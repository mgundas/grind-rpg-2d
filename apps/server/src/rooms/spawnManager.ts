import {
  isWalkableAt,
  nearestWalkable,
  randomRange,
  type CollisionGrid,
  type MapId,
  type MobZone,
  type RandomSource,
  type Vec2,
} from "@jadethrone/shared";
import { getMonster } from "@jadethrone/data/monsters";
import { getSpawnGroup, type SpawnGroupInfo, type SpawnMember } from "@jadethrone/data/spawnGroups";
import { aggroMonster } from "./monsterAi";
import { createMonsterRuntime, type MonsterRuntime } from "./monsterRuntime";
import { MonsterState, type WorldState } from "./state/WorldState";

/**
 * Spawn groups and pack behaviour (GAME_DESIGN.md §6.1). Placement is
 * deterministic from a per-group seeded stream, so a fixed seed always produces
 * the same pack layout; live rooms seed from the room id.
 */

export interface SpawnGroupRuntime {
  id: string;
  zone: MobZone;
  zoneIndex: number;
  group: SpawnGroupInfo;
  generation: number;
  /** Ids of currently living members. */
  members: Set<string>;
  respawnAtMs: number | null;
  rng: RandomSource;
}

export interface SpawnManager {
  mapId: MapId;
  grid: CollisionGrid;
  state: WorldState;
  runtimes: Map<string, MonsterRuntime>;
  groups: SpawnGroupRuntime[];
  monsterGroup: Map<string, SpawnGroupRuntime>;
  /** Monotonic counter for admin-spawned monsters (never group members). */
  adminSeq: number;
}

export interface BossStatus {
  groupId: string;
  typeId: string;
  name: string;
  alive: boolean;
  respawnAtMs: number | null;
}

export const ADMIN_MONSTER_GROUP = "@admin";

export interface SpawnManagerInput {
  mapId: MapId;
  grid: CollisionGrid;
  state: WorldState;
  runtimes: Map<string, MonsterRuntime>;
  mobZones: readonly MobZone[];
  rngForGroup: (seed: string) => RandomSource;
}

export interface PlaceGroupInput {
  zone: MobZone;
  group: SpawnGroupInfo;
  grid: CollisionGrid;
  rng: RandomSource;
  occupied?: readonly Vec2[];
  players?: readonly Vec2[];
}

export interface PlacedMonster {
  monsterId: string;
  x: number;
  y: number;
  leader: boolean;
}

const ZONE_MARGIN_PX = 16;
const PLAYER_SPACING_PX = 40;
const MONSTER_SPACING_PX = 24;
const RING_MIN_PX = 48;
const RING_MAX_PX = 72;
const PLACEMENT_ATTEMPTS = 16;

function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function insideZone(zone: MobZone, point: Vec2): boolean {
  return (
    point.x >= zone.x + ZONE_MARGIN_PX &&
    point.x <= zone.x + zone.w - ZONE_MARGIN_PX &&
    point.y >= zone.y + ZONE_MARGIN_PX &&
    point.y <= zone.y + zone.h - ZONE_MARGIN_PX
  );
}

function isFree(
  point: Vec2,
  grid: CollisionGrid,
  occupied: readonly Vec2[],
  players: readonly Vec2[],
): boolean {
  if (!isWalkableAt(grid, point.x, point.y)) {
    return false;
  }
  for (const other of occupied) {
    if (distanceSq(point, other) < MONSTER_SPACING_PX * MONSTER_SPACING_PX) {
      return false;
    }
  }
  for (const player of players) {
    if (distanceSq(point, player) < PLAYER_SPACING_PX * PLAYER_SPACING_PX) {
      return false;
    }
  }
  return true;
}

function zoneCentre(zone: MobZone): Vec2 {
  return { x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 };
}

function randomPointInZone(zone: MobZone, rng: RandomSource): Vec2 {
  const minX = zone.x + ZONE_MARGIN_PX;
  const maxX = Math.max(minX, zone.x + zone.w - ZONE_MARGIN_PX);
  const minY = zone.y + ZONE_MARGIN_PX;
  const maxY = Math.max(minY, zone.y + zone.h - ZONE_MARGIN_PX);
  return {
    x: randomRange(rng, minX, maxX),
    y: randomRange(rng, minY, maxY),
  };
}

function ringPoint(centre: Vec2, rng: RandomSource, attempt: number): Vec2 {
  const angle = rng.next() * Math.PI * 2 + attempt * 0.61803398875;
  const radius = RING_MIN_PX + rng.next() * (RING_MAX_PX - RING_MIN_PX);
  return {
    x: centre.x + Math.cos(angle) * radius,
    y: centre.y + Math.sin(angle) * radius,
  };
}

function chooseSpot(
  zone: MobZone,
  grid: CollisionGrid,
  rng: RandomSource,
  occupied: readonly Vec2[],
  players: readonly Vec2[],
  preferred: readonly Vec2[],
): Vec2 | null {
  for (const point of preferred) {
    if (insideZone(zone, point) && isFree(point, grid, occupied, players)) {
      return point;
    }
  }
  for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
    const point = randomPointInZone(zone, rng);
    if (isFree(point, grid, occupied, players)) {
      return point;
    }
  }
  return null;
}

/** Expand member entries into one slot per monster, leader(s) first. */
function expandMembers(
  members: readonly SpawnMember[],
): Array<{ monsterId: string; leader: boolean }> {
  const slots: Array<{ monsterId: string; leader: boolean }> = [];
  for (const member of members) {
    for (let index = 0; index < member.count; index++) {
      slots.push({ monsterId: member.monsterId, leader: member.leader === true && index === 0 });
    }
  }
  return slots.sort((a, b) => Number(b.leader) - Number(a.leader));
}

/**
 * Deterministic pack placement inside a mob zone. The leader takes the zone
 * centre (snapped to walkable ground), the rest form a seeded ring, then fall
 * back to random points. Spots too close to existing monsters or players, or
 * outside the zone, are skipped.
 */
export function placeGroup(input: PlaceGroupInput): PlacedMonster[] {
  const { zone, group, grid, rng } = input;
  const occupied: Vec2[] = [...(input.occupied ?? [])];
  const players = input.players ?? [];
  const slots = expandMembers(group.members);
  const placed: PlacedMonster[] = [];
  const centre = zoneCentre(zone);

  let anchor = centre;
  for (const slot of slots) {
    const preferred: Vec2[] = [];
    if (slot.leader) {
      const snapped = isWalkableAt(grid, centre.x, centre.y)
        ? centre
        : nearestWalkable(grid, centre.x, centre.y, 6);
      if (snapped) {
        preferred.push(snapped);
        anchor = snapped;
      }
    } else {
      for (let attempt = 0; attempt < 8; attempt++) {
        preferred.push(ringPoint(anchor, rng, attempt));
      }
    }

    const spot = chooseSpot(zone, grid, rng, occupied, players, preferred);
    if (!spot) {
      continue;
    }
    occupied.push(spot);
    placed.push({ monsterId: slot.monsterId, x: spot.x, y: spot.y, leader: slot.leader });
  }

  return placed;
}

export function createSpawnManager(input: SpawnManagerInput): SpawnManager {
  const groups: SpawnGroupRuntime[] = input.mobZones.map((zone, zoneIndex) => {
    const group = getSpawnGroup(zone.spawnGroupId);
    return {
      id: group.id,
      zone,
      zoneIndex,
      group,
      generation: 0,
      members: new Set<string>(),
      respawnAtMs: null,
      rng: input.rngForGroup(`${input.mapId}:${group.id}`),
    };
  });

  return {
    mapId: input.mapId,
    grid: input.grid,
    state: input.state,
    runtimes: input.runtimes,
    groups,
    monsterGroup: new Map(),
    adminSeq: 0,
  };
}

function occupiedPositions(manager: SpawnManager): Vec2[] {
  return [...manager.state.monsters.values()].map((monster) => ({
    x: monster.x,
    y: monster.y,
  }));
}

/** Spawn one fresh generation for a group. Returns the number placed. */
export function spawnGroup(
  manager: SpawnManager,
  group: SpawnGroupRuntime,
  now: number,
  players: readonly Vec2[] = [],
): number {
  const generation = group.generation++;
  const placed = placeGroup({
    zone: group.zone,
    group: group.group,
    grid: manager.grid,
    rng: group.rng,
    occupied: occupiedPositions(manager),
    players,
  });

  group.members.clear();
  for (const [index, spawn] of placed.entries()) {
    const spec = getMonster(spawn.monsterId);
    const id = `m${group.zoneIndex}_g${generation}_${index}`;
    const monster = new MonsterState();
    monster.typeId = spec.id;
    monster.name = spec.name;
    monster.level = spec.level;
    monster.x = spawn.x;
    monster.y = spawn.y;
    monster.facing = 0;
    monster.hp = spec.hp;
    monster.maxHp = spec.hp;
    monster.moving = false;
    monster.isBoss = spec.isBoss;

    const runtime = createMonsterRuntime({
      id,
      typeId: spec.id,
      groupId: group.id,
      home: { x: spawn.x, y: spawn.y },
      maxHp: spec.hp,
      generation,
      spawnIndex: index,
      now,
    });

    manager.state.monsters.set(id, monster);
    manager.runtimes.set(id, runtime);
    manager.monsterGroup.set(id, group);
    group.members.add(id);
  }

  // An entirely blocked zone retries soon instead of waiting 30–60 s.
  group.respawnAtMs = placed.length === 0 ? now + 5000 : null;
  return placed.length;
}

export interface AdminMonsterSpawnInput {
  typeId: string;
  count: number;
  position: Vec2;
  now: number;
  rng: RandomSource;
}

export interface AdminMonsterSpawnResult {
  monsterId: string;
  x: number;
  y: number;
}

/**
 * Spawn monsters on demand without a spawn group. They participate in normal
 * AI/combat/drops but have no group, so `notifyMonsterDeath` does not schedule
 * a respawn and `aggroGroup` is a no-op.
 */
export function spawnAdminMonsters(
  manager: SpawnManager,
  input: AdminMonsterSpawnInput,
): AdminMonsterSpawnResult[] {
  const result: AdminMonsterSpawnResult[] = [];
  for (let index = 0; index < input.count; index++) {
    const spec = getMonster(input.typeId);
    const ring = 48 + 16 * Math.floor(index / 8);
    const angle = input.rng.next() * Math.PI * 2;
    const candidate = {
      x: input.position.x + Math.cos(angle) * ring,
      y: input.position.y + Math.sin(angle) * ring,
    };
    const spot = nearestWalkable(manager.grid, candidate.x, candidate.y) ?? input.position;
    const id = `a${++manager.adminSeq}`;

    const monster = new MonsterState();
    monster.typeId = spec.id;
    monster.name = spec.name;
    monster.level = spec.level;
    monster.x = spot.x;
    monster.y = spot.y;
    monster.facing = 0;
    monster.hp = spec.hp;
    monster.maxHp = spec.hp;
    monster.moving = false;
    monster.isBoss = spec.isBoss;

    const runtime = createMonsterRuntime({
      id,
      typeId: spec.id,
      groupId: ADMIN_MONSTER_GROUP,
      home: { x: spot.x, y: spot.y },
      maxHp: spec.hp,
      generation: 0,
      spawnIndex: index,
      now: input.now,
    });
    manager.state.monsters.set(id, monster);
    manager.runtimes.set(id, runtime);
    result.push({ monsterId: id, x: spot.x, y: spot.y });
  }
  return result;
}

export function spawnAllGroups(
  manager: SpawnManager,
  now: number,
  players: readonly Vec2[] = [],
): void {
  for (const group of manager.groups) {
    spawnGroup(manager, group, now, players);
  }
}

/** Respawn groups whose last member died long enough ago. Returns how many
 * groups spawned so the room can refresh interest immediately. */
export function tickSpawns(
  manager: SpawnManager,
  now: number,
  players: readonly Vec2[] = [],
): number {
  let spawned = 0;
  for (const group of manager.groups) {
    if (group.respawnAtMs !== null && now >= group.respawnAtMs) {
      spawnGroup(manager, group, now, players);
      spawned++;
    }
  }
  return spawned;
}

/**
 * Remove a dead monster from its group. The group respawns 30–60 s after its
 * last member dies; partial wipes never schedule a respawn.
 */
export function notifyMonsterDeath(manager: SpawnManager, monsterId: string, now: number): void {
  const group = manager.monsterGroup.get(monsterId);
  if (!group) {
    return;
  }
  manager.monsterGroup.delete(monsterId);
  group.members.delete(monsterId);
  if (group.members.size === 0 && group.respawnAtMs === null) {
    group.respawnAtMs =
      now + randomRange(group.rng, group.group.respawnMinMs, group.group.respawnMaxMs);
  }
}

/**
 * Pack aggro: damaging one member makes every living member chase the attacker.
 * Returning monsters ignore it (they are invulnerable until they reach home).
 */
/**
 * Public boss clocks for the HUD. Field bosses are identified by their spawn
 * group definition; regular packs are ignored.
 */
export function bossStatuses(manager: SpawnManager): BossStatus[] {
  const result: BossStatus[] = [];
  for (const group of manager.groups) {
    const bossMember = group.group.members.find((member) => getMonster(member.monsterId).isBoss);
    if (!bossMember) {
      continue;
    }
    const spec = getMonster(bossMember.monsterId);
    const alive = [...group.members].some((id) => {
      const runtime = manager.runtimes.get(id);
      return Boolean(runtime && runtime.typeId === spec.id && runtime.hp > 0);
    });
    result.push({
      groupId: group.id,
      typeId: spec.id,
      name: spec.name,
      alive,
      respawnAtMs: alive ? null : group.respawnAtMs,
    });
  }
  return result;
}

export function aggroGroup(
  manager: SpawnManager,
  monsterId: string,
  attackerSessionId: string,
): void {
  const group = manager.monsterGroup.get(monsterId);
  if (!group) {
    return;
  }
  for (const memberId of group.members) {
    const runtime = manager.runtimes.get(memberId);
    if (runtime && runtime.hp > 0) {
      aggroMonster(runtime, attackerSessionId);
    }
  }
}

export function livingMembers(manager: SpawnManager, groupId: string): MonsterRuntime[] {
  const group = manager.groups.find((candidate) => candidate.id === groupId);
  if (!group) {
    return [];
  }
  const result: MonsterRuntime[] = [];
  for (const memberId of group.members) {
    const runtime = manager.runtimes.get(memberId);
    if (runtime) {
      result.push(runtime);
    }
  }
  return result;
}

import { describe, expect, it } from "vitest";
import {
  ROOM_NAME_FIELDS,
  seededRandomSource,
  type CollisionGrid,
  type MobZone,
  type Vec2,
} from "@jadethrone/shared";
import { getMonster } from "@jadethrone/data/monsters";
import { getSpawnGroup } from "@jadethrone/data/spawnGroups";
import { createMonsterRuntime, type MonsterRuntime } from "../../src/rooms/monsterRuntime";
import {
  aggroGroup,
  createSpawnManager,
  notifyMonsterDeath,
  placeGroup,
  spawnAllGroups,
  tickSpawns,
  type SpawnManager,
} from "../../src/rooms/spawnManager";
import { WorldState } from "../../src/rooms/state/WorldState";

const ZONE: MobZone = {
  x: 96,
  y: 96,
  w: 256,
  h: 256,
  spawnGroupId: "field_wolves",
};

function grid(solid: boolean = false): CollisionGrid {
  const width = 40;
  const height = 40;
  const cells = new Uint8Array(width * height);
  if (solid) {
    cells.fill(1);
  }
  return { width, height, tileSize: 32, solid: cells };
}

function makeManager(
  options: {
    zones?: readonly MobZone[];
    seed?: number;
    map?: CollisionGrid;
  } = {},
): {
  manager: SpawnManager;
  state: WorldState;
  runtimes: Map<string, MonsterRuntime>;
} {
  const state = new WorldState();
  const runtimes = new Map<string, MonsterRuntime>();
  const seed = options.seed ?? 7;
  const manager = createSpawnManager({
    mapId: ROOM_NAME_FIELDS,
    grid: options.map ?? grid(),
    state,
    runtimes,
    mobZones: options.zones ?? [ZONE],
    rngForGroup: () => seededRandomSource(seed),
  });
  return { manager, state, runtimes };
}

function kill(manager: SpawnManager, monsterId: string, now: number): void {
  manager.state.monsters.delete(monsterId);
  manager.runtimes.delete(monsterId);
  notifyMonsterDeath(manager, monsterId, now);
}

describe("placeGroup", () => {
  it("places a full pack inside the zone, leader first", () => {
    const placed = placeGroup({
      zone: ZONE,
      group: getSpawnGroup("field_wolves"),
      grid: grid(),
      rng: seededRandomSource(7),
    });

    expect(placed).toHaveLength(6);
    expect(placed[0]?.leader).toBe(true);
    expect(placed[0]?.monsterId).toBe("alpha_wolf");
    for (const spawn of placed) {
      expect(spawn.x).toBeGreaterThanOrEqual(ZONE.x + 16);
      expect(spawn.x).toBeLessThanOrEqual(ZONE.x + ZONE.w - 16);
      expect(spawn.y).toBeGreaterThanOrEqual(ZONE.y + 16);
      expect(spawn.y).toBeLessThanOrEqual(ZONE.y + ZONE.h - 16);
      for (const other of placed) {
        if (other === spawn) continue;
        const dx = other.x - spawn.x;
        const dy = other.y - spawn.y;
        expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(24 * 24);
      }
    }
  });

  it("is deterministic for the same seed", () => {
    const first = placeGroup({
      zone: ZONE,
      group: getSpawnGroup("field_wolves"),
      grid: grid(),
      rng: seededRandomSource(99),
    });
    const second = placeGroup({
      zone: ZONE,
      group: getSpawnGroup("field_wolves"),
      grid: grid(),
      rng: seededRandomSource(99),
    });
    expect(first).toEqual(second);
  });

  it("keeps spawns at least 40 px from players", () => {
    const player: Vec2 = { x: ZONE.x + ZONE.w / 2, y: ZONE.y + ZONE.h / 2 };
    const placed = placeGroup({
      zone: ZONE,
      group: getSpawnGroup("field_wolves"),
      grid: grid(),
      rng: seededRandomSource(3),
      players: [player],
    });
    expect(placed.length).toBeGreaterThan(0);
    for (const spawn of placed) {
      const dx = spawn.x - player.x;
      const dy = spawn.y - player.y;
      expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(40 * 40);
    }
  });

  it("places nothing in a fully blocked zone", () => {
    const placed = placeGroup({
      zone: ZONE,
      group: getSpawnGroup("field_wolves"),
      grid: grid(true),
      rng: seededRandomSource(7),
    });
    expect(placed).toEqual([]);
  });
});

describe("spawn manager", () => {
  it("spawns every group member with the right state", () => {
    const { manager, state, runtimes } = makeManager();
    spawnAllGroups(manager, 1000);

    expect(state.monsters.size).toBe(6);
    expect(runtimes.size).toBe(6);
    const alpha = [...state.monsters.values()].find((monster) => monster.typeId === "alpha_wolf")!;
    const spec = getMonster("alpha_wolf");
    expect(alpha.name).toBe(spec.name);
    expect(alpha.level).toBe(spec.level);
    expect(alpha.hp).toBe(spec.hp);
    expect(alpha.maxHp).toBe(spec.hp);
    expect(alpha.isBoss).toBe(false);
  });

  it("spawns a single boss with its long respawn window", () => {
    const bossZone: MobZone = { ...ZONE, spawnGroupId: "field_boss" };
    const { manager, state } = makeManager({ zones: [bossZone] });
    spawnAllGroups(manager, 0);

    expect(state.monsters.size).toBe(1);
    expect([...state.monsters.values()][0]?.isBoss).toBe(true);
    expect(manager.groups[0]?.group.respawnMinMs).toBe(20 * 60 * 1000);
  });

  it("respawns only after the last member dies", () => {
    const { manager, state } = makeManager();
    spawnAllGroups(manager, 0);
    const group = manager.groups[0]!;
    const ids = [...group.members];

    for (const id of ids.slice(0, -1)) {
      kill(manager, id, 1000);
    }
    expect(group.respawnAtMs).toBeNull();
    expect(state.monsters.size).toBe(1);

    kill(manager, ids[ids.length - 1]!, 1000);
    expect(group.respawnAtMs).not.toBeNull();
    expect(group.respawnAtMs!).toBeGreaterThanOrEqual(31_000);
    expect(group.respawnAtMs!).toBeLessThanOrEqual(61_000);

    const respawnAt = group.respawnAtMs!;
    tickSpawns(manager, respawnAt - 1);
    expect(state.monsters.size).toBe(0);

    tickSpawns(manager, respawnAt);
    expect(state.monsters.size).toBe(6);
    expect(group.generation).toBe(2);
    expect([...state.monsters.keys()].every((id) => id.includes("_g1_"))).toBe(true);
  });

  it("retries quickly when the zone has no room", () => {
    const { manager, state } = makeManager({ map: grid(true) });
    spawnAllGroups(manager, 500);
    expect(state.monsters.size).toBe(0);
    expect(manager.groups[0]?.respawnAtMs).toBe(5500);
  });

  it("aggroes the whole pack and skips returning members", () => {
    const { manager, runtimes } = makeManager();
    spawnAllGroups(manager, 0);
    const group = manager.groups[0]!;
    const [first, second] = [...group.members];

    aggroGroup(manager, first!, "p1");
    for (const id of group.members) {
      expect(runtimes.get(id)?.ai).toBe("chase");
      expect(runtimes.get(id)?.targetSessionId).toBe("p1");
    }

    runtimes.get(second!)!.ai = "return";
    aggroGroup(manager, first!, "p1");
    expect(runtimes.get(second!)?.ai).toBe("return");
  });
});

describe("spawn manager runtime plumbing", () => {
  it("creates runtimes that share ids with the schema entities", () => {
    const { manager, state, runtimes } = makeManager();
    spawnAllGroups(manager, 0);
    for (const [id, monster] of state.monsters) {
      const runtime = runtimes.get(id)!;
      expect(runtime).toBeDefined();
      expect(runtime.typeId).toBe(monster.typeId);
      expect(runtime.mover.pos).toEqual({ x: monster.x, y: monster.y });
      expect(runtime.maxHp).toBe(monster.maxHp);
    }
  });

  it("exposes a createMonsterRuntime factory independent of the manager", () => {
    const runtime = createMonsterRuntime({
      id: "m0_g0_0",
      typeId: "wild_dog",
      groupId: "field_wolves",
      home: { x: 100, y: 100 },
      maxHp: 28,
      generation: 0,
      spawnIndex: 0,
      now: 0,
    });
    expect(runtime.hp).toBe(28);
    expect(runtime.ai).toBe("idle");
  });
});

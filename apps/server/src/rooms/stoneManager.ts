import type { StoneInfo } from "@jadethrone/data/stones";
import {
  isWalkableAt,
  nearestWalkable,
  type CollisionGrid,
  type RandomSource,
  type TiledObjectJson,
  type Vec2,
} from "@jadethrone/shared";

/** Empty margin inside a stone zone so stones do not sit on the exact edge. */
const ZONE_MARGIN_PX = 24;
const MIN_STONE_SPACING_PX = 140;
const PLACEMENT_ATTEMPTS = 24;

export interface StoneZone {
  info: StoneInfo;
  zone: TiledObjectJson;
}

export interface StoneRuntime {
  stoneId: string;
  infoId: string;
  zoneId: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Damage attributed to each session since spawn. */
  damageBy: Map<string, number>;
  /** Index into the descending wave-trigger array. */
  nextWaveIndex: number;
}

export interface StoneDamageResult {
  stoneId: string;
  hp: number;
  destroyed: boolean;
  /** One wave per crossed 20% threshold. */
  waves: number;
}

interface PendingStone {
  zone: StoneZone;
  respawnAtMs: number;
}

export interface StoneManager {
  readonly zones: StoneZone[];
  readonly stones: Map<string, StoneRuntime>;
  spawnInitial(now?: number): StoneRuntime[];
  tick(now?: number): StoneRuntime[];
  get(stoneId: string): StoneRuntime | undefined;
  livingInZone(zoneId: string): StoneRuntime[];
  damage(
    stoneId: string,
    sessionId: string,
    amount: number,
    now?: number,
  ): StoneDamageResult | null;
  clear(): void;
}

function zoneIdOf(zone: TiledObjectJson): string {
  const value = zone.properties?.find((property) => property.name === "zoneId")?.value;
  return typeof value === "string" ? value : zone.name;
}

function inZone(zone: TiledObjectJson, point: Vec2, margin = 0): boolean {
  const width = zone.width ?? 0;
  const height = zone.height ?? 0;
  return (
    point.x >= zone.x + margin &&
    point.x <= zone.x + width - margin &&
    point.y >= zone.y + margin &&
    point.y <= zone.y + height - margin
  );
}

export function createStoneManager(input: {
  zones: readonly StoneZone[];
  grid: CollisionGrid;
  rng: RandomSource;
  idFactory: () => string;
}): StoneManager {
  const stones = new Map<string, StoneRuntime>();
  const pending: PendingStone[] = [];

  function livingInZone(zoneId: string): StoneRuntime[] {
    return [...stones.values()].filter((stone) => stone.zoneId === zoneId);
  }

  function chooseSpot(zone: StoneZone): Vec2 | null {
    const width = zone.zone.width ?? 0;
    const height = zone.zone.height ?? 0;
    if (width <= ZONE_MARGIN_PX * 2 || height <= ZONE_MARGIN_PX * 2) {
      return null;
    }
    for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
      const candidate = {
        x: zone.zone.x + ZONE_MARGIN_PX + input.rng.next() * (width - ZONE_MARGIN_PX * 2),
        y: zone.zone.y + ZONE_MARGIN_PX + input.rng.next() * (height - ZONE_MARGIN_PX * 2),
      };
      const spot = nearestWalkable(input.grid, candidate.x, candidate.y);
      if (!spot || !inZone(zone.zone, spot)) {
        continue;
      }
      const tooClose = livingInZone(zone.info.zoneId).some((stone) => {
        const dx = stone.x - spot.x;
        const dy = stone.y - spot.y;
        return dx * dx + dy * dy < MIN_STONE_SPACING_PX * MIN_STONE_SPACING_PX;
      });
      if (!tooClose && isWalkableAt(input.grid, spot.x, spot.y)) {
        return spot;
      }
    }
    return null;
  }

  function spawnOne(zone: StoneZone): StoneRuntime | null {
    if (livingInZone(zone.info.zoneId).length >= zone.info.maxPerZone) {
      return null;
    }
    const spot = chooseSpot(zone);
    if (!spot) {
      return null;
    }
    const runtime: StoneRuntime = {
      stoneId: input.idFactory(),
      infoId: zone.info.id,
      zoneId: zone.info.zoneId,
      x: spot.x,
      y: spot.y,
      hp: zone.info.hp,
      maxHp: zone.info.hp,
      damageBy: new Map(),
      nextWaveIndex: 0,
    };
    stones.set(runtime.stoneId, runtime);
    return runtime;
  }

  function spawnForZone(zone: StoneZone, now: number): StoneRuntime[] {
    const spawned: StoneRuntime[] = [];
    while (livingInZone(zone.info.zoneId).length < zone.info.maxPerZone) {
      const stone = spawnOne(zone);
      if (!stone) {
        break;
      }
      spawned.push(stone);
    }
    if (spawned.length === 0 && livingInZone(zone.info.zoneId).length === 0) {
      pending.push({ zone, respawnAtMs: now + 5_000 });
    }
    return spawned;
  }

  function spawnInitial(now = Date.now()): StoneRuntime[] {
    const spawned: StoneRuntime[] = [];
    for (const zone of input.zones) {
      spawned.push(...spawnForZone(zone, now));
    }
    return spawned;
  }

  function tick(now = Date.now()): StoneRuntime[] {
    const spawned: StoneRuntime[] = [];
    for (let index = pending.length - 1; index >= 0; index--) {
      const entry = pending[index]!;
      if (entry.respawnAtMs > now) {
        continue;
      }
      pending.splice(index, 1);
      const stone = spawnOne(entry.zone);
      if (stone) {
        spawned.push(stone);
      } else if (livingInZone(entry.zone.info.zoneId).length < entry.zone.info.maxPerZone) {
        pending.push({ zone: entry.zone, respawnAtMs: now + 5_000 });
      }
    }
    return spawned;
  }

  function damage(
    stoneId: string,
    sessionId: string,
    amount: number,
    now = Date.now(),
  ): StoneDamageResult | null {
    const stone = stones.get(stoneId);
    if (!stone) {
      return null;
    }
    const info = input.zones.find((zone) => zone.info.id === stone.infoId)?.info;
    if (!info) {
      return null;
    }
    const safeDamage = Math.max(0, Math.floor(amount));
    stone.damageBy.set(sessionId, (stone.damageBy.get(sessionId) ?? 0) + safeDamage);
    stone.hp = Math.max(0, stone.hp - safeDamage);

    let waves = 0;
    while (stone.nextWaveIndex < info.waveTriggers.length) {
      const threshold = info.waveTriggers[stone.nextWaveIndex]!;
      if (stone.hp > info.hp * (threshold / 100)) {
        break;
      }
      stone.nextWaveIndex++;
      waves++;
    }

    if (stone.hp > 0) {
      return { stoneId, hp: stone.hp, destroyed: false, waves };
    }
    stones.delete(stoneId);
    const zone = input.zones.find((entry) => entry.info.id === stone.infoId);
    if (zone) {
      const respawnAtMs = now + info.respawnMinMs + input.rng.next() * (info.respawnMaxMs - info.respawnMinMs);
      pending.push({ zone, respawnAtMs });
    }
    return { stoneId, hp: 0, destroyed: true, waves };
  }

  return {
    zones: [...input.zones],
    stones,
    spawnInitial,
    tick,
    get(stoneId) {
      return stones.get(stoneId);
    },
    livingInZone,
    damage,
    clear() {
      stones.clear();
      pending.length = 0;
    },
  };
}

/** Zone id from a Tiled object, shared by map/room wiring. */
export { zoneIdOf };

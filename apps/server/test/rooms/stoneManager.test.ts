import { describe, expect, it } from "vitest";
import { getStone } from "@jadethrone/data/stones";
import {
  seedFromString,
  seededRandomSource,
  type CollisionGrid,
  type TiledObjectJson,
} from "@jadethrone/shared";
import { createStoneManager, zoneIdOf, type StoneZone } from "../../src/rooms/stoneManager";

const info = getStone("ember_fields_stone");
const zone: TiledObjectJson = {
  name: "stone_zone",
  x: 100,
  y: 100,
  width: 640,
  height: 640,
  properties: [{ name: "zoneId", type: "string", value: info.zoneId }],
};

function grid(solid = false): CollisionGrid {
  const width = 40;
  const height = 40;
  return {
    width,
    height,
    tileSize: 32,
    solid: new Uint8Array(width * height).fill(solid ? 1 : 0),
  };
}

function ids(): () => string {
  let next = 0;
  return () => `stone-${++next}`;
}

function create(options: { solid?: boolean; zones?: StoneZone[] } = {}) {
  return createStoneManager({
    zones: options.zones ?? [{ info, zone }],
    grid: grid(options.solid),
    rng: seededRandomSource(seedFromString("stone-test")),
    idFactory: ids(),
  });
}

describe("stone manager", () => {
  it("spawns at most the zone cap on walkable, spaced ground", () => {
    const manager = create();
    const stones = manager.spawnInitial(1000);
    expect(stones.length).toBeGreaterThan(0);
    expect(stones.length).toBeLessThanOrEqual(info.maxPerZone);
    expect(manager.livingInZone(info.zoneId)).toHaveLength(stones.length);
    for (const stone of stones) {
      expect(stone.x).toBeGreaterThanOrEqual(zone.x);
      expect(stone.x).toBeLessThanOrEqual(zone.x + (zone.width ?? 0));
      expect(stone.y).toBeGreaterThanOrEqual(zone.y);
      expect(stone.y).toBeLessThanOrEqual(zone.y + (zone.height ?? 0));
    }
    for (let index = 0; index < stones.length; index++) {
      for (let other = index + 1; other < stones.length; other++) {
        const dx = stones[index]!.x - stones[other]!.x;
        const dy = stones[index]!.y - stones[other]!.y;
        expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(140);
      }
    }
  });

  it("spawns nothing when the whole zone is blocked", () => {
    const manager = create({ solid: true });
    expect(manager.spawnInitial(1000)).toHaveLength(0);
  });

  it("spawns one wave per crossed 20% threshold, including overkill", () => {
    const manager = create();
    const [stone] = manager.spawnInitial(1000);
    expect(stone).toBeDefined();
    const id = stone!.stoneId;

    expect(manager.damage(id, "a", 2400, 1100)).toMatchObject({ waves: 1, destroyed: false });
    expect(manager.damage(id, "a", 2400, 1200)).toMatchObject({ waves: 1, destroyed: false });
    expect(manager.damage(id, "b", 4800, 1300)).toMatchObject({ waves: 2, destroyed: false });
    expect(manager.damage(id, "b", 5000, 1400)).toMatchObject({ waves: 0, destroyed: true });
    expect(manager.get(id)).toBeUndefined();
    expect(manager.damage(id, "a", 100, 1500)).toBeNull();
  });

  it("attributes damage to sessions", () => {
    const manager = create();
    const [stone] = manager.spawnInitial(1000);
    manager.damage(stone!.stoneId, "alpha", 1000, 1100);
    manager.damage(stone!.stoneId, "beta", 500, 1200);
    expect(manager.get(stone!.stoneId)?.damageBy).toEqual(
      new Map([
        ["alpha", 1000],
        ["beta", 500],
      ]),
    );
  });

  it("respawns destroyed stones after their timer", () => {
    const manager = create();
    const [stone] = manager.spawnInitial(1000);
    manager.damage(stone!.stoneId, "a", info.hp, 2000);
    expect(manager.livingInZone(info.zoneId).length).toBeLessThan(info.maxPerZone + 1);
    const spawned = manager.tick(2000 + info.respawnMaxMs + 1);
    expect(spawned.length).toBeGreaterThan(0);
    expect(manager.livingInZone(info.zoneId).length).toBeGreaterThan(0);
  });

  it("reads a zone id from Tiled properties", () => {
    expect(zoneIdOf(zone)).toBe(info.zoneId);
    expect(zoneIdOf({ name: "stone_zone", x: 0, y: 0 })).toBe("stone_zone");
  });
});

import { describe, expect, it } from "vitest";
import { getDropTable, hasDropTable } from "@jadethrone/data/dropTables";
import { getStone, getStoneForZone, hasStone, STONES } from "@jadethrone/data/stones";

describe("stones.json", () => {
  it("defines the Ember Fields stone zone", () => {
    const stone = getStoneForZone("fields_stones");
    expect(stone).toBeDefined();
    expect(stone?.mapId).toBe("map_ember_fields");
    expect(stone?.maxPerZone).toBe(3);
    expect(stone?.hp).toBeGreaterThan(10_000);
  });

  it("spawns waves every 20% with 4–6 monsters", () => {
    for (const stone of STONES) {
      expect(stone.waveTriggers).toEqual([80, 60, 40, 20]);
      expect(stone.waveMin).toBeGreaterThanOrEqual(4);
      expect(stone.waveMax).toBeLessThanOrEqual(6);
      expect(stone.waveMax).toBeGreaterThanOrEqual(stone.waveMin);
      expect(stone.waveMonsters.length).toBeGreaterThan(0);
    }
  });

  it("uses existing monsters and drop tables", () => {
    for (const stone of STONES) {
      expect(hasDropTable(stone.dropTableId)).toBe(true);
      const table = getDropTable(stone.dropTableId);
      expect(table.drops.some((drop) => drop.itemId === "material_spirit_shard")).toBe(true);
    }
  });

  it("respawns between three and five minutes with valid rewards", () => {
    for (const stone of STONES) {
      expect(stone.respawnMinMs).toBeGreaterThanOrEqual(180_000);
      expect(stone.respawnMaxMs).toBeLessThanOrEqual(300_000);
      expect(stone.respawnMaxMs).toBeGreaterThanOrEqual(stone.respawnMinMs);
      expect(stone.goldMax).toBeGreaterThanOrEqual(stone.goldMin);
      expect(stone.xp).toBeGreaterThan(0);
      expect(stone.spriteKey.length).toBeGreaterThan(0);
    }
  });

  it("looks stones up by id and zone", () => {
    expect(hasStone("ember_fields_stone")).toBe(true);
    expect(hasStone("nope")).toBe(false);
    expect(getStone("ember_fields_stone").name).toBe("Corrupted Spirit Stone");
    expect(getStoneForZone("missing_zone")).toBeUndefined();
    expect(() => getStone("nope")).toThrow(/unknown stone/);
  });
});

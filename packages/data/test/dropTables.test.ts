import { describe, expect, it } from "vitest";
import { MONSTERS } from "@jadethrone/data/monsters";
import { DROP_TABLES, getDropTable, hasDropTable } from "@jadethrone/data/dropTables";
import { getItem } from "@jadethrone/data/items";

describe("dropTables.json", () => {
  it("defines one table per starter monster", () => {
    expect(DROP_TABLES).toHaveLength(MONSTERS.length);
    expect(new Set(DROP_TABLES.map((table) => table.id)).size).toBe(DROP_TABLES.length);
  });

  it("references real items with valid quantities and chances", () => {
    for (const table of DROP_TABLES) {
      expect(table.drops.length).toBeGreaterThan(0);
      for (const drop of table.drops) {
        expect(drop.chance).toBeGreaterThan(0);
        expect(drop.chance).toBeLessThanOrEqual(1);
        expect(drop.minQty).toBeGreaterThanOrEqual(1);
        expect(drop.maxQty).toBeGreaterThanOrEqual(drop.minQty);
        expect(drop.maxQty).toBeLessThanOrEqual(getItem(drop.itemId).maxStack);
      }
    }
  });

  it("keeps a deterministic level-1 drop for acceptance testing", () => {
    const wildDog = getDropTable("wild_dog");
    expect(wildDog.drops).toContainEqual({
      itemId: "material_wolf_fang",
      chance: 1,
      minQty: 1,
      maxQty: 1,
    });
  });

  it("gives the boss a meaningful reward table", () => {
    const boss = getDropTable("wolf_king");
    expect(boss.drops.some((drop) => drop.itemId === "material_spirit_shard")).toBe(true);
    expect(boss.drops.some((drop) => drop.itemId === "material_corrupted_crystal")).toBe(true);
    expect(boss.drops.some((drop) => drop.itemId === "potion_hp_l")).toBe(true);
  });

  it("looks tables up by id", () => {
    expect(hasDropTable("wild_dog")).toBe(true);
    expect(hasDropTable("nope")).toBe(false);
    expect(() => getDropTable("nope")).toThrow(/unknown drop table/);
  });
});

import { describe, expect, it } from "vitest";
import { mulberry32 } from "../src/rng";
import { rollDrops, type DropRollEntry } from "../src/drops";

function rng(seed: number) {
  const next = mulberry32(seed);
  return { next };
}

const TABLE: DropRollEntry[] = [
  { itemId: "material_wolf_fang", chance: 1, minQty: 1, maxQty: 1 },
  { itemId: "potion_hp_s", chance: 0.5, minQty: 1, maxQty: 2 },
];

describe("rollDrops", () => {
  it("always includes guaranteed entries and respects the gold range", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const result = rollDrops(rng(seed), TABLE, 1, 4);
      expect(result.gold).toBeGreaterThanOrEqual(1);
      expect(result.gold).toBeLessThanOrEqual(4);
      expect(result.items).toContainEqual({ itemId: "material_wolf_fang", quantity: 1 });
    }
  });

  it("is deterministic for a given seed", () => {
    const first = rollDrops(rng(42), TABLE, 10, 20);
    const second = rollDrops(rng(42), TABLE, 10, 20);
    expect(second).toEqual(first);
  });

  it("rolls quantities within the configured bounds", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const result = rollDrops(rng(seed), TABLE, 0, 0);
      for (const drop of result.items) {
        const entry = TABLE.find((candidate) => candidate.itemId === drop.itemId)!;
        expect(drop.quantity).toBeGreaterThanOrEqual(entry.minQty);
        expect(drop.quantity).toBeLessThanOrEqual(entry.maxQty);
      }
    }
  });

  it("produces no gold when the range is empty", () => {
    expect(rollDrops(rng(1), [], 0, 0).gold).toBe(0);
    expect(rollDrops(rng(1), [], 5, 5).gold).toBe(5);
  });
});

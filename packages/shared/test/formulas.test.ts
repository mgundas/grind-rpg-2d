import { describe, expect, it } from "vitest";
import { maxHp, maxMp } from "@jadethrone/shared";

describe("character HP/MP formulas", () => {
  it("computes level-1 warrior HP/MP from the spec formula", () => {
    expect(maxHp({ baseHp: 120, vit: 4, level: 1 })).toBe(316);
    expect(maxMp({ baseMp: 20, int: 3, level: 1 })).toBe(92);
  });

  it("computes level-1 mystic HP/MP", () => {
    expect(maxHp({ baseHp: 80, vit: 3, level: 1 })).toBe(236);
    expect(maxMp({ baseMp: 50, int: 6, level: 1 })).toBe(182);
  });

  it("scales with level and stat points", () => {
    expect(maxHp({ baseHp: 120, vit: 10, level: 10 })).toBe(120 + 400 + 360);
    expect(maxMp({ baseMp: 20, int: 10, level: 10 })).toBe(20 + 200 + 120);
  });
});

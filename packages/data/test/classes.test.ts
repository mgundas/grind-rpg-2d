import { describe, expect, it } from "vitest";
import { CLASS_IDS } from "@jadethrone/shared";
import { CLASSES, getClass } from "@jadethrone/data/classes";

describe("classes.json", () => {
  it("declares every class exactly once", () => {
    expect(CLASSES.map((info) => info.id).sort()).toEqual([...CLASS_IDS].sort());
  });

  it("matches the starting stats from GAME_DESIGN.md §4.2", () => {
    expect(getClass("warrior").stats).toEqual({ vit: 4, int: 3, str: 6, dex: 3 });
    expect(getClass("assassin").stats).toEqual({ vit: 3, int: 3, str: 4, dex: 6 });
    expect(getClass("hexblade").stats).toEqual({ vit: 3, int: 5, str: 5, dex: 3 });
    expect(getClass("mystic").stats).toEqual({ vit: 3, int: 6, str: 3, dex: 4 });
  });

  it("gives every class two distinct doctrines and positive HP/MP bases", () => {
    for (const info of CLASSES) {
      expect(info.baseHp).toBeGreaterThan(0);
      expect(info.baseMp).toBeGreaterThan(0);
      expect(new Set(info.doctrines.map((doctrine) => doctrine.id)).size).toBe(2);
      expect(info.weapons.length).toBeGreaterThan(0);
      expect(info.colors.outfit).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("has globally unique doctrine ids", () => {
    const ids = CLASSES.flatMap((info) => info.doctrines.map((doctrine) => doctrine.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

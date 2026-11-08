import { describe, expect, it } from "vitest";
import {
  bonusItemStats,
  bonusValue,
  effectiveItemStats,
  equipmentForStats,
  itemNameColor,
  sumEquipmentStats,
  type ItemDefinitionLike,
} from "@jadethrone/shared";

const definition: ItemDefinitionLike = {
  id: "test_sword",
  type: "weapon",
  rarity: "common",
  size: 3,
  stackable: false,
  maxStack: 1,
  levelReq: 1,
  classes: "all",
  baseStats: { attack: 10 },
  upgradeChain: { attack: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18] },
};

describe("item bonuses", () => {
  it("maps classic bonus types into the stat block", () => {
    expect(
      bonusItemStats([
        { type: "attack", value: 5 },
        { type: "max_hp", value: 100 },
        { type: "crit_chance", value: 0.02 },
        { type: "strong_monsters", value: 0.1 },
      ]),
    ).toEqual({ attack: 5, defense: 0, maxHp: 100, maxMp: 0, critChance: 0.02 });
    expect(bonusValue([{ type: "move_speed", value: 0.05 }], "move_speed")).toBe(0.05);
  });

  it("adds bonuses on top of base and upgrade stats", () => {
    expect(
      effectiveItemStats(definition, 3, [
        { type: "attack", value: 5 },
        { type: "max_hp", value: 100 },
      ]),
    ).toEqual({ attack: 21, defense: 0, maxHp: 100, maxMp: 0, critChance: 0 });
    expect(sumEquipmentStats([{ definition, upgradeLevel: 1, bonuses: [] }]).attack).toBe(12);
  });

  it("keeps bonuses through equipmentForStats", () => {
    const state = {
      items: [],
      equipment: [
        {
          id: "i",
          itemId: definition.id,
          slot: 0,
          quantity: 1,
          upgradeLevel: 2,
          bonuses: [{ type: "attack", value: 3 }],
        },
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ],
    };
    const equipped = equipmentForStats(state, () => definition);
    expect(equipped[0]?.bonuses).toEqual([{ type: "attack", value: 3 }]);
    expect(sumEquipmentStats(equipped).attack).toBe(17);
  });

  it("colors names by bonus count", () => {
    expect(itemNameColor(0)).toBe("#e8eeea");
    expect(itemNameColor(1)).toBe("#4a90d9");
    expect(itemNameColor(2)).toBe("#4a90d9");
    expect(itemNameColor(3)).toBe("#9b59d0");
    expect(itemNameColor(4)).toBe("#9b59d0");
    expect(itemNameColor(5)).toBe("#d4a017");
  });
});

import { describe, expect, it } from "vitest";
import {
  canEquip,
  effectiveItemStats,
  emptyItemStats,
  equipSlotForItemType,
  isEquipmentType,
  sumEquipmentStats,
  type ItemDefinitionLike,
} from "../src/items";
import {
  equipmentForStats,
  type InventoryState,
  type ItemStack,
} from "../src/inventory";

function definition(overrides: Partial<ItemDefinitionLike> = {}): ItemDefinitionLike {
  return {
    id: "test_item",
    type: "weapon",
    rarity: "common",
    size: 1,
    stackable: false,
    maxStack: 1,
    levelReq: 1,
    classes: "all",
    ...overrides,
  };
}

function stack(overrides: Partial<ItemStack> = {}): ItemStack {
  return {
    id: "item-1",
    itemId: "test_item",
    slot: 0,
    quantity: 1,
    upgradeLevel: 0,
    bonuses: [],
    ...overrides,
  };
}

describe("item helpers", () => {
  it("maps every equipment type to its slot", () => {
    expect(equipSlotForItemType("weapon")).toBe("weapon");
    expect(equipSlotForItemType("armor")).toBe("armor");
    expect(equipSlotForItemType("skillbook")).toBeNull();
    expect(equipSlotForItemType("earrings")).toBe("earrings");
    expect(equipSlotForItemType("consumable")).toBeNull();
    expect(isEquipmentType("shield")).toBe(true);
    expect(isEquipmentType("material")).toBe(false);
  });

  it("adds the upgrade-chain entry to base stats", () => {
    const weapon = definition({
      baseStats: { attack: 10, maxHp: 5 },
      upgradeChain: {
        attack: [0, 2, 5, 8, 12, 16, 20, 25, 30, 40],
      },
    });
    expect(effectiveItemStats(weapon)).toEqual({ attack: 10, defense: 0, maxHp: 5, maxMp: 0, critChance: 0 });
    expect(effectiveItemStats(weapon, 3).attack).toBe(18);
    // Out-of-range levels clamp to the +9 entry rather than crashing.
    expect(effectiveItemStats(weapon, 99).attack).toBe(50);
  });

  it("sums equipped stats and ignores empty slots", () => {
    const sword = definition({ baseStats: { attack: 6 } });
    const armor = definition({ id: "armor", type: "armor", baseStats: { defense: 4, maxHp: 20 } });
    const total = sumEquipmentStats([
      { definition: sword, upgradeLevel: 0 },
      null,
      { definition: armor, upgradeLevel: 0 },
    ]);
    expect(total.attack).toBe(6);
    expect(total.defense).toBe(4);
    expect(total.maxHp).toBe(20);
    expect(total.critChance).toBe(0);
    expect(emptyItemStats()).toEqual({ attack: 0, defense: 0, maxHp: 0, maxMp: 0, critChance: 0 });
  });

  it("enforces class and level requirements", () => {
    const weapon = definition({ levelReq: 10, classes: ["warrior"] });
    expect(canEquip(weapon, "warrior", 10)).toBe(true);
    expect(canEquip(weapon, "warrior", 9)).toBe(false);
    expect(canEquip(weapon, "assassin", 10)).toBe(false);
    expect(canEquip(definition({ classes: "all" }), "mystic", 1)).toBe(true);
  });

  it("builds the equipment view used by stat aggregation", () => {
    const state: InventoryState = {
      items: [],
      equipment: [stack({ itemId: "test_item", slot: 0 }), null, null, null, null, null, null, null],
    };
    const equipment = equipmentForStats(state, () => definition({ baseStats: { attack: 3 } }));
    expect(equipment[0]?.definition.id).toBe("test_item");
    expect(sumEquipmentStats(equipment).attack).toBe(3);
  });
});

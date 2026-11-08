import { describe, expect, it } from "vitest";
import { emptyInventory, type ItemStack } from "@jadethrone/shared";
import { equipmentBonusStats, equipmentBonusValue } from "../../src/items/equipment";

function equipped(bonuses: ItemStack["bonuses"]): ItemStack {
  return {
    id: "eq-1",
    itemId: "sword_ember_t1",
    slot: 0,
    quantity: 1,
    upgradeLevel: 2,
    bonuses,
  };
}

describe("equipment bonuses", () => {
  it("adds instance bonuses to classic stats", () => {
    const inventory = emptyInventory();
    inventory.equipment[0] = equipped([
      { type: "attack", value: 5 },
      { type: "max_hp", value: 100 },
    ]);
    const stats = equipmentBonusStats(inventory);
    expect(stats.attack).toBe(15);
    expect(stats.maxHp).toBe(100);
  });

  it("sums non-classic modifiers across equipped items", () => {
    const inventory = emptyInventory();
    inventory.equipment[0] = equipped([
      { type: "attack_speed", value: 0.05 },
      { type: "strong_animals", value: 0.1 },
    ]);
    inventory.equipment[1] = {
      ...equipped([{ type: "attack_speed", value: 0.02 }]),
      id: "eq-2",
      itemId: "armor_warrior_t1",
      slot: 1,
    };
    expect(equipmentBonusValue(inventory, "attack_speed")).toBeCloseTo(0.07);
    expect(equipmentBonusValue(inventory, "strong_animals")).toBeCloseTo(0.1);
    expect(equipmentBonusValue(inventory, "move_speed")).toBe(0);
  });
});

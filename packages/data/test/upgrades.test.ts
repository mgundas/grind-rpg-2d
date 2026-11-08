import { describe, expect, it } from "vitest";
import { getItem, hasItem } from "@jadethrone/data/items";
import { getShop } from "@jadethrone/data/shops";
import { getUpgradeStep, MAX_UPGRADE_LEVEL, UPGRADE_STEPS } from "@jadethrone/data/upgrades";
import {
  BONUS_POOL,
  bonusesForItemType,
  getBonusDefinition,
} from "@jadethrone/data/bonuses";

describe("upgrades.json", () => {
  it("covers +0 through +9 with the designed chances", () => {
    expect(MAX_UPGRADE_LEVEL).toBe(9);
    expect(UPGRADE_STEPS).toHaveLength(9);
    expect(UPGRADE_STEPS.map((step) => step.chance)).toEqual([
      0.95, 0.9, 0.85, 0.7, 0.6, 0.5, 0.4, 0.25, 0.15,
    ]);
    for (const [index, step] of UPGRADE_STEPS.entries()) {
      expect(step.from).toBe(index);
      expect(step.to).toBe(index + 1);
      expect(step.gold).toBeGreaterThan(0);
      for (const material of step.materials) {
        expect(hasItem(material.itemId)).toBe(true);
        expect(material.quantity).toBeGreaterThanOrEqual(1);
      }
    }
    expect(getUpgradeStep(8)?.to).toBe(9);
    expect(getUpgradeStep(9)).toBeUndefined();
  });

  it("uses the documented material progression", () => {
    expect(getUpgradeStep(3)?.materials).toEqual([
      { itemId: "material_wolf_fang", quantity: 1 },
    ]);
    expect(getUpgradeStep(6)?.materials).toEqual([
      { itemId: "material_spirit_shard", quantity: 2 },
    ]);
    expect(getUpgradeStep(8)?.materials).toEqual([
      { itemId: "material_corrupted_crystal", quantity: 1 },
    ]);
  });
});

describe("bonuses.json", () => {
  it("defines unique, valid bonus types with ordered ranges", () => {
    expect(BONUS_POOL.length).toBeGreaterThanOrEqual(10);
    expect(new Set(BONUS_POOL.map((entry) => entry.type)).size).toBe(BONUS_POOL.length);
    for (const entry of BONUS_POOL) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.min).toBeLessThanOrEqual(entry.max);
      expect(entry.itemTypes.length).toBeGreaterThan(0);
    }
    expect(getBonusDefinition("max_hp")?.label).toBe("Max HP");
    expect(getBonusDefinition("missing")).toBeUndefined();
  });

  it("filters the pool by equipment type", () => {
    const weapon = bonusesForItemType("weapon");
    expect(weapon.some((entry) => entry.type === "attack")).toBe(true);
    expect(weapon.some((entry) => entry.type === "defense")).toBe(false);
    const armor = bonusesForItemType("armor");
    expect(armor.some((entry) => entry.type === "defense")).toBe(true);
    expect(armor.some((entry) => entry.type === "attack")).toBe(false);
  });

  it("makes the Reinforce Scroll obtainable", () => {
    expect(getShop("general_goods").items.some((entry) => entry.itemId === "scroll_reinforce")).toBe(
      true,
    );
    expect(getItem("scroll_reinforce").buyPrice).toBeGreaterThan(0);
  });
});

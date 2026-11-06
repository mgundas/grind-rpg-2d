import { describe, expect, it } from "vitest";
import { CLASS_IDS, EQUIP_SLOTS, equipSlotForItemType, isEquipmentType } from "@jadethrone/shared";
import { getClass } from "@jadethrone/data/classes";
import { ITEMS, getItem, hasItem, itemIconKey } from "@jadethrone/data/items";

describe("items.json", () => {
  it("defines a unique, non-empty starter catalogue", () => {
    expect(ITEMS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(ITEMS.map((item) => item.id)).size).toBe(ITEMS.length);
    for (const item of ITEMS) {
      expect(item.name.length).toBeGreaterThan(0);
      expect(item.iconKey).toBe(`icon.item.${item.id}`);
      expect(itemIconKey(item)).toBe(item.iconKey);
      expect(hasItem(item.id)).toBe(true);
    }
  });

  it("covers four weapon tiers and three armour tiers per class", () => {
    for (const classId of CLASS_IDS) {
      const weapons = ITEMS.filter(
        (item) => item.type === "weapon" && item.classes !== "all" && item.classes.includes(classId),
      );
      expect(weapons.length).toBeGreaterThanOrEqual(4);
      const armour = ITEMS.filter(
        (item) => item.type === "armor" && item.classes !== "all" && item.classes.includes(classId),
      );
      expect(armour.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps weapon subtypes consistent with the class weapon list", () => {
    for (const item of ITEMS.filter((candidate) => candidate.type === "weapon")) {
      for (const classId of CLASS_IDS) {
        if (item.classes !== "all" && item.classes.includes(classId)) {
          expect(getClass(classId).weapons).toContain(item.subtype);
        }
      }
    }
  });

  it("gives every equipment item a valid slot, size and upgrade chain", () => {
    for (const item of ITEMS.filter((candidate) => isEquipmentType(candidate.type))) {
      expect(equipSlotForItemType(item.type)).not.toBeNull();
      expect(EQUIP_SLOTS).toContain(equipSlotForItemType(item.type));
      expect(item.size).toBeGreaterThanOrEqual(1);
      expect(item.size).toBeLessThanOrEqual(3);
      expect(item.stackable).toBe(false);
      expect(item.maxStack).toBe(1);
    }
    for (const item of ITEMS.filter((candidate) => candidate.upgradeChain)) {
      for (const chain of Object.values(item.upgradeChain!)) {
        expect(chain).toHaveLength(10);
        expect(chain![0]).toBe(0);
      }
    }
  });

  it("has stat, effect and stacking rules that make sense", () => {
    for (const item of ITEMS) {
      if (!item.stackable) {
        expect(item.maxStack).toBe(1);
      }
      if (item.type !== "consumable") {
        expect(item.effect).toBeUndefined();
      }
      if (item.buyPrice > 0) {
        expect(item.sellPrice).toBeLessThanOrEqual(item.buyPrice);
      }
      for (const value of Object.values(item.baseStats ?? {})) {
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
    expect(getItem("potion_hp_s").effect).toEqual({ kind: "heal_hp", amount: 120 });
    expect(getItem("scroll_return").effect).toEqual({ kind: "warp_town" });
  });

  it("provides the required starter content categories", () => {
    for (const type of [
      "weapon",
      "armor",
      "helmet",
      "shield",
      "shoes",
      "bracelet",
      "necklace",
      "earrings",
      "consumable",
      "material",
    ] as const) {
      expect(ITEMS.some((item) => item.type === type)).toBe(true);
    }
    for (const id of [
      "potion_hp_s",
      "potion_hp_m",
      "potion_hp_l",
      "potion_mp_s",
      "potion_mp_m",
      "potion_mp_l",
      "material_wolf_fang",
      "material_bear_claw",
      "material_spirit_shard",
      "material_corrupted_crystal",
      "scroll_blessing",
      "scroll_enchant",
      "scroll_reinforce",
      "scroll_return",
    ]) {
      expect(hasItem(id)).toBe(true);
    }
  });

  it("looks items up by id", () => {
    expect(hasItem("nope")).toBe(false);
    expect(() => getItem("nope")).toThrow(/unknown item/);
  });
});

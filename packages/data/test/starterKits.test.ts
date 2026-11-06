import { describe, expect, it } from "vitest";
import { CLASS_IDS } from "@jadethrone/shared";
import { getClass } from "@jadethrone/data/classes";
import { getItem } from "@jadethrone/data/items";
import { STARTER_KIT, getStarterWeapon } from "@jadethrone/data/starterKits";

describe("starterKits.json", () => {
  it("gives every class a usable level-1 weapon", () => {
    for (const classId of CLASS_IDS) {
      const weapon = getItem(getStarterWeapon(classId));
      expect(weapon.type).toBe("weapon");
      expect(weapon.levelReq).toBe(1);
      expect(weapon.classes === "all" || weapon.classes.includes(classId)).toBe(true);
      expect(getClass(classId).weapons).toContain(weapon.subtype);
    }
  });

  it("starts with gold and stackable potions within their maxStack", () => {
    expect(STARTER_KIT.gold).toBeGreaterThan(0);
    expect(STARTER_KIT.potions.length).toBeGreaterThan(0);
    for (const potion of STARTER_KIT.potions) {
      const item = getItem(potion.itemId);
      expect(item.stackable).toBe(true);
      expect(potion.quantity).toBeLessThanOrEqual(item.maxStack);
      expect(potion.quantity).toBeGreaterThan(0);
    }
  });
});

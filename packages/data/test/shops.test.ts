import { describe, expect, it } from "vitest";
import { getItem } from "@jadethrone/data/items";
import { NPCS } from "@jadethrone/data/npcs";
import { SHOPS, getShop, hasShop } from "@jadethrone/data/shops";

describe("shops.json", () => {
  it("defines the three town shops with unique ids", () => {
    expect(SHOPS.map((shop) => shop.id).sort()).toEqual(["armorer", "general_goods", "weaponsmith"]);
    expect(new Set(SHOPS.map((shop) => shop.npcId)).size).toBe(SHOPS.length);
  });

  it("stocks real, purchasable items at valid prices", () => {
    for (const shop of SHOPS) {
      expect(shop.items.length).toBeGreaterThan(0);
      for (const entry of shop.items) {
        const item = getItem(entry.itemId);
        expect(item.buyPrice).toBeGreaterThan(0);
      }
    }
  });

  it("sells the acceptance-critical general goods", () => {
    const stock = getShop("general_goods").items.map((entry) => entry.itemId);
    expect(stock).toContain("potion_hp_s");
    expect(stock).toContain("potion_mp_s");
    expect(stock).toContain("scroll_return");
  });

  it("has a matching NPC for every shop", () => {
    for (const shop of SHOPS) {
      const npc = NPCS.find((candidate) => candidate.id === shop.npcId);
      expect(npc?.kind).toBe("shop");
      expect(npc?.shopId).toBe(shop.id);
    }
  });

  it("looks shops up by id", () => {
    expect(hasShop("armorer")).toBe(true);
    expect(hasShop("nope")).toBe(false);
    expect(() => getShop("nope")).toThrow(/unknown shop/);
  });
});

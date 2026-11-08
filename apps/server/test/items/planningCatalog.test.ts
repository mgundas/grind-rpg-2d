import { describe, expect, it } from "vitest";
import { emptyInventory } from "@jadethrone/shared";
import {
  BASE_GAME_DATA,
  buildCatalog,
  mergeGameData,
} from "@jadethrone/data/catalog";
import { planBuy } from "../../src/items/planning";

function catalogWithPotionPrice(price: number) {
  const potion = BASE_GAME_DATA.items.find(
    (entry) => (entry as { id: string }).id === "potion_hp_s",
  ) as Record<string, unknown>;
  const entries = mergeGameData(BASE_GAME_DATA, [
    {
      dataset: "items",
      entryId: "potion_hp_s",
      payload: { ...potion, buyPrice: price },
    },
  ]);
  return buildCatalog(entries, 2);
}

describe("planning with a catalog", () => {
  it("charges the overridden buy price", () => {
    const catalog = catalogWithPotionPrice(999);
    const result = planBuy(
      emptyInventory(),
      "char-1",
      2_000,
      "general_goods",
      "potion_hp_s",
      1,
      () => "new-item",
      catalog,
    );
    expect(result.plan.gold?.delta).toBe(-999);
    expect(result.plan.logs[0]?.detail?.unitPrice).toBe(999);
  });

  it("keeps the base price when no catalog is supplied", () => {
    const result = planBuy(
      emptyInventory(),
      "char-1",
      2_000,
      "general_goods",
      "potion_hp_s",
      1,
      () => "new-item",
    );
    expect(result.plan.gold?.delta).toBe(-40);
  });

  it("rejects items missing from an overridden shop", () => {
    const shop = BASE_GAME_DATA.shops.find(
      (entry) => (entry as { id: string }).id === "general_goods",
    ) as Record<string, unknown>;
    const entries = mergeGameData(BASE_GAME_DATA, [
      {
        dataset: "shops",
        entryId: "general_goods",
        payload: { ...shop, items: [{ itemId: "material_wolf_fang" }] },
      },
    ]);
    const catalog = buildCatalog(entries, 2);
    expect(() =>
      planBuy(
        emptyInventory(),
        "char-1",
        2_000,
        "general_goods",
        "potion_hp_s",
        1,
        () => "new-item",
        catalog,
      ),
    ).toThrow(/not sold here/);
  });
});

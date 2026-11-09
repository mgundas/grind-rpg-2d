import { describe, expect, it } from "vitest";
import {
  BASE_CATALOG,
  BASE_GAME_DATA,
  GameDataValidationError,
  buildCatalog,
  entryIdOf,
  mergeGameData,
} from "../src/catalog";
import { ITEMS } from "../src/items";
import { MONSTERS } from "../src/monsters";
import { SKILLS } from "../src/skills";

describe("catalog", () => {
  it("matches the static exports and starts at version 1", () => {
    expect(BASE_CATALOG.version).toBe(1);
    expect(BASE_CATALOG.items).toEqual(ITEMS);
    expect(BASE_CATALOG.monsters).toEqual(MONSTERS);
    expect(BASE_CATALOG.skills).toEqual(SKILLS);
    expect(BASE_CATALOG.maxUpgradeLevel).toBe(9);
    expect(BASE_CATALOG.getUpgradeStep(4)?.to).toBe(5);
  });

  it("identifies entries per dataset", () => {
    expect(entryIdOf("items", { id: "potion_hp_s" })).toBe("potion_hp_s");
    expect(entryIdOf("upgrades", { from: 4 })).toBe("4");
    expect(entryIdOf("bonuses", { type: "attack" })).toBe("attack");
    expect(() => entryIdOf("items", {})).toThrow(GameDataValidationError);
  });

  it("replaces an entry in place and appends new ids deterministically", () => {
    const item = BASE_GAME_DATA.items[0] as Record<string, unknown>;
    const merged = mergeGameData(BASE_GAME_DATA, [
      { dataset: "items", entryId: String(item.id), payload: { ...item, name: "Renamed" } },
    ]);
    const catalog = buildCatalog(merged, 2);
    expect(catalog.getItem(String(item.id)).name).toBe("Renamed");
    expect(catalog.version).toBe(2);

    const added = {
      ...item,
      id: "test_added_item",
      name: "Added",
    };
    const withNew = mergeGameData(BASE_GAME_DATA, [
      { dataset: "items", entryId: "test_added_item", payload: added },
    ]);
    const newCatalog = buildCatalog(withNew, 3);
    expect(newCatalog.findItem("test_added_item")?.name).toBe("Added");
    expect(newCatalog.items.map((entry) => entry.id)).toEqual(
      [...newCatalog.items.map((entry) => entry.id)].sort(),
    );
  });

  it("rejects an override whose payload id does not match", () => {
    const item = BASE_GAME_DATA.items[0] as Record<string, unknown>;
    expect(() =>
      mergeGameData(BASE_GAME_DATA, [{ dataset: "items", entryId: "other", payload: item }]),
    ).toThrow(GameDataValidationError);
  });

  it("validates cross-dataset references and keeps the base catalog intact", () => {
    const shop = BASE_GAME_DATA.shops[0] as Record<string, unknown>;
    const merged = mergeGameData(BASE_GAME_DATA, [
      {
        dataset: "shops",
        entryId: String(shop.id),
        payload: { ...shop, items: [{ itemId: "missing_item" }] },
      },
    ]);
    expect(() => buildCatalog(merged, 2)).toThrow(GameDataValidationError);
    expect(BASE_CATALOG.getItem("potion_hp_s").buyPrice).toBeGreaterThanOrEqual(0);
  });

  it("rejects a monster whose drop table does not exist", () => {
    const monster = BASE_GAME_DATA.monsters[0] as Record<string, unknown>;
    const merged = mergeGameData(BASE_GAME_DATA, [
      {
        dataset: "monsters",
        entryId: String(monster.id),
        payload: { ...monster, dropTableId: "missing_drop_table" },
      },
    ]);
    expect(() => buildCatalog(merged, 2)).toThrow(GameDataValidationError);
  });

  it("applies an upgrade override without changing the fixed max level", () => {
    const step = BASE_GAME_DATA.upgrades[4] as Record<string, unknown>;
    const merged = mergeGameData(BASE_GAME_DATA, [
      { dataset: "upgrades", entryId: "4", payload: { ...step, chance: 0.99 } },
    ]);
    const catalog = buildCatalog(merged, 2);
    expect(catalog.getUpgradeStep(4)?.chance).toBe(0.99);
    expect(catalog.maxUpgradeLevel).toBe(9);
  });

  it("validates a bonus override through the canonical pool", () => {
    const bonus = BASE_GAME_DATA.bonuses[0] as Record<string, unknown>;
    const merged = mergeGameData(BASE_GAME_DATA, [
      { dataset: "bonuses", entryId: String(bonus.type), payload: { ...bonus, max: 600 } },
    ]);
    const catalog = buildCatalog(merged, 2);
    expect(catalog.getBonusDefinition(String(bonus.type))?.max).toBe(600);

    const invalid = mergeGameData(BASE_GAME_DATA, [
      { dataset: "bonuses", entryId: String(bonus.type), payload: { ...bonus, min: 10, max: 1 } },
    ]);
    expect(() => buildCatalog(invalid, 2)).toThrow(GameDataValidationError);
  });
});

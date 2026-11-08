import { describe, expect, it } from "vitest";
import { BASE_GAME_DATA, GameDataValidationError } from "@jadethrone/data/catalog";
import {
  createGameDataStore,
  createStaticGameDataStore,
  type GameDataOverrideRecord,
} from "../../src/gameData/store";

const BASE_ITEM = BASE_GAME_DATA.items[0] as Record<string, unknown>;

function override(
  payload: Record<string, unknown>,
  dataset: GameDataOverrideRecord["dataset"] = "items",
): GameDataOverrideRecord {
  return {
    dataset,
    entryId: String(payload.id ?? payload.type ?? payload.from),
    payload,
    updatedBy: "account-1",
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

describe("game data store", () => {
  it("loads a valid override and bumps the version", async () => {
    const store = createGameDataStore({
      loadOverrides: async () => [
        override({ ...BASE_ITEM, name: "Renamed Sword", buyPrice: 500 }),
      ],
    });
    expect(store.getVersion()).toBe(1);
    await store.ensureLoaded();
    expect(store.getVersion()).toBe(2);
    expect(store.getCatalog().getItem(String(BASE_ITEM.id)).name).toBe("Renamed Sword");
    expect(store.getOverride("items", String(BASE_ITEM.id))?.payload.name).toBe(
      "Renamed Sword",
    );
    expect(store.getPublicCatalog().version).toBe(2);
  });

  it("keeps the previous snapshot when an override is invalid", async () => {
    let rows: GameDataOverrideRecord[] = [];
    const store = createGameDataStore({ loadOverrides: async () => rows });
    await store.ensureLoaded();
    const before = store.getSnapshot();

    rows = [override({ ...BASE_ITEM, buyPrice: -1 })];
    await expect(store.reload()).rejects.toBeInstanceOf(GameDataValidationError);
    expect(store.getSnapshot()).toBe(before);
    expect(store.getVersion()).toBe(2);
  });

  it("rejects identity mismatches", async () => {
    const store = createGameDataStore({
      loadOverrides: async () => [{ ...override(BASE_ITEM), entryId: "other" }],
    });
    await expect(store.ensureLoaded()).rejects.toBeInstanceOf(GameDataValidationError);
  });

  it("reverts to base when the override is removed", async () => {
    let rows: GameDataOverrideRecord[] = [
      override({ ...BASE_ITEM, name: "Renamed" }),
    ];
    const store = createGameDataStore({ loadOverrides: async () => rows });
    await store.ensureLoaded();
    expect(store.getCatalog().getItem(String(BASE_ITEM.id)).name).toBe("Renamed");

    rows = [];
    const result = await store.reload();
    expect(result.overrides).toBe(0);
    expect(store.getCatalog().getItem(String(BASE_ITEM.id)).name).toBe(
      String(BASE_ITEM.name),
    );
  });

  it("validates a candidate without touching the snapshot", async () => {
    const store = createGameDataStore({ loadOverrides: async () => [] });
    const before = store.getVersion();
    store.validateCandidate("items", String(BASE_ITEM.id), {
      ...BASE_ITEM,
      name: "Candidate",
    });
    expect(store.getVersion()).toBe(before);
    expect(store.getCatalog().getItem(String(BASE_ITEM.id)).name).not.toBe("Candidate");

    expect(() =>
      store.validateCandidate("items", String(BASE_ITEM.id), {
        ...BASE_ITEM,
        buyPrice: -5,
      }),
    ).toThrow(GameDataValidationError);
  });

  it("serialises concurrent reloads so versions are strictly increasing", async () => {
    const store = createGameDataStore({
      loadOverrides: async () => [override({ ...BASE_ITEM, name: "Concurrent" })],
    });
    const [one, two] = await Promise.all([store.reload(), store.reload()]);
    expect([one.version, two.version].sort()).toEqual([2, 3]);
    expect(store.getVersion()).toBe(3);
  });

  it("provides an immutable static store for tests", async () => {
    const store = createStaticGameDataStore(BASE_GAME_DATA, 7);
    expect(store.getVersion()).toBe(7);
    await store.ensureLoaded();
    expect((await store.reload()).version).toBe(7);
    expect(store.getPublicCatalog().version).toBe(7);
  });
});

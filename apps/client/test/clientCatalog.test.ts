import { afterEach, describe, expect, it } from "vitest";
import { BASE_GAME_DATA, mergeGameData } from "@jadethrone/data/catalog";
import {
  buildClientCatalog,
  ClientCatalogError,
  getClientCatalog,
  getItem,
  refreshClientCatalog,
  setClientCatalog,
} from "../src/data/catalog";
import { BASE_CATALOG } from "@jadethrone/data/catalog";

afterEach(() => {
  setClientCatalog(BASE_CATALOG);
});

function payloadWithRenamedPotion() {
  const potion = BASE_GAME_DATA.items.find(
    (entry) => (entry as { id: string }).id === "potion_hp_s",
  ) as Record<string, unknown>;
  const entries = mergeGameData(BASE_GAME_DATA, [
    {
      dataset: "items",
      entryId: "potion_hp_s",
      payload: { ...potion, name: "Fresh Potion", buyPrice: 88 },
    },
  ]);
  return { version: 9, entries };
}

describe("client catalog", () => {
  it("builds a catalog from a public payload", () => {
    const catalog = buildClientCatalog(payloadWithRenamedPotion());
    expect(catalog.version).toBe(9);
    expect(catalog.getItem("potion_hp_s").name).toBe("Fresh Potion");
    expect(catalog.getItem("potion_hp_s").buyPrice).toBe(88);
  });

  it("rejects malformed payloads", () => {
    expect(() => buildClientCatalog(null)).toThrow(ClientCatalogError);
    expect(() => buildClientCatalog({ version: "1" })).toThrow(ClientCatalogError);
    expect(() => buildClientCatalog({ version: 1, entries: {} })).toThrow(
      ClientCatalogError,
    );
  });

  it("swaps the live getters only on a version change", async () => {
    const payload = payloadWithRenamedPotion();
    const fetchFn = async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    expect(await refreshClientCatalog(fetchFn)).toBe(true);
    expect(getItem("potion_hp_s").name).toBe("Fresh Potion");
    expect(getClientCatalog().version).toBe(9);
    expect(await refreshClientCatalog(fetchFn)).toBe(false);
  });

  it("keeps the bundled catalog when refresh fails", async () => {
    await expect(
      refreshClientCatalog(async () => new Response("nope", { status: 503 })),
    ).rejects.toBeInstanceOf(ClientCatalogError);
    expect(getItem("potion_hp_s").name).toBe("Small Red Potion");
  });
});

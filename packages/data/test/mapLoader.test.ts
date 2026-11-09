import { describe, expect, it } from "vitest";
import { MAP_IDS } from "@jadethrone/shared";
import { MAP_JSON } from "../src/maps";
import { loadMapJson } from "../src/mapLoader";

describe("loadMapJson", () => {
  it("returns the exact same bytes as the static MAP_JSON entry", async () => {
    for (const mapId of MAP_IDS) {
      await expect(loadMapJson(mapId)).resolves.toEqual(MAP_JSON[mapId]);
    }
  });
});

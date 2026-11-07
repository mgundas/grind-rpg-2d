import { describe, expect, it } from "vitest";
import { ROOM_NAME_FIELDS, ROOM_NAME_VILLAGE } from "@jadethrone/shared";
import { loadMapAssets } from "../../src/maps/mapRegistry";

describe("map assets", () => {
  it("keeps the fields stone zone", () => {
    const fields = loadMapAssets(ROOM_NAME_FIELDS);
    expect(fields.stoneZones).toHaveLength(1);
    const [zone] = fields.stoneZones;
    expect(zone?.name).toBe("stone_zone");
    expect(zone?.width).toBeGreaterThan(0);
    expect(zone?.height).toBeGreaterThan(0);
    expect(zone?.properties?.find((property) => property.name === "zoneId")?.value).toBe(
      "fields_stones",
    );
  });

  it("has no stone zones in the village", () => {
    expect(loadMapAssets(ROOM_NAME_VILLAGE).stoneZones).toHaveLength(0);
  });
});

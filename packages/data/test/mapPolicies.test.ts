import { describe, expect, it } from "vitest";
import { MAP_IDS } from "@jadethrone/shared";
import raw from "../maps/policies.json";
import {
  MAP_POLICIES,
  buildMapPolicies,
  getMapPolicy,
} from "../src/mapPolicies";

describe("map policies", () => {
  it("covers every map and exposes safe/PvP/weather flags", () => {
    expect(MAP_POLICIES.map((policy) => policy.mapId).sort()).toEqual([...MAP_IDS].sort());
    const village = getMapPolicy("map_ember_village");
    expect(village.safe).toBe(true);
    expect(village.pvpAllowed).toBe(false);
    expect(village.weather).toBe("none");
    const fields = getMapPolicy("map_ember_fields");
    expect(fields.safe).toBe(false);
    expect(fields.pvpAllowed).toBe(true);
    expect(fields.weather).toBe("leaves");
    expect(fields.connections).toContain("map_ember_village");
  });

  it("rejects unsafe combinations and unknown connections", () => {
    const clone = structuredClone(raw);
    clone.maps[0]!.pvpAllowed = true;
    expect(() => buildMapPolicies(clone)).toThrow();

    const unknown = structuredClone(raw);
    unknown.maps[0]!.connections = ["map_missing"];
    expect(() => buildMapPolicies(unknown)).toThrow();

    const duplicate = structuredClone(raw);
    duplicate.maps.push({ ...duplicate.maps[0]! });
    expect(() => buildMapPolicies(duplicate)).toThrow();
  });

  it("requires a policy for every map id", () => {
    const missing = structuredClone(raw);
    missing.maps = missing.maps.filter((policy) => policy.mapId !== "map_ember_fields");
    expect(() => buildMapPolicies(missing)).toThrow(/missing map policy/);
  });
});

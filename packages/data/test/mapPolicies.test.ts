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
    expect(fields.label).toBe("Ember Highlands");
    expect(fields.safe).toBe(false);
    expect(fields.pvpAllowed).toBe(false);
    expect(fields.weather).toBe("leaves");
    expect(fields.connections).toContain("map_ember_village");
    expect(fields.connections).toContain("map_valley_of_echoes");
    const valley = getMapPolicy("map_valley_of_echoes");
    expect(valley.neutral).toBe(true);
    expect(valley.pvpAllowed).toBe(true);
    const cave = getMapPolicy("map_spider_cave");
    expect(cave.dungeon).toBe(true);
    expect(cave.pvpAllowed).toBe(false);
  });

  it("keeps every connection walkable in both directions", () => {
    const byId = new Map(MAP_POLICIES.map((policy) => [policy.mapId, policy]));
    for (const policy of MAP_POLICIES) {
      for (const targetId of policy.connections) {
        expect(byId.get(targetId)?.connections).toContain(policy.mapId);
      }
    }
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

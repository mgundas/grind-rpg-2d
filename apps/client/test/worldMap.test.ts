import { describe, expect, it } from "vitest";
import { MAP_POLICIES } from "@jadethrone/data/mapPolicies";
import { worldMapNodes } from "../src/ui/worldMap";

describe("world map layout", () => {
  it("marks the current map and preserves connections", () => {
    const nodes = worldMapNodes(MAP_POLICIES, "map_ember_village");
    expect(nodes).toHaveLength(2);
    const current = nodes.find((node) => node.current);
    expect(current?.mapId).toBe("map_ember_village");
    expect(current?.connections).toContain("map_ember_fields");
    expect(new Set(nodes.map((node) => node.x)).size).toBe(2);
  });

  it("handles an unknown current map", () => {
    expect(worldMapNodes(MAP_POLICIES, null).every((node) => !node.current)).toBe(true);
  });
});

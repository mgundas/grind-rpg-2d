import { describe, expect, it } from "vitest";
import miniMap from "./fixtures/mini-map.json";
import { extractMapObjects, parseTiledMap } from "../src/tiled";

function validMap(): ReturnType<typeof parseTiledMap> {
  return parseTiledMap(structuredClone(miniMap));
}

describe("parseTiledMap", () => {
  it("accepts the fixture map", () => {
    const map = validMap();
    expect(map.width).toBe(8);
    expect(map.height).toBe(8);
    expect(map.tilewidth).toBe(32);
    const names = map.layers.map((layer) => layer.name);
    expect(names).toEqual(["ground", "decor", "above", "collision", "objects"]);
  });

  it("rejects a wrong orientation", () => {
    const bad = structuredClone(miniMap) as Record<string, unknown>;
    bad.orientation = "isometric";
    expect(() => parseTiledMap(bad)).toThrow(/orientation/);
  });

  it("rejects a non-32px tile size", () => {
    const bad = structuredClone(miniMap) as Record<string, unknown>;
    bad.tilewidth = 16;
    expect(() => parseTiledMap(bad)).toThrow(/tile size/);
  });

  it("rejects a missing collision layer", () => {
    const bad = structuredClone(miniMap) as { layers: Array<{ name: string }> };
    bad.layers = bad.layers.filter((layer) => layer.name !== "collision");
    expect(() => parseTiledMap(bad)).toThrow(/missing tile layer "collision"/);
  });

  it("rejects a collision layer with the wrong cell count", () => {
    const bad = structuredClone(miniMap) as { layers: Array<{ name: string; data?: number[] }> };
    const collision = bad.layers.find((layer) => layer.name === "collision");
    collision!.data = [1, 0, 1];
    expect(() => parseTiledMap(bad)).toThrow(/has 3 cells, expected 64/);
  });

  it("rejects duplicate layer names", () => {
    const bad = structuredClone(miniMap) as { layers: Array<{ name: string }> };
    bad.layers.push({ ...bad.layers[0]!, name: "ground" });
    expect(() => parseTiledMap(bad)).toThrow(/duplicate layer "ground"/);
  });

  it("rejects a malformed object", () => {
    const bad = structuredClone(miniMap) as unknown as {
      layers: Array<{ name: string; objects?: Array<Record<string, unknown>> }>;
    };
    const objects = bad.layers.find((layer) => layer.name === "objects");
    objects!.objects![0]!.x = "nope";
    expect(() => parseTiledMap(bad)).toThrow(/Invalid Tiled map/);
  });
});

describe("extractMapObjects", () => {
  it("extracts the spawn point", () => {
    expect(extractMapObjects(validMap()).spawn).toEqual({ x: 48, y: 48 });
  });

  it("extracts warp rectangles and targets", () => {
    const { warps } = extractMapObjects(validMap());
    expect(warps).toHaveLength(1);
    expect(warps[0]).toEqual({
      x: 192,
      y: 0,
      w: 32,
      h: 32,
      targetMap: "map_ember_fields",
      targetX: 100,
      targetY: 100,
    });
  });

  it("parses mob zones with their spawn group id", () => {
    const objects = extractMapObjects(validMap());
    expect(objects.npcs).toHaveLength(1);
    expect(objects.mobZones).toEqual([{ x: 96, y: 160, w: 96, h: 96, spawnGroupId: "wolves" }]);
    expect(objects.stoneZones).toHaveLength(0);
  });

  it("rejects a mob zone without a spawn group id", () => {
    const bad = structuredClone(miniMap) as unknown as {
      layers: Array<{
        name: string;
        objects?: Array<{
          name: string;
          properties?: Array<{ name: string; value: unknown }>;
        }>;
      }>;
    };
    const zone = bad.layers
      .find((layer) => layer.name === "objects")!
      .objects!.find((object) => object.name === "mob_zone")!;
    zone.properties = [];
    expect(() => extractMapObjects(parseTiledMap(bad))).toThrow(/spawnGroupId/);
  });

  it("rejects an invalid warp target map", () => {
    const bad = structuredClone(miniMap) as unknown as {
      layers: Array<{
        name: string;
        objects?: Array<{
          name: string;
          properties?: Array<{ name: string; value: unknown }>;
        }>;
      }>;
    };
    const warp = bad.layers
      .find((layer) => layer.name === "objects")!
      .objects!.find((object) => object.name === "warp")!;
    warp.properties!.find((prop) => prop.name === "targetMap")!.value = "nowhere";
    expect(() => extractMapObjects(parseTiledMap(bad))).toThrow(/must be one of/);
  });

  it("rejects a warp with a non-numeric target position", () => {
    const bad = structuredClone(miniMap) as unknown as {
      layers: Array<{
        name: string;
        objects?: Array<{
          name: string;
          properties?: Array<{ name: string; value: unknown }>;
        }>;
      }>;
    };
    const warp = bad.layers
      .find((layer) => layer.name === "objects")!
      .objects!.find((object) => object.name === "warp")!;
    warp.properties!.find((prop) => prop.name === "targetX")!.value = "100";
    expect(() => extractMapObjects(parseTiledMap(bad))).toThrow(/numeric "targetX"/);
  });
});

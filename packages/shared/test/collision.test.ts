import { describe, expect, it } from "vitest";
import miniMap from "./fixtures/mini-map.json";
import {
  buildCollisionGrid,
  isSolidAt,
  isSolidTile,
  isWalkableAt,
  nearestWalkable,
  rectOverlapsSolid,
} from "../src/collision";
import { parseTiledMap } from "../src/tiled";

const map = parseTiledMap(structuredClone(miniMap));
const grid = buildCollisionGrid(map);

describe("buildCollisionGrid", () => {
  it("builds an 8x8 grid of 32px tiles", () => {
    expect(grid.width).toBe(8);
    expect(grid.height).toBe(8);
    expect(grid.tileSize).toBe(32);
    expect(grid.solid).toHaveLength(64);
  });

  it("marks the border and the inner block solid", () => {
    expect(isSolidTile(grid, 0, 0)).toBe(true);
    expect(isSolidTile(grid, 7, 7)).toBe(true);
    expect(isSolidTile(grid, 3, 3)).toBe(true);
    expect(isSolidTile(grid, 4, 4)).toBe(true);
    expect(isSolidTile(grid, 1, 1)).toBe(false);
  });
});

describe("isSolidTile / isSolidAt", () => {
  it("treats out-of-bounds as solid", () => {
    expect(isSolidTile(grid, -1, 0)).toBe(true);
    expect(isSolidTile(grid, 8, 0)).toBe(true);
    expect(isSolidTile(grid, 0, -1)).toBe(true);
    expect(isSolidTile(grid, 0, 8)).toBe(true);
  });

  it("converts pixels to the containing tile", () => {
    expect(isSolidAt(grid, 5, 5)).toBe(true); // border tile (0,0)
    expect(isSolidAt(grid, 48, 48)).toBe(false); // free tile (1,1)
    expect(isSolidAt(grid, 112, 112)).toBe(true); // inner block
  });
});

describe("rectOverlapsSolid", () => {
  it("lets the default player body stand in the free area", () => {
    expect(rectOverlapsSolid(grid, 48, 48)).toBe(false);
  });

  it("detects the border", () => {
    expect(rectOverlapsSolid(grid, 16, 16)).toBe(true);
    expect(rectOverlapsSolid(grid, 240, 240)).toBe(true);
  });

  it("detects the inner block", () => {
    expect(rectOverlapsSolid(grid, 112, 112)).toBe(true);
  });

  it("blocks a body that barely overlaps a solid tile", () => {
    // Block tiles (3..4, 3..4) span px 96..160 on both axes. A body centred
    // at x=104 reaches 94..114, so it clips the block at x=96.
    expect(rectOverlapsSolid(grid, 104, 112, 10, 6)).toBe(true);
    expect(rectOverlapsSolid(grid, 85, 112, 10, 6)).toBe(false);
  });

  it("uses custom half extents", () => {
    expect(rectOverlapsSolid(grid, 64, 64, 1, 1)).toBe(false);
    expect(rectOverlapsSolid(grid, 16, 16, 1, 1)).toBe(true);
  });
});

describe("isWalkableAt", () => {
  it("is the negation of rect overlap for the player body", () => {
    expect(isWalkableAt(grid, 48, 48)).toBe(true);
    expect(isWalkableAt(grid, 16, 16)).toBe(false);
  });
});

describe("nearestWalkable", () => {
  it("returns the input when already walkable", () => {
    expect(nearestWalkable(grid, 48, 48)).toEqual({ x: 48, y: 48 });
  });

  it("finds the closest free tile centre from inside the block", () => {
    // (80,112) and (112,80) are equally close; the deterministic tie-break
    // picks the lower y first.
    expect(nearestWalkable(grid, 112, 112)).toEqual({ x: 112, y: 80 });
  });

  it("escapes the border into the first free tile", () => {
    expect(nearestWalkable(grid, 16, 16)).toEqual({ x: 48, y: 48 });
  });

  it("returns null when the search radius is too small", () => {
    expect(nearestWalkable(grid, 112, 112, 0)).toBeNull();
  });

  it("returns null when nothing walkable exists in range", () => {
    // Entire border is solid; from the very corner a radius of 0 can never
    // find a walkable tile.
    expect(nearestWalkable(grid, 1, 1, 0)).toBeNull();
  });
});

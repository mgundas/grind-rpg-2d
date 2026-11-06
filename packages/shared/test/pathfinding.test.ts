import { describe, expect, it } from "vitest";
import miniMap from "./fixtures/mini-map.json";
import { buildCollisionGrid, isWalkableAt, nearestWalkable } from "../src/collision";
import { findPath, hasLineOfWalk, simplifyPath } from "../src/pathfinding";
import { parseTiledMap } from "../src/tiled";

const grid = buildCollisionGrid(parseTiledMap(structuredClone(miniMap)));

function expectWalkable(waypoints: Array<{ x: number; y: number }>): void {
  for (const waypoint of waypoints) {
    expect(isWalkableAt(grid, waypoint.x, waypoint.y)).toBe(true);
  }
}

describe("hasLineOfWalk", () => {
  it("accepts a straight open corridor", () => {
    expect(hasLineOfWalk(grid, { x: 48, y: 48 }, { x: 200, y: 48 })).toBe(true);
  });

  it("rejects a line through the inner block", () => {
    expect(hasLineOfWalk(grid, { x: 80, y: 80 }, { x: 112, y: 112 })).toBe(false);
  });
});

describe("findPath", () => {
  it("returns a single waypoint for a clear straight line", () => {
    const path = findPath(grid, { x: 48, y: 48 }, { x: 200, y: 48 });
    expect(path).toEqual([{ x: 200, y: 48 }]);
  });

  it("routes around the inner block", () => {
    const path = findPath(grid, { x: 48, y: 48 }, { x: 176, y: 112 });
    expect(path.length).toBeGreaterThan(1);
    expect(path[path.length - 1]).toEqual({ x: 176, y: 112 });
    expectWalkable(path);
  });

  it("snaps a blocked target to the nearest walkable point", () => {
    const expected = nearestWalkable(grid, 112, 112, 3);
    expect(expected).not.toBeNull();
    const path = findPath(grid, { x: 48, y: 48 }, { x: 112, y: 112 });
    expect(path[path.length - 1]).toEqual(expected);
  });

  it("returns an empty path when the target is outside the map", () => {
    expect(findPath(grid, { x: 48, y: 48 }, { x: 300, y: 300 })).toEqual([]);
  });

  it("returns a short hop when start and goal share a tile", () => {
    expect(findPath(grid, { x: 48, y: 48 }, { x: 50, y: 50 })).toEqual([{ x: 50, y: 50 }]);
  });

  it("returns no waypoints when start already equals the target", () => {
    expect(findPath(grid, { x: 48, y: 48 }, { x: 48, y: 48 })).toEqual([]);
  });

  it("gives up when the node budget is exhausted", () => {
    expect(findPath(grid, { x: 48, y: 48 }, { x: 200, y: 160 }, { maxExpand: 1 })).toEqual([]);
  });

  it("is deterministic", () => {
    const a = findPath(grid, { x: 48, y: 48 }, { x: 112, y: 160 });
    const b = findPath(grid, { x: 48, y: 48 }, { x: 112, y: 160 });
    expect(a).toEqual(b);
  });
});

describe("simplifyPath", () => {
  it("keeps only the final point on a clear line", () => {
    const simplified = simplifyPath(grid, [
      { x: 48, y: 48 },
      { x: 80, y: 48 },
      { x: 112, y: 48 },
      { x: 144, y: 48 },
    ]);
    expect(simplified).toEqual([{ x: 144, y: 48 }]);
  });

  it("keeps a corner waypoint when the straight line is blocked", () => {
    const simplified = simplifyPath(grid, [
      { x: 80, y: 80 },
      { x: 80, y: 112 },
      { x: 112, y: 112 },
    ]);
    expect(simplified.length).toBeGreaterThan(1);
    expect(simplified[simplified.length - 1]).toEqual({ x: 112, y: 112 });
  });

  it("returns an empty list for a single point", () => {
    expect(simplifyPath(grid, [{ x: 48, y: 48 }])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  DIR8_VECTORS,
  dir8FromAxes,
  dir8Towards,
  facing4FromDir8,
  type Dir8,
} from "../src/direction";
import { INV_SQRT2, WALK_SPEED } from "../src/constants";

const ALL_DIRS: Dir8[] = [0, 1, 2, 3, 4, 5, 6, 7];

describe("DIR8_VECTORS", () => {
  it("has 8 unit-length vectors", () => {
    expect(DIR8_VECTORS).toHaveLength(8);
    for (const v of DIR8_VECTORS) {
      expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 12);
    }
  });

  it("moves diagonally at exactly walk speed", () => {
    // Diagonals are pre-scaled by INV_SQRT2; the resulting speed must match
    // the axis-aligned speed, otherwise the 8 directions feel uneven.
    const diagonal = DIR8_VECTORS[1]!;
    const speed = WALK_SPEED * Math.hypot(diagonal.x, diagonal.y);
    expect(speed).toBeCloseTo(WALK_SPEED, 10);
  });

  it("uses the rounding-stable INV_SQRT2 literal for diagonals", () => {
    expect(DIR8_VECTORS[1]!.x).toBe(INV_SQRT2);
    expect(DIR8_VECTORS[5]!.y).toBe(-INV_SQRT2);
  });
});

describe("facing4FromDir8", () => {
  it("maps cardinal directions", () => {
    expect(facing4FromDir8(0)).toBe("right");
    expect(facing4FromDir8(2)).toBe("down");
    expect(facing4FromDir8(4)).toBe("left");
    expect(facing4FromDir8(6)).toBe("up");
  });

  it("maps diagonals to the closer horizontal facing", () => {
    expect(facing4FromDir8(1)).toBe("right");
    expect(facing4FromDir8(7)).toBe("right");
    expect(facing4FromDir8(3)).toBe("left");
    expect(facing4FromDir8(5)).toBe("left");
  });

  it("covers every direction", () => {
    for (const dir of ALL_DIRS) {
      expect(["down", "left", "right", "up"]).toContain(facing4FromDir8(dir));
    }
  });
});

describe("dir8FromAxes", () => {
  it("returns null when no axis is held", () => {
    expect(dir8FromAxes(0, 0)).toBeNull();
  });

  it("maps the 8 axis combinations", () => {
    const cases: Array<[number, number, Dir8]> = [
      [1, 0, 0],
      [1, 1, 1],
      [0, 1, 2],
      [-1, 1, 3],
      [-1, 0, 4],
      [-1, -1, 5],
      [0, -1, 6],
      [1, -1, 7],
    ];
    for (const [dx, dy, expected] of cases) {
      expect(dir8FromAxes(dx as -1 | 0 | 1, dy as -1 | 0 | 1)).toBe(expected);
    }
  });
});

describe("dir8Towards", () => {
  it("returns null for identical points", () => {
    expect(dir8Towards({ x: 10, y: 10 }, { x: 10, y: 10 })).toBeNull();
  });

  it("returns the 8 octants", () => {
    const cases: Array<[number, number, Dir8]> = [
      [100, 0, 0],
      [100, 60, 1],
      [0, 100, 2],
      [-100, 60, 3],
      [-100, 0, 4],
      [-100, -60, 5],
      [0, -100, 6],
      [100, -60, 7],
    ];
    for (const [dx, dy, expected] of cases) {
      expect(dir8Towards({ x: 0, y: 0 }, { x: dx, y: dy })).toBe(expected);
    }
  });

  it("treats near-axis vectors as axis-aligned", () => {
    expect(dir8Towards({ x: 0, y: 0 }, { x: 100, y: 5 })).toBe(0);
    expect(dir8Towards({ x: 0, y: 0 }, { x: 5, y: 100 })).toBe(2);
  });
});

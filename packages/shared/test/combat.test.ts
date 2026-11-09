import { describe, expect, it } from "vitest";
import {
  findArcTargets,
  findCircleTargets,
  findLineTargets,
  isInMeleeArc,
} from "@jadethrone/shared";

const origin = { x: 100, y: 100 };

function point(id: string, x: number, y: number) {
  return { id, x, y };
}

// A point exactly 60° clockwise from +X, 40 px away.
const boundary = point(
  "boundary",
  100 + 40 * Math.cos(Math.PI / 3),
  100 + 40 * Math.sin(Math.PI / 3),
);
// A point just outside the arc (61°).
const outside = point(
  "outside",
  100 + 40 * Math.cos((61 * Math.PI) / 180),
  100 + 40 * Math.sin((61 * Math.PI) / 180),
);

describe("isInMeleeArc", () => {
  it("accepts the facing direction and rejects behind", () => {
    expect(isInMeleeArc(origin, { x: 150, y: 100 }, "right", 64)).toBe(true);
    expect(isInMeleeArc(origin, { x: 50, y: 100 }, "right", 64)).toBe(false);
  });

  it("uses a 120° arc (60° each side)", () => {
    expect(isInMeleeArc(origin, boundary, "right", 64)).toBe(true);
    expect(isInMeleeArc(origin, outside, "right", 64)).toBe(false);
    expect(isInMeleeArc(origin, { x: 100, y: 150 }, "right", 64)).toBe(false);
  });

  it("supports all four facings", () => {
    expect(isInMeleeArc(origin, { x: 100, y: 150 }, "down", 64)).toBe(true);
    expect(isInMeleeArc(origin, { x: 100, y: 50 }, "up", 64)).toBe(true);
    expect(isInMeleeArc(origin, { x: 50, y: 100 }, "left", 64)).toBe(true);
    expect(isInMeleeArc(origin, { x: 50, y: 100 }, "up", 64)).toBe(false);
  });

  it("includes range padding and treats the same point as a hit", () => {
    expect(isInMeleeArc(origin, { x: 145, y: 100 }, "right", 40, 0)).toBe(false);
    expect(isInMeleeArc(origin, { x: 145, y: 100 }, "right", 40, 16)).toBe(true);
    expect(isInMeleeArc(origin, origin, "right", 64)).toBe(true);
  });

  it("hits a target that float32 rounding places a hair behind the attacker", () => {
    // Walking to the rounded schema coordinate can leave the authoritative
    // target 0.0002 px west of the player while the client faces east.
    expect(isInMeleeArc(origin, { x: 100 - 0.0002, y: 100 }, "right", 64)).toBe(true);
    // The epsilon must stay tiny: a visibly behind target is still rejected.
    expect(isInMeleeArc(origin, { x: 100 - 0.1, y: 100 }, "right", 64)).toBe(false);
  });
});

describe("findArcTargets", () => {
  it("returns every target in the arc, nearest first", () => {
    const candidates = [
      point("far", 175, 100),
      point("near", 130, 100),
      point("behind", 40, 100),
      point("side", 100, 170),
      boundary,
      outside,
    ];
    expect(
      findArcTargets(candidates, { origin, facing: "right", rangePx: 64, maxTargets: 8 }),
    ).toEqual(["near", "boundary", "far"]);
  });

  it("breaks equal-distance ties by id", () => {
    const candidates = [point("b", 140, 100), point("a", 140, 100)];
    expect(findArcTargets(candidates, { origin, facing: "right", rangePx: 64 })).toEqual([
      "a",
      "b",
    ]);
  });

  it("caps the number of targets and handles a zero cap", () => {
    const candidates = [point("a", 110, 100), point("b", 120, 100), point("c", 130, 100)];
    expect(
      findArcTargets(candidates, { origin, facing: "right", rangePx: 64, maxTargets: 2 }),
    ).toEqual(["a", "b"]);
    expect(
      findArcTargets(candidates, { origin, facing: "right", rangePx: 64, maxTargets: 0 }),
    ).toEqual([]);
  });
});

describe("findLineTargets", () => {
  const start = { x: 100, y: 100 };
  const end = { x: 200, y: 100 };

  it("accepts targets inside the corridor and rejects those outside it", () => {
    const candidates = [point("near", 130, 100), point("side", 150, 120), point("far", 260, 100)];
    expect(findLineTargets(candidates, { origin: start, end, widthPx: 20 })).toEqual(["near"]);
  });

  it("rejects a target behind the caster even when laterally inside the width", () => {
    const candidates = [point("behind", 90, 100), point("ahead", 150, 100)];
    expect(findLineTargets(candidates, { origin: start, end, widthPx: 40 })).toEqual(["ahead"]);
  });

  it("does not extend the corridor past its tip", () => {
    const candidates = [point("justPast", 215, 100), point("inside", 195, 100)];
    expect(findLineTargets(candidates, { origin: start, end, widthPx: 10 })).toEqual(["inside"]);
  });
});

describe("findCircleTargets", () => {
  it("includes the radius plus padding and sorts nearest first", () => {
    const candidates = [point("edge", 135, 100), point("center", 105, 100)];
    expect(findCircleTargets(candidates, { center: origin, radiusPx: 30, padPx: 8 })).toEqual([
      "center",
      "edge",
    ]);
  });
});

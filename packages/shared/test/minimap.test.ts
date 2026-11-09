import { describe, expect, it } from "vitest";
import { minimapDotRadius, projectToMinimap } from "../src/minimap";

describe("minimap projection", () => {
  it("maps world coordinates into the minimap box", () => {
    const transform = {
      mapWidthPx: 5120,
      mapHeightPx: 2560,
      width: 160,
      height: 80,
    };
    expect(projectToMinimap(0, 0, transform)).toEqual({ x: 0, y: 0 });
    expect(projectToMinimap(5120, 2560, transform)).toEqual({ x: 160, y: 80 });
    expect(projectToMinimap(2560, 1280, transform)).toEqual({ x: 80, y: 40 });
  });

  it("clamps out-of-bounds coordinates", () => {
    const transform = { mapWidthPx: 100, mapHeightPx: 100, width: 50, height: 50 };
    expect(projectToMinimap(500, -50, transform)).toEqual({ x: 50, y: 0 });
    expect(projectToMinimap(-10, 200, transform)).toEqual({ x: 0, y: 50 });
  });

  it("keeps dots visible at small sizes", () => {
    expect(minimapDotRadius(160)).toBeGreaterThanOrEqual(1.5);
    expect(minimapDotRadius(60)).toBe(1.5);
  });
});

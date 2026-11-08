import { describe, expect, it } from "vitest";
import { DAY_CYCLE_MS, dayCycleAt } from "../src/environment";

describe("day cycle", () => {
  it("starts at dawn, reaches full day and ends at night", () => {
    expect(dayCycleAt(0).phase).toBe("dawn");
    expect(dayCycleAt(0).darkness).toBeGreaterThan(0);
    expect(dayCycleAt(DAY_CYCLE_MS * 0.4)).toMatchObject({ phase: "day", darkness: 0 });
    expect(dayCycleAt(DAY_CYCLE_MS * 0.75).phase).toBe("dusk");
    expect(dayCycleAt(DAY_CYCLE_MS * 0.9)).toMatchObject({ phase: "night" });
    expect(dayCycleAt(DAY_CYCLE_MS * 0.9).darkness).toBeGreaterThan(0.5);
  });

  it("wraps around and handles negative timestamps", () => {
    const wrapped = dayCycleAt(DAY_CYCLE_MS * 3 + DAY_CYCLE_MS * 0.4);
    expect(wrapped.phase).toBe("day");
    expect(dayCycleAt(-DAY_CYCLE_MS * 0.1).phase).toBe("night");
  });

  it("reports normalized progress", () => {
    expect(dayCycleAt(DAY_CYCLE_MS * 0.25).progress).toBeCloseTo(0.25);
  });
});

import { describe, expect, it } from "vitest";
import { mulberry32, seedFromString } from "../src/rng";

describe("mulberry32", () => {
  it("is deterministic for the same seed", () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("stays within [0, 1) over many draws", () => {
    const rng = mulberry32(seedFromString("jade-throne"));
    for (let i = 0; i < 10000; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("produces different sequences for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).not.toEqual(seqB);
  });
});

describe("seedFromString", () => {
  it("is stable for the same string", () => {
    expect(seedFromString("wild_dog")).toBe(seedFromString("wild_dog"));
  });

  it("differs for different strings", () => {
    expect(seedFromString("wild_dog")).not.toBe(seedFromString("gray_wolf"));
  });
});

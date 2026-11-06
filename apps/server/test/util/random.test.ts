import { describe, expect, it } from "vitest";
import { seededRandomSource } from "@jadethrone/shared";
import { createCryptoRandomSource } from "../../src/util/random";

describe("createCryptoRandomSource", () => {
  it("returns floats in [0, 1) and keeps drawing new values", () => {
    const rng = createCryptoRandomSource();
    const values = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      values.add(value);
    }
    expect(values.size).toBeGreaterThan(900);
  });
});

describe("seeded test source", () => {
  it("remains deterministic independently of the crypto source", () => {
    const a = seededRandomSource(77);
    const b = seededRandomSource(77);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });
});

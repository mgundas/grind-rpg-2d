import { describe, expect, it } from "vitest";
import { createRateLimiter } from "../../src/http/rateLimit";

describe("createRateLimiter", () => {
  it("allows max attempts per key and rejects the next one", () => {
    const now = 0;
    const limiter = createRateLimiter({ windowMs: 1000, max: 2 }, () => now);
    expect(limiter.check("ip-a")).toBe(true);
    expect(limiter.check("ip-a")).toBe(true);
    expect(limiter.check("ip-a")).toBe(false);
  });

  it("keeps keys independent", () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1 });
    expect(limiter.check("ip-a")).toBe(true);
    expect(limiter.check("ip-b")).toBe(true);
    expect(limiter.check("ip-a")).toBe(false);
  });

  it("resets after the window and on demand", () => {
    let now = 0;
    const limiter = createRateLimiter({ windowMs: 1000, max: 1 }, () => now);
    expect(limiter.check("ip")).toBe(true);
    now = 1000;
    expect(limiter.check("ip")).toBe(true);
    expect(limiter.check("ip")).toBe(false);
    limiter.reset();
    expect(limiter.check("ip")).toBe(true);
  });

  it("tracks entries and survives many unique keys", () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1 });
    for (let index = 0; index < 50; index++) {
      expect(limiter.check(`ip-${index}`)).toBe(true);
    }
    expect(limiter.size()).toBe(50);
  });
});

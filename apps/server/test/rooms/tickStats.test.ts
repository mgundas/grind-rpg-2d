import { describe, expect, it } from "vitest";
import { TickStats } from "../../src/rooms/tickStats";

describe("TickStats", () => {
  it("returns an empty snapshot before any samples", () => {
    expect(new TickStats(10).snapshot()).toEqual({
      count: 0,
      lastMs: 0,
      avgMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      maxMs: 0,
      overruns: 0,
    });
  });

  it("records count, average, last and max", () => {
    const stats = new TickStats(10);
    stats.record(4);
    stats.record(8);
    const snapshot = stats.snapshot();
    expect(snapshot.count).toBe(2);
    expect(snapshot.avgMs).toBe(6);
    expect(snapshot.lastMs).toBe(8);
    expect(snapshot.maxMs).toBe(8);
  });

  it("computes p50 and p95 from the window", () => {
    const stats = new TickStats(100);
    for (let value = 1; value <= 100; value++) {
      stats.record(value);
    }
    const snapshot = stats.snapshot();
    expect(snapshot.p50Ms).toBe(50);
    expect(snapshot.p95Ms).toBe(95);
    expect(snapshot.maxMs).toBe(100);
  });

  it("counts overruns against the tick budget", () => {
    const stats = new TickStats(10);
    stats.record(49);
    stats.record(50);
    stats.record(51);
    expect(stats.snapshot().overruns).toBe(1);
  });

  it("overwrites old samples once the ring is full", () => {
    const stats = new TickStats(3);
    stats.record(100);
    stats.record(100);
    stats.record(100);
    stats.record(1);
    const snapshot = stats.snapshot();
    expect(snapshot.count).toBe(3);
    expect(snapshot.lastMs).toBe(1);
    expect(snapshot.avgMs).toBeCloseTo((100 + 100 + 1) / 3);
    expect(snapshot.p50Ms).toBe(100);
    expect(snapshot.p95Ms).toBe(100);
  });

  it("ignores invalid durations", () => {
    const stats = new TickStats(4);
    stats.record(Number.NaN);
    stats.record(-5);
    expect(stats.snapshot().count).toBe(2);
    expect(stats.snapshot().avgMs).toBe(0);
  });

  it("reset clears the window and counters", () => {
    const stats = new TickStats(4);
    stats.record(60);
    stats.reset();
    expect(stats.snapshot().count).toBe(0);
    expect(stats.snapshot().overruns).toBe(0);
  });

  it("rejects an invalid capacity", () => {
    expect(() => new TickStats(0)).toThrow(/capacity/);
  });
});

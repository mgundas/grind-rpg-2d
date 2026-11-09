/**
 * Allocation-free per-room tick timing. One ring buffer of durations; p50/p95
 * are computed only when an admin/load-test poll asks for a snapshot, so the
 * 20 Hz hot path pays for one clock read and one array store.
 */

export interface TickStatsSnapshot {
  count: number;
  lastMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  overruns: number;
}

const DEFAULT_CAPACITY = 1200; // 60 s at 20 Hz
const DEFAULT_BUDGET_MS = 50;

const EMPTY: TickStatsSnapshot = {
  count: 0,
  lastMs: 0,
  avgMs: 0,
  p50Ms: 0,
  p95Ms: 0,
  maxMs: 0,
  overruns: 0,
};

function percentile(sorted: Float64Array, count: number, q: number): number {
  if (count === 0) {
    return 0;
  }
  const index = Math.min(count - 1, Math.max(0, Math.floor(q * (count - 1))));
  return sorted[index] ?? 0;
}

export class TickStats {
  private readonly ring: Float64Array;
  private readonly scratch: Float64Array;
  private head = 0;
  private filled = 0;
  private sum = 0;
  private last = 0;
  private max = 0;
  private overruns = 0;

  constructor(private readonly capacity: number = DEFAULT_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error("TickStats capacity must be a positive integer");
    }
    this.ring = new Float64Array(capacity);
    this.scratch = new Float64Array(capacity);
  }

  record(durationMs: number, budgetMs: number = DEFAULT_BUDGET_MS): void {
    const value = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
    if (this.filled === this.capacity) {
      this.sum -= this.ring[this.head] ?? 0;
    }
    this.ring[this.head] = value;
    this.sum += value;
    this.head = (this.head + 1) % this.capacity;
    this.filled = Math.min(this.capacity, this.filled + 1);
    this.last = value;
    if (value > this.max) {
      this.max = value;
    }
    if (value > budgetMs) {
      this.overruns++;
    }
  }

  /** Call from one poller at a time: sorting reuses a shared scratch buffer. */
  snapshot(): TickStatsSnapshot {
    if (this.filled === 0) {
      return { ...EMPTY };
    }
    for (let index = 0; index < this.filled; index++) {
      this.scratch[index] = this.ring[index] ?? 0;
    }
    const sorted = this.scratch.subarray(0, this.filled);
    sorted.sort();
    return {
      count: this.filled,
      lastMs: this.last,
      avgMs: this.sum / this.filled,
      p50Ms: percentile(sorted, this.filled, 0.5),
      p95Ms: percentile(sorted, this.filled, 0.95),
      maxMs: this.max,
      overruns: this.overruns,
    };
  }

  reset(): void {
    this.head = 0;
    this.filled = 0;
    this.sum = 0;
    this.last = 0;
    this.max = 0;
    this.overruns = 0;
  }
}

/** Shared day/night clock (GAME_DESIGN.md §2): one full cycle every 20 minutes. */
export const DAY_CYCLE_MS = 20 * 60 * 1000;

export type DayPhase = "dawn" | "day" | "dusk" | "night";

export interface DayCyclePoint {
  phase: DayPhase;
  /** 0 = full daylight, 1 = deepest night tint. */
  darkness: number;
  /** Normalized position in the cycle, 0..1. */
  progress: number;
}

const DAWN_END = 0.2;
const DAY_END = 0.7;
const DUSK_END = 0.85;
const MAX_DARKNESS = 0.72;

export function dayCycleAt(nowMs: number): DayCyclePoint {
  const cycle = ((nowMs % DAY_CYCLE_MS) + DAY_CYCLE_MS) % DAY_CYCLE_MS;
  const progress = cycle / DAY_CYCLE_MS;

  if (progress < DAWN_END) {
    return {
      phase: "dawn",
      darkness: MAX_DARKNESS * (1 - progress / DAWN_END),
      progress,
    };
  }
  if (progress < DAY_END) {
    return { phase: "day", darkness: 0, progress };
  }
  if (progress < DUSK_END) {
    return {
      phase: "dusk",
      darkness: MAX_DARKNESS * ((progress - DAY_END) / (DUSK_END - DAY_END)),
      progress,
    };
  }
  return { phase: "night", darkness: MAX_DARKNESS, progress };
}

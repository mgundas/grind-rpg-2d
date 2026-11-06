import { randomInt } from "node:crypto";
import type { RandomSource } from "@jadethrone/shared";

/**
 * Production randomness. Combat, spawn placement and future loot rolls must
 * use crypto randomness; `seededRandomSource` is only for tests and balance
 * scripts. `randomInt` is a CSPRNG and its result is comfortably uniform for
 * gameplay probability checks.
 */
export function createCryptoRandomSource(): RandomSource {
  return {
    next: () => randomInt(0, 1_000_000_000) / 1_000_000_000,
  };
}

/**
 * Deterministic RNG, used by procedural placeholder generation now and by
 * seeded tests (drop rolls, upgrade chains) in later phases.
 *
 * Note: the live server must use cryptographically secure randomness for all
 * loot and upgrade rolls (GAME_DESIGN.md §7.4) — this seeded PRNG is for
 * visuals and reproducible tests, never for real rolls.
 */

/** FNV-1a 32-bit hash: gives a stable seed from any string. */
export function seedFromString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Mulberry32 PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Injectable randomness. Combat and spawn code depend on this interface, not on
 * a concrete PRNG: the live server installs a crypto-backed source, tests and
 * balance scripts install `seededRandomSource`.
 */
export interface RandomSource {
  /** Float in [0, 1). */
  next(): number;
}

export function seededRandomSource(seed: number): RandomSource {
  return { next: mulberry32(seed) };
}

/** Float in [min, max). */
export function randomRange(rng: RandomSource, min: number, max: number): number {
  return min + (max - min) * rng.next();
}

/** Integer in [minInclusive, maxExclusive). */
export function randomInt(rng: RandomSource, minInclusive: number, maxExclusive: number): number {
  return minInclusive + Math.floor(rng.next() * (maxExclusive - minInclusive));
}

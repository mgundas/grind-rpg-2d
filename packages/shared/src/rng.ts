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

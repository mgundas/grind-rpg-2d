import type { RandomSource } from "./rng";

/** One item row in a drop table (GAME_DESIGN.md §6.3). */
export interface DropRollEntry {
  itemId: string;
  chance: number;
  minQty: number;
  maxQty: number;
}

export interface DropRoll {
  itemId: string;
  quantity: number;
}

export interface DropRollResult {
  gold: number;
  items: DropRoll[];
}

function rollInt(rng: RandomSource, min: number, max: number): number {
  const low = Math.max(0, Math.floor(min));
  const high = Math.max(low, Math.floor(max));
  if (high === low) {
    return low;
  }
  const draw = Math.min(Math.max(rng.next(), 0), 0.999999999999);
  return low + Math.floor(draw * (high - low + 1));
}

/**
 * Roll gold and every item entry with the room RNG. Order is fixed (gold,
 * then table order), so a seeded test reproduces drops exactly. Gold comes from
 * the monster's own range; the drop table contributes items only.
 */
export function rollDrops(
  rng: RandomSource,
  entries: ReadonlyArray<DropRollEntry>,
  goldMin: number,
  goldMax: number,
): DropRollResult {
  const gold = goldMax > 0 ? rollInt(rng, goldMin, goldMax) : 0;
  const items: DropRoll[] = [];
  for (const entry of entries) {
    const chance = Math.min(1, Math.max(0, entry.chance));
    if (rng.next() >= chance) {
      continue;
    }
    items.push({
      itemId: entry.itemId,
      quantity: rollInt(rng, entry.minQty, entry.maxQty),
    });
  }
  return { gold, items };
}

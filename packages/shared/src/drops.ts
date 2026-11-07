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

/** Ownership fields needed to decide whether a pickup is allowed. */
export interface DropClaim {
  ownerPartyId: string;
  ownerCharacterId: string;
  ownerUntilMs: number;
}

/**
 * Party-aware loot lock. A missing/empty owner or an expired lock is free for
 * all; a party lock admits members (and the round-robin character when set).
 */
export function canPickupDrop(
  drop: DropClaim,
  characterId: string,
  partyId: string | null,
  now: number,
): boolean {
  if (drop.ownerUntilMs <= 0 || now >= drop.ownerUntilMs) {
    return true;
  }
  if (drop.ownerPartyId) {
    if (partyId !== drop.ownerPartyId) {
      return false;
    }
    return drop.ownerCharacterId === "" || drop.ownerCharacterId === characterId;
  }
  if (drop.ownerCharacterId) {
    return drop.ownerCharacterId === characterId;
  }
  return true;
}

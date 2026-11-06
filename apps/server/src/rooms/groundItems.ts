import type { Rarity } from "@jadethrone/shared";

/** Server-private ground drop. Mirrored into `GroundItemState` for clients. */
export interface GroundItemRuntime {
  dropId: string;
  kind: "item" | "gold";
  itemId: string;
  quantity: number;
  rarity: Rarity;
  x: number;
  y: number;
  /** Empty string means free for all. */
  ownerCharacterId: string;
  ownerUntilMs: number;
  despawnAtMs: number;
}

export function isOwnerLocked(item: GroundItemRuntime, characterId: string, now: number): boolean {
  if (!item.ownerCharacterId || now >= item.ownerUntilMs) {
    return false;
  }
  return item.ownerCharacterId === characterId;
}

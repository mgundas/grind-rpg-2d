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

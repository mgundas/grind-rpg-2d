import type { ItemBonus, ItemStack } from "@jadethrone/shared";

/** Persisted location of an item row. */
export type ItemLocation = "inventory" | "equipment" | "warehouse" | "ground";

/** The fields a mutation asserts before writing (compare-and-swap). */
export interface RowState {
  location: ItemLocation;
  slot: number | null;
  quantity: number;
  ownerCharacterId: string | null;
  ownerAccountId: string | null;
  mapId: string | null;
  upgradeLevel: number;
  bonuses: readonly ItemBonus[];
}

export interface InsertChange {
  kind: "insert";
  id: string;
  itemId: string;
  location: "inventory" | "equipment" | "warehouse";
  slot: number;
  quantity: number;
  upgradeLevel: number;
  bonuses: readonly ItemBonus[];
  ownerCharacterId: string | null;
  ownerAccountId: string | null;
  createdBy: string;
}

export interface UpdateChange {
  kind: "update";
  id: string;
  itemId: string;
  expect: RowState;
  to: RowState;
}

export interface DeleteChange {
  kind: "delete";
  id: string;
  itemId: string;
  expect: RowState;
}

export type ItemChange = InsertChange | UpdateChange | DeleteChange;

export interface ItemLogEntry {
  itemId: string;
  action: string;
  definitionId: string;
  quantity: number;
  fromLocation?: ItemLocation | null;
  fromSlot?: number | null;
  toLocation?: ItemLocation | null;
  toSlot?: number | null;
  detail?: Record<string, unknown>;
}

export type GoldReason =
  | "kill"
  | "pickup"
  | "shop_buy"
  | "shop_sell"
  | "admin"
  | "starter"
  | "upgrade"
  | "enchant"
  | "trade"
  | "guild_create"
  | "teleport";

export interface GoldDelta {
  delta: number;
  reason: GoldReason;
  detail?: Record<string, unknown>;
}

export interface ItemPlan {
  changes: ItemChange[];
  logs: ItemLogEntry[];
  gold?: GoldDelta;
  /** Warehouse plans lock the account row as well as the character row. */
  lockAccount?: boolean;
}

export function rowStateFromStack(
  stack: ItemStack,
  location: "inventory" | "equipment",
  characterId: string,
): RowState {
  return {
    location,
    slot: stack.slot,
    quantity: stack.quantity,
    ownerCharacterId: characterId,
    ownerAccountId: null,
    mapId: null,
    upgradeLevel: stack.upgradeLevel,
    bonuses: [...stack.bonuses],
  };
}

export function rowStateFromGround(row: {
  mapId: string;
  quantity: number;
  upgradeLevel?: number;
  bonuses?: readonly ItemBonus[];
}): RowState {
  return {
    location: "ground",
    slot: null,
    quantity: row.quantity,
    ownerCharacterId: null,
    ownerAccountId: null,
    mapId: row.mapId,
    upgradeLevel: row.upgradeLevel ?? 0,
    bonuses: [...(row.bonuses ?? [])],
  };
}

/**
 * Turn a change list into one audit row per touched instance. Planners can add
 * operation-specific detail; the from/to fields are always derived from the
 * change itself so the log cannot drift from what was written.
 */
export function describeChanges(
  changes: ReadonlyArray<ItemChange>,
  action: string,
  detail?: Record<string, unknown>,
): ItemLogEntry[] {
  return changes.map((change) => {
    if (change.kind === "insert") {
      return {
        itemId: change.id,
        action,
        definitionId: change.itemId,
        quantity: change.quantity,
        toLocation: change.location,
        toSlot: change.slot,
        detail,
      };
    }
    if (change.kind === "delete") {
      return {
        itemId: change.id,
        action,
        definitionId: change.itemId,
        quantity: change.expect.quantity,
        fromLocation: change.expect.location,
        fromSlot: change.expect.slot,
        detail,
      };
    }
    const quantityDelta = change.to.quantity - change.expect.quantity;
    return {
      itemId: change.id,
      action,
      definitionId: change.itemId,
      quantity: Math.abs(quantityDelta) > 0 ? Math.abs(quantityDelta) : change.to.quantity,
      fromLocation: change.expect.location,
      fromSlot: change.expect.slot,
      toLocation: change.to.location,
      toSlot: change.to.slot,
      detail: {
        ...detail,
        quantityDelta,
        previousUpgradeLevel: change.expect.upgradeLevel,
        upgradeLevel: change.to.upgradeLevel,
        bonusCount: change.to.bonuses.length,
      },
    };
  });
}

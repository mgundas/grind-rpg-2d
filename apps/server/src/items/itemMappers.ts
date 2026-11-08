import {
  EQUIP_SLOTS,
  equipSlotForItemType,
  findFreeSlot,
  normalizeInventory,
  type InventoryState,
  type ItemDefinitionLike,
  type ItemStack,
  type ItemType,
  type ItemInstanceDto,
} from "@jadethrone/shared";
import { BASE_CATALOG, type CatalogLookup } from "@jadethrone/data/catalog";
import type { ItemRow, NewItemRow } from "../db/schema";

/**
 * Row ↔ domain mapping plus the load-time repair pass. The repair pass is the
 * only place that tolerates corrupted or obsolete rows; it never deletes an
 * item because a definition disappeared.
 */

export type ItemLocation = "inventory" | "equipment" | "warehouse" | "ground";

const FALLBACK_DEFINITION: ItemDefinitionLike = {
  id: "__unknown__",
  type: "material",
  rarity: "common",
  size: 1,
  stackable: false,
  maxStack: 1,
  levelReq: 1,
  classes: "all",
};

/** Never throws on a removed/renamed definition: treats it as a size-1 material. */
export function safeDefinition(
  itemId: string,
  catalog: CatalogLookup = BASE_CATALOG,
): ItemDefinitionLike {
  return catalog.findItem(itemId) ?? FALLBACK_DEFINITION;
}

export function definitionLookup(
  catalog: CatalogLookup = BASE_CATALOG,
): (itemId: string) => ItemDefinitionLike {
  return (itemId) => safeDefinition(itemId, catalog);
}

export function toItemStack(row: ItemRow): ItemStack {
  return {
    id: row.id,
    itemId: row.definitionId,
    slot: row.slot ?? 0,
    quantity: row.quantity,
    upgradeLevel: row.upgradeLevel,
    bonuses: row.bonuses ?? [],
  };
}

export function toItemDto(stack: ItemStack): ItemInstanceDto {
  return {
    id: stack.id,
    itemId: stack.itemId,
    slot: stack.slot,
    quantity: stack.quantity,
    upgradeLevel: stack.upgradeLevel,
    bonuses: [...stack.bonuses],
  };
}

export function toNewItemRow(
  stack: ItemStack,
  owner: { characterId: string } | { accountId: string },
  location: "inventory" | "equipment" | "warehouse",
  createdBy: string,
): NewItemRow {
  return {
    id: stack.id,
    definitionId: stack.itemId,
    ownerCharacterId: "characterId" in owner ? owner.characterId : null,
    ownerAccountId: "accountId" in owner ? owner.accountId : null,
    location,
    slot: stack.slot,
    quantity: stack.quantity,
    upgradeLevel: stack.upgradeLevel,
    bonuses: [...stack.bonuses],
    createdBy,
  };
}

export type InventoryRepairReason =
  | "overlap"
  | "equipment_slot"
  | "equipment_quantity"
  | "unknown_definition"
  | "invalid_quantity";

export interface InventoryRepair {
  itemId: string;
  definitionId: string;
  reason: InventoryRepairReason;
  fromLocation: "inventory" | "equipment";
  toLocation: "inventory" | "equipment";
  fromSlot: number | null;
  toSlot: number | null;
  quantity: number;
}

function isInventoryType(type: ItemType): boolean {
  return type !== "consumable" && type !== "material" && type !== "skillbook" && type !== "quest";
}

/**
 * Turn persisted rows into the in-memory state, repairing overlaps, obsolete
 * equipment slots and absurd quantities. Equipment items that cannot stay
 * equipped move to the first free inventory cell.
 */
export function loadRowsIntoState(
  rows: ReadonlyArray<ItemRow>,
  catalog: CatalogLookup = BASE_CATALOG,
): { inventory: InventoryState; repairs: InventoryRepair[] } {
  const lookup = definitionLookup(catalog);
  const items: ItemStack[] = [];
  const equipment: (ItemStack | null)[] = Array.from({ length: EQUIP_SLOTS.length }, () => null);
  const repairs: InventoryRepair[] = [];

  // Inventory first: an equipment row that has to move into the bag must see
  // the real occupied cells, otherwise it can target an occupied slot.
  const ordered = [...rows].sort((a, b) => {
    const rank = (row: ItemRow) => (row.location === "inventory" ? 0 : 1);
    return rank(a) - rank(b);
  });
  for (const row of ordered) {
    if (row.location !== "inventory" && row.location !== "equipment") {
      continue;
    }
    const stack = toItemStack(row);
    if (row.location === "inventory") {
      const known = catalog.hasItem(row.definitionId);
      const definition = safeDefinition(row.definitionId, catalog);
      const maxQuantity = definition.stackable ? Math.max(1, definition.maxStack) : 1;
      if (!known) {
        // A removed definition must not destroy the saved quantity; it is
        // already unreadable in-game, but the row can be restored by data.
        items.push(stack);
        continue;
      }
      if (!Number.isInteger(stack.quantity) || stack.quantity < 1) {
        stack.quantity = 1;
        repairs.push({
          itemId: stack.id,
          definitionId: stack.itemId,
          reason: "invalid_quantity",
          fromLocation: "inventory",
          toLocation: "inventory",
          fromSlot: stack.slot,
          toSlot: stack.slot,
          quantity: stack.quantity,
        });
      } else if (stack.quantity > maxQuantity) {
        stack.quantity = maxQuantity;
        repairs.push({
          itemId: stack.id,
          definitionId: stack.itemId,
          reason: "invalid_quantity",
          fromLocation: "inventory",
          toLocation: "inventory",
          fromSlot: stack.slot,
          toSlot: stack.slot,
          quantity: stack.quantity,
        });
      }
      items.push(stack);
      continue;
    }

    const known = catalog.hasItem(row.definitionId);
    const definition = safeDefinition(row.definitionId, catalog);
    const equipSlot = equipSlotForItemType(definition.type);
    const expectedIndex = equipSlot === null ? -1 : EQUIP_SLOTS.indexOf(equipSlot);
    const index = row.slot ?? -1;
    const validIndex = Number.isInteger(index) && index >= 0 && index < equipment.length;
    const canStay = known && isInventoryType(definition.type) && expectedIndex >= 0 && index === expectedIndex;
    const slotFree = validIndex && equipment[index] === null;

    if (canStay && slotFree) {
      stack.slot = index;
      if (stack.quantity !== 1) {
        repairs.push({
          itemId: stack.id,
          definitionId: stack.itemId,
          reason: "equipment_quantity",
          fromLocation: "equipment",
          toLocation: "equipment",
          fromSlot: index,
          toSlot: index,
          quantity: 1,
        });
        stack.quantity = 1;
      }
      equipment[index] = stack;
      continue;
    }

    // Relocate to the inventory. `findFreeSlot` sees every item collected so
    // far; if the grid is genuinely full the normalizer below will try again.
    const destination = findFreeSlot(items, definition.size, lookup) ?? 0;
    stack.slot = destination;
    items.push(stack);
    repairs.push({
      itemId: stack.id,
      definitionId: stack.itemId,
      reason: known ? "equipment_slot" : "unknown_definition",
      fromLocation: "equipment",
      toLocation: "inventory",
      fromSlot: Number.isInteger(index) ? index : null,
      toSlot: destination,
      quantity: stack.quantity,
    });
  }

  const beforeSlots = new Map(items.map((item) => [item.id, item.slot]));
  const normalized = normalizeInventory(items, lookup);
  for (const item of normalized.items) {
    const before = beforeSlots.get(item.id);
    if (before !== undefined && before !== item.slot) {
      repairs.push({
        itemId: item.id,
        definitionId: item.itemId,
        reason: "overlap",
        fromLocation: "inventory",
        toLocation: "inventory",
        fromSlot: before,
        toSlot: item.slot,
        quantity: item.quantity,
      });
    }
  }

  return { inventory: { items: normalized.items, equipment }, repairs };
}

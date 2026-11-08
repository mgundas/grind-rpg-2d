import {
  EQUIP_SLOTS,
  equipSlotForItemType,
  canEquip,
  type EquippedItemLike,
  type ItemBonus,
  type ItemDefinitionLike,
} from "./items";

/**
 * Multi-cell inventory maths shared by client and server (GAME_DESIGN.md §7.3).
 * Items occupy one column and 1–3 rows. Slots are the top-left cell index, so
 * a 3-row item at row 7 would cross a page boundary and is therefore invalid.
 *
 * Every operation is pure: it returns a new state or an error code. The server
 * persists the resulting state; the client uses the same rules for previews.
 */

export const INVENTORY_COLS = 5;
export const INVENTORY_ROWS = 9;
export const INVENTORY_PAGES = 2;
export const INVENTORY_CELLS = INVENTORY_COLS * INVENTORY_ROWS * INVENTORY_PAGES;

export const WAREHOUSE_PAGES = 3;
export const WAREHOUSE_CELLS = INVENTORY_COLS * INVENTORY_ROWS * WAREHOUSE_PAGES;

export const EQUIP_SLOT_COUNT = EQUIP_SLOTS.length;

export interface GridSpec {
  columns: number;
  rows: number;
  pages: number;
}

export const INVENTORY_GRID: GridSpec = {
  columns: INVENTORY_COLS,
  rows: INVENTORY_ROWS,
  pages: INVENTORY_PAGES,
};

export const WAREHOUSE_GRID: GridSpec = {
  columns: INVENTORY_COLS,
  rows: INVENTORY_ROWS,
  pages: WAREHOUSE_PAGES,
};

/** One item instance; `slot` is a top-left inventory cell or an equipment index. */
export interface ItemStack {
  id: string;
  itemId: string;
  slot: number;
  quantity: number;
  upgradeLevel: number;
  bonuses: readonly ItemBonus[];
}

export interface InventoryState {
  items: ItemStack[];
  equipment: (ItemStack | null)[];
}

/** Account-wide warehouse contents (3 pages, no equipment). */
export interface WarehouseState {
  items: ItemStack[];
}

export const INVENTORY_ERROR_CODES = [
  "invalid_slot",
  "slot_occupied",
  "item_not_found",
  "invalid_quantity",
  "requirements_not_met",
  "not_equippable",
  "not_equipped",
  "inventory_full",
] as const;

export type InventoryErrorCode = (typeof INVENTORY_ERROR_CODES)[number];

export type InventoryResult =
  | { ok: true; state: InventoryState }
  | { ok: false; code: InventoryErrorCode };

export function emptyInventory(): InventoryState {
  return {
    items: [],
    equipment: Array.from({ length: EQUIP_SLOTS.length }, () => null),
  };
}

export function emptyWarehouse(): WarehouseState {
  return { items: [] };
}

export function cloneInventory(state: InventoryState): InventoryState {
  return {
    items: state.items.map((item) => ({ ...item, bonuses: [...item.bonuses] })),
    equipment: state.equipment.map((item) =>
      item ? { ...item, bonuses: [...item.bonuses] } : null,
    ),
  };
}

export function gridPageCells(grid: GridSpec = INVENTORY_GRID): number {
  return grid.columns * grid.rows;
}

export function isSlotInGrid(slot: number, grid: GridSpec = INVENTORY_GRID): boolean {
  if (!Number.isInteger(slot)) {
    return false;
  }
  return slot >= 0 && slot < gridPageCells(grid) * grid.pages;
}

export function slotPage(slot: number, grid: GridSpec = INVENTORY_GRID): number {
  return Math.floor(slot / gridPageCells(grid));
}

export function slotRow(slot: number, grid: GridSpec = INVENTORY_GRID): number {
  const local = slot % gridPageCells(grid);
  return Math.floor(local / grid.columns);
}

export function slotCol(slot: number, grid: GridSpec = INVENTORY_GRID): number {
  return slot % grid.columns;
}

/** Normalize a definition size to the valid 1–3 range. */
export function itemSize(size: number): number {
  if (!Number.isFinite(size)) {
    return 1;
  }
  return Math.min(3, Math.max(1, Math.floor(size)));
}

/**
 * Cells occupied by an item whose top-left cell is `slot`, or null when the
 * placement is invalid (out of grid or crossing a page boundary).
 */
export function cellsForSlot(
  slot: number,
  size: number,
  grid: GridSpec = INVENTORY_GRID,
): number[] | null {
  if (!isSlotInGrid(slot, grid)) {
    return null;
  }
  const height = itemSize(size);
  const row = slotRow(slot, grid);
  if (row + height > grid.rows) {
    return null;
  }
  const pageOffset = slotPage(slot, grid) * gridPageCells(grid);
  const col = slotCol(slot, grid);
  const cells: number[] = [];
  for (let offset = 0; offset < height; offset++) {
    cells.push(pageOffset + (row + offset) * grid.columns + col);
  }
  return cells;
}

/** Map every occupied cell to the id of its item. */
export function buildOccupiedCells(
  items: ReadonlyArray<ItemStack>,
  getDefinition: (itemId: string) => ItemDefinitionLike,
  grid: GridSpec = INVENTORY_GRID,
): Map<number, string> {
  const occupied = new Map<number, string>();
  for (const item of items) {
    const definition = getDefinition(item.itemId);
    const cells = cellsForSlot(item.slot, definition.size, grid);
    if (!cells) {
      continue;
    }
    for (const cell of cells) {
      occupied.set(cell, item.id);
    }
  }
  return occupied;
}

/** The item whose occupied cells include `cell` (or null). */
export function itemAtCell(
  items: ReadonlyArray<ItemStack>,
  cell: number,
  getDefinition: (itemId: string) => ItemDefinitionLike,
  grid: GridSpec = INVENTORY_GRID,
): ItemStack | null {
  for (const item of items) {
    const cells = cellsForSlot(item.slot, getDefinition(item.itemId).size, grid);
    if (cells?.includes(cell)) {
      return item;
    }
  }
  return null;
}

export function canPlaceAt(
  items: ReadonlyArray<ItemStack>,
  slot: number,
  size: number,
  getDefinition: (itemId: string) => ItemDefinitionLike,
  grid: GridSpec = INVENTORY_GRID,
): boolean {
  const cells = cellsForSlot(slot, size, grid);
  if (!cells) {
    return false;
  }
  const occupied = buildOccupiedCells(items, getDefinition, grid);
  return cells.every((cell) => !occupied.has(cell));
}

export function findFreeSlot(
  items: ReadonlyArray<ItemStack>,
  size: number,
  getDefinition: (itemId: string) => ItemDefinitionLike,
  grid: GridSpec = INVENTORY_GRID,
  startSlot = 0,
): number | null {
  const occupied = buildOccupiedCells(items, getDefinition, grid);
  const pageCells = gridPageCells(grid);
  for (let page = 0; page < grid.pages; page++) {
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.columns; col++) {
        const slot = page * pageCells + row * grid.columns + col;
        if (slot < startSlot) {
          continue;
        }
        const cells = cellsForSlot(slot, size, grid);
        if (cells && cells.every((cell) => !occupied.has(cell))) {
          return slot;
        }
      }
    }
  }
  return null;
}

function sameStack(a: ItemStack, b: ItemStack): boolean {
  if (a.itemId !== b.itemId || a.upgradeLevel !== b.upgradeLevel) {
    return false;
  }
  if (a.bonuses.length !== b.bonuses.length) {
    return false;
  }
  return a.bonuses.every(
    (bonus, index) =>
      bonus.type === b.bonuses[index]?.type && bonus.value === b.bonuses[index]?.value,
  );
}

/**
 * Add `item` to the inventory, merging into existing stacks first and creating
 * extra stacks when the quantity exceeds `maxStack`. `newId` supplies ids for
 * the additional stacks. The operation is atomic: if any part cannot fit, the
 * original state is returned unchanged with `inventory_full`.
 */
export function addItem(
  state: InventoryState,
  definition: ItemDefinitionLike,
  item: ItemStack,
  newId: () => string,
  getDefinition: (itemId: string) => ItemDefinitionLike,
  grid: GridSpec = INVENTORY_GRID,
): InventoryResult {
  if (!Number.isInteger(item.quantity) || item.quantity < 1) {
    return { ok: false, code: "invalid_quantity" };
  }
  if (!definition.stackable && item.quantity !== 1) {
    return { ok: false, code: "invalid_quantity" };
  }

  const next = cloneInventory(state);
  let remaining = item.quantity;

  if (definition.stackable) {
    const stacks = next.items
      .filter((candidate) => sameStack(candidate, item))
      .sort((a, b) => a.slot - b.slot);
    for (const stack of stacks) {
      const space = definition.maxStack - stack.quantity;
      if (space <= 0) {
        continue;
      }
      const moved = Math.min(space, remaining);
      stack.quantity += moved;
      remaining -= moved;
      if (remaining === 0) {
        return { ok: true, state: next };
      }
    }
  }

  let first = true;
  const maxStack = definition.stackable ? Math.max(1, definition.maxStack) : 1;
  while (remaining > 0) {
    const slot = findFreeSlot(next.items, definition.size, getDefinition, grid);
    if (slot === null) {
      return { ok: false, code: "inventory_full" };
    }
    const quantity = Math.min(maxStack, remaining);
    next.items.push({
      ...item,
      id: first ? item.id : newId(),
      slot,
      quantity,
      bonuses: [...item.bonuses],
    });
    first = false;
    remaining -= quantity;
  }

  return { ok: true, state: next };
}

/**
 * Move an item to a target cell. Dropping on an occupied cell either merges a
 * compatible stack or swaps the two items when both fit.
 */
export function moveItem(
  state: InventoryState,
  instanceId: string,
  targetSlot: number,
  getDefinition: (itemId: string) => ItemDefinitionLike,
  grid: GridSpec = INVENTORY_GRID,
): InventoryResult {
  if (!isSlotInGrid(targetSlot, grid)) {
    return { ok: false, code: "invalid_slot" };
  }
  const source = state.items.find((item) => item.id === instanceId);
  if (!source) {
    return { ok: false, code: "item_not_found" };
  }

  const next = cloneInventory(state);
  const moving = next.items.find((item) => item.id === instanceId)!;
  const target = itemAtCell(next.items, targetSlot, getDefinition, grid);

  if (target?.id === moving.id) {
    return { ok: true, state: next };
  }

  if (target) {
    const sourceDefinition = getDefinition(moving.itemId);
    const targetDefinition = getDefinition(target.itemId);

    if (sourceDefinition.stackable && sameStack(moving, target)) {
      const space = Math.max(0, targetDefinition.maxStack - target.quantity);
      const moved = Math.min(space, moving.quantity);
      target.quantity += moved;
      moving.quantity -= moved;
      if (moving.quantity <= 0) {
        next.items = next.items.filter((item) => item.id !== moving.id);
      }
      return { ok: true, state: next };
    }

    // Swap: remove both first so each sees the other's freed cells.
    const remaining = next.items.filter(
      (item) => item.id !== moving.id && item.id !== target.id,
    );
    const sourceFits = canPlaceAt(
      remaining,
      target.slot,
      sourceDefinition.size,
      getDefinition,
      grid,
    );
    const targetFits = canPlaceAt(
      remaining,
      moving.slot,
      targetDefinition.size,
      getDefinition,
      grid,
    );
    if (!sourceFits || !targetFits) {
      return { ok: false, code: "slot_occupied" };
    }
    moving.slot = target.slot;
    target.slot = source.slot;
    return { ok: true, state: next };
  }

  const definition = getDefinition(moving.itemId);
  next.items = next.items.filter((item) => item.id !== moving.id);
  if (!canPlaceAt(next.items, targetSlot, definition.size, getDefinition, grid)) {
    return { ok: false, code: "invalid_slot" };
  }
  moving.slot = targetSlot;
  next.items.push(moving);
  return { ok: true, state: next };
}

/** Split part of a stack into a new instance at `targetSlot` (or the first free slot). */
export function splitStack(
  state: InventoryState,
  instanceId: string,
  quantity: number,
  newId: string,
  targetSlot: number | null,
  getDefinition: (itemId: string) => ItemDefinitionLike,
  grid: GridSpec = INVENTORY_GRID,
): InventoryResult {
  const source = state.items.find((item) => item.id === instanceId);
  if (!source) {
    return { ok: false, code: "item_not_found" };
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity >= source.quantity) {
    return { ok: false, code: "invalid_quantity" };
  }

  const definition = getDefinition(source.itemId);
  if (!definition.stackable) {
    return { ok: false, code: "invalid_quantity" };
  }

  const next = cloneInventory(state);
  const moving = next.items.find((item) => item.id === instanceId)!;
  const destination = targetSlot === null ? null : itemAtCell(next.items, targetSlot, getDefinition, grid);

  if (targetSlot !== null && destination && destination.id !== moving.id) {
    if (!sameStack(destination, moving)) {
      return { ok: false, code: "slot_occupied" };
    }
    const space = Math.max(0, definition.maxStack - destination.quantity);
    if (space < quantity) {
      return { ok: false, code: "inventory_full" };
    }
    destination.quantity += quantity;
    moving.quantity -= quantity;
    return { ok: true, state: next };
  }

  const slot =
    targetSlot === null
      ? findFreeSlot(next.items, definition.size, getDefinition, grid)
      : targetSlot;
  if (slot === null || !canPlaceAt(next.items, slot, definition.size, getDefinition, grid)) {
    return { ok: false, code: "inventory_full" };
  }

  moving.quantity -= quantity;
  next.items.push({
    ...moving,
    id: newId,
    slot,
    quantity,
    bonuses: [...moving.bonuses],
  });
  return { ok: true, state: next };
}

/** Equip an inventory item, swapping out the currently equipped one if possible. */
export function equipItem(
  state: InventoryState,
  instanceId: string,
  classId: Parameters<typeof canEquip>[1],
  level: number,
  getDefinition: (itemId: string) => ItemDefinitionLike,
): InventoryResult {
  const source = state.items.find((item) => item.id === instanceId);
  if (!source) {
    return { ok: false, code: "item_not_found" };
  }
  if (source.quantity !== 1) {
    return { ok: false, code: "invalid_quantity" };
  }
  const definition = getDefinition(source.itemId);
  const slot = equipSlotForItemType(definition.type);
  if (slot === null) {
    return { ok: false, code: "not_equippable" };
  }
  if (!canEquip(definition, classId, level)) {
    return { ok: false, code: "requirements_not_met" };
  }

  const next = cloneInventory(state);
  const moving = next.items.find((item) => item.id === instanceId)!;
  const equipmentIndex = EQUIP_SLOTS.indexOf(slot);
  const previous = next.equipment[equipmentIndex] ?? null;
  next.items = next.items.filter((item) => item.id !== moving.id);

  if (previous) {
    const previousDefinition = getDefinition(previous.itemId);
    let destination: number | null = moving.slot;
    if (
      !canPlaceAt(
        next.items,
        destination,
        previousDefinition.size,
        getDefinition,
      )
    ) {
      destination = findFreeSlot(next.items, previousDefinition.size, getDefinition);
    }
    if (destination === null) {
      return { ok: false, code: "inventory_full" };
    }
    previous.slot = destination;
    next.items.push(previous);
  }

  next.equipment[equipmentIndex] = {
    ...moving,
    slot: equipmentIndex,
    quantity: 1,
  };
  return { ok: true, state: next };
}

/** Move an equipped item back to the inventory. */
export function unequipItem(
  state: InventoryState,
  equipmentIndex: number,
  targetSlot: number | null,
  getDefinition: (itemId: string) => ItemDefinitionLike,
  grid: GridSpec = INVENTORY_GRID,
): InventoryResult {
  if (
    !Number.isInteger(equipmentIndex) ||
    equipmentIndex < 0 ||
    equipmentIndex >= EQUIP_SLOTS.length
  ) {
    return { ok: false, code: "invalid_slot" };
  }
  const equipped = state.equipment[equipmentIndex];
  if (!equipped) {
    return { ok: false, code: "not_equipped" };
  }

  const definition = getDefinition(equipped.itemId);
  const next = cloneInventory(state);
  next.equipment[equipmentIndex] = null;

  const slot =
    targetSlot === null
      ? findFreeSlot(next.items, definition.size, getDefinition, grid)
      : targetSlot;
  if (slot === null || !canPlaceAt(next.items, slot, definition.size, getDefinition, grid)) {
    return { ok: false, code: "inventory_full" };
  }

  next.items.push({ ...equipped, slot });
  return { ok: true, state: next };
}

/**
 * Repair loaded rows whose definition changed or whose slots overlap. Items are
 * processed in slot order; anything invalid moves to the first free cell.
 */
export function normalizeInventory(
  items: ReadonlyArray<ItemStack>,
  getDefinition: (itemId: string) => ItemDefinitionLike,
  grid: GridSpec = INVENTORY_GRID,
): { items: ItemStack[]; repaired: boolean } {
  const placed: ItemStack[] = [];
  let repaired = false;

  for (const item of [...items].sort((a, b) => a.slot - b.slot)) {
    const definition = getDefinition(item.itemId);
    if (canPlaceAt(placed, item.slot, definition.size, getDefinition, grid)) {
      placed.push({ ...item, bonuses: [...item.bonuses] });
      continue;
    }
    const slot = findFreeSlot(placed, definition.size, getDefinition, grid);
    if (slot === null) {
      // The grid is truly full; keep the item at its original slot so the
      // caller can log it rather than silently deleting a valuable item.
      placed.push({ ...item, bonuses: [...item.bonuses] });
      repaired = true;
      continue;
    }
    placed.push({ ...item, slot, bonuses: [...item.bonuses] });
    repaired = true;
  }

  return { items: placed.sort((a, b) => a.slot - b.slot), repaired };
}

/** Convenience for equipment aggregation: turn the slot array into EquippedItemLike. */
export function equipmentForStats(
  state: InventoryState,
  getDefinition: (itemId: string) => ItemDefinitionLike,
): Array<EquippedItemLike | null> {
  return state.equipment.map((item) =>
    item
      ? {
          definition: getDefinition(item.itemId),
          upgradeLevel: item.upgradeLevel,
          bonuses: item.bonuses,
        }
      : null,
  );
}

/** Slot → sprite layer key (empty string means nothing equipped). */
export interface EquipmentLayerKeys {
  weaponLayer: string;
  armorLayer: string;
  helmetLayer: string;
  shieldLayer: string;
}

export function equipmentLayerKeys(
  state: InventoryState,
  getDefinition: (itemId: string) => ItemDefinitionLike & { spriteLayerKey?: string },
): EquipmentLayerKeys {
  const keys: EquipmentLayerKeys = {
    weaponLayer: "",
    armorLayer: "",
    helmetLayer: "",
    shieldLayer: "",
  };
  for (const item of state.equipment) {
    if (!item) {
      continue;
    }
    const definition = getDefinition(item.itemId);
    const layer = definition.spriteLayerKey ?? "";
    if (!layer) {
      continue;
    }
    switch (definition.type) {
      case "weapon":
        keys.weaponLayer = layer;
        break;
      case "armor":
        keys.armorLayer = layer;
        break;
      case "helmet":
        keys.helmetLayer = layer;
        break;
      case "shield":
        keys.shieldLayer = layer;
        break;
      default:
        break;
    }
  }
  return keys;
}

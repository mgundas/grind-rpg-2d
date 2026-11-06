import {
  INVENTORY_GRID,
  WAREHOUSE_GRID,
  addItem,
  canPlaceAt,
  cloneInventory,
  equipItem,
  findFreeSlot,
  moveItem,
  splitStack,
  unequipItem,
  type ClassId,
  type InventoryState,
  type ItemBonus,
  type ItemStack,
  type WarehouseState,
} from "@jadethrone/shared";
import { getItem, hasItem } from "@jadethrone/data/items";
import { getShop } from "@jadethrone/data/shops";
import { ItemError } from "./errors";
import {
  describeChanges,
  rowStateFromGround,
  rowStateFromStack,
  type DeleteChange,
  type GoldDelta,
  type InsertChange,
  type ItemChange,
  type ItemPlan,
  type UpdateChange,
} from "./itemChanges";
import { safeDefinition } from "./itemMappers";

/** A plan plus the next in-memory state. The room applies the plan first. */
export interface ItemPlanResult<S> {
  state: S;
  plan: ItemPlan;
}

interface LocatedStack {
  stack: ItemStack;
  location: "inventory" | "equipment";
}

function locateStacks(state: InventoryState): Map<string, LocatedStack> {
  const located = new Map<string, LocatedStack>();
  for (const stack of state.items) {
    located.set(stack.id, { stack, location: "inventory" });
  }
  state.equipment.forEach((stack, index) => {
    if (stack) {
      located.set(stack.id, { stack: { ...stack, slot: index }, location: "equipment" });
    }
  });
  return located;
}

function insertChange(
  stack: ItemStack,
  location: "inventory" | "equipment",
  characterId: string,
  createdBy: string,
): InsertChange {
  return {
    kind: "insert",
    id: stack.id,
    itemId: stack.itemId,
    location,
    slot: stack.slot,
    quantity: stack.quantity,
    upgradeLevel: stack.upgradeLevel,
    bonuses: [...stack.bonuses],
    ownerCharacterId: characterId,
    ownerAccountId: null,
    createdBy,
  };
}

/** Diff two inventory states by instance id, never by array position. */
export function diffInventory(
  before: InventoryState,
  after: InventoryState,
  characterId: string,
  createdBy = "mutation",
): ItemChange[] {
  const previous = locateStacks(before);
  const next = locateStacks(after);
  const changes: ItemChange[] = [];

  for (const [id, entry] of next) {
    const old = previous.get(id);
    if (!old) {
      changes.push(insertChange(entry.stack, entry.location, characterId, createdBy));
      continue;
    }
    const expect = rowStateFromStack(old.stack, old.location, characterId);
    const to = rowStateFromStack(entry.stack, entry.location, characterId);
    if (
      expect.location !== to.location ||
      expect.slot !== to.slot ||
      expect.quantity !== to.quantity
    ) {
      changes.push({
        kind: "update",
        id,
        itemId: entry.stack.itemId,
        expect,
        to,
      });
    }
  }

  for (const [id, entry] of previous) {
    if (!next.has(id)) {
      changes.push({
        kind: "delete",
        id,
        itemId: entry.stack.itemId,
        expect: rowStateFromStack(entry.stack, entry.location, characterId),
      });
    }
  }

  return changes;
}

function planFromInventory(
  before: InventoryState,
  after: InventoryState,
  characterId: string,
  action: string,
  createdBy = "mutation",
  detail?: Record<string, unknown>,
  gold?: GoldDelta,
): ItemPlanResult<InventoryState> {
  const changes = diffInventory(before, after, characterId, createdBy);
  return {
    state: after,
    plan: { changes, logs: describeChanges(changes, action, detail), gold },
  };
}

export function planMove(
  state: InventoryState,
  characterId: string,
  instanceId: string,
  toSlot: number,
): ItemPlanResult<InventoryState> {
  const result = moveItem(state, instanceId, toSlot, safeDefinition);
  if (!result.ok) {
    throw new ItemError(result.code, `Cannot move item: ${result.code}`);
  }
  return planFromInventory(state, result.state, characterId, "move");
}

export function planSplit(
  state: InventoryState,
  characterId: string,
  instanceId: string,
  quantity: number,
  toSlot: number | null,
  newId: () => string,
): ItemPlanResult<InventoryState> {
  const result = splitStack(state, instanceId, quantity, newId(), toSlot, safeDefinition);
  if (!result.ok) {
    throw new ItemError(result.code, `Cannot split stack: ${result.code}`);
  }
  return planFromInventory(state, result.state, characterId, "split", "split", { quantity });
}

export function planEquip(
  state: InventoryState,
  characterId: string,
  classId: ClassId,
  level: number,
  instanceId: string,
): ItemPlanResult<InventoryState> {
  const result = equipItem(state, instanceId, classId, level, safeDefinition);
  if (!result.ok) {
    throw new ItemError(result.code, `Cannot equip item: ${result.code}`);
  }
  return planFromInventory(state, result.state, characterId, "equip");
}

export function planUnequip(
  state: InventoryState,
  characterId: string,
  equipmentIndex: number,
  toSlot: number | null,
): ItemPlanResult<InventoryState> {
  const result = unequipItem(state, equipmentIndex, toSlot, safeDefinition);
  if (!result.ok) {
    throw new ItemError(result.code, `Cannot unequip item: ${result.code}`);
  }
  return planFromInventory(state, result.state, characterId, "unequip");
}

/** Consume exactly one unit of a stack (the effect itself is applied by the room). */
export function planConsume(
  state: InventoryState,
  characterId: string,
  instanceId: string,
): ItemPlanResult<InventoryState> {
  const stack = state.items.find((item) => item.id === instanceId);
  if (!stack) {
    throw new ItemError("item_not_found", "Item is not in the inventory.");
  }
  const after = cloneInventory(state);
  const target = after.items.find((item) => item.id === instanceId)!;
  if (target.quantity <= 1) {
    after.items = after.items.filter((item) => item.id !== instanceId);
  } else {
    target.quantity -= 1;
  }
  return planFromInventory(state, after, characterId, "use", "mutation", {
    itemId: target.itemId,
  });
}

export interface GroundRowInput {
  id: string;
  itemId: string;
  quantity: number;
  upgradeLevel: number;
  bonuses: readonly ItemBonus[];
  mapId: string;
}

/**
 * Pick up a ground item. `addItem` merges compatible stacks first and reuses
 * the ground row's UUID for the first newly created stack, so the common case
 * is a single row update rather than a delete + insert.
 */
export function planPickup(
  state: InventoryState,
  characterId: string,
  ground: GroundRowInput,
  newId: () => string,
): ItemPlanResult<InventoryState> {
  if (!hasItem(ground.itemId)) {
    throw new ItemError("unknown_item", `Unknown item "${ground.itemId}".`);
  }
  const definition = getItem(ground.itemId);
  const result = addItem(
    state,
    definition,
    {
      id: ground.id,
      itemId: ground.itemId,
      slot: 0,
      quantity: ground.quantity,
      upgradeLevel: ground.upgradeLevel,
      bonuses: ground.bonuses,
    },
    newId,
    safeDefinition,
  );
  if (!result.ok) {
    throw new ItemError(result.code, `Cannot pick up item: ${result.code}`);
  }

  const changes: ItemChange[] = [];
  const beforeById = new Map(state.items.map((stack) => [stack.id, stack]));
  const groundExpect = rowStateFromGround(ground);
  let leftover = 0;
  let leftoverSlot: number | null = null;

  for (const stack of result.state.items) {
    if (stack.id === ground.id) {
      leftover = stack.quantity;
      leftoverSlot = stack.slot;
      continue;
    }
    const before = beforeById.get(stack.id);
    if (!before) {
      // Extra stack created when the ground quantity exceeded maxStack.
      changes.push(insertChange(stack, "inventory", characterId, "pickup"));
      continue;
    }
    if (before.quantity !== stack.quantity) {
      const update: UpdateChange = {
        kind: "update",
        id: stack.id,
        itemId: stack.itemId,
        expect: rowStateFromStack(before, "inventory", characterId),
        to: rowStateFromStack(stack, "inventory", characterId),
      };
      changes.push(update);
    }
  }

  if (leftover > 0 && leftoverSlot !== null) {
    changes.push({
      kind: "update",
      id: ground.id,
      itemId: ground.itemId,
      expect: groundExpect,
      to: {
        location: "inventory",
        slot: leftoverSlot,
        quantity: leftover,
        ownerCharacterId: characterId,
        ownerAccountId: null,
        mapId: null,
      },
    });
  } else {
    const remove: DeleteChange = {
      kind: "delete",
      id: ground.id,
      itemId: ground.itemId,
      expect: groundExpect,
    };
    changes.push(remove);
  }

  const merged = ground.quantity - leftover;
  return {
    state: result.state,
    plan: {
      changes,
      logs: [
        {
          itemId: ground.id,
          action: "pickup",
          definitionId: ground.itemId,
          quantity: ground.quantity,
          fromLocation: "ground",
          fromSlot: null,
          toLocation: leftover > 0 ? "inventory" : null,
          toSlot: leftoverSlot,
          detail: { merged, moved: leftover },
        },
      ],
    },
  };
}

export function planGoldPickup(characterId: string, amount: number, dropId: string): ItemPlan {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ItemError("invalid_quantity", "Gold amount must be positive.");
  }
  return {
    changes: [],
    logs: [],
    gold: { delta: amount, reason: "pickup", detail: { dropId, characterId } },
  };
}

export function planBuy(
  state: InventoryState,
  characterId: string,
  gold: number,
  shopId: string,
  itemId: string,
  quantity: number,
  newId: () => string,
): ItemPlanResult<InventoryState> {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new ItemError("invalid_quantity", "Quantity must be positive.");
  }
  let shop;
  try {
    shop = getShop(shopId);
  } catch {
    throw new ItemError("unknown_shop", `Unknown shop "${shopId}".`);
  }
  if (!shop.items.some((entry) => entry.itemId === itemId)) {
    throw new ItemError("not_for_sale", "That item is not sold here.");
  }
  if (!hasItem(itemId)) {
    throw new ItemError("unknown_item", `Unknown item "${itemId}".`);
  }
  const definition = getItem(itemId);
  if (definition.buyPrice <= 0) {
    throw new ItemError("not_for_sale", "That item has no buy price.");
  }
  if (!definition.stackable && quantity !== 1) {
    throw new ItemError("invalid_quantity", "Equipment can only be bought one at a time.");
  }
  const total = definition.buyPrice * quantity;
  if (gold < total) {
    throw new ItemError("no_gold", "Not enough gold.");
  }

  const result = addItem(
    state,
    definition,
    {
      id: newId(),
      itemId,
      slot: 0,
      quantity,
      upgradeLevel: 0,
      bonuses: [],
    },
    newId,
    safeDefinition,
  );
  if (!result.ok) {
    throw new ItemError(result.code, `Cannot buy item: ${result.code}`);
  }

  const changes = diffInventory(state, result.state, characterId, "shop");
  return {
    state: result.state,
    plan: {
      changes,
      logs: describeChanges(changes, "buy", {
        shopId,
        itemId,
        quantity,
        unitPrice: definition.buyPrice,
        total,
      }),
      gold: {
        delta: -total,
        reason: "shop_buy",
        detail: { shopId, itemId, quantity, unitPrice: definition.buyPrice, total },
      },
    },
  };
}

export function planSell(
  state: InventoryState,
  characterId: string,
  instanceId: string,
  quantity: number,
): ItemPlanResult<InventoryState> {
  const stack = state.items.find((item) => item.id === instanceId);
  if (!stack) {
    throw new ItemError("item_not_found", "Item is not in the inventory.");
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > stack.quantity) {
    throw new ItemError("invalid_quantity", "Invalid sell quantity.");
  }
  const definition = getItem(stack.itemId);
  if (definition.sellPrice <= 0) {
    throw new ItemError("not_for_sale", "That item cannot be sold.");
  }
  const unitPrice = definition.sellPrice;
  const total = unitPrice * quantity;
  const after = cloneInventory(state);
  const target = after.items.find((item) => item.id === instanceId)!;
  if (quantity === target.quantity) {
    after.items = after.items.filter((item) => item.id !== instanceId);
  } else {
    target.quantity -= quantity;
  }
  return planFromInventory(state, after, characterId, "sell", "mutation", {
    itemId: stack.itemId,
    quantity,
    unitPrice,
    total,
  }, { delta: total, reason: "shop_sell", detail: { instanceId, quantity, unitPrice, total } });
}

export function planDeposit(
  inventory: InventoryState,
  warehouse: WarehouseState,
  characterId: string,
  accountId: string,
  instanceId: string,
): ItemPlanResult<{ inventory: InventoryState; warehouse: WarehouseState }> {
  const stack = inventory.items.find((item) => item.id === instanceId);
  if (!stack) {
    throw new ItemError("item_not_found", "Item is not in the inventory.");
  }
  const definition = safeDefinition(stack.itemId);
  const slot = findFreeSlot(warehouse.items, definition.size, safeDefinition, WAREHOUSE_GRID);
  if (slot === null) {
    throw new ItemError("warehouse_full", "The warehouse is full.");
  }

  const nextInventory = cloneInventory(inventory);
  nextInventory.items = nextInventory.items.filter((item) => item.id !== instanceId);
  const nextWarehouse: WarehouseState = {
    items: [
      ...warehouse.items,
      { ...stack, slot, bonuses: [...stack.bonuses] },
    ],
  };
  const change: UpdateChange = {
    kind: "update",
    id: stack.id,
    itemId: stack.itemId,
    expect: rowStateFromStack(stack, "inventory", characterId),
    to: {
      location: "warehouse",
      slot,
      quantity: stack.quantity,
      ownerCharacterId: null,
      ownerAccountId: accountId,
      mapId: null,
    },
  };
  return {
    state: { inventory: nextInventory, warehouse: nextWarehouse },
    plan: {
      changes: [change],
      logs: describeChanges([change], "deposit", { accountId }),
      lockAccount: true,
    },
  };
}

export function planWithdraw(
  inventory: InventoryState,
  warehouse: WarehouseState,
  characterId: string,
  accountId: string,
  instanceId: string,
  toSlot: number | null,
): ItemPlanResult<{ inventory: InventoryState; warehouse: WarehouseState }> {
  const stack = warehouse.items.find((item) => item.id === instanceId);
  if (!stack) {
    throw new ItemError("item_not_found", "Item is not in the warehouse.");
  }
  const definition = safeDefinition(stack.itemId);
  let slot: number | null;
  if (toSlot === null) {
    slot = findFreeSlot(inventory.items, definition.size, safeDefinition, INVENTORY_GRID);
  } else {
    slot = canPlaceAt(inventory.items, toSlot, definition.size, safeDefinition, INVENTORY_GRID)
      ? toSlot
      : null;
  }
  if (slot === null) {
    throw new ItemError(
      toSlot === null ? "inventory_full" : "slot_occupied",
      "No room for the withdrawn item.",
    );
  }

  const nextInventory = cloneInventory(inventory);
  nextInventory.items.push({ ...stack, slot, bonuses: [...stack.bonuses] });
  const nextWarehouse: WarehouseState = {
    items: warehouse.items.filter((item) => item.id !== instanceId),
  };
  const change: UpdateChange = {
    kind: "update",
    id: stack.id,
    itemId: stack.itemId,
    expect: {
      location: "warehouse",
      slot: stack.slot,
      quantity: stack.quantity,
      ownerCharacterId: null,
      ownerAccountId: accountId,
      mapId: null,
    },
    to: rowStateFromStack({ ...stack, slot }, "inventory", characterId),
  };
  return {
    state: { inventory: nextInventory, warehouse: nextWarehouse },
    plan: {
      changes: [change],
      logs: describeChanges([change], "withdraw", { accountId }),
      lockAccount: true,
    },
  };
}

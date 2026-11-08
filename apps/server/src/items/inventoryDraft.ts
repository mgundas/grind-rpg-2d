import type { InventoryState, ItemStack } from "@jadethrone/shared";
import { ItemError } from "./errors";

/** One stack plus where it lives; mutations rebuild rather than alias. */
export interface LocatedStack {
  stack: ItemStack;
  location: "inventory" | "equipment";
}

export function findStack(state: InventoryState, instanceId: string): LocatedStack | null {
  const inventory = state.items.find((item) => item.id === instanceId);
  if (inventory) {
    return { stack: inventory, location: "inventory" };
  }
  const equipment = state.equipment.find((item) => item?.id === instanceId);
  return equipment ? { stack: equipment, location: "equipment" } : null;
}

export function countItem(state: InventoryState, itemId: string): number {
  return state.items
    .filter((item) => item.itemId === itemId)
    .reduce((total, item) => total + item.quantity, 0);
}

/** Consume `quantity` from inventory stacks, mutating the working state. */
export function consumeItem(state: InventoryState, itemId: string, quantity: number): void {
  let remaining = quantity;
  for (let index = 0; index < state.items.length && remaining > 0; index += 1) {
    const stack = state.items[index]!;
    if (stack.itemId !== itemId) {
      continue;
    }
    const consumed = Math.min(stack.quantity, remaining);
    remaining -= consumed;
    if (consumed === stack.quantity) {
      state.items.splice(index, 1);
      index -= 1;
    } else {
      state.items[index] = { ...stack, quantity: stack.quantity - consumed };
    }
  }
  if (remaining > 0) {
    throw new ItemError("not_usable", `Not enough ${itemId}.`);
  }
}

/** Replace or remove one stack in a working inventory. */
export function setStack(
  state: InventoryState,
  instanceId: string,
  next: ItemStack | null,
): void {
  const inventoryIndex = state.items.findIndex((item) => item.id === instanceId);
  if (inventoryIndex >= 0) {
    if (next === null) {
      state.items.splice(inventoryIndex, 1);
    } else {
      state.items[inventoryIndex] = next;
    }
    return;
  }
  const equipmentIndex = state.equipment.findIndex((item) => item?.id === instanceId);
  if (equipmentIndex < 0) {
    throw new ItemError("item_not_found", "Item not found.");
  }
  state.equipment[equipmentIndex] = next;
}

import { describe, expect, it } from "vitest";
import {
  addItem,
  canPlaceAt,
  cellsForSlot,
  emptyInventory,
  equipItem,
  findFreeSlot,
  INVENTORY_CELLS,
  moveItem,
  normalizeInventory,
  splitStack,
  unequipItem,
  WAREHOUSE_CELLS,
  WAREHOUSE_GRID,
  type InventoryState,
  type ItemStack,
} from "../src/inventory";
import type { ItemDefinitionLike } from "../src/items";

const DEFINITIONS: Record<string, ItemDefinitionLike> = {
  sword: {
    id: "sword",
    type: "weapon",
    rarity: "common",
    size: 3,
    stackable: false,
    maxStack: 1,
    levelReq: 1,
    classes: ["warrior"],
    baseStats: { attack: 6 },
  },
  armor: {
    id: "armor",
    type: "armor",
    rarity: "common",
    size: 2,
    stackable: false,
    maxStack: 1,
    levelReq: 1,
    classes: "all",
    baseStats: { defense: 3 },
  },
  potion: {
    id: "potion",
    type: "consumable",
    rarity: "common",
    size: 1,
    stackable: true,
    maxStack: 10,
    levelReq: 1,
    classes: "all",
  },
  ore: {
    id: "ore",
    type: "material",
    rarity: "common",
    size: 1,
    stackable: true,
    maxStack: 5,
    levelReq: 1,
    classes: "all",
  },
};

function getDefinition(itemId: string): ItemDefinitionLike {
  const definition = DEFINITIONS[itemId];
  if (!definition) {
    throw new Error(`unknown test item ${itemId}`);
  }
  return definition;
}

function stack(overrides: Partial<ItemStack> = {}): ItemStack {
  return {
    id: "item-1",
    itemId: "potion",
    slot: 0,
    quantity: 1,
    upgradeLevel: 0,
    bonuses: [],
    ...overrides,
  };
}

function stateWith(items: ItemStack[], equipment: (ItemStack | null)[] = []): InventoryState {
  return {
    items,
    equipment: Array.from({ length: 8 }, (_, index) => equipment[index] ?? null),
  };
}

function nextIdFactory(): () => string {
  let next = 100;
  return () => `new-${next++}`;
}

describe("inventory grid maths", () => {
  it("occupies vertical cells and never crosses a page boundary", () => {
    expect(cellsForSlot(0, 3)).toEqual([0, 5, 10]);
    expect(cellsForSlot(0, 1)).toEqual([0]);
    // row 7 of page 0: a 3-row item would cross into page 1.
    expect(cellsForSlot(35, 3)).toBeNull();
    expect(cellsForSlot(35, 2)).toEqual([35, 40]);
    // page 1 starts at 45.
    expect(cellsForSlot(45, 3)).toEqual([45, 50, 55]);
  });

  it("supports three warehouse pages", () => {
    expect(WAREHOUSE_CELLS).toBe(135);
    expect(cellsForSlot(134, 1, WAREHOUSE_GRID)).toEqual([134]);
    expect(cellsForSlot(134, 2, WAREHOUSE_GRID)).toBeNull();
    expect(cellsForSlot(INVENTORY_CELLS, 1)).toBeNull();
  });

  it("finds the first free top-left slot around tall items", () => {
    const items = [stack({ id: "a", itemId: "sword", slot: 0 })];
    expect(findFreeSlot(items, 3, getDefinition)).toBe(1);
    expect(findFreeSlot(items, 2, getDefinition)).toBe(1);
    expect(canPlaceAt(items, 0, 1, getDefinition)).toBe(false);
    expect(canPlaceAt(items, 2, 1, getDefinition)).toBe(true);
  });
});

describe("adding items", () => {
  it("merges stacks before using new cells", () => {
    const state = stateWith([stack({ id: "a", quantity: 8 })]);
    const result = addItem(state, DEFINITIONS.potion!, stack({ id: "b", quantity: 5 }), nextIdFactory(), getDefinition);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.items).toHaveLength(2);
    const first = result.state.items.find((item) => item.id === "a");
    expect(first?.quantity).toBe(10);
    const second = result.state.items.find((item) => item.id === "b");
    expect(second?.quantity).toBe(3);
    expect(second?.slot).toBe(1);
  });

  it("creates multiple stacks when quantity exceeds maxStack", () => {
    const result = addItem(
      emptyInventory(),
      DEFINITIONS.ore!,
      stack({ id: "a", itemId: "ore", quantity: 12 }),
      nextIdFactory(),
      getDefinition,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.items.map((item) => item.quantity)).toEqual([5, 5, 2]);
    expect(new Set(result.state.items.map((item) => item.id)).size).toBe(3);
  });

  it("is atomic when the grid is full", () => {
    const full = stateWith(
      Array.from({ length: INVENTORY_CELLS }, (_, slot) =>
        stack({ id: `p-${slot}`, slot, quantity: 10 }),
      ),
    );
    const result = addItem(full, DEFINITIONS.potion!, stack({ id: "new" }), nextIdFactory(), getDefinition);
    expect(result).toEqual({ ok: false, code: "inventory_full" });
    expect(full.items).toHaveLength(INVENTORY_CELLS);
  });

  it("rejects a non-stackable item with quantity above one", () => {
    const result = addItem(
      emptyInventory(),
      DEFINITIONS.sword!,
      stack({ itemId: "sword", quantity: 2 }),
      nextIdFactory(),
      getDefinition,
    );
    expect(result).toEqual({ ok: false, code: "invalid_quantity" });
  });
});

describe("moving and splitting", () => {
  it("moves an item to an empty slot", () => {
    const state = stateWith([stack({ id: "a", slot: 0 })]);
    const result = moveItem(state, "a", 7, getDefinition);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.items[0]?.slot).toBe(7);
  });

  it("swaps two items when both fit", () => {
    const state = stateWith([
      stack({ id: "potion", itemId: "potion", slot: 0 }),
      stack({ id: "ore", itemId: "ore", slot: 1 }),
    ]);
    const result = moveItem(state, "potion", 1, getDefinition);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.items.find((item) => item.id === "potion")?.slot).toBe(1);
    expect(result.state.items.find((item) => item.id === "ore")?.slot).toBe(0);
  });

  it("swaps with a multi-cell item via its top-left slot", () => {
    const state = stateWith([
      stack({ id: "sword", itemId: "sword", slot: 20 }),
      stack({ id: "potion", itemId: "potion", slot: 0 }),
    ]);
    // 25 is the middle cell of the sword, so the target resolves to slot 20.
    const result = moveItem(state, "potion", 25, getDefinition);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.items.find((item) => item.id === "potion")?.slot).toBe(20);
    expect(result.state.items.find((item) => item.id === "sword")?.slot).toBe(0);
  });

  it("merges a moved stack into a compatible stack", () => {
    const state = stateWith([
      stack({ id: "a", quantity: 6, slot: 0 }),
      stack({ id: "b", quantity: 5, slot: 1 }),
    ]);
    const result = moveItem(state, "b", 0, getDefinition);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.items).toHaveLength(2);
    expect(result.state.items.find((item) => item.id === "a")?.quantity).toBe(10);
    expect(result.state.items.find((item) => item.id === "b")?.quantity).toBe(1);
  });

  it("splits a stack into a new instance", () => {
    const state = stateWith([stack({ id: "a", quantity: 8, slot: 0 })]);
    const result = splitStack(state, "a", 3, "new-stack", null, getDefinition);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.items).toHaveLength(2);
    expect(result.state.items.find((item) => item.id === "a")?.quantity).toBe(5);
    expect(result.state.items.find((item) => item.id === "new-stack")?.quantity).toBe(3);
    expect(result.state.items.find((item) => item.id === "new-stack")?.slot).toBe(1);
  });

  it("rejects invalid split quantities", () => {
    const state = stateWith([stack({ id: "a", quantity: 8 })]);
    expect(splitStack(state, "a", 0, "new", null, getDefinition)).toEqual({
      ok: false,
      code: "invalid_quantity",
    });
    expect(splitStack(state, "a", 8, "new", null, getDefinition)).toEqual({
      ok: false,
      code: "invalid_quantity",
    });
  });
});

describe("equipment", () => {
  it("equips a weapon and frees its inventory cell", () => {
    const state = stateWith([stack({ id: "w", itemId: "sword", slot: 0 })]);
    const result = equipItem(state, "w", "warrior", 1, getDefinition);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.items).toHaveLength(0);
    expect(result.state.equipment[0]?.id).toBe("w");
  });

  it("enforces class and level requirements", () => {
    const state = stateWith([stack({ id: "w", itemId: "sword", slot: 0 })]);
    expect(equipItem(state, "w", "assassin", 1, getDefinition)).toEqual({
      ok: false,
      code: "requirements_not_met",
    });
  });

  it("swaps an equipped item back into the inventory", () => {
    const state = stateWith(
      [stack({ id: "new", itemId: "sword", slot: 0 })],
      [stack({ id: "old", itemId: "sword", slot: 0 })],
    );
    const result = equipItem(state, "new", "warrior", 1, getDefinition);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.equipment[0]?.id).toBe("new");
    expect(result.state.items.find((item) => item.id === "old")?.slot).toBe(0);
  });

  it("unequips into the first free slot", () => {
    const state = stateWith([], [stack({ id: "w", itemId: "sword", slot: 0 })]);
    const result = unequipItem(state, 0, null, getDefinition);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.equipment[0]).toBeNull();
    expect(result.state.items[0]?.id).toBe("w");
  });

  it("refuses to unequip into a full inventory", () => {
    const state = stateWith(
      Array.from({ length: INVENTORY_CELLS }, (_, slot) =>
        stack({ id: `p-${slot}`, slot, quantity: 10 }),
      ),
      [stack({ id: "w", itemId: "sword", slot: 0 })],
    );
    expect(unequipItem(state, 0, null, getDefinition)).toEqual({
      ok: false,
      code: "inventory_full",
    });
  });
});

describe("normalization", () => {
  it("moves overlapping or out-of-page items to free slots", () => {
    const result = normalizeInventory(
      [
        stack({ id: "a", itemId: "armor", slot: 0 }),
        stack({ id: "b", itemId: "armor", slot: 0 }),
        stack({ id: "c", itemId: "sword", slot: 35 }),
        stack({ id: "d", itemId: "potion", slot: 999 }),
      ],
      getDefinition,
    );
    expect(result.repaired).toBe(true);
    const slots = result.items.map((item) => item.slot);
    expect(new Set(slots).size).toBe(slots.length);
    for (const item of result.items) {
      expect(cellsForSlot(item.slot, getDefinition(item.itemId).size)).not.toBeNull();
    }
  });

  it("leaves a valid layout untouched", () => {
    const items = [
      stack({ id: "a", itemId: "sword", slot: 0 }),
      stack({ id: "b", itemId: "potion", slot: 1 }),
    ];
    const result = normalizeInventory(items, getDefinition);
    expect(result.repaired).toBe(false);
    expect(result.items.map((item) => item.slot)).toEqual([0, 1]);
  });
});

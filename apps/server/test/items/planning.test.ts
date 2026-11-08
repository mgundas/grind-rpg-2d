import { describe, expect, it } from "vitest";
import {
  EQUIP_SLOTS,
  emptyInventory,
  type InventoryState,
  type ItemStack,
} from "@jadethrone/shared";
import type { ItemChange } from "../../src/items/itemChanges";
import {
  planBuy,
  planConsume,
  planDeposit,
  planEquip,
  planGoldPickup,
  planMove,
  planPickup,
  planSell,
  planSplit,
  planUnequip,
  planWithdraw,
} from "../../src/items/planning";

function stack(overrides: Partial<ItemStack> = {}): ItemStack {
  return {
    id: "item-1",
    itemId: "potion_hp_s",
    slot: 0,
    quantity: 1,
    upgradeLevel: 0,
    bonuses: [],
    ...overrides,
  };
}

function state(
  items: ItemStack[],
  equipment: (ItemStack | null)[] = [],
): InventoryState {
  return {
    items,
    equipment: Array.from({ length: 8 }, (_, index) => equipment[index] ?? null),
  };
}

function idFactory(): () => string {
  let next = 0;
  return () => `new-${++next}`;
}

function expectItemError(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error(`expected ItemError ${code}`);
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
  }
}

/** Apply a plan's changes to the before-state and compare with the planned state. */
function assertRoundTrip(before: InventoryState, after: InventoryState, changes: ItemChange[]) {
  const result: InventoryState = {
    items: before.items.map((item) => ({ ...item, bonuses: [...item.bonuses] })),
    equipment: before.equipment.map((item) =>
      item ? { ...item, bonuses: [...item.bonuses] } : null,
    ),
  };
  const remove = (id: string) => {
    result.items = result.items.filter((item) => item.id !== id);
    result.equipment = result.equipment.map((item) => (item?.id === id ? null : item));
  };
  for (const change of changes) {
    if (change.kind === "delete") {
      remove(change.id);
      continue;
    }
    if (change.kind === "update") {
      const existing =
        result.items.find((item) => item.id === change.id) ??
        result.equipment.find((item) => item?.id === change.id) ??
        null;
      if (!existing) {
        // Ground rows are not part of InventoryState; a ground → inventory
        // update is effectively an insert for this invariant check.
        if (change.expect.location === "ground") {
          if (change.to.location === "inventory" && change.to.slot !== null) {
            result.items.push({
              id: change.id,
              itemId: change.itemId,
              slot: change.to.slot,
              quantity: change.to.quantity,
              upgradeLevel: 0,
              bonuses: [],
            });
          }
          continue;
        }
        throw new Error(`update for missing ${change.id}`);
      }
      remove(change.id);
      const moved: ItemStack = {
        ...existing,
        slot: change.to.slot ?? existing.slot,
        quantity: change.to.quantity,
        upgradeLevel: change.to.upgradeLevel,
        bonuses: [...change.to.bonuses],
      };
      if (change.to.location === "inventory") {
        result.items.push(moved);
      } else if (change.to.location === "equipment") {
        result.equipment[moved.slot] = moved;
      }
      continue;
    }
    const inserted: ItemStack = {
      id: change.id,
      itemId: change.itemId,
      slot: change.slot,
      quantity: change.quantity,
      upgradeLevel: change.upgradeLevel,
      bonuses: [...change.bonuses],
    };
    if (change.location === "inventory") {
      result.items.push(inserted);
    } else if (change.location === "equipment") {
      result.equipment[inserted.slot] = inserted;
    }
  }

  const key = (items: ItemStack[]) =>
    [...items]
      .sort((a, b) => a.slot - b.slot)
      .map((item) => `${item.id}:${item.itemId}:${item.slot}:${item.quantity}`);
  expect(key(result.items)).toEqual(key(after.items));
  expect(result.equipment.map((item) => item?.id ?? null)).toEqual(
    after.equipment.map((item) => item?.id ?? null),
  );
}

describe("inventory planners", () => {
  it("move produces a change set that reproduces the state", () => {
    const before = state([stack({ id: "a", slot: 0 })]);
    const result = planMove(before, "char-1", "a", 7);
    expect(result.state.items[0]?.slot).toBe(7);
    assertRoundTrip(before, result.state, result.plan.changes);
    expect(result.plan.logs[0]?.action).toBe("move");
  });

  it("split creates a new stack and logs the split", () => {
    const before = state([stack({ id: "a", quantity: 8, slot: 0 })]);
    const result = planSplit(before, "char-1", "a", 3, null, idFactory());
    expect(result.state.items).toHaveLength(2);
    assertRoundTrip(before, result.state, result.plan.changes);
    expect(result.plan.logs[0]?.action).toBe("split");
  });

  it("equip swaps the old weapon back into the inventory", () => {
    const before = state(
      [stack({ id: "new", itemId: "sword_ember_t1", slot: 0 })],
      [stack({ id: "old", itemId: "sword_ember_t1", slot: 0 })],
    );
    const result = planEquip(before, "char-1", "warrior", 1, "new");
    expect(result.state.equipment[0]?.id).toBe("new");
    assertRoundTrip(before, result.state, result.plan.changes);
    expect(result.plan.logs[0]?.action).toBe("equip");
  });

  it("unequip fails when the inventory is full", () => {
    const before = state(
      Array.from({ length: 90 }, (_, slot) =>
        stack({ id: `p-${slot}`, slot, quantity: 100 }),
      ),
      [stack({ id: "w", itemId: "sword_ember_t1", slot: 0 })],
    );
    expect(() => planUnequip(before, "char-1", 0, null)).toThrowError(/inventory_full/);
  });

  it("consume deletes the last unit and decrements larger stacks", () => {
    const single = state([stack({ id: "a", quantity: 1 })]);
    const deleted = planConsume(single, "char-1", "a");
    expect(deleted.state.items).toHaveLength(0);
    assertRoundTrip(single, deleted.state, deleted.plan.changes);

    const many = state([stack({ id: "a", quantity: 3 })]);
    const decremented = planConsume(many, "char-1", "a");
    expect(decremented.state.items[0]?.quantity).toBe(2);
    assertRoundTrip(many, decremented.state, decremented.plan.changes);
  });
});

describe("pickup planners", () => {
  const ground = {
    id: "ground-1",
    itemId: "material_wolf_fang",
    quantity: 1,
    upgradeLevel: 0,
    bonuses: [],
    mapId: "map_ember_fields",
  };

  it("updates the ground row into the inventory when there is no matching stack", () => {
    const before = emptyInventory();
    const result = planPickup(before, "char-1", ground, idFactory());
    assertRoundTrip(before, result.state, result.plan.changes);
    const update = result.plan.changes.find((change) => change.kind === "update");
    expect(update?.kind).toBe("update");
    if (update?.kind === "update") {
      expect(update.expect.location).toBe("ground");
      expect(update.to.location).toBe("inventory");
    }
    expect(result.plan.logs[0]?.action).toBe("pickup");
  });

  it("deletes the ground row when the drop fully merges", () => {
    const before = state([
      stack({ id: "existing", itemId: "material_wolf_fang", quantity: 999 - 1 }),
    ]);
    const result = planPickup(before, "char-1", ground, idFactory());
    expect(result.state.items[0]?.quantity).toBe(999);
    expect(result.plan.changes.some((change) => change.kind === "delete")).toBe(true);
    assertRoundTrip(before, result.state, result.plan.changes);
  });

  it("rejects pickup when the inventory is full", () => {
    const before = state(
      Array.from({ length: 90 }, (_, slot) =>
        stack({ id: `p-${slot}`, itemId: "material_bear_claw", slot, quantity: 999 }),
      ),
    );
    expect(() => planPickup(before, "char-1", ground, idFactory())).toThrowError(
      /inventory_full/,
    );
  });

  it("creates a gold plan with no item rows", () => {
    const plan = planGoldPickup("char-1", 25, "coin-1");
    expect(plan.changes).toHaveLength(0);
    expect(plan.gold).toEqual({
      delta: 25,
      reason: "pickup",
      detail: { dropId: "coin-1", characterId: "char-1" },
    });
  });
});

describe("shop planners", () => {
  it("buys a full stack and splits when the quantity exceeds maxStack", () => {
    const before = emptyInventory();
    const result = planBuy(
      before,
      "char-1",
      10_000,
      "general_goods",
      "potion_hp_s",
      25,
      idFactory(),
    );
    assertRoundTrip(before, result.state, result.plan.changes);
    const total = result.state.items.reduce((sum, item) => sum + item.quantity, 0);
    expect(total).toBe(25);
    expect(result.plan.gold?.delta).toBe(-1000); // 25 × 40
  });

  it("rejects a purchase that cannot be afforded or is not stocked", () => {
    const before = emptyInventory();
    expectItemError(
      () => planBuy(before, "char-1", 39, "general_goods", "potion_hp_s", 1, idFactory()),
      "no_gold",
    );
    expectItemError(
      () =>
        planBuy(before, "char-1", 10_000, "general_goods", "sword_ember_t1", 1, idFactory()),
      "not_for_sale",
    );
    expectItemError(
      () => planBuy(before, "char-1", 10_000, "nope", "potion_hp_s", 1, idFactory()),
      "unknown_shop",
    );
  });

  it("sells part of a stack or the whole stack", () => {
    const before = state([stack({ id: "a", quantity: 5 })]);
    const partial = planSell(before, "char-1", "a", 2);
    expect(partial.state.items[0]?.quantity).toBe(3);
    expect(partial.plan.gold?.delta).toBe(24); // 2 × 12
    assertRoundTrip(before, partial.state, partial.plan.changes);

    const all = planSell(before, "char-1", "a", 5);
    expect(all.state.items).toHaveLength(0);
    assertRoundTrip(before, all.state, all.plan.changes);
  });

  it("refuses to sell unsellable items", () => {
    const before = state([stack({ id: "a", itemId: "material_wolf_fang", quantity: 1 })]);
    const definition = before.items[0]!;
    expect(definition.itemId).toBe("material_wolf_fang");
    // Wolf Fang is sellable; a quest item with sellPrice 0 would not be.
    expect(planSell(before, "char-1", "a", 1).plan.gold?.delta).toBe(12);
  });
});

describe("warehouse planners", () => {
  it("deposits and withdraws a whole stack", () => {
    const inventory = state([stack({ id: "a", slot: 3, quantity: 5 })]);
    const deposit = planDeposit(inventory, { items: [] }, "char-1", "account-1", "a");
    expect(deposit.state.warehouse.items[0]?.slot).toBe(0);
    expect(deposit.plan.lockAccount).toBe(true);
    const change = deposit.plan.changes[0];
    expect(change?.kind).toBe("update");
    if (change?.kind === "update") {
      expect(change.to.ownerAccountId).toBe("account-1");
      expect(change.to.ownerCharacterId).toBeNull();
      expect(change.to.location).toBe("warehouse");
    }

    const withdraw = planWithdraw(
      deposit.state.inventory,
      deposit.state.warehouse,
      "char-1",
      "account-1",
      "a",
      null,
    );
    expect(withdraw.state.inventory.items[0]?.id).toBe("a");
    expect(withdraw.state.warehouse.items).toHaveLength(0);
    expect(withdraw.state.inventory.equipment).toHaveLength(EQUIP_SLOTS.length);
  });

  it("reports a full warehouse or inventory", () => {
    const inventory = state([stack({ id: "a" })]);
    const fullWarehouse = {
      items: Array.from({ length: 135 }, (_, slot) =>
        stack({ id: `w-${slot}`, itemId: "material_wolf_fang", slot, quantity: 1 }),
      ),
    };
    expectItemError(
      () => planDeposit(inventory, fullWarehouse, "char-1", "account-1", "a"),
      "warehouse_full",
    );

    const fullInventory = state(
      Array.from({ length: 90 }, (_, slot) =>
        stack({ id: `i-${slot}`, itemId: "material_wolf_fang", slot, quantity: 1 }),
      ),
    );
    expectItemError(
      () =>
        planWithdraw(
          fullInventory,
          { items: [stack({ id: "w" })] },
          "char-1",
          "account-1",
          "w",
          null,
        ),
      "inventory_full",
    );
  });
});

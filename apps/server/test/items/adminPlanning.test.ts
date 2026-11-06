import { describe, expect, it } from "vitest";
import { effectiveItemStats } from "@jadethrone/shared";
import { getItem } from "@jadethrone/data/items";
import type { InventoryState, ItemStack } from "@jadethrone/shared";
import { planAdminGive, planAdminRemove } from "../../src/items/planning";

function state(items: ItemStack[] = [], equipment: (ItemStack | null)[] = []): InventoryState {
  return {
    items,
    equipment: Array.from({ length: 8 }, (_, index) => equipment[index] ?? null),
  };
}

function ids(prefix = "admin"): () => string {
  let next = 0;
  return () => `${prefix}-${++next}`;
}

function expectItemError(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error(`expected ItemError ${code}`);
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
  }
}

describe("planAdminGive", () => {
  it("grants a +5 sword with its upgrade level and bonuses", () => {
    const plan = planAdminGive(
      state(),
      "char-1",
      getItem("sword_ember_t1"),
      1,
      5,
      [],
      ids(),
    );
    const item = plan.state.items[0]!;
    expect(item.itemId).toBe("sword_ember_t1");
    expect(item.upgradeLevel).toBe(5);
    expect(effectiveItemStats(getItem("sword_ember_t1"), 5).attack).toBeGreaterThan(
      effectiveItemStats(getItem("sword_ember_t1"), 0).attack,
    );
    expect(plan.plan.changes).toHaveLength(1);
    expect(plan.plan.changes[0]?.kind).toBe("insert");
    expect(plan.plan.logs[0]?.action).toBe("admin_grant");
  });

  it("keeps bonuses on the instance", () => {
    const bonuses = [{ type: "max_hp", value: 100 }];
    const plan = planAdminGive(
      state(),
      "char-1",
      getItem("potion_hp_s"),
      1,
      0,
      bonuses,
      ids(),
    );
    expect(plan.state.items[0]?.bonuses).toEqual(bonuses);
  });

  it("merges stackable grants into existing stacks", () => {
    const before = state([
      {
        id: "existing",
        itemId: "potion_hp_s",
        slot: 0,
        quantity: 90,
        upgradeLevel: 0,
        bonuses: [],
      },
    ]);
    const plan = planAdminGive(before, "char-1", getItem("potion_hp_s"), 25, 0, [], ids());
    expect(plan.state.items).toHaveLength(2);
    expect(plan.state.items.find((item) => item.id === "existing")?.quantity).toBe(100);
    expect(plan.state.items.reduce((sum, item) => sum + item.quantity, 0)).toBe(115);
  });

  it("is atomic when the bag is full", () => {
    const full = state(
      Array.from({ length: 90 }, (_, slot) => ({
        id: `p-${slot}`,
        itemId: "potion_hp_s",
        slot,
        quantity: 100,
        upgradeLevel: 0,
        bonuses: [],
      })),
    );
    expect(() =>
      planAdminGive(full, "char-1", getItem("sword_ember_t1"), 1, 5, [], ids()),
    ).toThrowError(/inventory_full/);
  });

  it("rejects equipment quantities above one and invalid upgrades", () => {
    expectItemError(
      () => planAdminGive(state(), "char-1", getItem("sword_ember_t1"), 2, 0, [], ids()),
      "invalid_quantity",
    );
    expectItemError(
      () => planAdminGive(state(), "char-1", getItem("sword_ember_t1"), 1, 10, [], ids()),
      "invalid_quantity",
    );
  });
});

describe("planAdminRemove", () => {
  it("removes an inventory item", () => {
    const before = state([
      {
        id: "potion",
        itemId: "potion_hp_s",
        slot: 0,
        quantity: 5,
        upgradeLevel: 0,
        bonuses: [],
      },
    ]);
    const plan = planAdminRemove(before, "char-1", "potion");
    expect(plan.state.items).toHaveLength(0);
    expect(plan.plan.changes[0]?.kind).toBe("delete");
    expect(plan.plan.logs[0]?.action).toBe("admin_remove");
  });

  it("removes an equipped item and frees its slot", () => {
    const before = state(
      [],
      [
        {
          id: "sword",
          itemId: "sword_ember_t1",
          slot: 0,
          quantity: 1,
          upgradeLevel: 3,
          bonuses: [],
        },
      ],
    );
    const plan = planAdminRemove(before, "char-1", "sword");
    expect(plan.state.equipment[0]).toBeNull();
    expect(plan.state.items).toHaveLength(0);
    expect(plan.plan.changes[0]?.kind).toBe("delete");
  });

  it("rejects an item from another character", () => {
    expectItemError(() => planAdminRemove(state(), "char-1", "missing"), "item_not_found");
  });
});

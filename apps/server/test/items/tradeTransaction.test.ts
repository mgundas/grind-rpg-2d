import { describe, expect, it } from "vitest";
import { emptyInventory, type ItemStack } from "@jadethrone/shared";
import { assignReceivedSlots } from "../../src/items/tradeTransaction";

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

describe("assignReceivedSlots", () => {
  it("places incoming stacks in deterministic free slots", () => {
    const later = stack({ id: "later", slot: 9 });
    const earlier = stack({ id: "earlier", slot: 2 });
    const placed = assignReceivedSlots([], [later, earlier])!;
    expect(placed.map((item) => item.id)).toEqual(["earlier", "later"]);
    expect(placed.map((item) => item.slot)).toEqual([0, 1]);
  });

  it("reuses slots freed by outgoing items", () => {
    const remaining = [stack({ id: "stay", slot: 0 })];
    const placed = assignReceivedSlots(remaining, [stack({ id: "incoming", slot: 5 })])!;
    expect(placed[0]?.slot).toBe(1);
  });

  it("keeps upgrade levels, bonuses, quantity and id", () => {
    const incoming = stack({
      id: "sword",
      itemId: "sword_ember_t1",
      slot: 4,
      quantity: 1,
      upgradeLevel: 5,
      bonuses: [{ type: "attack", value: 5 }],
    });
    const [placed] = assignReceivedSlots([], [incoming])!;
    expect(placed).toEqual({ ...incoming, slot: 0 });
  });

  it("fits multi-cell items only when all rows are free", () => {
    // Fill the first page so the size-3 sword rolls over to slot 45.
    const firstPage = Array.from({ length: 45 }, (_, slot) =>
      stack({ id: `filled-${slot}`, slot }),
    );
    const placed = assignReceivedSlots(firstPage, [
      stack({ id: "sword", itemId: "sword_ember_t1", slot: 42 }),
    ])!;
    expect(placed[0]?.slot).toBe(45);

    const blocked = assignReceivedSlots(
      [...firstPage, stack({ id: "blocker", slot: 45 })],
      [stack({ id: "sword", itemId: "sword_ember_t1", slot: 42 })],
    )!;
    expect(blocked[0]?.slot).toBe(46);
  });

  it("returns null when the receiver has no room", () => {
    const full = Array.from({ length: 90 }, (_, slot) =>
      stack({ id: `filled-${slot}`, slot }),
    );
    expect(assignReceivedSlots(full, [stack({ id: "incoming", slot: 0 })])).toBeNull();
  });

  it("accepts an empty incoming list", () => {
    expect(assignReceivedSlots(emptyInventory().items, [])).toEqual([]);
  });
});

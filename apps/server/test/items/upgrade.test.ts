import { describe, expect, it } from "vitest";
import {
  emptyInventory,
  seededRandomSource,
  type InventoryState,
  type ItemStack,
  type RandomSource,
} from "@jadethrone/shared";
import { ItemError } from "../../src/items/errors";
import {
  buildUpgradePreview,
  isUpgradeableItem,
  planUpgrade,
  UPGRADE_BLESSING_ITEM,
} from "../../src/items/upgrade";

const CHARACTER = "char-1";

function stack(overrides: Partial<ItemStack> = {}): ItemStack {
  return {
    id: "item-1",
    itemId: "sword_ember_t1",
    slot: 0,
    quantity: 1,
    upgradeLevel: 0,
    bonuses: [],
    ...overrides,
  };
}

function scripted(...values: number[]): RandomSource {
  let index = 0;
  return {
    next: () => values[Math.min(index++, values.length - 1)] ?? 0,
  };
}

function state(items: ItemStack[], equipment: (ItemStack | null)[] = []): InventoryState {
  return {
    ...emptyInventory(),
    items,
    equipment:
      equipment.length > 0
        ? equipment
        : Array.from({ length: emptyInventory().equipment.length }, () => null),
  };
}

function material(id: string, quantity: number, slot = 5): ItemStack {
  return stack({ id: `mat-${id}`, itemId: id, slot, quantity });
}

describe("upgrade preview", () => {
  it("reports the next step, cost and owned materials", () => {
    const item = stack({ upgradeLevel: 3, slot: 0 });
    const inventory = state([item, material("material_wolf_fang", 2)]);
    const preview = buildUpgradePreview(inventory, 8_000, item.id);
    expect(preview.currentLevel).toBe(3);
    expect(preview.nextLevel).toBe(4);
    expect(preview.maxLevel).toBe(9);
    expect(preview.chance).toBeCloseTo(0.7);
    expect(preview.gold).toBe(8_000);
    expect(preview.materials).toEqual([
      { itemId: "material_wolf_fang", required: 1, owned: 2 },
    ]);
    expect(preview.hasGold).toBe(true);
    expect(preview.hasMaterials).toBe(true);
    expect(preview.blessingAvailable).toBe(false);
    expect(preview.canUpgrade).toBe(true);
  });

  it("blocks the preview when gold or materials are short", () => {
    const item = stack({ upgradeLevel: 4, slot: 0 });
    const inventory = state([item, material("material_wolf_fang", 1)]);
    const preview = buildUpgradePreview(inventory, 14_999, item.id);
    expect(preview.hasGold).toBe(false);
    expect(preview.hasMaterials).toBe(false);
    expect(preview.canUpgrade).toBe(false);
  });

  it("reports a maxed item as not upgradeable", () => {
    const item = stack({ upgradeLevel: 9, slot: 0 });
    const preview = buildUpgradePreview(state([item]), 1_000_000, item.id);
    expect(preview.nextLevel).toBeNull();
    expect(preview.chance).toBeNull();
    expect(preview.gold).toBeNull();
    expect(preview.canUpgrade).toBe(false);
  });

  it("rejects unknown items and non-equipment", () => {
    expect(() => buildUpgradePreview(state([]), 0, "missing")).toThrow(ItemError);
    const potion = stack({ itemId: "potion_hp_s", quantity: 1 });
    expect(() => buildUpgradePreview(state([potion]), 0, potion.id)).toThrow(
      /Only equipment/,
    );
  });
});

describe("planUpgrade", () => {
  it("succeeds below the chance threshold and consumes gold plus materials", () => {
    const item = stack({ upgradeLevel: 3, slot: 0 });
    const fangs = material("material_wolf_fang", 3);
    const inventory = state([item, fangs]);

    const result = planUpgrade(inventory, 8_000, CHARACTER, item.id, {
      useBlessing: false,
      rng: scripted(0.6999),
    });

    expect(result.success).toBe(true);
    expect(result.previousLevel).toBe(3);
    expect(result.level).toBe(4);
    expect(result.destroyed).toBe(false);
    expect(result.usedBlessing).toBe(false);
    expect(result.plan.gold).toEqual({
      delta: -8_000,
      reason: "upgrade",
      detail: expect.objectContaining({ instanceId: item.id, previousLevel: 3, level: 4 }),
    });

    const target = result.plan.changes.find((change) => change.id === item.id);
    expect(target?.kind).toBe("update");
    if (target?.kind === "update") {
      expect(target.expect.ownerCharacterId).toBe(CHARACTER);
      expect(target.expect.upgradeLevel).toBe(3);
      expect(target.to.upgradeLevel).toBe(4);
    }

    const consumed = result.plan.changes.find((change) => change.id === fangs.id);
    expect(consumed?.kind).toBe("update");
    if (consumed?.kind === "update") {
      expect(consumed.expect.quantity).toBe(3);
      expect(consumed.to.quantity).toBe(2);
    }
    expect(result.plan.logs.map((entry) => entry.action)).toContain("upgrade_success");
  });

  it("treats a roll equal to the chance as failure", () => {
    const item = stack({ upgradeLevel: 0, slot: 0 });
    const result = planUpgrade(state([item]), 1_000, CHARACTER, item.id, {
      useBlessing: false,
      rng: scripted(0.95),
    });
    expect(result.success).toBe(false);
    expect(result.destroyed).toBe(true);
  });

  it("destroys the item on failure without a blessing", () => {
    const item = stack({ upgradeLevel: 3, slot: 0 });
    const fangs = material("material_wolf_fang", 1);
    const inventory = state([item, fangs]);

    const result = planUpgrade(inventory, 8_000, CHARACTER, item.id, {
      useBlessing: false,
      rng: scripted(0.9),
    });

    expect(result.success).toBe(false);
    expect(result.destroyed).toBe(true);
    expect(result.level).toBeNull();
    const target = result.plan.changes.find((change) => change.id === item.id);
    expect(target?.kind).toBe("delete");
    expect(result.plan.logs.map((entry) => entry.action)).toContain("upgrade_failure");
  });

  it("downgrades one level and consumes a blessing on failure", () => {
    const item = stack({ upgradeLevel: 3, slot: 0 });
    const blessing = material(UPGRADE_BLESSING_ITEM, 2, 6);
    const inventory = state([item, material("material_wolf_fang", 1), blessing]);

    const result = planUpgrade(inventory, 8_000, CHARACTER, item.id, {
      useBlessing: true,
      rng: scripted(0.9),
    });

    expect(result.success).toBe(false);
    expect(result.destroyed).toBe(false);
    expect(result.usedBlessing).toBe(true);
    expect(result.level).toBe(2);

    const target = result.plan.changes.find((change) => change.id === item.id);
    expect(target?.kind).toBe("update");
    if (target?.kind === "update") {
      expect(target.to.upgradeLevel).toBe(2);
    }
    const scrollChange = result.plan.changes.find((change) => change.id === blessing.id);
    expect(scrollChange?.kind).toBe("update");
    if (scrollChange?.kind === "update") {
      expect(scrollChange.to.quantity).toBe(1);
    }
  });

  it("consumes a blessing only on failure", () => {
    const item = stack({ upgradeLevel: 1, slot: 0 });
    const blessing = material(UPGRADE_BLESSING_ITEM, 1, 6);
    const inventory = state([item, blessing]);

    const result = planUpgrade(inventory, 2_000, CHARACTER, item.id, {
      useBlessing: true,
      rng: scripted(0.1),
    });

    expect(result.success).toBe(true);
    expect(result.usedBlessing).toBe(false);
    expect(result.level).toBe(2);
    expect(result.plan.changes.some((change) => change.id === blessing.id)).toBe(false);
  });

  it("upgrades the +8 step with its rare material", () => {
    const item = stack({ upgradeLevel: 8, slot: 0 });
    const crystal = material("material_corrupted_crystal", 1);
    const inventory = state([item, crystal]);

    const result = planUpgrade(inventory, 250_000, CHARACTER, item.id, {
      useBlessing: false,
      rng: scripted(0.1499),
    });

    expect(result.success).toBe(true);
    expect(result.level).toBe(9);
    expect(result.plan.changes.find((change) => change.id === crystal.id)?.kind).toBe(
      "delete",
    );
  });

  it("upgrades an equipped item in place", () => {
    const item = stack({ id: "eq-1", upgradeLevel: 2, slot: 2 });
    const equipment = Array.from(
      { length: emptyInventory().equipment.length },
      () => null,
    ) as (ItemStack | null)[];
    equipment[2] = item;
    const inventory = state([], equipment);
    const fangs = material("material_wolf_fang", 1);
    inventory.items.push(fangs);

    const result = planUpgrade(inventory, 4_000, CHARACTER, item.id, {
      useBlessing: false,
      rng: scripted(0.1),
    });

    const target = result.plan.changes.find((change) => change.id === item.id);
    expect(target?.kind).toBe("update");
    if (target?.kind === "update") {
      expect(target.expect.location).toBe("equipment");
      expect(target.to.location).toBe("equipment");
      expect(target.to.slot).toBe(2);
      expect(target.to.upgradeLevel).toBe(3);
    }
  });

  it("rolls the configured chance against a seeded RNG", () => {
    const item = stack({ upgradeLevel: 2, slot: 0 });
    const rng = seededRandomSource(20261108);
    let successes = 0;
    const trials = 4_000;
    for (let trial = 0; trial < trials; trial += 1) {
      const result = planUpgrade(state([{ ...item, id: `item-${trial}` }]), 4_000, CHARACTER, `item-${trial}`, {
        useBlessing: false,
        rng,
      });
      if (result.success) {
        successes += 1;
      }
    }
    // Step 2 -> 3 is 85%; allow sampling noise around the true probability.
    expect(successes / trials).toBeGreaterThan(0.82);
    expect(successes / trials).toBeLessThan(0.88);
  });

  it("rejects max-level items", () => {
    const item = stack({ upgradeLevel: 9, slot: 0 });
    try {
      planUpgrade(state([item]), 1_000_000, CHARACTER, item.id, {
        useBlessing: false,
        rng: scripted(0),
      });
      expect.unreachable("expected a max-level rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ItemError);
      expect((error as ItemError).code).toBe("not_usable");
    }
  });

  it("rejects missing gold, materials or blessing", () => {
    const item = stack({ upgradeLevel: 3, slot: 0 });
    const fangs = material("material_wolf_fang", 1);
    expect(() =>
      planUpgrade(state([item, fangs]), 7_999, CHARACTER, item.id, {
        useBlessing: false,
        rng: scripted(0),
      }),
    ).toThrow(/Not enough gold/);

    expect(() =>
      planUpgrade(state([item]), 8_000, CHARACTER, item.id, {
        useBlessing: false,
        rng: scripted(0),
      }),
    ).toThrow(/Not enough material_wolf_fang/);

    expect(() =>
      planUpgrade(state([item, fangs]), 8_000, CHARACTER, item.id, {
        useBlessing: true,
        rng: scripted(0),
      }),
    ).toThrow(/No Blessing Scroll/);
  });

  it("rejects unknown or non-equipment targets", () => {
    expect(() =>
      planUpgrade(state([]), 0, CHARACTER, "missing", {
        useBlessing: false,
        rng: scripted(0),
      }),
    ).toThrow(ItemError);

    const potion = stack({ itemId: "potion_hp_s" });
    expect(() =>
      planUpgrade(state([potion]), 0, CHARACTER, potion.id, {
        useBlessing: false,
        rng: scripted(0),
      }),
    ).toThrow(/Only equipment/);
  });
});

describe("isUpgradeableItem", () => {
  it("only accepts known equipment definitions", () => {
    expect(isUpgradeableItem("sword_ember_t1")).toBe(true);
    expect(isUpgradeableItem("potion_hp_s")).toBe(false);
    expect(isUpgradeableItem("unknown_item")).toBe(false);
  });
});

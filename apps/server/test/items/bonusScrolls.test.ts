import { describe, expect, it } from "vitest";
import {
  emptyInventory,
  type InventoryState,
  type ItemBonus,
  type ItemStack,
  type RandomSource,
} from "@jadethrone/shared";
import { bonusesForItemType, getBonusDefinition } from "@jadethrone/data/bonuses";
import { ItemError } from "../../src/items/errors";
import {
  BONUS_SCROLL_IDS,
  planBonusScroll,
  type BonusScrollKind,
} from "../../src/items/bonusScrolls";

const CHARACTER = "char-1";
const WEAPON_POOL = bonusesForItemType("weapon");
const ARMOR_POOL = bonusesForItemType("armor");

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

function scroll(id: BonusScrollKind, slot = 5, quantity = 1): ItemStack {
  return stack({
    id: `scroll-${id}`,
    itemId: BONUS_SCROLL_IDS[id],
    slot,
    quantity,
    bonuses: [],
  });
}

function assertInPool(bonuses: ItemBonus[], poolTypes: readonly string[]): void {
  for (const bonus of bonuses) {
    expect(poolTypes).toContain(bonus.type);
    const definition = getBonusDefinition(bonus.type)!;
    expect(bonus.value).toBeGreaterThanOrEqual(definition.min);
    expect(bonus.value).toBeLessThanOrEqual(definition.max);
  }
}

describe("planBonusScroll enchant", () => {
  it("rolls one bonus at the low end of the count range", () => {
    const sword = stack({ bonuses: [{ type: "attack", value: 9 }] });
    const scrollItem = scroll("enchant");
    const inventory = state([sword, scrollItem]);

    const result = planBonusScroll(
      inventory,
      CHARACTER,
      scrollItem.id,
      sword.id,
      scripted(0, 0.1, 0.5),
    );

    expect(result.kind).toBe("enchant");
    expect(result.bonuses).toHaveLength(1);
    expect(result.bonuses[0]?.type).toBe(WEAPON_POOL[0]?.type);
    assertInPool(result.bonuses, WEAPON_POOL.map((bonus) => bonus.type));
    const nextSword = result.state.items.find((item) => item.id === sword.id)!;
    expect(nextSword.bonuses).toEqual(result.bonuses);
    expect(result.state.items.some((item) => item.id === scrollItem.id)).toBe(false);
  });

  it("rolls four unique bonuses at the high end of the count range", () => {
    const sword = stack();
    const scrollItem = scroll("enchant");
    const inventory = state([sword, scrollItem]);

    const result = planBonusScroll(
      inventory,
      CHARACTER,
      scrollItem.id,
      sword.id,
      scripted(0.99, 0, 0.2, 0.4, 0.6, 0, 0.2, 0.4, 0.6),
    );

    expect(result.bonuses).toHaveLength(4);
    expect(new Set(result.bonuses.map((bonus) => bonus.type)).size).toBe(4);
    assertInPool(result.bonuses, WEAPON_POOL.map((bonus) => bonus.type));
  });

  it("replaces every existing bonus", () => {
    const sword = stack({
      bonuses: [
        { type: "attack", value: 5 },
        { type: "attack_speed", value: 0.02 },
      ],
    });
    const scrollItem = scroll("enchant");
    const result = planBonusScroll(
      state([sword, scrollItem]),
      CHARACTER,
      scrollItem.id,
      sword.id,
      scripted(0.5, 0.5, 0.5),
    );
    expect(result.bonuses).toHaveLength(3);
    expect(new Set(result.bonuses.map((bonus) => bonus.type)).size).toBe(3);
  });

  it("uses the armor pool for armor", () => {
    const armor = stack({ itemId: "armor_warrior_t1", bonuses: [] });
    const scrollItem = scroll("enchant");
    const result = planBonusScroll(
      state([armor, scrollItem]),
      CHARACTER,
      scrollItem.id,
      armor.id,
      scripted(0.99, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5),
    );
    expect(result.bonuses).toHaveLength(4);
    assertInPool(result.bonuses, ARMOR_POOL.map((bonus) => bonus.type));
  });
});

describe("planBonusScroll reinforce", () => {
  it("appends one eligible bonus without replacing existing ones", () => {
    const existing: ItemBonus[] = [
      { type: "attack", value: 4 },
      { type: "crit_chance", value: 0.01 },
    ];
    const sword = stack({ bonuses: existing });
    const scrollItem = scroll("reinforce");
    const result = planBonusScroll(
      state([sword, scrollItem]),
      CHARACTER,
      scrollItem.id,
      sword.id,
      scripted(0.5, 0.5),
    );

    expect(result.bonuses).toHaveLength(3);
    expect(result.bonuses.slice(0, 2)).toEqual(existing);
    const added = result.bonuses[2]!;
    expect(existing.some((bonus) => bonus.type === added.type)).toBe(false);
    assertInPool([added], WEAPON_POOL.map((bonus) => bonus.type));
    expect(result.state.items.some((item) => item.id === scrollItem.id)).toBe(false);
  });

  it("updates an equipped target in place", () => {
    const armor = stack({ id: "eq-1", itemId: "armor_warrior_t1", slot: 1 });
    const equipment = Array.from(
      { length: emptyInventory().equipment.length },
      () => null,
    ) as (ItemStack | null)[];
    equipment[1] = armor;
    const scrollItem = scroll("reinforce");
    const inventory = state([scrollItem], equipment);

    const result = planBonusScroll(
      inventory,
      CHARACTER,
      scrollItem.id,
      armor.id,
      scripted(0.5, 0.5),
    );

    const target = result.plan.changes.find((change) => change.id === armor.id);
    expect(target?.kind).toBe("update");
    if (target?.kind === "update") {
      expect(target.expect.location).toBe("equipment");
      expect(target.to.location).toBe("equipment");
      expect(target.to.bonuses).toHaveLength(1);
    }
    expect(result.state.equipment[1]?.bonuses).toHaveLength(1);
  });

  it("rejects a fifth-slot item without consuming the scroll", () => {
    const sword = stack({
      bonuses: WEAPON_POOL.slice(0, 5).map((definition) => ({
        type: definition.type,
        value: definition.min,
      })),
    });
    const scrollItem = scroll("reinforce");
    const inventory = state([sword, scrollItem]);

    expect(() =>
      planBonusScroll(inventory, CHARACTER, scrollItem.id, sword.id, scripted(0.5)),
    ).toThrow(/five bonuses/);
    expect(inventory.items.some((item) => item.id === scrollItem.id)).toBe(true);
  });
});

describe("planBonusScroll validation", () => {
  it("rejects non-scroll sources, missing items and non-equipment targets", () => {
    const sword = stack();
    const potion = stack({ id: "potion", itemId: "potion_hp_s", slot: 2, bonuses: [] });
    const scrollItem = scroll("enchant");
    const inventory = state([sword, potion, scrollItem]);

    expect(() =>
      planBonusScroll(inventory, CHARACTER, potion.id, sword.id, scripted(0)),
    ).toThrow(ItemError);
    expect(() =>
      planBonusScroll(inventory, CHARACTER, "missing", sword.id, scripted(0)),
    ).toThrow(/Scroll not found/);
    expect(() =>
      planBonusScroll(inventory, CHARACTER, scrollItem.id, potion.id, scripted(0)),
    ).toThrow(/Only equipment/);
    expect(() =>
      planBonusScroll(inventory, CHARACTER, scrollItem.id, scrollItem.id, scripted(0)),
    ).toThrow(ItemError);
  });

  it("leaves the original inventory untouched on invalid targets", () => {
    const potion = stack({ id: "potion", itemId: "potion_hp_s", slot: 2 });
    const scrollItem = scroll("enchant");
    const inventory = state([potion, scrollItem]);
    const before = JSON.stringify(inventory);
    expect(() =>
      planBonusScroll(inventory, CHARACTER, scrollItem.id, potion.id, scripted(0)),
    ).toThrow(ItemError);
    expect(JSON.stringify(inventory)).toBe(before);
  });
});

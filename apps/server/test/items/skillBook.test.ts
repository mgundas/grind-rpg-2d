import { describe, expect, it } from "vitest";
import { emptyInventory, type InventoryState, type ItemStack, type RandomSource } from "@jadethrone/shared";
import { MASTERY_RULES } from "@jadethrone/data/mastery";
import { ItemError } from "../../src/items/errors";
import { MASTERY_BOOK_ID, planSkillBookRead } from "../../src/items/skillBook";

const CHARACTER = "char-1";
const SKILL_ID = "warrior_blade_whirlwind";

function stack(overrides: Partial<ItemStack> = {}): ItemStack {
  return {
    id: "book-1",
    itemId: MASTERY_BOOK_ID,
    slot: 0,
    quantity: 1,
    upgradeLevel: 0,
    bonuses: [],
    ...overrides,
  };
}

function scripted(...values: number[]): RandomSource {
  let index = 0;
  return { next: () => values[Math.min(index++, values.length - 1)] ?? 0 };
}

function state(items: ItemStack[]): InventoryState {
  return { ...emptyInventory(), items };
}

function input(overrides: Partial<Parameters<typeof planSkillBookRead>[3]> = {}) {
  return {
    skillId: SKILL_ID,
    rank: 20,
    classId: "warrior" as const,
    doctrine: "blade",
    mastery: { level: 0, lastReadAtMs: 0 },
    now: 1_000_000,
    rng: scripted(0),
    ...overrides,
  };
}

describe("skill book planner", () => {
  it("consumes the book, raises mastery and starts the cooldown on success", () => {
    const book = stack();
    const result = planSkillBookRead(state([book]), CHARACTER, book.id, input());
    expect(result.success).toBe(true);
    expect(result.previousLevel).toBe(0);
    expect(result.level).toBe(1);
    expect(result.nextReadAtMs).toBe(1_000_000 + MASTERY_RULES.readCooldownMs);
    expect(result.state.items.some((item) => item.id === book.id)).toBe(false);
    expect(result.plan.logs[0]?.action).toBe("skill_book_read");
    expect(result.plan.logs[0]?.detail?.success).toBe(true);
  });

  it("consumes the book and sets the cooldown on failure", () => {
    const book = stack();
    const result = planSkillBookRead(
      state([book]),
      CHARACTER,
      book.id,
      input({ mastery: { level: 5, lastReadAtMs: 0 }, rng: scripted(0.99) }),
    );
    expect(result.success).toBe(false);
    expect(result.level).toBe(5);
    expect(result.state.items).toHaveLength(0);
    expect(result.nextReadAtMs).toBe(1_000_000 + MASTERY_RULES.readCooldownMs);
  });

  it("consumes exactly the selected stack instance", () => {
    const selected = stack({ id: "book-a", quantity: 2 });
    const other = stack({ id: "book-b", slot: 1, quantity: 3 });
    const result = planSkillBookRead(
      state([selected, other]),
      CHARACTER,
      selected.id,
      input(),
    );
    expect(result.state.items.find((item) => item.id === selected.id)?.quantity).toBe(1);
    expect(result.state.items.find((item) => item.id === other.id)?.quantity).toBe(3);
  });

  it("rejects ineligible rank, max mastery, cooldown and wrong items without consuming", () => {
    const book = stack();
    const inventory = state([book]);
    for (const invalid of [
      input({ rank: 19 }),
      input({ mastery: { level: 10, lastReadAtMs: 0 } }),
      input({ mastery: { level: 2, lastReadAtMs: 1_000_000 - 1_000 } }),
    ]) {
      expect(() => planSkillBookRead(inventory, CHARACTER, book.id, invalid)).toThrow(
        ItemError,
      );
      expect(inventory.items).toHaveLength(1);
    }

    const potion = stack({ id: "potion", itemId: "potion_hp_s", slot: 2 });
    expect(() =>
      planSkillBookRead(state([potion]), CHARACTER, potion.id, input()),
    ).toThrow(/not a mastery book/);
  });

  it("rejects a book outside the cooldown window even when the item is valid", () => {
    const book = stack();
    const inventory = state([book]);
    expect(() =>
      planSkillBookRead(
        inventory,
        CHARACTER,
        book.id,
        input({
          mastery: { level: 1, lastReadAtMs: 1 },
          now: 1_000,
        }),
      ),
    ).toThrow(/cooldown/);
    expect(inventory.items).toHaveLength(1);
  });
});

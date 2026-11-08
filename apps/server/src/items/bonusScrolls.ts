import {
  cloneInventory,
  isEquipmentType,
  type InventoryState,
  type ItemBonus,
  type RandomSource,
} from "@jadethrone/shared";
import { getItem } from "@jadethrone/data/items";
import { bonusesForItemType, type BonusDefinition } from "@jadethrone/data/bonuses";
import { ItemError } from "./errors";
import { describeChanges, type ItemPlan } from "./itemChanges";
import { consumeItem, findStack, setStack } from "./inventoryDraft";
import { diffInventory } from "./planning";

export const BONUS_SCROLL_IDS = {
  enchant: "scroll_enchant",
  reinforce: "scroll_reinforce",
} as const;

export type BonusScrollKind = keyof typeof BONUS_SCROLL_IDS;

export interface BonusScrollResult {
  /** Next in-memory inventory; commit the plan before assigning it. */
  state: InventoryState;
  plan: ItemPlan;
  kind: BonusScrollKind;
  bonuses: ItemBonus[];
}

const MAX_BONUSES = 5;

function scrollKindOf(itemId: string): BonusScrollKind | null {
  if (itemId === BONUS_SCROLL_IDS.enchant) {
    return "enchant";
  }
  if (itemId === BONUS_SCROLL_IDS.reinforce) {
    return "reinforce";
  }
  return null;
}

function rollValue(definition: BonusDefinition, rng: RandomSource): number {
  if (Number.isInteger(definition.min) && Number.isInteger(definition.max)) {
    const span = definition.max - definition.min + 1;
    return definition.min + Math.min(span - 1, Math.floor(rng.next() * span));
  }
  const value = definition.min + rng.next() * (definition.max - definition.min);
  return Math.round(value * 10_000) / 10_000;
}

function pickUnique(
  pool: readonly BonusDefinition[],
  count: number,
  rng: RandomSource,
): BonusDefinition[] {
  const remaining = [...pool];
  const picked: BonusDefinition[] = [];
  while (picked.length < count && remaining.length > 0) {
    const index = Math.min(remaining.length - 1, Math.floor(rng.next() * remaining.length));
    picked.push(remaining.splice(index, 1)[0]!);
  }
  return picked;
}

/**
 * Plan one enchant or reinforce scroll application against a copy of the
 * inventory. Invalid targets throw before any change is built, so the scroll is
 * never consumed on rejection.
 */
export function planBonusScroll(
  state: InventoryState,
  characterId: string,
  scrollInstanceId: string,
  itemInstanceId: string,
  rng: RandomSource,
): BonusScrollResult {
  if (scrollInstanceId === itemInstanceId) {
    throw new ItemError("not_usable", "Choose an item to enchant.");
  }
  const scroll = findStack(state, scrollInstanceId);
  if (!scroll) {
    throw new ItemError("item_not_found", "Scroll not found.");
  }
  const scrollDefinition = getItem(scroll.stack.itemId);
  const kind = scrollDefinition.subtype === "scroll" ? scrollKindOf(scroll.stack.itemId) : null;
  if (kind === null) {
    throw new ItemError("not_usable", "That item is not an enchant or reinforce scroll.");
  }
  const target = findStack(state, itemInstanceId);
  if (!target) {
    throw new ItemError("item_not_found", "Item not found.");
  }
  const targetDefinition = getItem(target.stack.itemId);
  if (!isEquipmentType(targetDefinition.type)) {
    throw new ItemError("not_usable", "Only equipment can receive bonuses.");
  }
  const pool = bonusesForItemType(targetDefinition.type);
  if (pool.length === 0) {
    throw new ItemError("not_usable", "This item has no eligible bonuses.");
  }

  let bonuses: ItemBonus[];
  if (kind === "enchant") {
    const count = Math.min(4, 1 + Math.floor(rng.next() * 4), pool.length);
    bonuses = pickUnique(pool, count, rng).map((definition) => ({
      type: definition.type,
      value: rollValue(definition, rng),
    }));
  } else {
    if (target.stack.bonuses.length >= MAX_BONUSES) {
      throw new ItemError("not_usable", "This item already has five bonuses.");
    }
    const existing = new Set(target.stack.bonuses.map((bonus) => bonus.type));
    const available = pool.filter((definition) => !existing.has(definition.type));
    if (available.length === 0) {
      throw new ItemError("not_usable", "No new bonus can be added.");
    }
    const [definition] = pickUnique(available, 1, rng);
    bonuses = [...target.stack.bonuses, { type: definition!.type, value: rollValue(definition!, rng) }];
  }

  const next = cloneInventory(state);
  consumeItem(next, scroll.stack.itemId, 1);
  const nextTarget = findStack(next, itemInstanceId)!;
  setStack(next, itemInstanceId, { ...nextTarget.stack, bonuses });

  const detail = {
    scrollItemId: scroll.stack.itemId,
    itemId: target.stack.itemId,
    bonuses,
  };
  const changes = diffInventory(state, next, characterId, kind);
  return {
    state: next,
    plan: {
      changes,
      logs: describeChanges(changes, kind, detail),
    },
    kind,
    bonuses,
  };
}

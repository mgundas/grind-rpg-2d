import {
  cloneInventory,
  type ClassId,
  type InventoryState,
  type RandomSource,
} from "@jadethrone/shared";
import { BASE_CATALOG, type CatalogLookup } from "@jadethrone/data/catalog";
import {
  MASTERY_RULES,
  masterySuccessChance,
} from "@jadethrone/data/mastery";
import type { SkillMasteryEntry } from "../characters/skillMastery";
import { ItemError } from "./errors";
import { describeChanges, type ItemPlan } from "./itemChanges";
import { findStack, setStack } from "./inventoryDraft";
import { diffInventory } from "./planning";

export const MASTERY_BOOK_ID = "skillbook_mastery";

export interface SkillBookReadInput {
  skillId: string;
  rank: number;
  classId: ClassId;
  doctrine: string | null;
  mastery: SkillMasteryEntry;
  now: number;
  rng: RandomSource;
}

export interface SkillBookReadResult {
  state: InventoryState;
  plan: ItemPlan;
  skillId: string;
  success: boolean;
  previousLevel: number;
  level: number;
  nextReadAtMs: number;
}

/**
 * Plan a mastery-book reading. The caller persists the returned mastery level
 * and cooldown in the same transaction as the item plan.
 */
export function planSkillBookRead(
  state: InventoryState,
  characterId: string,
  bookInstanceId: string,
  input: SkillBookReadInput,
  catalog: CatalogLookup = BASE_CATALOG,
): SkillBookReadResult {
  const book = findStack(state, bookInstanceId);
  if (!book) {
    throw new ItemError("item_not_found", "Skill book not found.");
  }
  const bookDefinition = catalog.findItem(book.stack.itemId);
  if (
    !bookDefinition ||
    bookDefinition.type !== "skillbook" ||
    bookDefinition.id !== MASTERY_BOOK_ID ||
    bookDefinition.effect?.kind !== "skill_book"
  ) {
    throw new ItemError("not_usable", "That item is not a mastery book.");
  }

  const skill = catalog.findSkill(input.skillId);
  if (!skill) {
    throw new ItemError("not_usable", "Unknown skill.");
  }
  if (skill.classId !== input.classId) {
    throw new ItemError("not_usable", "That skill belongs to another class.");
  }
  if (input.doctrine === null || skill.doctrineId !== input.doctrine) {
    throw new ItemError("not_usable", "That skill is not in your doctrine.");
  }
  if (input.rank < MASTERY_RULES.requiredRank) {
    throw new ItemError(
      "not_usable",
      `Mastery requires rank ${MASTERY_RULES.requiredRank}.`,
    );
  }
  if (input.mastery.level >= MASTERY_RULES.maxMasterLevel) {
    throw new ItemError("not_usable", "This skill is already at maximum mastery.");
  }
  const readyAt = input.mastery.lastReadAtMs + MASTERY_RULES.readCooldownMs;
  if (input.mastery.lastReadAtMs > 0 && input.now < readyAt) {
    throw new ItemError("cooldown", "This skill's reading cooldown is still active.");
  }

  const previousLevel = input.mastery.level;
  const success = input.rng.next() < masterySuccessChance(previousLevel);
  const level = success ? previousLevel + 1 : previousLevel;
  const nextReadAtMs = input.now + MASTERY_RULES.readCooldownMs;

  const next = cloneInventory(state);
  const selected = findStack(next, bookInstanceId)!;
  setStack(
    next,
    bookInstanceId,
    selected.stack.quantity <= 1
      ? null
      : { ...selected.stack, quantity: selected.stack.quantity - 1 },
  );

  const detail = {
    skillId: input.skillId,
    bookItemId: book.stack.itemId,
    success,
    previousLevel,
    level,
    nextReadAtMs,
    chance: masterySuccessChance(previousLevel),
  };
  const changes = diffInventory(state, next, characterId, "skill_book");
  return {
    state: next,
    plan: {
      changes,
      logs: describeChanges(changes, "skill_book_read", detail),
    },
    skillId: input.skillId,
    success,
    previousLevel,
    level,
    nextReadAtMs,
  };
}

import type { FullItemStats, ItemBonus } from "./items";

/** Canonical bonus types shared by data validation, server stats and tooltips. */
export const BONUS_TYPES = [
  "max_hp",
  "max_mp",
  "attack",
  "defense",
  "crit_chance",
  "attack_speed",
  "move_speed",
  "hp_regen",
  "strong_monsters",
  "strong_animals",
  "strong_spirits",
  "resist_sword",
  "resist_dagger",
  "resist_bow",
  "resist_magic",
] as const;
export type BonusType = (typeof BONUS_TYPES)[number];

/** Bonus types that feed the five classic equipment stat buckets. */
export const BONUS_ITEM_STATS: Partial<Record<BonusType, keyof FullItemStats>> = {
  max_hp: "maxHp",
  max_mp: "maxMp",
  attack: "attack",
  defense: "defense",
  crit_chance: "critChance",
};

/** Bonus-count name colors from GAME_DESIGN.md §7.3. */
export function itemNameColor(bonusCount: number): string {
  const count = Math.max(0, Math.floor(bonusCount));
  if (count >= 5) {
    return "#d4a017";
  }
  if (count >= 3) {
    return "#9b59d0";
  }
  if (count >= 1) {
    return "#4a90d9";
  }
  return "#e8eeea";
}

/** Aggregate classic stats contributed by an item's bonus list. */
export function bonusItemStats(
  bonuses: readonly ItemBonus[] | undefined,
): FullItemStats {
  const total: FullItemStats = {
    attack: 0,
    defense: 0,
    maxHp: 0,
    maxMp: 0,
    critChance: 0,
  };
  for (const bonus of bonuses ?? []) {
    if (!(BONUS_TYPES as readonly string[]).includes(bonus.type)) {
      continue;
    }
    const key = BONUS_ITEM_STATS[bonus.type as BonusType];
    if (key) {
      total[key] += bonus.value;
    }
  }
  return total;
}

/** Total value of one non-classic modifier (attack speed, strong vs, etc.). */
export function bonusValue(
  bonuses: readonly ItemBonus[] | undefined,
  type: BonusType,
): number {
  let total = 0;
  for (const bonus of bonuses ?? []) {
    if (bonus.type === type) {
      total += bonus.value;
    }
  }
  return total;
}

/**
 * Sum one bonus type across equipped stacks. Client prediction and the server
 * movement step must use this same helper or they diverge every tick.
 */
export function equippedBonusValue(
  equipment: ReadonlyArray<{ bonuses: readonly ItemBonus[] } | null | undefined>,
  type: BonusType,
): number {
  let total = 0;
  for (const stack of equipment) {
    if (stack) {
      total += bonusValue(stack.bonuses, type);
    }
  }
  return total;
}

/** Movement multiplier from equipped `move_speed` bonuses (shared formula). */
export function moveSpeedMultiplier(bonus: number): number {
  return Math.max(0.1, 1 + bonus);
}

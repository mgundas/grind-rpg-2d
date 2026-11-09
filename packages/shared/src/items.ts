import type { ClassId } from "./characterRules";
import { BONUS_ITEM_STATS, type BonusType } from "./bonuses";
import type { Rarity } from "./constants";

/**
 * Item domain shared by the data package, server and client (GAME_DESIGN.md §7).
 * Nothing here knows about the database or the graphics layer.
 */

export const ITEM_TYPES = [
  "weapon",
  "armor",
  "helmet",
  "shield",
  "shoes",
  "bracelet",
  "necklace",
  "earrings",
  "consumable",
  "material",
  "skillbook",
  "quest",
] as const;

export type ItemType = (typeof ITEM_TYPES)[number];

/** The eight equipment slots in display order; the index is the DB slot value. */
export const EQUIP_SLOTS = [
  "weapon",
  "armor",
  "helmet",
  "shield",
  "shoes",
  "bracelet",
  "necklace",
  "earrings",
] as const;

export type EquipSlot = (typeof EQUIP_SLOTS)[number];

export const ITEM_STAT_KEYS = ["attack", "defense", "maxHp", "maxMp", "critChance"] as const;
export type ItemStatKey = (typeof ITEM_STAT_KEYS)[number];

/** Sparse stat block used by item data; absent keys mean zero. */
export type ItemStats = Partial<Record<ItemStatKey, number>>;

/** Fully populated stat block used when aggregating equipment. */
export type FullItemStats = Record<ItemStatKey, number>;

/** Phase-7 bonus entry; stored on instances from the start to avoid a migration. */
export interface ItemBonus {
  type: string;
  value: number;
}

export type ItemEffect =
  | { kind: "heal_hp"; amount: number }
  | { kind: "heal_mp"; amount: number }
  | { kind: "warp_town" }
  | { kind: "summon_mount" }
  | { kind: "skill_book" };

/** Bonus-scroll definition ids shared by server planning and client UX. */
export const BONUS_SCROLL_IDS = {
  enchant: "scroll_enchant",
  reinforce: "scroll_reinforce",
} as const;
export type BonusScrollKind = keyof typeof BONUS_SCROLL_IDS;

export function isBonusScrollId(itemId: string): boolean {
  return itemId === BONUS_SCROLL_IDS.enchant || itemId === BONUS_SCROLL_IDS.reinforce;
}

/** The subset of an item definition the shared inventory code needs. */
export interface ItemDefinitionLike {
  id: string;
  type: ItemType;
  rarity: Rarity;
  size: number;
  stackable: boolean;
  maxStack: number;
  levelReq: number;
  classes: readonly ClassId[] | "all";
  baseStats?: ItemStats;
  /**
   * Absolute stats for +0 … +9, one array per stat (length 10). Phase 4 only
   * uses index 0; Phase 7 upgrades index by `upgradeLevel`.
   */
  upgradeChain?: Partial<Record<ItemStatKey, readonly number[]>>;
  effect?: ItemEffect;
}

export interface EquippedItemLike {
  definition: ItemDefinitionLike;
  upgradeLevel: number;
  bonuses?: readonly ItemBonus[];
}

export function emptyItemStats(): FullItemStats {
  return { attack: 0, defense: 0, maxHp: 0, maxMp: 0, critChance: 0 };
}

export function equipSlotForItemType(type: ItemType): EquipSlot | null {
  switch (type) {
    case "weapon":
    case "armor":
    case "helmet":
    case "shield":
    case "shoes":
    case "bracelet":
    case "necklace":
    case "earrings":
      return type;
    default:
      return null;
  }
}

export function isEquipSlot(value: string): value is EquipSlot {
  return (EQUIP_SLOTS as readonly string[]).includes(value);
}

export function isEquipmentType(type: ItemType): boolean {
  return equipSlotForItemType(type) !== null;
}

/** Base stats plus the upgrade-chain entry and instance bonuses. */
export function effectiveItemStats(
  definition: ItemDefinitionLike,
  upgradeLevel = 0,
  bonuses: readonly ItemBonus[] = [],
): FullItemStats {
  const result = emptyItemStats();
  const base = definition.baseStats ?? {};
  for (const key of ITEM_STAT_KEYS) {
    const chain = definition.upgradeChain?.[key];
    const upgraded = chain?.[Math.max(0, Math.min(9, Math.floor(upgradeLevel)))];
    result[key] = (base[key] ?? 0) + (upgraded ?? 0);
  }
  for (const bonus of bonuses) {
    const key = BONUS_ITEM_STATS[bonus.type as BonusType];
    if (key) {
      result[key] += bonus.value;
    }
  }
  return result;
}

/** Sum every equipped item's effective stats. Null slots are ignored. */
export function sumEquipmentStats(
  equipment: ReadonlyArray<EquippedItemLike | null | undefined>,
): FullItemStats {
  const total = emptyItemStats();
  for (const equipped of equipment) {
    if (!equipped) {
      continue;
    }
    const stats = effectiveItemStats(
      equipped.definition,
      equipped.upgradeLevel,
      equipped.bonuses,
    );
    for (const key of ITEM_STAT_KEYS) {
      total[key] += stats[key];
    }
  }
  return total;
}

export function canEquip(
  definition: ItemDefinitionLike,
  classId: ClassId,
  level: number,
): boolean {
  if (level < definition.levelReq) {
    return false;
  }
  return definition.classes === "all" || definition.classes.includes(classId);
}

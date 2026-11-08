import { z } from "zod";
import {
  CLASS_IDS,
  ITEM_STAT_KEYS,
  ITEM_TYPES,
  type ClassId,
  type ItemEffect,
  type ItemStatKey,
  type ItemStats,
  type ItemDefinitionLike,
  type Rarity,
} from "@jadethrone/shared";
import raw from "../items.json";

/**
 * Item definitions (GAME_DESIGN.md §7.1). Validated at import so a malformed
 * file breaks boot/tests immediately. The JSON stores a compact `upgradeStep`
 * (per-level gain); this module expands it into the shared `upgradeChain`
 * (absolute stats for +0…+9) so the rest of the game sees one stable shape.
 */
const statsSchema = z
  .object({
    attack: z.number().min(0).optional(),
    defense: z.number().min(0).optional(),
    maxHp: z.number().int().min(0).optional(),
    maxMp: z.number().int().min(0).optional(),
    critChance: z.number().min(0).max(1).optional(),
  })
  .strict();

const effectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("heal_hp"), amount: z.number().int().positive() }),
  z.object({ kind: z.literal("heal_mp"), amount: z.number().int().positive() }),
  z.object({ kind: z.literal("warp_town") }),
]);

const itemSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    type: z.enum(ITEM_TYPES),
    subtype: z.string().min(1),
    classes: z.union([z.literal("all"), z.array(z.enum(CLASS_IDS)).min(1)]),
    levelReq: z.number().int().min(1).max(99),
    size: z.number().int().min(1).max(3),
    stackable: z.boolean(),
    maxStack: z.number().int().min(1).max(9999),
    buyPrice: z.number().int().min(0),
    sellPrice: z.number().int().min(0),
    baseStats: statsSchema.default({}),
    upgradeStep: statsSchema.optional(),
    iconKey: z.string().regex(/^icon\.item\.[a-z0-9_]+$/),
    spriteLayerKey: z.string().regex(/^[a-z0-9_.]+$/).optional(),
    rarity: z.enum(["common", "fine", "rare", "legendary"]),
    effect: effectSchema.optional(),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.stackable) {
      if (item.maxStack < 2) {
        ctx.addIssue({ code: "custom", message: "stackable items need maxStack >= 2" });
      }
    } else if (item.maxStack !== 1) {
      ctx.addIssue({ code: "custom", message: "non-stackable items need maxStack 1" });
    }
    if (item.buyPrice > 0 && item.sellPrice > item.buyPrice) {
      ctx.addIssue({ code: "custom", message: "sellPrice cannot exceed buyPrice" });
    }
    const equipment =
      item.type === "weapon" ||
      item.type === "armor" ||
      item.type === "helmet" ||
      item.type === "shield" ||
      item.type === "shoes" ||
      item.type === "bracelet" ||
      item.type === "necklace" ||
      item.type === "earrings";
    if (equipment && item.stackable) {
      ctx.addIssue({ code: "custom", message: "equipment cannot be stackable" });
    }
    if (
      (item.type === "weapon" ||
        item.type === "armor" ||
        item.type === "helmet" ||
        item.type === "shield") &&
      !item.spriteLayerKey
    ) {
      ctx.addIssue({ code: "custom", message: "visible equipment needs spriteLayerKey" });
    }
    if (item.effect && item.type !== "consumable") {
      ctx.addIssue({ code: "custom", message: "only consumables can have an effect" });
    }
  });

const itemsFileSchema = z
  .object({
    version: z.literal(1),
    items: z.array(itemSchema).min(1),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const item of file.items) {
      if (seen.has(item.id)) {
        ctx.addIssue({ code: "custom", message: `duplicate item id "${item.id}"` });
      }
      seen.add(item.id);
    }
  });

export interface ItemDefinition extends ItemDefinitionLike {
  name: string;
  description?: string;
  subtype: string;
  buyPrice: number;
  sellPrice: number;
  iconKey: string;
  spriteLayerKey?: string;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Expand the compact JSON `upgradeStep` into absolute +0…+9 stats. */
function buildUpgradeChain(
  step: ItemStats | undefined,
): Partial<Record<ItemStatKey, readonly number[]>> | undefined {
  if (!step) {
    return undefined;
  }
  const chain: Partial<Record<ItemStatKey, number[]>> = {};
  for (const key of ITEM_STAT_KEYS) {
    const value = step[key];
    if (value === undefined) {
      continue;
    }
    const digits = key === "critChance" ? 4 : 0;
    chain[key] = Array.from({ length: 10 }, (_, level) => round(value * level, digits));
  }
  return Object.keys(chain).length > 0 ? chain : undefined;
}

/** Build and validate item definitions from raw JSON (base or merged). */
export function buildItems(rawJson: unknown): readonly ItemDefinition[] {
  const parsed = itemsFileSchema.parse(rawJson);
  return parsed.items.map((item) => ({
  id: item.id,
  name: item.name,
  description: item.description,
  type: item.type,
  subtype: item.subtype,
  classes: item.classes as readonly ClassId[] | "all",
  levelReq: item.levelReq,
  size: item.size,
  stackable: item.stackable,
  maxStack: item.maxStack,
  buyPrice: item.buyPrice,
  sellPrice: item.sellPrice,
  baseStats: item.baseStats,
  upgradeChain: buildUpgradeChain(item.upgradeStep),
  iconKey: item.iconKey,
  spriteLayerKey: item.spriteLayerKey,
  rarity: item.rarity as Rarity,
    effect: item.effect as ItemEffect | undefined,
  }));
}

export const ITEMS: readonly ItemDefinition[] = buildItems(raw);

const byId = new Map(ITEMS.map((item) => [item.id, item]));

export function hasItem(id: string): boolean {
  return byId.has(id);
}

export function getItem(id: string): ItemDefinition {
  const found = byId.get(id);
  if (!found) {
    throw new Error(`unknown item "${id}"`);
  }
  return found;
}

export function itemIconKey(item: Pick<ItemDefinition, "iconKey">): string {
  return item.iconKey;
}

import { z } from "zod";
import { CLASS_IDS, type ClassId } from "@jadethrone/shared";
import { getItem, hasItem } from "./items";
import raw from "../starterKits.json";

/**
 * New-character starter kit (GAME_DESIGN.md §7.6 economy: a fresh character
 * needs a weapon and a few potions). Balance values stay in data.
 */
const potionSchema = z
  .object({
    itemId: z.string().min(1),
    quantity: z.number().int().min(1),
  })
  .strict()
  .superRefine((potion, ctx) => {
    if (!hasItem(potion.itemId)) {
      ctx.addIssue({ code: "custom", message: `unknown item "${potion.itemId}"` });
      return;
    }
    const item = getItem(potion.itemId);
    if (!item.stackable) {
      ctx.addIssue({ code: "custom", message: `${potion.itemId} is not stackable` });
    }
    if (potion.quantity > item.maxStack) {
      ctx.addIssue({ code: "custom", message: `${potion.itemId} quantity exceeds maxStack` });
    }
  });

const starterKitsFileSchema = z
  .object({
    version: z.literal(1),
    gold: z.number().int().min(0),
    potions: z.array(potionSchema).min(1),
    weapons: z.record(z.enum(CLASS_IDS), z.string().min(1)),
  })
  .strict()
  .superRefine((file, ctx) => {
    for (const classId of CLASS_IDS) {
      const itemId = file.weapons[classId];
      if (!itemId) {
        ctx.addIssue({ code: "custom", message: `missing weapon for ${classId}` });
        continue;
      }
      if (!hasItem(itemId)) {
        ctx.addIssue({ code: "custom", message: `${classId}: unknown weapon "${itemId}"` });
        continue;
      }
      const item = getItem(itemId);
      if (item.type !== "weapon") {
        ctx.addIssue({ code: "custom", message: `${itemId} is not a weapon` });
      }
      if (item.levelReq !== 1) {
        ctx.addIssue({ code: "custom", message: `${itemId} must be usable at level 1` });
      }
      if (item.classes === "all" || !item.classes.includes(classId)) {
        ctx.addIssue({ code: "custom", message: `${itemId} is not usable by ${classId}` });
      }
    }
  });

export interface StarterPotion {
  itemId: string;
  quantity: number;
}

export interface StarterKitData {
  gold: number;
  potions: StarterPotion[];
  weapons: Record<ClassId, string>;
}

const parsed = starterKitsFileSchema.parse(raw);

export const STARTER_KIT: StarterKitData = {
  gold: parsed.gold,
  potions: parsed.potions,
  weapons: parsed.weapons as Record<ClassId, string>,
};

export function getStarterWeapon(classId: ClassId): string {
  const itemId = STARTER_KIT.weapons[classId];
  if (!itemId) {
    throw new Error(`no starter weapon for class "${classId}"`);
  }
  return itemId;
}

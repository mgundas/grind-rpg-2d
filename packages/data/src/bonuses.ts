import { z } from "zod";
import { BONUS_TYPES, ITEM_TYPES, type BonusType, type ItemType } from "@jadethrone/shared";
import raw from "../bonuses.json";

const bonusSchema = z
  .object({
    type: z.enum(BONUS_TYPES),
    label: z.string().min(1).max(64),
    min: z.number(),
    max: z.number(),
    itemTypes: z.array(z.enum(ITEM_TYPES)).min(1),
  })
  .strict()
  .superRefine((bonus, ctx) => {
    if (bonus.max < bonus.min) {
      ctx.addIssue({ code: "custom", message: `${bonus.type}: max below min` });
    }
    if (new Set(bonus.itemTypes).size !== bonus.itemTypes.length) {
      ctx.addIssue({ code: "custom", message: `${bonus.type}: duplicate item type` });
    }
  });

const bonusesFileSchema = z
  .object({
    version: z.literal(1),
    bonuses: z.array(bonusSchema).min(1),
  })
  .strict()
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const bonus of file.bonuses) {
      if (seen.has(bonus.type)) {
        ctx.addIssue({ code: "custom", message: `duplicate bonus type "${bonus.type}"` });
      }
      seen.add(bonus.type);
    }
  });

const parsed = bonusesFileSchema.parse(raw);

export interface BonusDefinition {
  type: BonusType;
  label: string;
  min: number;
  max: number;
  itemTypes: ItemType[];
}

export const BONUS_POOL: readonly BonusDefinition[] = parsed.bonuses;

const byType = new Map(BONUS_POOL.map((bonus) => [bonus.type, bonus]));

export function getBonusDefinition(type: string): BonusDefinition | undefined {
  return byType.get(type as BonusType);
}

export function bonusesForItemType(itemType: ItemType): BonusDefinition[] {
  return BONUS_POOL.filter((bonus) => bonus.itemTypes.includes(itemType));
}

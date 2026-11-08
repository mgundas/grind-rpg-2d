import { z } from "zod";
import { hasItem } from "./items";
import raw from "../upgrades.json";

export interface UpgradeMaterial {
  itemId: string;
  quantity: number;
}

export interface UpgradeStep {
  from: number;
  to: number;
  chance: number;
  gold: number;
  materials: UpgradeMaterial[];
}

/** Build and validate the +0…+9 table against the merged item catalog. */
export function buildUpgrades(
  rawJson: unknown,
  refs: { hasItem(id: string): boolean },
): { maxLevel: number; steps: readonly UpgradeStep[] } {
  const materialSchema = z
    .object({
      itemId: z.string().min(1).max(64),
      quantity: z.number().int().min(1).max(999),
    })
    .strict()
    .superRefine((material, ctx) => {
      if (!refs.hasItem(material.itemId)) {
        ctx.addIssue({
          code: "custom",
          message: `unknown upgrade material "${material.itemId}"`,
        });
      }
    });
  const stepSchema = z
    .object({
      from: z.number().int().min(0).max(8),
      to: z.number().int().min(1).max(9),
      chance: z.number().min(0).max(1),
      gold: z.number().int().min(0),
      materials: z.array(materialSchema),
    })
    .strict();
  const fileSchema = z
    .object({
      version: z.literal(1),
      maxLevel: z.literal(9),
      steps: z.array(stepSchema).length(9),
    })
    .strict()
    .superRefine((file, ctx) => {
      const seen = new Set<number>();
      for (const [index, step] of file.steps.entries()) {
        if (step.from !== index || step.to !== index + 1) {
          ctx.addIssue({
            code: "custom",
            message: `upgrade step ${index} must be ${index} -> ${index + 1}`,
          });
        }
        if (seen.has(step.from)) {
          ctx.addIssue({ code: "custom", message: `duplicate upgrade step ${step.from}` });
        }
        seen.add(step.from);
      }
    });
  const parsed = fileSchema.parse(rawJson);
  return { maxLevel: parsed.maxLevel, steps: parsed.steps };
}

const baseUpgrades = buildUpgrades(raw, { hasItem });
export const MAX_UPGRADE_LEVEL = baseUpgrades.maxLevel;
export const UPGRADE_STEPS: readonly UpgradeStep[] = baseUpgrades.steps;

const byLevel = new Map(UPGRADE_STEPS.map((step) => [step.from, step]));

export function getUpgradeStep(level: number): UpgradeStep | undefined {
  return byLevel.get(Math.max(0, Math.floor(level)));
}

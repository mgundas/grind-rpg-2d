import { z } from "zod";
import raw from "../mastery.json";

/** Master skill reading rules (GAME_DESIGN.md §8). */
const fileSchema = z
  .object({
    version: z.literal(1),
    maxMasterLevel: z.literal(10),
    requiredRank: z.literal(20),
    readCooldownMs: z.number().int().min(60_000),
    rankBonusPerMasterLevel: z.number().positive().max(5),
    successChanceByLevel: z.array(z.number().min(0).max(1)).length(10),
  })
  .strict();

export interface MasteryRules {
  maxMasterLevel: number;
  requiredRank: number;
  readCooldownMs: number;
  rankBonusPerMasterLevel: number;
  successChanceByLevel: readonly number[];
}

export function buildMasteryRules(rawJson: unknown): MasteryRules {
  return fileSchema.parse(rawJson);
}

export const MASTERY_RULES: MasteryRules = buildMasteryRules(raw);

/** Chance for the next reading, keyed by the current master level (0..9). */
export function masterySuccessChance(currentLevel: number): number {
  const index = Math.min(
    MASTERY_RULES.successChanceByLevel.length - 1,
    Math.max(0, Math.floor(currentLevel)),
  );
  return MASTERY_RULES.successChanceByLevel[index]!;
}

export function effectiveSkillRank(rank: number, masterLevel: number): number {
  return rank + Math.max(0, Math.floor(masterLevel)) * MASTERY_RULES.rankBonusPerMasterLevel;
}

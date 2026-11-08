import { and, eq } from "drizzle-orm";
import type { Db, Tx } from "../db/client";
import { characterSkillMastery } from "../db/schema";
import { effectiveSkillRank } from "@jadethrone/data/mastery";

export interface SkillMasteryEntry {
  level: number;
  /** Epoch ms of the last reading, or 0 when never read. */
  lastReadAtMs: number;
}

export type SkillMasteryMap = Record<string, SkillMasteryEntry>;

export async function loadSkillMastery(
  client: Db | Tx,
  characterId: string,
): Promise<SkillMasteryMap> {
  const rows = await client
    .select()
    .from(characterSkillMastery)
    .where(eq(characterSkillMastery.characterId, characterId));
  const mastery: SkillMasteryMap = {};
  for (const row of rows) {
    mastery[row.skillId] = {
      level: row.masterLevel,
      lastReadAtMs: row.lastReadAt?.getTime() ?? 0,
    };
  }
  return mastery;
}

export async function getSkillMastery(
  client: Db | Tx,
  characterId: string,
  skillId: string,
): Promise<SkillMasteryEntry | null> {
  const [row] = await client
    .select()
    .from(characterSkillMastery)
    .where(
      and(
        eq(characterSkillMastery.characterId, characterId),
        eq(characterSkillMastery.skillId, skillId),
      ),
    )
    .limit(1);
  return row
    ? { level: row.masterLevel, lastReadAtMs: row.lastReadAt?.getTime() ?? 0 }
    : null;
}

export function masteryOf(
  mastery: SkillMasteryMap | undefined,
  skillId: string,
): SkillMasteryEntry {
  return mastery?.[skillId] ?? { level: 0, lastReadAtMs: 0 };
}

export function effectiveRankFor(
  mastery: SkillMasteryMap | undefined,
  skillId: string,
  rank: number,
): number {
  return effectiveSkillRank(rank, masteryOf(mastery, skillId).level);
}

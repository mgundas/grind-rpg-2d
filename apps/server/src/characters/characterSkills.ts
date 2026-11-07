import { and, eq, inArray, sql } from "drizzle-orm";
import { getSkill, hasSkill } from "@jadethrone/data/skills";
import type { Db, Tx } from "../db/client";
import { pgErrorInfo, toServiceError } from "../db/errors";
import { characterSkills, characters } from "../db/schema";
import { ServiceError } from "../errors";
import { logger } from "../logger";

/** Learned ranks keyed by skill id. Rank 0 is represented by an absent key. */
export type SkillRanks = Record<string, number>;

export interface SkillStateChange {
  /** `undefined` leaves the column untouched; `null` clears it. */
  doctrine?: string | null;
  /** `undefined` leaves the column untouched. */
  skillPoints?: number;
  /** Absolute ranks; 0 removes the row. */
  ranks?: Readonly<Record<string, number>>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SKILL_POINTS = 10_000;

/** Validate one absolute rank; rank 0 is valid and means "unlearned". */
export function normalizeSkillRank(skillId: string, rank: number): number {
  if (!hasSkill(skillId)) {
    throw new ServiceError("validation", "Unknown skill.", { skillId: "invalid" });
  }
  const skill = getSkill(skillId);
  if (
    !Number.isFinite(rank) ||
    !Number.isInteger(rank) ||
    rank < 0 ||
    rank > skill.maxRank
  ) {
    throw new ServiceError("validation", "Invalid skill rank.", { rank: "invalid" });
  }
  return rank;
}

/** Validate every rank in a map; preserves entries with rank 0 for the caller. */
export function normalizeSkillRanks(
  ranks: Readonly<Record<string, number>>,
): ReadonlyArray<{ skillId: string; rank: number }> {
  return Object.entries(ranks)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([skillId, rank]) => ({ skillId, rank: normalizeSkillRank(skillId, rank) }));
}

/** Clamp the derived unspent-points column into a safe range. */
export function normalizeSkillPoints(points: number): number {
  if (!Number.isFinite(points)) {
    throw new ServiceError("validation", "Invalid skill points.");
  }
  return Math.min(MAX_SKILL_POINTS, Math.max(0, Math.floor(points)));
}

/** Load learned ranks for one character. Unknown ids are warned about, not fatal. */
export async function loadSkillRanks(client: Db | Tx, characterId: string): Promise<SkillRanks> {
  if (!UUID_PATTERN.test(characterId)) {
    return {};
  }
  try {
    const all = await client
      .select({ skillId: characterSkills.skillId, rank: characterSkills.rank })
      .from(characterSkills)
      .where(eq(characterSkills.characterId, characterId))
      .orderBy(characterSkills.skillId);
    const result: SkillRanks = {};
    let unknown = 0;
    for (const row of all) {
      if (!hasSkill(row.skillId)) {
        unknown++;
        continue;
      }
      result[row.skillId] = row.rank;
    }
    if (unknown > 0) {
      logger.warn({ characterId, unknown }, "ignored unknown persisted skill ids");
    }
    return result;
  } catch (error) {
    throw toServiceError(error);
  }
}

async function characterExists(client: Db | Tx, characterId: string): Promise<boolean> {
  if (!UUID_PATTERN.test(characterId)) {
    return false;
  }
  const [row] = await client
    .select({ id: characters.id })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);
  return Boolean(row);
}

/** Save one absolute rank. Returns false when the character no longer exists. */
export async function saveSkillRank(
  db: Db,
  characterId: string,
  skillId: string,
  rank: number,
): Promise<boolean> {
  const safeRank = normalizeSkillRank(skillId, rank);
  try {
    if (!(await characterExists(db, characterId))) {
      return false;
    }
    if (safeRank === 0) {
      await db
        .delete(characterSkills)
        .where(
          and(
            eq(characterSkills.characterId, characterId),
            eq(characterSkills.skillId, skillId),
          ),
        );
      return true;
    }
    await db
      .insert(characterSkills)
      .values({ characterId, skillId, rank: safeRank })
      .onConflictDoUpdate({
        target: [characterSkills.characterId, characterSkills.skillId],
        set: { rank: safeRank, updatedAt: new Date() },
      });
    return true;
  } catch (error) {
    const info = pgErrorInfo(error);
    if (info?.code === "23503") {
      return false;
    }
    throw toServiceError(error);
  }
}

/**
 * Atomically persist doctrine, derived skill points and any changed ranks.
 * Validation happens before the transaction so an invalid request cannot leave
 * a half-applied state.
 */
export async function saveSkillState(
  db: Db,
  characterId: string,
  change: SkillStateChange,
): Promise<boolean> {
  const ranks = change.ranks ? normalizeSkillRanks(change.ranks) : null;
  const skillPoints =
    change.skillPoints === undefined ? undefined : normalizeSkillPoints(change.skillPoints);

  try {
    return await db.transaction(async (tx) => {
      if (!UUID_PATTERN.test(characterId)) {
        return false;
      }
      const [row] = await tx
        .select({ id: characters.id })
        .from(characters)
        .where(eq(characters.id, characterId))
        .for("update")
        .limit(1);
      if (!row) {
        return false;
      }

      if (change.doctrine !== undefined || skillPoints !== undefined) {
        await tx
          .update(characters)
          .set({
            ...(change.doctrine !== undefined ? { doctrine: change.doctrine } : {}),
            ...(skillPoints !== undefined ? { skillPoints } : {}),
            updatedAt: new Date(),
          })
          .where(eq(characters.id, characterId));
      }

      if (ranks) {
        const removed = ranks.filter((entry) => entry.rank === 0).map((entry) => entry.skillId);
        const saved = ranks.filter((entry) => entry.rank > 0);
        if (removed.length > 0) {
          await tx
            .delete(characterSkills)
            .where(
              and(
                eq(characterSkills.characterId, characterId),
                inArray(characterSkills.skillId, removed),
              ),
            );
        }
        if (saved.length > 0) {
          await tx
            .insert(characterSkills)
            .values(
              saved.map((entry) => ({
                characterId,
                skillId: entry.skillId,
                rank: entry.rank,
              })),
            )
            .onConflictDoUpdate({
              target: [characterSkills.characterId, characterSkills.skillId],
              set: { rank: sql`excluded.rank`, updatedAt: new Date() },
            });
        }
      }
      return true;
    });
  } catch (error) {
    throw toServiceError(error);
  }
}

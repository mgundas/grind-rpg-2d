import {
  applyXpGain,
  clamp,
  maxHp,
  maxMp,
  skillPointsForLevel,
  type ClassId,
  type FullItemStats,
  type Stats,
} from "@jadethrone/shared";
import { getClass } from "@jadethrone/data/classes";
import type { CharacterRecord } from "./characterMappers";

/**
 * Authoritative combat/progression values derived from a persisted character.
 * Kept separate from the room so joining and tests share the exact same
 * clamping and max-HP/MP rules.
 */
export interface PlayerProgression {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  level: number;
  xp: number;
  stats: Stats;
  statPoints: number;
  /** Chosen doctrine, or null before level 5 / before choosing. */
  doctrine: string | null;
  /** Derived unspent skill points (level points minus learned ranks). */
  skillPoints: number;
  /** Learned skill ranks keyed by skill id. */
  skills: Record<string, number>;
}

export function progressionFromCharacter(
  character: CharacterRecord,
  equipment?: FullItemStats,
): PlayerProgression {
  const info = getClass(character.classId);
  const stats: Stats = {
    vit: character.statVit,
    int: character.statInt,
    str: character.statStr,
    dex: character.statDex,
  };
  // Over-full XP (legacy/corrupt rows) levels up in memory; `applyXpGain` with
  // zero gain still consumes full thresholds.
  const levelled = applyXpGain(character.level, character.xp, 0);

  const maximumHp =
    maxHp({ baseHp: info.baseHp, vit: stats.vit, level: levelled.level }) +
    (equipment?.maxHp ?? 0);
  const maximumMp =
    maxMp({ baseMp: info.baseMp, int: stats.int, level: levelled.level }) +
    (equipment?.maxMp ?? 0);
  const doctrine =
    character.doctrine &&
    info.doctrines.some((candidate) => candidate.id === character.doctrine)
      ? character.doctrine
      : null;
  const spentSkillPoints = Object.values(character.skills).reduce(
    (total, rank) => total + Math.max(0, Math.floor(rank)),
    0,
  );

  return {
    // A dead-on-login row is revived at full HP rather than trapping the player
    // on the death screen; the room marks the correction dirty.
    hp: character.hp <= 0 ? maximumHp : clamp(character.hp, 1, maximumHp),
    maxHp: maximumHp,
    mp: clamp(character.mp, 0, maximumMp),
    maxMp: maximumMp,
    level: levelled.level,
    xp: levelled.xp,
    stats,
    statPoints: character.statPoints + levelled.statPointsGained,
    doctrine,
    skillPoints: Math.max(0, skillPointsForLevel(levelled.level) - spentSkillPoints),
    skills: { ...character.skills },
  };
}

/** Recompute max HP/MP after a level-up, stat allocation or equip change. */
export function recomputeMaxima(
  progression: PlayerProgression,
  classId: ClassId,
  equipment?: FullItemStats,
): void {
  const info = getClass(classId);
  progression.maxHp =
    maxHp({
      baseHp: info.baseHp,
      vit: progression.stats.vit,
      level: progression.level,
    }) + (equipment?.maxHp ?? 0);
  progression.maxMp =
    maxMp({
      baseMp: info.baseMp,
      int: progression.stats.int,
      level: progression.level,
    }) + (equipment?.maxMp ?? 0);
  progression.hp = clamp(progression.hp, 0, progression.maxHp);
  progression.mp = clamp(progression.mp, 0, progression.maxMp);
}

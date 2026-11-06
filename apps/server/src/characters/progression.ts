import { applyXpGain, clamp, maxHp, maxMp, type Stats } from "@jadethrone/shared";
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
}

export function progressionFromCharacter(character: CharacterRecord): PlayerProgression {
  const info = getClass(character.classId);
  const stats: Stats = {
    vit: character.statVit,
    int: character.statInt,
    str: character.statStr,
    dex: character.statDex,
  };
  const maximumHp = maxHp({ baseHp: info.baseHp, vit: stats.vit, level: character.level });
  const maximumMp = maxMp({ baseMp: info.baseMp, int: stats.int, level: character.level });

  // Over-full XP (legacy/corrupt rows) levels up in memory; `applyXpGain` with
  // zero gain still consumes full thresholds.
  const levelled = applyXpGain(character.level, character.xp, 0);

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
  };
}

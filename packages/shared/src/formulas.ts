/**
 * Combat, progression and regen formulas (GAME_DESIGN.md §4.4).
 *
 * Every random roll takes an injected `RandomSource`, so the live server can
 * use crypto randomness while tests and balance scripts stay deterministic.
 */

import type { ClassId } from "./characterRules";
import { MAX_LEVEL, STAT_POINTS_PER_LEVEL, type Stats } from "./constants";
import type { RandomSource } from "./rng";

export interface MaxHpInput {
  baseHp: number;
  vit: number;
  level: number;
}

export interface MaxMpInput {
  baseMp: number;
  int: number;
  level: number;
}

export function maxHp({ baseHp, vit, level }: MaxHpInput): number {
  return baseHp + vit * 40 + level * 36;
}

export function maxMp({ baseMp, int, level }: MaxMpInput): number {
  return baseMp + int * 20 + level * 12;
}

/** XP required to advance from `level` to `level + 1` (spec §4.4). */
export function xpToNextLevel(level: number): number {
  if (!Number.isFinite(level) || level < 1) {
    return Math.floor(120 * Math.pow(1, 2.25));
  }
  return Math.floor(120 * Math.pow(level, 2.25));
}

export interface PhysicalAttackInput {
  classId: ClassId;
  stats: Stats;
  level: number;
  /** Weapon attack + upgrade bonus; 0 until Phase 4 adds equipment. */
  weaponAttack?: number;
}

/**
 * Physical attack contribution from stats (spec §4.3):
 * STR ×2 for Warrior/Hexblade, STR ×1 for the others, plus DEX ×2 for Assassin.
 */
export function statAttack(classId: ClassId, stats: Stats): number {
  const strength = stats.str * (classId === "warrior" || classId === "hexblade" ? 2 : 1);
  const dexterity = classId === "assassin" ? stats.dex * 2 : 0;
  return strength + dexterity;
}

/** physicalAttack = weaponAttack(+upgrade) + statAttack + level × 2. */
export function physicalAttack({
  classId,
  stats,
  level,
  weaponAttack = 0,
}: PhysicalAttackInput): number {
  return weaponAttack + statAttack(classId, stats) + level * 2;
}

/** VIT gives +0.5 defense per point (spec §4.3). */
export function defenseOf(vit: number): number {
  return vit * 0.5;
}

/** Uniform damage roll between 0.9 and 1.1 of attack power. */
export function damageRoll(rng: RandomSource): number {
  const draw = Math.min(Math.max(rng.next(), 0), 0.999999999999);
  return 0.9 + draw * 0.2;
}

/** damage = max(1, round(damageRoll × attackerAtk − defenderDef × 0.7)). */
export function resolveDamage(
  rng: RandomSource,
  attackerAttack: number,
  defenderDefense: number,
): number {
  return Math.max(1, Math.round(damageRoll(rng) * attackerAttack - defenderDefense * 0.7));
}

export interface HitChanceInput {
  attackerDex: number;
  defenderDex: number;
  attackerLevel: number;
  defenderLevel: number;
}

/** clamp(0.7 + DEX gap×0.005 + level gap×0.01, 0.4, 0.98). */
export function hitChance({
  attackerDex,
  defenderDex,
  attackerLevel,
  defenderLevel,
}: HitChanceInput): number {
  return clamp(
    0.7 + (attackerDex - defenderDex) * 0.005 + (attackerLevel - defenderLevel) * 0.01,
    0.4,
    0.98,
  );
}

export function rollHit(rng: RandomSource, chance: number): boolean {
  return rng.next() < chance;
}

/** critChance = 0.02 + DEX×0.001 + item bonus. */
export function critChance(dex: number, itemCritBonus = 0): number {
  return 0.02 + dex * 0.001 + itemCritBonus;
}

export function rollCrit(rng: RandomSource, chance: number): boolean {
  return rng.next() < chance;
}

export const CRIT_MULTIPLIER = 2;

export function critDamage(damage: number): number {
  return Math.max(1, Math.round(damage * CRIT_MULTIPLIER));
}

/**
 * XP multiplier by level gap (spec §4.4): 10+ levels below gives 20%, 5–9 below
 * gives 60%, same or above gives up to +20% (linear +4% per level).
 */
export function levelXpMultiplier(monsterLevel: number, playerLevel: number): number {
  const gap = monsterLevel - playerLevel;
  if (gap <= -10) {
    return 0.2;
  }
  if (gap <= -5) {
    return 0.6;
  }
  if (gap >= 0) {
    return Math.min(1.2, 1 + gap * 0.04);
  }
  return 1;
}

export function monsterXpGain(
  monsterXp: number,
  monsterLevel: number,
  playerLevel: number,
): number {
  return Math.max(1, Math.floor(monsterXp * levelXpMultiplier(monsterLevel, playerLevel)));
}

/** 2% of the current level's XP requirement, never more than current progress. */
export function deathXpLoss(level: number, xpIntoLevel: number): number {
  const loss = Math.floor(xpToNextLevel(level) * 0.02);
  return Math.min(Math.max(0, Math.floor(xpIntoLevel)), Math.max(0, loss));
}

export interface XpGainOptions {
  levelCap?: number;
  statPointsPerLevel?: number;
}

export interface XpGainResult {
  level: number;
  xp: number;
  levelsGained: number;
  statPointsGained: number;
}

/**
 * Adds XP stored as progress inside the current level. Handles multiple level
 * ups in one gain and stops at the level cap.
 */
export function applyXpGain(
  level: number,
  xp: number,
  gained: number,
  options: XpGainOptions = {},
): XpGainResult {
  const levelCap = options.levelCap ?? MAX_LEVEL;
  const pointsPerLevel = options.statPointsPerLevel ?? STAT_POINTS_PER_LEVEL;
  let nextLevel = Math.max(1, Math.floor(level));
  let nextXp = Math.max(0, Math.floor(xp)) + Math.max(0, Math.floor(gained));
  let levelsGained = 0;

  while (nextLevel < levelCap && nextXp >= xpToNextLevel(nextLevel)) {
    nextXp -= xpToNextLevel(nextLevel);
    nextLevel++;
    levelsGained++;
  }
  if (nextLevel >= levelCap) {
    nextLevel = levelCap;
    nextXp = 0;
  }

  return {
    level: nextLevel,
    xp: nextXp,
    levelsGained,
    statPointsGained: levelsGained * pointsPerLevel,
  };
}

/** HP regenerated per 3 s interval: 2% out of combat, 0.5% in combat. */
export function hpRegenAmount(maxHpValue: number, inCombat: boolean): number {
  const rate = inCombat ? 0.005 : 0.02;
  return Math.max(1, Math.round(maxHpValue * rate));
}

/** MP regenerated per 3 s interval: 2% of max MP. */
export function mpRegenAmount(maxMpValue: number): number {
  return Math.max(1, Math.round(maxMpValue * 0.02));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

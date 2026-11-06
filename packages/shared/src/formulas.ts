/**
 * Character HP/MP formulas (GAME_DESIGN.md §4.4). Only the two formulas needed
 * to initialise persisted characters live here in Phase 2; the combat formulas
 * (damage, hit, crit, XP) arrive with Phase 3.
 */
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

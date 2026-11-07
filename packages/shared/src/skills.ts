/** Skill taxonomy shared by data validation, server resolution and client FX. */
export const SKILL_TYPES = [
  "melee_aoe",
  "projectile",
  "area",
  "buff",
  "heal",
  "dash",
] as const;
export type SkillType = (typeof SKILL_TYPES)[number];

/** Runtime effect kinds a skill can apply. */
export const SKILL_EFFECT_KINDS = [
  "stun",
  "slow",
  "knockback",
  "poison",
  "buff",
  "heal_over_time",
  "lifesteal",
  "cleanse",
  "stealth",
] as const;
export type SkillEffectKind = (typeof SKILL_EFFECT_KINDS)[number];

/** Stats a buff/debuff can modify. */
export const BUFF_STATS = [
  "attack",
  "defense",
  "critChance",
  "attackSpeed",
  "evasion",
] as const;
export type BuffStat = (typeof BUFF_STATS)[number];

export const BUFF_MODES = ["flat", "percent"] as const;
export type BuffMode = (typeof BUFF_MODES)[number];

export interface BuffModifier {
  stat: BuffStat;
  mode: BuffMode;
  value: number;
}

export const CAST_CANCEL_REASONS = [
  "moved",
  "attacked",
  "cast",
  "damaged",
  "dead",
  "warped",
  "invalid",
] as const;
export type CastCancelReason = (typeof CAST_CANCEL_REASONS)[number];

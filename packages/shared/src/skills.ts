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

/** How a skill chooses its targets. */
export const SKILL_TARGETS = ["self", "enemy", "ground", "ally", "party"] as const;
export type SkillTarget = (typeof SKILL_TARGETS)[number];

/** Damage scaling source used by the server resolver. */
export const DAMAGE_SCALINGS = ["physical", "magic"] as const;
export type DamageScaling = (typeof DAMAGE_SCALINGS)[number];

/** Client FX presets; each maps to a distinct particle/tween recipe. */
export const SKILL_FX_PRESETS = [
  "slash_arc",
  "spin",
  "nova",
  "projectile",
  "beam",
  "ground_ring",
  "dash",
  "aura",
  "heal",
  "shard",
] as const;
export type SkillFxPreset = (typeof SKILL_FX_PRESETS)[number];

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

export const SKILL_ERROR_CODES = [
  "doctrine_locked",
  "doctrine_invalid",
  "level_too_low",
  "skill_locked",
  "skill_maxed",
  "no_skill_points",
  "not_in_doctrine",
  "unknown_skill",
  "not_enough_mp",
  "on_cooldown",
  "out_of_range",
  "invalid_target",
  "already_casting",
  "dead",
  "warping",
  "pvp_blocked",
  "internal",
] as const;
export type SkillErrorCode = (typeof SKILL_ERROR_CODES)[number];

export interface SkillErrorPayload {
  code: SkillErrorCode;
  message: string;
  skillId?: string;
}

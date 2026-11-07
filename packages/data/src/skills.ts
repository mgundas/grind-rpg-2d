import { z } from "zod";
import {
  CLASS_IDS,
  BUFF_MODES,
  BUFF_STATS,
  DAMAGE_SCALINGS,
  SKILL_EFFECT_KINDS,
  SKILL_FX_PRESETS,
  SKILL_TARGETS,
  SKILL_TYPES,
  type ClassId,
  type SkillType,
} from "@jadethrone/shared";
import { CLASSES } from "./classes";
import raw from "../skills.json";

/**
 * Skill definitions (GAME_DESIGN.md §8). Every class has two doctrines with six
 * skills each; the JSON is validated at import time so malformed data fails on
 * boot and in the client bundle instead of producing an unusable skill.
 */
const mpCostSchema = z.object({
  base: z.number().int().min(0),
  perRank: z.number().int().min(0),
});

const damageSchema = z
  .object({
    scaling: z.enum(DAMAGE_SCALINGS),
    basePower: z.number().positive(),
    powerPerRank: z.number().min(0),
    /** Fraction of damage returned as healing. */
    lifestealPct: z.number().min(0).max(1).optional(),
  })
  .strict();

const healSchema = z
  .object({
    base: z.number().min(0),
    perRank: z.number().min(0),
    overTime: z.boolean().optional(),
    durationMs: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((heal, ctx) => {
    if (heal.overTime && !heal.durationMs) {
      ctx.addIssue({ code: "custom", message: "over-time heals need durationMs" });
    }
  });

const effectSchema = z
  .object({
    kind: z.enum(SKILL_EFFECT_KINDS),
    stat: z.enum(BUFF_STATS).optional(),
    mode: z.enum(BUFF_MODES).optional(),
    value: z.number().optional(),
    perRank: z.number().optional(),
    durationMs: z.number().int().min(0).optional(),
    tickMs: z.number().int().min(100).optional(),
    stacks: z.number().int().min(1).max(10).optional(),
  })
  .strict()
  .superRefine((effect, ctx) => {
    switch (effect.kind) {
      case "buff":
        if (effect.stat === undefined || effect.mode === undefined) {
          ctx.addIssue({ code: "custom", message: "buff effects need stat and mode" });
        }
        if (effect.value === undefined) {
          ctx.addIssue({ code: "custom", message: "buff effects need value" });
        }
        break;
      case "stun":
      case "stealth":
      case "cleanse":
        break;
      case "slow":
        if (effect.value === undefined || effect.value < 0 || effect.value > 1) {
          ctx.addIssue({ code: "custom", message: "slow needs a fraction in [0,1]" });
        }
        break;
      case "knockback":
        if (effect.value === undefined || effect.value <= 0) {
          ctx.addIssue({ code: "custom", message: "knockback needs a positive distance" });
        }
        break;
      case "poison":
      case "heal_over_time":
        if (effect.value === undefined || effect.value < 0) {
          ctx.addIssue({ code: "custom", message: `${effect.kind} needs a non-negative value` });
        }
        break;
      case "lifesteal":
        if (effect.value === undefined || effect.value < 0 || effect.value > 1) {
          ctx.addIssue({ code: "custom", message: "lifesteal needs a fraction in [0,1]" });
        }
        break;
    }
    if (
      ["stun", "slow", "poison", "knockback", "stealth", "heal_over_time"].includes(
        effect.kind,
      ) &&
      (effect.durationMs === undefined || effect.durationMs <= 0)
    ) {
      ctx.addIssue({ code: "custom", message: `${effect.kind} needs a positive durationMs` });
    }
  });

const skillSchema = z
  .object({
    id: z.string().min(1).max(64),
    classId: z.enum(CLASS_IDS),
    doctrineId: z.string().min(1).max(64),
    name: z.string().min(1).max(64),
    description: z.string().min(1).max(500),
    iconKey: z.string().min(1).max(128),
    unlockLevel: z.number().int().min(1).max(99),
    maxRank: z.literal(20),
    type: z.enum(SKILL_TYPES),
    target: z.enum(SKILL_TARGETS),
    rangePx: z.number().int().min(0).max(2000),
    radiusPx: z.number().int().min(0).max(1200),
    maxTargets: z.number().int().min(1).max(20).optional(),
    castTimeMs: z.number().int().min(0).max(10_000),
    cooldownMs: z.number().int().min(0).max(600_000),
    /** One-time health cost as a fraction of max HP (e.g. Blood Price). */
    selfDamagePct: z.number().min(0).max(0.5).optional(),
    mpCost: mpCostSchema,
    damage: damageSchema.optional(),
    heal: healSchema.optional(),
    effects: z.array(effectSchema).max(6),
    fx: z.enum(SKILL_FX_PRESETS),
    animationRow: z.number().int().min(0).max(7),
  })
  .strict()
  .superRefine((skill, ctx) => {
    if (skill.type === "heal" && !skill.heal) {
      ctx.addIssue({ code: "custom", message: "heal skills need a heal block" });
    }
    if (skill.type === "buff" && skill.effects.length === 0) {
      ctx.addIssue({ code: "custom", message: "buff skills need at least one effect" });
    }
    if (
      (skill.type === "melee_aoe" || skill.type === "area") &&
      skill.radiusPx <= 0
    ) {
      ctx.addIssue({ code: "custom", message: "area skills need a positive radiusPx" });
    }
  });

const skillsFileSchema = z
  .object({
    version: z.literal(1),
    skills: z.array(skillSchema),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const skill of file.skills) {
      if (seen.has(skill.id)) {
        ctx.addIssue({ code: "custom", message: `duplicate skill id "${skill.id}"` });
      }
      seen.add(skill.id);
      const info = CLASSES.find((candidate) => candidate.id === skill.classId);
      if (!info) {
        ctx.addIssue({ code: "custom", message: `${skill.id}: unknown class` });
        continue;
      }
      if (!info.doctrines.some((doctrine) => doctrine.id === skill.doctrineId)) {
        ctx.addIssue({
          code: "custom",
          message: `${skill.id}: "${skill.doctrineId}" is not a ${skill.classId} doctrine`,
        });
      }
    }
  });

const parsed = skillsFileSchema.parse(raw);

export interface SkillDamage {
  scaling: (typeof DAMAGE_SCALINGS)[number];
  basePower: number;
  powerPerRank: number;
  lifestealPct?: number;
}

export interface SkillHeal {
  base: number;
  perRank: number;
  overTime?: boolean;
  durationMs?: number;
}

export interface SkillEffect {
  kind: (typeof SKILL_EFFECT_KINDS)[number];
  stat?: (typeof BUFF_STATS)[number];
  mode?: (typeof BUFF_MODES)[number];
  value?: number;
  perRank?: number;
  durationMs?: number;
  tickMs?: number;
  stacks?: number;
}

export interface SkillInfo {
  id: string;
  classId: ClassId;
  doctrineId: string;
  name: string;
  description: string;
  iconKey: string;
  unlockLevel: number;
  maxRank: 20;
  type: SkillType;
  target: (typeof SKILL_TARGETS)[number];
  rangePx: number;
  radiusPx: number;
  maxTargets?: number;
  castTimeMs: number;
  cooldownMs: number;
  selfDamagePct?: number;
  mpCost: { base: number; perRank: number };
  damage?: SkillDamage;
  heal?: SkillHeal;
  effects: SkillEffect[];
  fx: (typeof SKILL_FX_PRESETS)[number];
  animationRow: number;
}

export const SKILLS: readonly SkillInfo[] = parsed.skills;

const byId = new Map(SKILLS.map((skill) => [skill.id, skill]));

export function hasSkill(id: string): boolean {
  return byId.has(id);
}

export function getSkill(id: string): SkillInfo {
  const found = byId.get(id);
  if (!found) {
    throw new Error(`unknown skill "${id}"`);
  }
  return found;
}

export function skillsForDoctrine(classId: ClassId, doctrineId: string): SkillInfo[] {
  return SKILLS.filter(
    (skill) => skill.classId === classId && skill.doctrineId === doctrineId,
  ).sort((a, b) => a.unlockLevel - b.unlockLevel || a.id.localeCompare(b.id));
}

import type { CastSkillMessage, ClassId, Vec2 } from "@jadethrone/shared";
import { getSkill, hasSkill, type SkillInfo } from "@jadethrone/data/skills";
import type { PlayerProgression } from "../characters/progression";
import { SkillRuleError } from "./skillState";

export interface SkillCastValidation {
  skill: SkillInfo;
  rank: number;
  mpCost: number;
  readyAtMs: number;
}

export interface PendingSkillCast {
  skillId: string;
  request: CastSkillMessage;
  completesAtMs: number;
}

export interface ValidateSkillCastInput {
  progression: PlayerProgression;
  classId: ClassId;
  request: CastSkillMessage;
  now: number;
  cooldowns: ReadonlyMap<string, number>;
  hasPendingCast: boolean;
  dead: boolean;
  warping: boolean;
  casterPos: Vec2;
  /** Resolved target position; absent for self/party skills. */
  targetPos?: Vec2;
}

/** MP cost at a 1-based rank. */
export function skillMpCost(skill: SkillInfo, rank: number): number {
  return Math.max(0, skill.mpCost.base + skill.mpCost.perRank * (Math.max(1, rank) - 1));
}

export function skillReadyAt(
  cooldowns: ReadonlyMap<string, number>,
  skillId: string,
): number {
  return cooldowns.get(skillId) ?? 0;
}

function requiresTarget(skill: SkillInfo): boolean {
  if (skill.target === "self" || skill.target === "party") {
    return false;
  }
  return skill.target === "enemy" || skill.target === "ally" || skill.target === "ground";
}

/**
 * Validate a cast before MP/cooldown are spent. The room resolves target ids to
 * a position and passes it here; geometry and all rule checks stay pure.
 */
export function validateSkillCast(
  input: ValidateSkillCastInput,
): SkillCastValidation {
  const { request, progression, classId } = input;
  if (!hasSkill(request.skillId)) {
    throw new SkillRuleError("unknown_skill", "Unknown skill.", request.skillId);
  }
  const skill = getSkill(request.skillId);
  if (skill.classId !== classId) {
    throw new SkillRuleError("skill_locked", "That skill is not available to your class.");
  }
  if (progression.doctrine === null) {
    throw new SkillRuleError("skill_locked", "Choose a doctrine first.");
  }
  if (skill.doctrineId !== progression.doctrine) {
    throw new SkillRuleError("not_in_doctrine", "That skill belongs to another doctrine.");
  }
  if (progression.level < skill.unlockLevel) {
    throw new SkillRuleError("level_too_low", `Unlocks at level ${skill.unlockLevel}.`);
  }
  const rank = progression.skills[skill.id] ?? 0;
  if (rank <= 0) {
    throw new SkillRuleError("skill_locked", "Learn that skill first.", skill.id);
  }
  if (input.dead) {
    throw new SkillRuleError("dead", "Cannot cast while dead.", skill.id);
  }
  if (input.warping) {
    throw new SkillRuleError("warping", "Cannot cast while warping.", skill.id);
  }
  if (input.hasPendingCast) {
    throw new SkillRuleError("already_casting", "Finish your current cast first.", skill.id);
  }
  const readyAtMs = skillReadyAt(input.cooldowns, skill.id);
  if (input.now < readyAtMs) {
    throw new SkillRuleError("on_cooldown", "That skill is still cooling down.", skill.id);
  }
  const mpCost = skillMpCost(skill, rank);
  if (progression.mp < mpCost) {
    throw new SkillRuleError("not_enough_mp", "Not enough MP.", skill.id);
  }
  if (requiresTarget(skill)) {
    if (!input.targetPos) {
      throw new SkillRuleError("invalid_target", "Choose a target.", skill.id);
    }
    const dx = input.targetPos.x - input.casterPos.x;
    const dy = input.targetPos.y - input.casterPos.y;
    const reach = skill.rangePx + 32;
    if (dx * dx + dy * dy > reach * reach) {
      throw new SkillRuleError("out_of_range", "That target is out of range.", skill.id);
    }
  }
  return { skill, rank, mpCost, readyAtMs };
}

/** Cast bar bookkeeping; MP/cooldown are consumed by the room on success. */
export function createPendingCast(
  validation: SkillCastValidation,
  request: CastSkillMessage,
  now: number,
): PendingSkillCast {
  return {
    skillId: validation.skill.id,
    request,
    completesAtMs: now + validation.skill.castTimeMs,
  };
}

export function isCastComplete(pending: PendingSkillCast, now: number): boolean {
  return now >= pending.completesAtMs;
}

export function startSkillCooldown(
  cooldowns: Map<string, number>,
  skill: SkillInfo,
  now: number,
): number {
  const readyAtMs = now + skill.cooldownMs;
  cooldowns.set(skill.id, readyAtMs);
  return readyAtMs;
}

import {
  skillPointsForLevel,
  type ClassId,
  type SkillErrorCode,
  type SkillErrorPayload,
  type SkillStatePayload,
} from "@jadethrone/shared";
import { getClass } from "@jadethrone/data/classes";
import { BASE_CATALOG, type CatalogLookup } from "@jadethrone/data/catalog";
import type { SkillInfo } from "@jadethrone/data/skills";
import type { PlayerProgression } from "../characters/progression";

/** Rule violation with a stable client-facing code. */
export class SkillRuleError extends Error {
  readonly code: SkillErrorCode;
  readonly skillId?: string;

  constructor(code: SkillErrorCode, message: string, skillId?: string) {
    super(message);
    this.name = "SkillRuleError";
    this.code = code;
    this.skillId = skillId;
  }
}

export function toSkillErrorPayload(error: SkillRuleError): SkillErrorPayload {
  return {
    code: error.code,
    message: error.message,
    ...(error.skillId ? { skillId: error.skillId } : {}),
  };
}

const START_LEVEL = 5;

/** Build the owner-only skill/doctrine snapshot shown by the skill window. */
export function buildSkillState(
  progression: PlayerProgression,
  classId: ClassId,
  cooldowns: ReadonlyMap<string, number> = new Map(),
  catalog: CatalogLookup = BASE_CATALOG,
): SkillStatePayload {
  const skills = progression.doctrine
    ? catalog.skillsForDoctrine(classId, progression.doctrine).map((skill) => ({
        skillId: skill.id,
        rank: progression.skills[skill.id] ?? 0,
        readyAtMs: cooldowns.get(skill.id) ?? 0,
      }))
    : [];
  return {
    doctrine: progression.doctrine,
    skillPoints: progression.skillPoints,
    totalSkillPoints: skillPointsForLevel(progression.level),
    skills,
  };
}

/** Validate and return the doctrine id; persistence happens in the room. */
export function chooseDoctrine(
  progression: PlayerProgression,
  classId: ClassId,
  doctrineId: string,
): string {
  if (progression.doctrine !== null) {
    throw new SkillRuleError("doctrine_locked", "Your doctrine is already chosen.");
  }
  if (progression.level < START_LEVEL) {
    throw new SkillRuleError(
      "level_too_low",
      `Choose a doctrine at level ${START_LEVEL}.`,
    );
  }
  const info = getClass(classId);
  if (!info.doctrines.some((doctrine) => doctrine.id === doctrineId)) {
    throw new SkillRuleError("doctrine_invalid", "That doctrine does not belong to your class.");
  }
  return doctrineId;
}

export interface SkillUpgradeResult {
  skill: SkillInfo;
  rank: number;
  skillPoints: number;
}

/** Validate one rank purchase. Rank 1 is the first point spent. */
export function upgradeSkill(
  progression: PlayerProgression,
  classId: ClassId,
  skillId: string,
  catalog: CatalogLookup = BASE_CATALOG,
): SkillUpgradeResult {
  if (!catalog.hasSkill(skillId)) {
    throw new SkillRuleError("unknown_skill", "Unknown skill.", skillId);
  }
  const skill = catalog.getSkill(skillId);
  if (skill.classId !== classId) {
    throw new SkillRuleError("skill_locked", "That skill is not available to your class.", skillId);
  }
  if (progression.doctrine === null) {
    throw new SkillRuleError("skill_locked", "Choose a doctrine first.", skillId);
  }
  if (skill.doctrineId !== progression.doctrine) {
    throw new SkillRuleError("not_in_doctrine", "That skill belongs to another doctrine.", skillId);
  }
  if (progression.level < skill.unlockLevel) {
    throw new SkillRuleError(
      "level_too_low",
      `Unlocks at level ${skill.unlockLevel}.`,
      skillId,
    );
  }
  const rank = progression.skills[skillId] ?? 0;
  if (rank >= skill.maxRank) {
    throw new SkillRuleError("skill_maxed", "That skill is already at maximum rank.", skillId);
  }
  if (progression.skillPoints <= 0) {
    throw new SkillRuleError("no_skill_points", "No skill points available.", skillId);
  }
  return { skill, rank: rank + 1, skillPoints: progression.skillPoints - 1 };
}

import { describe, expect, it } from "vitest";
import { SKILLS } from "@jadethrone/data/skills";
import {
  normalizeSkillPoints,
  normalizeSkillRank,
  normalizeSkillRanks,
} from "../../src/characters/characterSkills";
import { ServiceError } from "../../src/errors";

const warriorSkill = SKILLS.find((skill) => skill.classId === "warrior")!;

function validationError(run: () => unknown): ServiceError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ServiceError);
    return error as ServiceError;
  }
  throw new Error("expected a validation error");
}

describe("character skill normalization", () => {
  it("accepts rank 0 through the skill max rank", () => {
    expect(normalizeSkillRank(warriorSkill.id, 0)).toBe(0);
    expect(normalizeSkillRank(warriorSkill.id, 1)).toBe(1);
    expect(normalizeSkillRank(warriorSkill.id, warriorSkill.maxRank)).toBe(
      warriorSkill.maxRank,
    );
  });

  it("rejects unknown skills and bad ranks", () => {
    expect(validationError(() => normalizeSkillRank("missing_skill", 1)).code).toBe("validation");
    for (const rank of [-1, 1.5, Number.NaN, warriorSkill.maxRank + 1]) {
      expect(validationError(() => normalizeSkillRank(warriorSkill.id, rank)).code).toBe(
        "validation",
      );
    }
  });

  it("normalizes every map entry including rank 0 and keeps a stable order", () => {
    const skills = SKILLS.filter((skill) => skill.classId === "warrior").slice(0, 2);
    const result = normalizeSkillRanks({ [skills[1]!.id]: 0, [skills[0]!.id]: 3 });
    expect(result).toEqual(
      [...result].sort((a, b) => a.skillId.localeCompare(b.skillId)),
    );
    expect(result.some((entry) => entry.rank === 0)).toBe(true);
  });

  it("clamps skill points", () => {
    expect(normalizeSkillPoints(-5)).toBe(0);
    expect(normalizeSkillPoints(3.9)).toBe(3);
    expect(normalizeSkillPoints(1e9)).toBe(10_000);
    expect(validationError(() => normalizeSkillPoints(Number.NaN)).code).toBe("validation");
  });
});

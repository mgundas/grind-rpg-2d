import { describe, expect, it } from "vitest";
import { skillPointsForLevel } from "@jadethrone/shared";
import type { PlayerProgression } from "../../src/characters/progression";
import {
  buildSkillState,
  chooseDoctrine,
  SkillRuleError,
  upgradeSkill,
} from "../../src/skills/skillState";

function progression(overrides: Partial<PlayerProgression> = {}): PlayerProgression {
  const level = overrides.level ?? 10;
  return {
    hp: 100,
    maxHp: 100,
    mp: 50,
    maxMp: 50,
    level,
    xp: 0,
    stats: { vit: 4, int: 3, str: 6, dex: 3 },
    statPoints: 0,
    doctrine: null,
    skillPoints: skillPointsForLevel(level),
    skills: {},
    ...overrides,
  };
}

function ruleError(run: () => unknown): SkillRuleError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(SkillRuleError);
    return error as SkillRuleError;
  }
  throw new Error("expected a skill rule error");
}

describe("buildSkillState", () => {
  it("returns no skills before a doctrine is chosen", () => {
    const state = buildSkillState(progression(), "warrior");
    expect(state.doctrine).toBeNull();
    expect(state.skills).toEqual([]);
  });

  it("returns the six doctrine skills with ranks and cooldowns", () => {
    const state = buildSkillState(
      progression({
        doctrine: "blade",
        skills: { warrior_blade_whirlwind: 3 },
      }),
      "warrior",
      new Map([["warrior_blade_charge", 12_345]]),
    );
    expect(state.doctrine).toBe("blade");
    expect(state.skills).toHaveLength(6);
    expect(state.skills.find((skill) => skill.skillId === "warrior_blade_whirlwind")).toEqual({
      skillId: "warrior_blade_whirlwind",
      rank: 3,
      readyAtMs: 0,
    });
    expect(state.skills.find((skill) => skill.skillId === "warrior_blade_charge")?.readyAtMs).toBe(
      12_345,
    );
    expect(state.totalSkillPoints).toBe(6);
  });
});

describe("chooseDoctrine", () => {
  it("accepts a class doctrine at level 5", () => {
    expect(chooseDoctrine(progression({ level: 5 }), "warrior", "blade")).toBe("blade");
  });

  it("rejects low level, foreign doctrine and a second choice", () => {
    expect(ruleError(() => chooseDoctrine(progression({ level: 4 }), "warrior", "blade")).code).toBe(
      "level_too_low",
    );
    expect(ruleError(() => chooseDoctrine(progression(), "warrior", "dark_arts")).code).toBe(
      "doctrine_invalid",
    );
    expect(
      ruleError(() => chooseDoctrine(progression({ doctrine: "blade" }), "warrior", "iron_body"))
        .code,
    ).toBe("doctrine_locked");
  });
});

describe("upgradeSkill", () => {
  it("spends one point for the next rank", () => {
    const current = progression({
      doctrine: "blade",
      skillPoints: 4,
      skills: { warrior_blade_whirlwind: 2 },
    });
    const result = upgradeSkill(current, "warrior", "warrior_blade_whirlwind");
    expect(result.rank).toBe(3);
    expect(result.skillPoints).toBe(3);
    expect(result.skill.maxRank).toBe(20);
  });

  it("rejects unknown, foreign and locked skills", () => {
    expect(ruleError(() => upgradeSkill(progression(), "warrior", "missing_skill")).code).toBe(
      "unknown_skill",
    );
    expect(
      ruleError(() => upgradeSkill(progression(), "warrior", "warrior_blade_whirlwind")).code,
    ).toBe("skill_locked");
    expect(
      ruleError(() =>
        upgradeSkill(
          progression({ doctrine: "blade" }),
          "warrior",
          "warrior_iron_body_shield_bash",
        ),
      ).code,
    ).toBe("not_in_doctrine");
    expect(
      ruleError(() =>
        upgradeSkill(
          progression({ doctrine: "blade", level: 7 }),
          "warrior",
          "warrior_blade_charge",
        ),
      ).code,
    ).toBe("level_too_low");
  });

  it("rejects maxed skills and an empty point pool", () => {
    expect(
      ruleError(() =>
        upgradeSkill(
          progression({
            doctrine: "blade",
            skillPoints: 5,
            skills: { warrior_blade_whirlwind: 20 },
          }),
          "warrior",
          "warrior_blade_whirlwind",
        ),
      ).code,
    ).toBe("skill_maxed");
    expect(
      ruleError(() =>
        upgradeSkill(
          progression({ doctrine: "blade", skillPoints: 0 }),
          "warrior",
          "warrior_blade_whirlwind",
        ),
      ).code,
    ).toBe("no_skill_points");
  });
});

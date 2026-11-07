import { describe, expect, it } from "vitest";
import type { Vec2 } from "@jadethrone/shared";
import { getSkill } from "@jadethrone/data/skills";
import type { PlayerProgression } from "../../src/characters/progression";
import {
  createPendingCast,
  isCastComplete,
  skillMpCost,
  startSkillCooldown,
  validateSkillCast,
  type ValidateSkillCastInput,
} from "../../src/skills/skillRuntime";

const CASTER: Vec2 = { x: 100, y: 100 };

function progression(overrides: Partial<PlayerProgression> = {}): PlayerProgression {
  return {
    hp: 300,
    maxHp: 300,
    mp: 92,
    maxMp: 92,
    level: 10,
    xp: 0,
    stats: { vit: 4, int: 3, str: 6, dex: 3 },
    statPoints: 0,
    doctrine: "blade",
    skillPoints: 4,
    skills: { warrior_blade_whirlwind: 1, warrior_blade_charge: 1 },
    ...overrides,
  };
}

function input(overrides: Partial<ValidateSkillCastInput> = {}): ValidateSkillCastInput {
  return {
    progression: progression(),
    classId: "warrior",
    request: { skillId: "warrior_blade_whirlwind" },
    now: 1000,
    cooldowns: new Map(),
    hasPendingCast: false,
    dead: false,
    warping: false,
    casterPos: CASTER,
    ...overrides,
  };
}

function errorCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as { code: string }).code;
  }
  throw new Error("expected a skill error");
}

describe("validateSkillCast", () => {
  it("accepts a learned, ready skill and reports MP", () => {
    const result = validateSkillCast(input());
    expect(result.skill.id).toBe("warrior_blade_whirlwind");
    expect(result.rank).toBe(1);
    expect(result.mpCost).toBe(10);
    expect(skillMpCost(getSkill("warrior_blade_whirlwind"), 3)).toBe(14);
  });

  it("rejects rule violations with stable codes", () => {
    expect(errorCode(() => validateSkillCast(input({ request: { skillId: "nope" } })))).toBe(
      "unknown_skill",
    );
    expect(
      errorCode(() =>
        validateSkillCast(
          input({
            classId: "warrior",
            request: { skillId: "assassin_hawk_piercing_shot" },
          }),
        ),
      ),
    ).toBe("skill_locked");
    expect(
      errorCode(() => validateSkillCast(input({ progression: progression({ doctrine: null }) }))),
    ).toBe("skill_locked");
    expect(
      errorCode(() =>
        validateSkillCast(input({ progression: progression({ doctrine: "iron_body" }) })),
      ),
    ).toBe("not_in_doctrine");
    expect(
      errorCode(() => validateSkillCast(input({ progression: progression({ level: 4 }) }))),
    ).toBe("level_too_low");
    expect(
      errorCode(() =>
        validateSkillCast(input({ progression: progression({ skills: {} }) })),
      ),
    ).toBe("skill_locked");
    expect(errorCode(() => validateSkillCast(input({ dead: true })))).toBe("dead");
    expect(errorCode(() => validateSkillCast(input({ warping: true })))).toBe("warping");
    expect(errorCode(() => validateSkillCast(input({ hasPendingCast: true })))).toBe(
      "already_casting",
    );
  });

  it("gates cooldowns and MP", () => {
    expect(
      errorCode(() =>
        validateSkillCast(input({ cooldowns: new Map([["warrior_blade_whirlwind", 1500]]) })),
      ),
    ).toBe("on_cooldown");
    expect(
      errorCode(() => validateSkillCast(input({ progression: progression({ mp: 5 }) }))),
    ).toBe("not_enough_mp");
  });

  it("requires and range-checks targeted skills", () => {
    const charge = { skillId: "warrior_blade_charge" };
    expect(
      errorCode(() => validateSkillCast(input({ request: charge }))),
    ).toBe("invalid_target");
    expect(
      errorCode(() =>
        validateSkillCast(input({ request: charge, targetPos: { x: 1000, y: 100 } })),
      ),
    ).toBe("out_of_range");
    expect(
      validateSkillCast(input({ request: charge, targetPos: { x: 200, y: 100 } })).skill.id,
    ).toBe("warrior_blade_charge");
  });

  it("creates a pending cast and starts cooldowns", () => {
    const validation = validateSkillCast(input());
    const pending = createPendingCast(validation, { skillId: validation.skill.id }, 1000);
    expect(pending.completesAtMs).toBe(1000);
    expect(isCastComplete(pending, 1000)).toBe(true);
    const cooldowns = new Map<string, number>();
    expect(startSkillCooldown(cooldowns, validation.skill, 1000)).toBe(
      1000 + validation.skill.cooldownMs,
    );
    expect(cooldowns.get(validation.skill.id)).toBe(1000 + validation.skill.cooldownMs);
  });
});

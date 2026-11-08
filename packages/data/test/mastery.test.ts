import { describe, expect, it } from "vitest";
import {
  MASTERY_RULES,
  effectiveSkillRank,
  masterySuccessChance,
} from "../src/mastery";

describe("mastery rules", () => {
  it("exposes ten chances and a twelve-hour cooldown", () => {
    expect(MASTERY_RULES.successChanceByLevel).toHaveLength(10);
    expect(MASTERY_RULES.readCooldownMs).toBe(43_200_000);
    expect(masterySuccessChance(0)).toBe(0.9);
    expect(masterySuccessChance(9)).toBe(0.2);
    expect(masterySuccessChance(99)).toBe(0.2);
  });

  it("adds master levels to the effective rank", () => {
    expect(effectiveSkillRank(20, 0)).toBe(20);
    expect(effectiveSkillRank(20, 5)).toBe(25);
    expect(effectiveSkillRank(3, 2)).toBe(5);
  });
});

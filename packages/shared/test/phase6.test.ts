import { describe, expect, it } from "vitest";
import {
  applyBuffModifiers,
  buffModifierTotals,
  castSkillMessageSchema,
  chooseDoctrineMessageSchema,
  findCircleTargets,
  findLineTargets,
  magicAttackOf,
  partyInviteMessageSchema,
  partyXpMultiplier,
  partyRespondMessageSchema,
  skillDamage,
  skillHealAmount,
  skillPointsForLevel,
  skillPowerAtRank,
  upgradeSkillMessageSchema,
  type RandomSource,
} from "@jadethrone/shared";

function fixed(value: number): RandomSource {
  return { next: () => value };
}

function point(id: string, x: number, y: number) {
  return { id, x, y };
}

describe("Phase 6 protocol schemas", () => {
  it("accepts a self skill and rejects an incomplete ground point", () => {
    expect(castSkillMessageSchema.safeParse({ skillId: "warrior_blade_whirlwind" }).success).toBe(
      true,
    );
    expect(
      castSkillMessageSchema.safeParse({ skillId: "warrior_blade_whirlwind", x: 10 }).success,
    ).toBe(false);
    expect(
      castSkillMessageSchema.safeParse({ skillId: "warrior_blade_whirlwind", x: 10, y: 20 })
        .success,
    ).toBe(true);
    expect(
      castSkillMessageSchema.safeParse({ skillId: "warrior_blade_whirlwind", dir: 8 }).success,
    ).toBe(false);
  });

  it("validates doctrine and skill upgrade requests", () => {
    expect(chooseDoctrineMessageSchema.safeParse({ doctrineId: "blade" }).success).toBe(true);
    expect(chooseDoctrineMessageSchema.safeParse({ doctrineId: "" }).success).toBe(false);
    expect(upgradeSkillMessageSchema.safeParse({ skillId: "warrior_blade_whirlwind" }).success).toBe(
      true,
    );
    expect(upgradeSkillMessageSchema.safeParse({}).success).toBe(false);
  });

  it("requires an invite target and a boolean response", () => {
    expect(partyInviteMessageSchema.safeParse({ name: "Grinder" }).success).toBe(true);
    expect(partyInviteMessageSchema.safeParse({}).success).toBe(false);
    expect(
      partyRespondMessageSchema.safeParse({
        inviteId: "11111111-1111-4111-8111-111111111111",
        accept: true,
      }).success,
    ).toBe(true);
    expect(
      partyRespondMessageSchema.safeParse({
        inviteId: "11111111-1111-4111-8111-111111111111",
        accept: "yes",
      }).success,
    ).toBe(false);
  });
});

describe("Phase 6 formulas", () => {
  it("derives magic attack from INT and level", () => {
    expect(magicAttackOf(3, 1)).toBe(7);
    expect(magicAttackOf(10, 20)).toBe(40);
    expect(magicAttackOf(-2, 5)).toBe(5);
  });

  it("scales skill power per rank", () => {
    expect(skillPowerAtRank(1.4, 0.1, 1)).toBeCloseTo(1.4);
    expect(skillPowerAtRank(1.4, 0.1, 4)).toBeCloseTo(1.7);
    expect(skillPowerAtRank(1.4, 0.1, 0)).toBeCloseTo(1.4);
  });

  it("applies skill damage with the same roll and defense reduction", () => {
    expect(skillDamage(fixed(0), 14, 2, 2)).toBe(24);
    expect(skillDamage(fixed(0.999999), 14, 2, 2)).toBe(29);
    expect(skillDamage(fixed(0), 0, 999, 0.1)).toBe(1);
  });

  it("computes direct heals from base, rank and magic attack", () => {
    expect(skillHealAmount(20, 5, 1, 7)).toBe(24);
    expect(skillHealAmount(20, 5, 3, 7)).toBe(34);
  });

  it("grants one skill point per level from level 5", () => {
    expect(skillPointsForLevel(1)).toBe(0);
    expect(skillPointsForLevel(5)).toBe(1);
    expect(skillPointsForLevel(10)).toBe(6);
    expect(skillPointsForLevel(99)).toBe(95);
  });

  it("adds 10% party XP per eligible extra member", () => {
    expect(partyXpMultiplier(0)).toBe(1);
    expect(partyXpMultiplier(1)).toBe(1);
    expect(partyXpMultiplier(2)).toBeCloseTo(1.1);
    expect(partyXpMultiplier(8)).toBeCloseTo(1.7);
  });

  it("aggregates flat and percent buff modifiers with a cap", () => {
    const modifiers = [
      { stat: "attack" as const, mode: "flat" as const, value: 5 },
      { stat: "attack" as const, mode: "percent" as const, value: 0.1 },
      { stat: "defense" as const, mode: "flat" as const, value: 2 },
    ];
    expect(buffModifierTotals(modifiers, "attack")).toEqual({ flat: 5, percent: 0.1 });
    expect(applyBuffModifiers(100, modifiers, "attack")).toBeCloseTo(115.5);
    expect(applyBuffModifiers(100, modifiers, "defense")).toBe(102);
    expect(
      applyBuffModifiers(100, [{ stat: "attack", mode: "percent", value: 5 }], "attack"),
    ).toBe(300);
  });
});

describe("Phase 6 target geometry", () => {
  it("selects circle targets nearest first with padding", () => {
    const circleCandidates = [point("near", 20, 0), point("edge", 49, 0), point("far", 80, 0), point("side", 0, 30)];
    expect(
      findCircleTargets(circleCandidates, { center: { x: 0, y: 0 }, radiusPx: 50, padPx: 0 }),
    ).toEqual(["near", "side", "edge"]);
    expect(
      findCircleTargets(circleCandidates, {
        center: { x: 0, y: 0 },
        radiusPx: 50,
        padPx: 20,
        maxTargets: 2,
      }),
    ).toEqual(["near", "side"]);
  });

  it("selects only targets inside the line corridor", () => {
    const lineTargets = [
      point("on", 50, 0),
      point("inside", 50, 8),
      point("outside", 50, 12),
      point("before", -20, 0),
      point("beyond", 110, 0),
    ];
    expect(
      findLineTargets(lineTargets, {
        origin: { x: 0, y: 0 },
        end: { x: 100, y: 0 },
        widthPx: 20,
      }),
    ).toEqual(["on", "inside"]);
  });

  it("caps results and breaks ties by id", () => {
    const tie = [point("b", 10, 0), point("a", 10, 0)];
    expect(
      findCircleTargets(tie, { center: { x: 0, y: 0 }, radiusPx: 20, padPx: 0, maxTargets: 1 }),
    ).toEqual(["a"]);
    expect(
      findCircleTargets(tie, { center: { x: 0, y: 0 }, radiusPx: 20, padPx: 0, maxTargets: 0 }),
    ).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  BUFF_PERCENT_CAP_MAX,
  BUFF_PERCENT_CAP_MIN,
  CRIT_MULTIPLIER,
  MAX_LEVEL,
  applyBuffModifiers,
  applyXpGain,
  critChance,
  critDamage,
  deathXpLoss,
  defenseOf,
  hitChance,
  hpRegenAmount,
  levelXpMultiplier,
  maxHp,
  maxMp,
  monsterXpGain,
  mpRegenAmount,
  physicalAttack,
  resolveDamage,
  seededRandomSource,
  statAttack,
  xpToNextLevel,
  type RandomSource,
} from "@jadethrone/shared";

function fixed(value: number): RandomSource {
  return { next: () => value };
}

describe("buff percentage caps", () => {
  it("clamps stacked percent modifiers to the exported bounds", () => {
    expect(
      applyBuffModifiers(100, [{ stat: "attack", mode: "percent", value: 10 }], "attack"),
    ).toBe(100 * (1 + BUFF_PERCENT_CAP_MAX));
    expect(
      applyBuffModifiers(100, [{ stat: "attack", mode: "percent", value: -10 }], "attack"),
    ).toBeCloseTo(100 * (1 + BUFF_PERCENT_CAP_MIN));
  });
});

describe("character HP/MP formulas", () => {
  it("computes level-1 warrior HP/MP from the spec formula", () => {
    expect(maxHp({ baseHp: 120, vit: 4, level: 1 })).toBe(316);
    expect(maxMp({ baseMp: 20, int: 3, level: 1 })).toBe(92);
  });

  it("computes level-1 mystic HP/MP", () => {
    expect(maxHp({ baseHp: 80, vit: 3, level: 1 })).toBe(236);
    expect(maxMp({ baseMp: 50, int: 6, level: 1 })).toBe(182);
  });

  it("scales with level and stat points", () => {
    expect(maxHp({ baseHp: 120, vit: 10, level: 10 })).toBe(120 + 400 + 360);
    expect(maxMp({ baseMp: 20, int: 10, level: 10 })).toBe(20 + 200 + 120);
  });
});

describe("attack formulas", () => {
  const warrior = { vit: 4, int: 3, str: 6, dex: 3 };
  const assassin = { vit: 3, int: 3, str: 4, dex: 6 };

  it("applies class stat weights", () => {
    expect(statAttack("warrior", warrior)).toBe(12);
    expect(statAttack("hexblade", { vit: 3, int: 5, str: 5, dex: 3 })).toBe(10);
    expect(statAttack("mystic", { vit: 3, int: 6, str: 3, dex: 4 })).toBe(3);
    expect(statAttack("assassin", assassin)).toBe(4 + 12);
  });

  it("adds level × 2 and the weapon bonus", () => {
    expect(physicalAttack({ classId: "warrior", stats: warrior, level: 1 })).toBe(14);
    expect(physicalAttack({ classId: "assassin", stats: assassin, level: 1 })).toBe(18);
    expect(physicalAttack({ classId: "warrior", stats: warrior, level: 10 })).toBe(32);
    expect(physicalAttack({ classId: "warrior", stats: warrior, level: 1, weaponAttack: 7 })).toBe(
      21,
    );
  });

  it("derives defense from VIT", () => {
    expect(defenseOf(4)).toBe(2);
    expect(defenseOf(10)).toBe(5);
  });
});

describe("damage rolls", () => {
  it("uses the 0.9–1.1 range and subtracts 70% of defense", () => {
    // 0.9 * 14 - 2 * 0.7 = 12.6 - 1.4 = 11.2 -> 11
    expect(resolveDamage(fixed(0), 14, 2)).toBe(11);
    // 1.1 * 14 - 1.4 = 14 -> 14
    expect(resolveDamage(fixed(0.999999), 14, 2)).toBe(14);
  });

  it("always deals at least 1 damage", () => {
    expect(resolveDamage(fixed(0), 1, 1000)).toBe(1);
  });
});

describe("hit chance", () => {
  it("uses the spec formula", () => {
    expect(hitChance({ attackerDex: 3, defenderDex: 3, attackerLevel: 1, defenderLevel: 1 })).toBe(
      0.7,
    );
    expect(
      hitChance({ attackerDex: 10, defenderDex: 3, attackerLevel: 10, defenderLevel: 1 }),
    ).toBeCloseTo(0.7 + 0.035 + 0.09, 10);
  });

  it("clamps to 0.4–0.98", () => {
    expect(
      hitChance({ attackerDex: -500, defenderDex: 500, attackerLevel: 0, defenderLevel: 99 }),
    ).toBe(0.4);
    expect(
      hitChance({ attackerDex: 500, defenderDex: -500, attackerLevel: 99, defenderLevel: 0 }),
    ).toBe(0.98);
  });
});

describe("crit", () => {
  it("starts at 2% and adds 0.1% per DEX point", () => {
    expect(critChance(3)).toBeCloseTo(0.023, 10);
    expect(critChance(0, 0.05)).toBeCloseTo(0.07, 10);
  });

  it("doubles damage", () => {
    expect(CRIT_MULTIPLIER).toBe(2);
    expect(critDamage(11)).toBe(22);
    expect(critDamage(1)).toBe(2);
  });
});

describe("XP curve and gains", () => {
  it("uses floor(120 × level^2.25)", () => {
    expect(xpToNextLevel(1)).toBe(120);
    expect(xpToNextLevel(2)).toBe(570);
    expect(xpToNextLevel(10)).toBe(21339);
  });

  it("applies level-gap multipliers", () => {
    expect(levelXpMultiplier(1, 1)).toBe(1);
    expect(levelXpMultiplier(6, 1)).toBeCloseTo(1.2, 10);
    expect(levelXpMultiplier(20, 1)).toBeCloseTo(1.2, 10); // capped
    expect(levelXpMultiplier(1, 6)).toBe(0.6); // 5 below
    expect(levelXpMultiplier(1, 11)).toBe(0.2); // 10 below
    expect(levelXpMultiplier(5, 8)).toBe(1); // 3 below is normal
  });

  it("scales monster XP and never gives zero", () => {
    expect(monsterXpGain(20, 1, 1)).toBe(20);
    expect(monsterXpGain(20, 1, 6)).toBe(12);
    expect(monsterXpGain(20, 1, 11)).toBe(4);
    expect(monsterXpGain(1, 1, 11)).toBe(1);
    expect(monsterXpGain(20, 4, 1)).toBe(22);
  });

  it("levels up once, carrying the remainder", () => {
    expect(applyXpGain(1, 100, 30)).toEqual({
      level: 2,
      xp: 10,
      levelsGained: 1,
      statPointsGained: 3,
    });
  });

  it("handles multiple levels in one gain", () => {
    expect(applyXpGain(1, 0, 700)).toEqual({
      level: 3,
      xp: 10,
      levelsGained: 2,
      statPointsGained: 6,
    });
  });

  it("stops at the level cap", () => {
    const result = applyXpGain(MAX_LEVEL, 0, 1_000_000_000);
    expect(result.level).toBe(MAX_LEVEL);
    expect(result.xp).toBe(0);
    expect(result.levelsGained).toBe(0);
  });
});

describe("death XP loss", () => {
  it("is 2% of the current level requirement", () => {
    expect(deathXpLoss(1, 100)).toBe(2);
    expect(deathXpLoss(10, 100_000)).toBe(426);
  });

  it("never takes more than the current progress and never de-levels", () => {
    expect(deathXpLoss(10, 10)).toBe(10);
    expect(deathXpLoss(10, 0)).toBe(0);
  });
});

describe("regen", () => {
  it("regenerates 2% out of combat and 0.5% in combat", () => {
    expect(hpRegenAmount(316, false)).toBe(6);
    expect(hpRegenAmount(316, true)).toBe(2);
    expect(mpRegenAmount(92)).toBe(2);
  });

  it("always regenerates at least 1", () => {
    expect(hpRegenAmount(1, true)).toBe(1);
    expect(mpRegenAmount(1)).toBe(1);
  });
});

describe("seededRandomSource", () => {
  it("is deterministic and stays in [0, 1)", () => {
    const a = seededRandomSource(1234);
    const b = seededRandomSource(1234);
    for (let i = 0; i < 20; i++) {
      const value = a.next();
      expect(value).toBe(b.next());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  activeBuffs,
  applyPlayerBuff,
  applyPoison,
  applySlow,
  applyStunAt,
  buffViews,
  clearMonsterStatus,
  createMonsterStatus,
  hasStealth,
  isStunned,
  movementFactor,
  playerBuffModifiers,
  pruneExpiredBuffs,
  removeStealth,
  tickPoison,
} from "../../src/skills/effects";

const ATTACK_BUFF = {
  sourceSkillId: "warrior_blade_berserk",
  name: "Berserk",
  iconKey: "icon.skill.berserk",
  modifiers: [
    { stat: "attack" as const, mode: "percent" as const, value: 0.2 },
    { stat: "attackSpeed" as const, mode: "percent" as const, value: 0.1 },
  ],
  durationMs: 8000,
};

describe("player buffs", () => {
  it("applies and refreshes a buff by source skill", () => {
    const buffs = new Map();
    const first = applyPlayerBuff(buffs, ATTACK_BUFF, 1000);
    expect(first.expiresAtMs).toBe(9000);
    expect(first.stacks).toBe(1);

    const second = applyPlayerBuff(buffs, ATTACK_BUFF, 2000);
    expect(second.stacks).toBe(2);
    expect(second.expiresAtMs).toBe(10_000);
    expect(buffs.size).toBe(1);
  });

  it("expires buffs and exposes the UI view", () => {
    const buffs = new Map();
    applyPlayerBuff(buffs, ATTACK_BUFF, 1000);
    expect(activeBuffs(buffs, 8999)).toHaveLength(1);
    expect(buffViews(buffs, 1000)[0]).toMatchObject({
      sourceSkillId: ATTACK_BUFF.sourceSkillId,
      kind: "buff",
      stacks: 1,
    });
    expect(pruneExpiredBuffs(buffs, 9000)).toBe(true);
    expect(buffs.size).toBe(0);
    expect(activeBuffs(buffs, 9000)).toHaveLength(0);
  });

  it("aggregates active modifier sets", () => {
    const buffs = new Map();
    applyPlayerBuff(buffs, ATTACK_BUFF, 1000);
    applyPlayerBuff(
      buffs,
      {
        sourceSkillId: "iron_skin",
        name: "Iron Skin",
        iconKey: "icon.skill.iron_skin",
        modifiers: [{ stat: "defense", mode: "flat", value: 4 }],
        durationMs: 4000,
      },
      1000,
    );
    expect(playerBuffModifiers(buffs, 1000)).toHaveLength(3);
    expect(playerBuffModifiers(buffs, 5000)).toHaveLength(2);
  });

  it("tracks and removes stealth", () => {
    const buffs = new Map();
    applyPlayerBuff(
      buffs,
      { ...ATTACK_BUFF, sourceSkillId: "stealth", stealth: true },
      1000,
    );
    expect(hasStealth(buffs, 1000)).toBe(true);
    expect(removeStealth(buffs)).toBe(true);
    expect(hasStealth(buffs, 1000)).toBe(false);
  });
});

describe("monster statuses", () => {
  it("halves stun duration for bosses", () => {
    const normal = createMonsterStatus();
    applyStunAt(normal, 1000, false, 5000);
    expect(normal.stunUntilMs).toBe(6000);
    expect(isStunned(normal, 5999)).toBe(true);
    expect(isStunned(normal, 6000)).toBe(false);

    const boss = createMonsterStatus();
    applyStunAt(boss, 1000, true, 5000);
    expect(boss.stunUntilMs).toBe(5500);
  });

  it("slows movement until expiry", () => {
    const status = createMonsterStatus();
    applySlow(status, 0.4, 2000, 1000);
    expect(movementFactor(status, 1000)).toBe(0.4);
    expect(movementFactor(status, 2999)).toBe(0.4);
    expect(movementFactor(status, 3000)).toBe(1);
  });

  it("ticks poison on its interval and clears after expiry", () => {
    const status = createMonsterStatus();
    applyPoison(
      status,
      { damagePerTick: 12, durationMs: 2500, tickMs: 1000, sourceSessionId: "s1" },
      1000,
    );
    expect(tickPoison(status, 1999)).toBeNull();
    expect(tickPoison(status, 2000)).toEqual({ damage: 12, sourceSessionId: "s1" });
    expect(tickPoison(status, 2500)).toBeNull();
    expect(tickPoison(status, 3000)).toEqual({ damage: 12, sourceSessionId: "s1" });
    expect(tickPoison(status, 3400)).toBeNull();
    expect(tickPoison(status, 3500)).toBeNull();
    expect(status.poison).toBeNull();
    expect(tickPoison(status, 4000)).toBeNull();
  });

  it("clears every status", () => {
    const status = createMonsterStatus();
    applyStunAt(status, 1000, false, 0);
    applySlow(status, 0.5, 1000, 0);
    applyPoison(status, { damagePerTick: 1, durationMs: 1000, sourceSessionId: "s" }, 0);
    clearMonsterStatus(status);
    expect(status).toEqual({
      stunUntilMs: 0,
      slowUntilMs: 0,
      slowFactor: 1,
      poison: null,
    });
  });
});

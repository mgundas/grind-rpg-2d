import { describe, expect, it } from "vitest";
import type { CharacterRecord } from "../../src/characters/characterMappers";
import { progressionFromCharacter } from "../../src/characters/progression";

const base: CharacterRecord = {
  id: "11111111-1111-1111-1111-111111111111",
  accountId: "22222222-2222-2222-2222-222222222222",
  name: "Hero",
  classId: "warrior",
  doctrine: null,
  gender: "male",
  hairStyle: 0,
  hairColor: 0,
  level: 1,
  xp: 0,
  gold: 0,
  hp: 100,
  mp: 20,
  statVit: 4,
  statInt: 3,
  statStr: 6,
  statDex: 3,
  statPoints: 0,
  skillPoints: 0,
  map: "map_ember_fields",
  x: 100,
  y: 100,
  channel: 1,
  pvpMode: "peaceful",
};

describe("progressionFromCharacter", () => {
  it("derives max HP/MP and keeps a valid saved HP/MP", () => {
    const progression = progressionFromCharacter(base);
    expect(progression.maxHp).toBe(316);
    expect(progression.maxMp).toBe(92);
    expect(progression.hp).toBe(100);
    expect(progression.mp).toBe(20);
    expect(progression.level).toBe(1);
  });

  it("revives a dead-on-login row at full HP", () => {
    expect(progressionFromCharacter({ ...base, hp: 0 }).hp).toBe(316);
    expect(progressionFromCharacter({ ...base, hp: -20 }).hp).toBe(316);
  });

  it("clamps over-max HP, MP and negative XP", () => {
    const progression = progressionFromCharacter({ ...base, hp: 5000, mp: 9999, xp: -5 });
    expect(progression.hp).toBe(316);
    expect(progression.mp).toBe(92);
    expect(progression.xp).toBe(0);
  });

  it("levels up over-full XP rows in memory and grants their stat points", () => {
    const progression = progressionFromCharacter({ ...base, xp: 700 });
    expect(progression.level).toBe(3);
    expect(progression.xp).toBe(10);
    expect(progression.statPoints).toBe(6);
  });

  it("respects persisted stat points and stats", () => {
    const progression = progressionFromCharacter({
      ...base,
      statVit: 10,
      statPoints: 9,
      level: 10,
    });
    expect(progression.stats.vit).toBe(10);
    expect(progression.statPoints).toBe(9);
    expect(progression.maxHp).toBe(120 + 400 + 360);
  });
});

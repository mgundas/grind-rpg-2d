import { describe, expect, it } from "vitest";
import { CLASSES, getClass } from "@jadethrone/data/classes";
import { MONSTERS, getMonster, hasMonster } from "@jadethrone/data/monsters";
import { DROP_TABLES, hasDropTable } from "@jadethrone/data/dropTables";
import { SPAWN_GROUPS, getSpawnGroup, hasSpawnGroup } from "@jadethrone/data/spawnGroups";

describe("monsters.json", () => {
  it("has at least 10 distinct starter monsters", () => {
    expect(MONSTERS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(MONSTERS.map((monster) => monster.id)).size).toBe(MONSTERS.length);
  });

  it("covers levels 1 to 15 and includes a field boss", () => {
    expect(Math.min(...MONSTERS.map((monster) => monster.level))).toBe(1);
    expect(Math.max(...MONSTERS.map((monster) => monster.level))).toBe(15);
    expect(MONSTERS.filter((monster) => monster.isBoss)).toHaveLength(1);
    expect(getMonster("wolf_king").isBoss).toBe(true);
  });

  it("uses the expected sprite keys and positive balance values", () => {
    for (const monster of MONSTERS) {
      expect(monster.spriteKey).toBe(`mob.${monster.id}`);
      expect(monster.hp).toBeGreaterThan(0);
      expect(monster.moveSpeed).toBeGreaterThan(0);
      expect(monster.attackCooldownMs).toBeGreaterThanOrEqual(200);
      expect(monster.leashRange).toBeGreaterThanOrEqual(monster.aggroRange);
      expect(monster.goldMax).toBeGreaterThanOrEqual(monster.goldMin);
      expect(monster.dropTableId).not.toBeNull();
      expect(hasDropTable(monster.dropTableId!)).toBe(true);
    }
  });

  it("gives every drop table exactly one owning monster", () => {
    const assigned = MONSTERS.map((monster) => monster.dropTableId);
    expect(new Set(assigned).size).toBe(MONSTERS.length);
    expect([...DROP_TABLES.map((table) => table.id)].sort()).toEqual(
      MONSTERS.map((monster) => monster.dropTableId).sort(),
    );
  });

  it("looks monsters up by id", () => {
    expect(hasMonster("wild_dog")).toBe(true);
    expect(hasMonster("nope")).toBe(false);
    expect(() => getMonster("nope")).toThrow(/unknown monster/);
  });
});

describe("spawnGroups.json", () => {
  it("defines the three field groups plus the boss", () => {
    expect(SPAWN_GROUPS.map((group) => group.id).sort()).toEqual([
      "field_bandits",
      "field_boars",
      "field_boss",
      "field_wolves",
    ]);
    expect(hasSpawnGroup("field_wolves")).toBe(true);
    expect(() => getSpawnGroup("nope")).toThrow(/unknown spawn group/);
  });

  it("uses 3–7 members per normal group and exactly one boss", () => {
    for (const group of SPAWN_GROUPS) {
      const total = group.members.reduce((sum, member) => sum + member.count, 0);
      if (total === 1) {
        expect(group.id).toBe("field_boss");
        expect(group.respawnMinMs).toBe(20 * 60 * 1000);
      } else {
        expect(total).toBeGreaterThanOrEqual(3);
        expect(total).toBeLessThanOrEqual(7);
        expect(group.respawnMinMs).toBeGreaterThanOrEqual(30_000);
        expect(group.respawnMaxMs).toBeLessThanOrEqual(60_000);
        expect(group.members.filter((member) => member.leader).length).toBe(1);
      }
    }
  });

  it("references existing monsters only", () => {
    for (const group of SPAWN_GROUPS) {
      for (const member of group.members) {
        expect(hasMonster(member.monsterId)).toBe(true);
      }
    }
  });
});

describe("class attack profiles", () => {
  it("gives every class a usable basic attack", () => {
    for (const info of CLASSES) {
      expect(info.attack.rangePx).toBeGreaterThan(0);
      expect(info.attack.cooldownMs).toBeGreaterThanOrEqual(200);
      expect(info.attack.maxTargets).toBeGreaterThanOrEqual(1);
    }
  });

  it("tunes Warrior and Assassin as the Phase-3 melee classes", () => {
    expect(getClass("warrior").attack).toEqual({
      rangePx: 64,
      cooldownMs: 900,
      maxTargets: 8,
    });
    expect(getClass("assassin").attack).toEqual({
      rangePx: 56,
      cooldownMs: 650,
      maxTargets: 6,
    });
  });
});

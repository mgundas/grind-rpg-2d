import { describe, expect, it } from "vitest";
import { REMOTE_INTERP_DELAY_MS } from "@jadethrone/shared";
import { MonsterRegistry, type MonsterData } from "../src/state/monsterRegistry";
import { levelRelation, monsterNameColor, LEVEL_COLORS } from "../src/world/levelColors";

function monster(overrides: Partial<MonsterData> = {}): MonsterData {
  return {
    typeId: "wild_dog",
    name: "Wild Dog",
    level: 1,
    x: 0,
    y: 0,
    facing: 0,
    hp: 28,
    maxHp: 28,
    moving: false,
    isBoss: false,
    ...overrides,
  };
}

describe("MonsterRegistry", () => {
  it("interpolates between patches 100 ms in the past", () => {
    const registry = new MonsterRegistry();
    registry.sync([["m1", monster({ x: 0 })]], 0);
    registry.sync([["m1", monster({ x: 100 })]], 100);

    const halfway = registry.renderPosition(
      registry.entities.get("m1")!,
      100 + REMOTE_INTERP_DELAY_MS / 2,
    );
    expect(halfway?.x).toBeCloseTo(50, 5);
    const latest = registry.renderPosition(
      registry.entities.get("m1")!,
      200 + REMOTE_INTERP_DELAY_MS,
    );
    expect(latest?.x).toBeCloseTo(100, 5);
  });

  it("updates mutable fields and removes entities that left the view", () => {
    const registry = new MonsterRegistry();
    registry.sync(
      [
        ["m1", monster({ hp: 10 })],
        ["m2", monster({ typeId: "gray_wolf" })],
      ],
      0,
    );
    expect(registry.entities.size).toBe(2);
    expect(registry.entities.get("m1")?.hp).toBe(10);

    const { removed } = registry.sync([["m1", monster({ hp: 5 })]], 50);
    expect(removed).toEqual(["m2"]);
    expect(registry.entities.has("m2")).toBe(false);
    expect(registry.entities.get("m1")?.hp).toBe(5);
  });

  it("clears the buffer on a long teleport", () => {
    const registry = new MonsterRegistry();
    registry.sync([["m1", monster({ x: 0 })]], 0);
    registry.sync([["m1", monster({ x: 500 })]], 100);
    const rendered = registry.renderPosition(
      registry.entities.get("m1")!,
      150 + REMOTE_INTERP_DELAY_MS,
    );
    expect(rendered?.x).toBeCloseTo(500, 5);
  });
});

describe("level colours", () => {
  it("uses the grey/white/yellow/red level bands", () => {
    expect(levelRelation(1, 6)).toBe("gray");
    expect(levelRelation(2, 6)).toBe("white");
    expect(levelRelation(7, 6)).toBe("yellow");
    expect(levelRelation(11, 6)).toBe("red");
  });

  it("returns the matching hex colour", () => {
    expect(monsterNameColor(11, 6)).toBe(LEVEL_COLORS.red);
    expect(monsterNameColor(7, 6)).toBe(LEVEL_COLORS.yellow);
    expect(monsterNameColor(6, 6)).toBe(LEVEL_COLORS.white);
    expect(monsterNameColor(1, 6)).toBe(LEVEL_COLORS.gray);
  });
});

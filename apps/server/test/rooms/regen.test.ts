import { describe, expect, it } from "vitest";
import { TICK_MS } from "@jadethrone/shared";
import { PlayerState, WorldState } from "../../src/rooms/state/WorldState";
import { createPlayerRuntime, type PlayerRuntime } from "../../src/rooms/playerRuntime";
import { applyRegenTick } from "../../src/rooms/regen";

function setup(): { runtime: PlayerRuntime; player: PlayerState } {
  const state = new WorldState();
  const runtime = createPlayerRuntime(
    { x: 100, y: 100 },
    {
      accountId: "a1",
      characterId: "c1",
      tokenVersion: 0,
      progression: {
        hp: 100,
        maxHp: 316,
        mp: 10,
        maxMp: 92,
        level: 1,
        xp: 0,
        stats: { vit: 4, int: 3, str: 6, dex: 3 },
        statPoints: 0,
      },
    },
  );
  const player = new PlayerState();
  player.classId = "warrior";
  player.hp = 100;
  player.maxHp = 316;
  player.mp = 10;
  player.maxMp = 92;
  player.dead = false;
  state.players.set("s1", player);
  return { runtime, player };
}

function ticks(runtime: PlayerRuntime, player: PlayerState, count: number, now: number): boolean {
  let changed = false;
  for (let index = 0; index < count; index++) {
    changed = applyRegenTick(runtime, player, now) || changed;
  }
  return changed;
}

describe("applyRegenTick", () => {
  it("regenerates 2% HP and 2% MP every 3 seconds out of combat", () => {
    const { runtime, player } = setup();
    const now = 100_000;
    const changed = ticks(runtime, player, 60, now);

    expect(changed).toBe(true);
    expect(runtime.progression.hp).toBe(106); // +round(316 * 0.02) = +6
    expect(runtime.progression.mp).toBe(12); // +round(92 * 0.02) = +2
    expect(player.hp).toBe(106);
    expect(player.mp).toBe(12);
    expect(runtime.regenAccumMs).toBe(0);
  });

  it("uses the in-combat 0.5% HP rate", () => {
    const { runtime } = setup();
    runtime.lastCombatAtMs = 99_000;
    ticks(runtime, setupPlayerFor(runtime), 60, 100_000);
    expect(runtime.progression.hp).toBe(102); // +round(316 * 0.005) = +2
  });

  it("never overheals and clamps MP", () => {
    const { runtime, player } = setup();
    runtime.progression.hp = 315;
    runtime.progression.mp = 91;
    ticks(runtime, player, 60, 100_000);
    expect(runtime.progression.hp).toBe(316);
    expect(runtime.progression.mp).toBe(92);
  });

  it("skips dead and warping players and resets their accumulator", () => {
    const { runtime, player } = setup();
    ticks(runtime, player, 59, 100_000);
    expect(runtime.regenAccumMs).toBe(TICK_MS * 59);

    runtime.dead = true;
    expect(applyRegenTick(runtime, player, 100_000)).toBe(false);
    expect(runtime.regenAccumMs).toBe(0);
    ticks(runtime, player, 59, 100_000);
    expect(runtime.progression.hp).toBe(100); // not yet a full interval

    runtime.dead = false;
    runtime.warping = true;
    ticks(runtime, player, 60, 100_000);
    expect(runtime.progression.hp).toBe(100);
    expect(runtime.regenAccumMs).toBe(0);
  });

  it("carries the remainder between intervals", () => {
    const { runtime, player } = setup();
    ticks(runtime, player, 65, 100_000);
    expect(runtime.regenAccumMs).toBe(TICK_MS * 5);
    ticks(runtime, player, 55, 100_000);
    expect(runtime.regenAccumMs).toBe(0);
    expect(runtime.progression.hp).toBe(112); // two intervals
  });
});

function setupPlayerFor(runtime: PlayerRuntime): PlayerState {
  const player = new PlayerState();
  player.classId = "warrior";
  player.hp = runtime.progression.hp;
  player.maxHp = runtime.progression.maxHp;
  player.mp = runtime.progression.mp;
  player.maxMp = runtime.progression.maxMp;
  player.dead = false;
  return player;
}

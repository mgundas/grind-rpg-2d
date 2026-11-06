import { describe, expect, it } from "vitest";
import type { CollisionGrid, Vec2 } from "@jadethrone/shared";
import { MonsterState } from "../../src/rooms/state/WorldState";
import { createMonsterRuntime, type MonsterRuntime } from "../../src/rooms/monsterRuntime";
import {
  aggroMonster,
  stepMonsterAi,
  type AiContext,
  type AiPlayerSnapshot,
  type MonsterAiSpec,
} from "../../src/rooms/monsterAi";

const HOME: Vec2 = { x: 176, y: 176 };

const spec: MonsterAiSpec = {
  moveSpeed: 100,
  attackRange: 32,
  attackCooldownMs: 1000,
  aggroType: "aggressive",
  aggroRange: 200,
  leashRange: 400,
};

function grid(solidTiles: Array<[number, number]> = []): CollisionGrid {
  const width = 20;
  const height = 20;
  const solid = new Uint8Array(width * height);
  for (const [x, y] of solidTiles) {
    solid[y * width + x] = 1;
  }
  return { width, height, tileSize: 32, solid };
}

function runtime(overrides: Partial<MonsterRuntime> = {}): MonsterRuntime {
  const created = createMonsterRuntime({
    id: "m1",
    typeId: "wild_dog",
    groupId: "field_wolves",
    home: HOME,
    maxHp: 100,
    generation: 1,
    spawnIndex: 0,
    now: 0,
  });
  return { ...created, ...overrides };
}

function stateFor(monster: MonsterRuntime): MonsterState {
  const state = new MonsterState();
  state.typeId = monster.typeId;
  state.name = "Wild Dog";
  state.level = 1;
  state.x = monster.mover.pos.x;
  state.y = monster.mover.pos.y;
  state.facing = 0;
  state.hp = monster.hp;
  state.maxHp = monster.maxHp;
  state.moving = false;
  state.isBoss = false;
  return state;
}

function player(
  sessionId: string,
  pos: Vec2,
  flags: Partial<Pick<AiPlayerSnapshot, "dead" | "warping">> = {},
): AiPlayerSnapshot {
  return { sessionId, pos, dead: flags.dead ?? false, warping: flags.warping ?? false };
}

interface Harness {
  ctx: AiContext;
  budget: { remaining: number; calls: number };
  rngCalls: { count: number };
}

function context(
  players: AiPlayerSnapshot[] = [],
  options: {
    now?: number;
    map?: CollisionGrid;
    rng?: () => number;
    budget?: number;
  } = {},
): Harness {
  const budget = { remaining: options.budget ?? 10, calls: 0 };
  const rngCalls = { count: 0 };
  const rng = options.rng ?? (() => 0.5);
  const ctx: AiContext = {
    grid: options.map ?? grid(),
    now: options.now ?? 0,
    players,
    takeAstar: () => {
      if (budget.remaining <= 0) {
        return false;
      }
      budget.remaining--;
      budget.calls++;
      return true;
    },
    rng: () => {
      rngCalls.count++;
      return rng();
    },
  };
  return { ctx, budget, rngCalls };
}

describe("monster AI — aggro and sleep", () => {
  it("an aggressive monster chases a nearby player", () => {
    const monster = runtime();
    const state = stateFor(monster);
    const { ctx } = context([player("p1", { x: 216, y: 176 })]);
    const result = stepMonsterAi(ctx, monster, state, spec);

    expect(monster.ai).toBe("chase");
    expect(monster.targetSessionId).toBe("p1");
    expect(monster.mover.pos.x).toBeGreaterThan(HOME.x);
    expect(state.moving).toBe(true);
    expect(result.attackTargetId).toBeUndefined();
  });

  it("a passive monster ignores proximity aggro", () => {
    const monster = runtime();
    const state = stateFor(monster);
    const { ctx } = context([player("p1", { x: 216, y: 176 })]);
    stepMonsterAi(ctx, monster, state, { ...spec, aggroType: "passive" });

    expect(monster.ai).toBe("idle");
    expect(monster.targetSessionId).toBeNull();
    expect(monster.mover.pos).toEqual(HOME);
  });

  it("sleeps with no living player nearby without consuming RNG or moving", () => {
    const monster = runtime();
    const state = stateFor(monster);
    const summoner = context([], { now: 10_000 });
    stepMonsterAi(summoner.ctx, monster, state, { ...spec, aggroType: "passive" });

    expect(monster.ai).toBe("idle");
    expect(monster.mover.pos).toEqual(HOME);
    expect(state.moving).toBe(false);
    expect(summoner.rngCalls.count).toBe(0);
    expect(summoner.budget.calls).toBe(0);
  });

  it("ignores dead and warping players", () => {
    const monster = runtime();
    const state = stateFor(monster);
    const { ctx } = context([
      player("dead", { x: 196, y: 176 }, { dead: true }),
      player("warping", { x: 196, y: 176 }, { warping: true }),
    ]);
    stepMonsterAi(ctx, monster, state, spec);

    expect(monster.ai).toBe("idle");
    expect(monster.targetSessionId).toBeNull();
  });

  it("picks the lower session id on an equal-distance tie", () => {
    const monster = runtime();
    const state = stateFor(monster);
    const { ctx } = context([player("b", { x: 226, y: 176 }), player("a", { x: 176, y: 226 })]);
    stepMonsterAi(ctx, monster, state, spec);

    expect(monster.targetSessionId).toBe("a");
  });

  it("keeps the current target instead of switching to a closer player", () => {
    const monster = runtime({ ai: "chase", targetSessionId: "a" });
    const state = stateFor(monster);
    const { ctx } = context([player("a", { x: 276, y: 176 }), player("z", { x: 196, y: 176 })]);
    stepMonsterAi(ctx, monster, state, spec);

    expect(monster.targetSessionId).toBe("a");
  });
});

describe("monster AI — leash and return", () => {
  it("leashes when the chase carries it beyond leashRange", () => {
    const monster = runtime({
      ai: "chase",
      targetSessionId: "p1",
      mover: { ...runtime().mover, pos: { x: HOME.x + 450, y: HOME.y } },
    });
    const state = stateFor(monster);
    const { ctx } = context([player("p1", { x: HOME.x + 500, y: HOME.y })]);
    stepMonsterAi(ctx, monster, state, spec);

    expect(monster.ai).toBe("return");
    expect(monster.targetSessionId).toBeNull();
  });

  it("does not re-leash or retarget while returning", () => {
    const monster = runtime({
      ai: "return",
      mover: { ...runtime().mover, pos: { x: HOME.x + 300, y: HOME.y } },
    });
    const state = stateFor(monster);
    const { ctx } = context([player("p1", { x: HOME.x + 320, y: HOME.y })]);
    stepMonsterAi(ctx, monster, state, spec);

    expect(monster.ai).toBe("return");
    expect(monster.targetSessionId).toBeNull();
  });

  it("heals to full and becomes idle on reaching home", () => {
    const monster = runtime({
      ai: "return",
      hp: 5,
      mover: { ...runtime().mover, pos: { x: HOME.x + 10, y: HOME.y } },
    });
    const state = stateFor(monster);
    const { ctx } = context([]);
    const result = stepMonsterAi(ctx, monster, state, spec);

    expect(result.arrivedHome).toBe(true);
    expect(monster.ai).toBe("idle");
    expect(monster.hp).toBe(100);
    expect(state.hp).toBe(100);
    expect(monster.mover.pos).toEqual(HOME);
  });

  it("damage cannot aggro a returning monster", () => {
    const monster = runtime({ ai: "return" });
    aggroMonster(monster, "p1");
    expect(monster.ai).toBe("return");
    expect(monster.targetSessionId).toBeNull();
  });
});

describe("monster AI — attack range and cooldown", () => {
  it("attacks on cooldown and faces the target", () => {
    const monster = runtime({ ai: "attack", targetSessionId: "p1" });
    const state = stateFor(monster);
    const harness = context([player("p1", { x: 196, y: 176 })], { now: 0 });

    const first = stepMonsterAi(harness.ctx, monster, state, spec);
    expect(first.attackTargetId).toBe("p1");
    expect(monster.attackReadyAtMs).toBe(1000);
    expect(state.facing).toBe(2); // right

    harness.ctx.now = 500;
    expect(stepMonsterAi(harness.ctx, monster, state, spec).attackTargetId).toBeUndefined();

    harness.ctx.now = 1000;
    expect(stepMonsterAi(harness.ctx, monster, state, spec).attackTargetId).toBe("p1");
  });

  it("uses hysteresis when leaving attack range", () => {
    const monster = runtime({ ai: "attack", targetSessionId: "p1" });
    const state = stateFor(monster);
    const staying = context([player("p1", { x: 216, y: 176 })]); // 40 = range + 8
    stepMonsterAi(staying.ctx, monster, state, spec);
    expect(monster.ai).toBe("attack");

    const leaving = context([player("p1", { x: 226, y: 176 })]); // 50 > range + 16
    stepMonsterAi(leaving.ctx, monster, state, spec);
    expect(monster.ai).toBe("chase");
  });
});

describe("monster AI — pathing", () => {
  it("throttles repaths until the target changes tile", () => {
    const monster = runtime({ ai: "chase", targetSessionId: "p1" });
    const state = stateFor(monster);
    const harness = context([player("p1", { x: 276, y: 176 })], { now: 0 });

    stepMonsterAi(harness.ctx, monster, state, spec);
    expect(harness.budget.calls).toBe(1);

    harness.ctx.now = 50;
    stepMonsterAi(harness.ctx, monster, state, spec);
    expect(harness.budget.calls).toBe(1); // same tile + throttle

    harness.ctx.now = 500;
    harness.ctx.players = [player("p1", { x: 340, y: 176 })]; // changed tile
    stepMonsterAi(harness.ctx, monster, state, spec);
    expect(harness.budget.calls).toBe(2);
  });

  it("returns home after three consecutive failed paths", () => {
    const walls: Array<[number, number]> = [];
    for (let y = 7; y <= 13; y++) {
      for (let x = 7; x <= 13; x++) {
        walls.push([x, y]);
      }
    }
    const monster = runtime({
      ai: "chase",
      targetSessionId: "p1",
      mover: { ...runtime().mover, pos: { x: 276, y: 176 } },
    });
    const state = stateFor(monster);
    const harness = context([player("p1", { x: 336, y: 336 })], {
      map: grid(walls),
    });

    stepMonsterAi(harness.ctx, monster, state, spec);
    harness.ctx.now = 500;
    stepMonsterAi(harness.ctx, monster, state, spec);
    harness.ctx.now = 1000;
    stepMonsterAi(harness.ctx, monster, state, spec);

    expect(monster.ai).toBe("return");
    expect(monster.failedRepaths).toBe(0);
  });

  it("does not count a budget-denied repath as a failure", () => {
    const monster = runtime({ ai: "chase", targetSessionId: "p1" });
    const state = stateFor(monster);
    const harness = context([player("p1", { x: 276, y: 176 })], { budget: 0 });

    stepMonsterAi(harness.ctx, monster, state, spec);

    expect(monster.ai).toBe("chase");
    expect(monster.failedRepaths).toBe(0);
    expect(harness.budget.calls).toBe(0);
  });

  it("retargets when the target disappears, or goes home for a passive monster", () => {
    const aggressive = runtime({ ai: "chase", targetSessionId: "gone" });
    const state = stateFor(aggressive);
    const harness = context([player("p2", { x: 226, y: 176 })]);
    stepMonsterAi(harness.ctx, aggressive, state, spec);
    expect(aggressive.targetSessionId).toBe("p2");

    const passive = runtime({
      ai: "chase",
      targetSessionId: "gone",
      mover: { ...runtime().mover, pos: { x: 276, y: 176 } },
    });
    const passiveState = stateFor(passive);
    stepMonsterAi(harness.ctx, passive, passiveState, { ...spec, aggroType: "passive" });
    expect(passive.ai).toBe("return");
    expect(passive.targetSessionId).toBeNull();
  });
});

describe("monster AI — idle wander", () => {
  it("wanders to a walkable point near home", () => {
    const monster = runtime();
    const state = stateFor(monster);
    // Player is close enough to keep the monster awake but outside aggro range.
    const harness = context([player("p1", { x: HOME.x + 300, y: HOME.y })], {
      now: 4000,
      rng: () => 0.5,
    });

    stepMonsterAi(harness.ctx, monster, state, { ...spec, aggroType: "passive" });

    expect(monster.ai).toBe("idle");
    expect(monster.nextWanderAtMs).toBeGreaterThan(4000);
    expect(harness.budget.calls).toBe(1);
    expect(monster.mover.pos.x).toBeLessThan(HOME.x);
    expect(state.moving).toBe(true);
  });

  it("reschedules without moving when no wander point is reachable", () => {
    const solid: Array<[number, number]> = [];
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        solid.push([x, y]);
      }
    }
    // Keep the monster's own tile walkable so the AI can consider wandering.
    const walkableOwnTile = solid.filter(([x, y]) => !(x === 5 && y === 5));
    const monster = runtime({ ai: "idle" });
    const state = stateFor(monster);
    const harness = context([player("p1", { x: HOME.x + 300, y: HOME.y })], {
      now: 4000,
      rng: () => 0.5,
      map: grid(walkableOwnTile),
    });

    stepMonsterAi(harness.ctx, monster, state, { ...spec, aggroType: "passive" });

    expect(monster.failedRepaths).toBe(0);
    expect(monster.mover.pos).toEqual(HOME);
    expect(monster.nextWanderAtMs).toBeGreaterThan(4000);
  });
});

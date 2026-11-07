import { describe, expect, it } from "vitest";
import type { RandomSource, Vec2 } from "@jadethrone/shared";
import { getMonster } from "@jadethrone/data/monsters";
import { MonsterState, PlayerState, WorldState } from "../../src/rooms/state/WorldState";
import { createPlayerRuntime, type PlayerRuntime } from "../../src/rooms/playerRuntime";
import { createMonsterRuntime, type MonsterRuntime } from "../../src/rooms/monsterRuntime";
import type { StoneRuntime } from "../../src/rooms/stoneManager";
import {
  resolvePlayerSwing,
  resolveMonsterAttack,
  type CombatContext,
} from "../../src/rooms/combat";

const PLAYER_POS: Vec2 = { x: 200, y: 200 };

function fixed(values: number[]): RandomSource {
  let index = 0;
  return {
    next: () => values[Math.min(index++, values.length - 1)] ?? 0,
  };
}

function makePlayer(
  state: WorldState,
  options: { classId?: string; pos?: Vec2; dead?: boolean; warping?: boolean } = {},
): PlayerRuntime {
  const pos = options.pos ?? PLAYER_POS;
  const runtime = createPlayerRuntime(pos, {
    accountId: "a1",
    characterId: "c1",
    tokenVersion: 0,
    progression: {
      hp: 316,
      maxHp: 316,
      mp: 92,
      maxMp: 92,
      level: 1,
      xp: 0,
      stats: { vit: 4, int: 3, str: 6, dex: 3 },
      statPoints: 0,
      doctrine: null,
      skillPoints: 0,
      skills: {},
    },
  });
  runtime.dead = options.dead ?? false;
  runtime.warping = options.warping ?? false;

  const player = new PlayerState();
  player.characterId = "c1";
  player.name = "Hero";
  player.kingdom = "ember";
  player.classId = options.classId ?? "warrior";
  player.gender = "male";
  player.hairStyle = 0;
  player.hairColor = 0;
  player.level = 1;
  player.x = pos.x;
  player.y = pos.y;
  player.facing = 2;
  player.moving = false;
  player.lastSeq = 0;
  player.hp = 316;
  player.maxHp = 316;
  player.mp = 92;
  player.maxMp = 92;
  player.dead = false;
  state.players.set("s1", player);
  return runtime;
}

function addMonster(
  state: WorldState,
  runtimes: Map<string, MonsterRuntime>,
  id: string,
  typeId: string,
  pos: Vec2,
  hp?: number,
): MonsterRuntime {
  const spec = getMonster(typeId);
  const runtime = createMonsterRuntime({
    id,
    typeId,
    groupId: "field_wolves",
    home: pos,
    maxHp: spec.hp,
    generation: 0,
    spawnIndex: 0,
    now: 0,
  });
  runtime.mover.pos = { x: pos.x, y: pos.y };
  if (hp !== undefined) {
    runtime.hp = hp;
  }

  const monster = new MonsterState();
  monster.typeId = spec.id;
  monster.name = spec.name;
  monster.level = spec.level;
  monster.x = pos.x;
  monster.y = pos.y;
  monster.facing = 0;
  monster.hp = runtime.hp;
  monster.maxHp = spec.hp;
  monster.moving = false;
  monster.isBoss = spec.isBoss;
  state.monsters.set(id, monster);
  runtimes.set(id, runtime);
  return runtime;
}

function context(
  state: WorldState,
  runtimes: Map<string, PlayerRuntime>,
  monsters: Map<string, MonsterRuntime>,
  values: number[],
  now = 0,
  stones: Map<string, StoneRuntime> = new Map(),
): CombatContext {
  return {
    now,
    rng: fixed(values),
    state,
    runtimes,
    monsterRuntimes: monsters,
    stoneRuntimes: stones,
  };
}

function addStone(
  stones: Map<string, StoneRuntime>,
  id: string,
  pos: Vec2,
  hp = 12_000,
): StoneRuntime {
  const runtime: StoneRuntime = {
    stoneId: id,
    infoId: "ember_fields_stone",
    zoneId: "fields_stones",
    x: pos.x,
    y: pos.y,
    hp,
    maxHp: 12_000,
    damageBy: new Map(),
    nextWaveIndex: 0,
  };
  stones.set(id, runtime);
  return runtime;
}

describe("resolvePlayerSwing", () => {
  it("hits the nearest target and mirrors HP into the schema", () => {
    const state = new WorldState();
    const runtimes = new Map<string, PlayerRuntime>();
    const monsters = new Map<string, MonsterRuntime>();
    runtimes.set("s1", makePlayer(state));
    addMonster(state, monsters, "m1", "wild_dog", { x: 230, y: 200 });

    const outcome = resolvePlayerSwing(context(state, runtimes, monsters, [0, 0.5, 0.9]), "s1", 0);

    expect(outcome).not.toBeNull();
    expect(outcome!.hits).toHaveLength(1);
    expect(outcome!.hits[0]).toMatchObject({
      target: { kind: "monster", monsterId: "m1" },
      miss: false,
      crit: false,
      damage: 14,
    });
    expect(monsters.get("m1")!.hp).toBe(14);
    expect(state.monsters.get("m1")!.hp).toBe(14);
    expect(outcome!.damagedMonsterIds).toEqual(["m1"]);
    expect(runtimes.get("s1")!.lastCombatAtMs).toBe(0);
  });

  it("records a miss without damage or combat time", () => {
    const state = new WorldState();
    const runtimes = new Map<string, PlayerRuntime>();
    const monsters = new Map<string, MonsterRuntime>();
    runtimes.set("s1", makePlayer(state));
    addMonster(state, monsters, "m1", "wild_dog", { x: 230, y: 200 });

    const outcome = resolvePlayerSwing(context(state, runtimes, monsters, [0.99]), "s1", 0);

    expect(outcome!.hits[0]?.miss).toBe(true);
    expect(outcome!.hits[0]?.damage).toBe(0);
    expect(monsters.get("m1")!.hp).toBe(28);
    expect(outcome!.damagedMonsterIds).toEqual([]);
    expect(runtimes.get("s1")!.lastCombatAtMs).toBe(0);
  });

  it("doubles crit damage and reports a kill at zero HP", () => {
    const state = new WorldState();
    const runtimes = new Map<string, PlayerRuntime>();
    const monsters = new Map<string, MonsterRuntime>();
    runtimes.set("s1", makePlayer(state));
    const monster = addMonster(state, monsters, "m1", "wild_dog", { x: 230, y: 200 }, 20);

    const outcome = resolvePlayerSwing(context(state, runtimes, monsters, [0, 0.5, 0]), "s1", 0);

    expect(outcome!.hits[0]).toMatchObject({ crit: true, damage: 28 });
    expect(monster.hp).toBe(0);
    expect(state.monsters.get("m1")!.hp).toBe(0);
    expect(outcome!.killed).toEqual([
      { monsterId: "m1", typeId: "wild_dog", x: 230, y: 200, ownerSessionId: "s1" },
    ]);
  });

  it("enforces the class cooldown and only sets it on accepted swings", () => {
    const state = new WorldState();
    const runtimes = new Map<string, PlayerRuntime>();
    const monsters = new Map<string, MonsterRuntime>();
    const runtime = makePlayer(state);
    runtimes.set("s1", runtime);
    addMonster(state, monsters, "m1", "wild_dog", { x: 230, y: 200 });

    const first = resolvePlayerSwing(context(state, runtimes, monsters, [0, 0.5, 0.9], 0), "s1", 0);
    expect(first).not.toBeNull();
    expect(runtime.attackReadyAtMs).toBe(900);

    expect(
      resolvePlayerSwing(context(state, runtimes, monsters, [0, 0.5, 0.9], 100), "s1", 0),
    ).toBeNull();
    expect(
      resolvePlayerSwing(context(state, runtimes, monsters, [0, 0.5, 0.9], 900), "s1", 0),
    ).not.toBeNull();
  });

  it("rejects dead, warping and unknown players", () => {
    const state = new WorldState();
    const runtimes = new Map<string, PlayerRuntime>();
    const monsters = new Map<string, MonsterRuntime>();
    const runtime = makePlayer(state);
    runtimes.set("s1", runtime);

    runtime.dead = true;
    expect(resolvePlayerSwing(context(state, runtimes, monsters, [0]), "s1", 0)).toBeNull();

    runtime.dead = false;
    runtime.warping = true;
    expect(resolvePlayerSwing(context(state, runtimes, monsters, [0]), "s1", 0)).toBeNull();

    expect(resolvePlayerSwing(context(state, runtimes, monsters, [0]), "nope", 0)).toBeNull();
  });

  it("skips returning monsters and monsters already at zero HP", () => {
    const state = new WorldState();
    const runtimes = new Map<string, PlayerRuntime>();
    const monsters = new Map<string, MonsterRuntime>();
    runtimes.set("s1", makePlayer(state));
    addMonster(state, monsters, "returning", "wild_dog", { x: 220, y: 200 }).ai = "return";
    addMonster(state, monsters, "dead", "wild_dog", { x: 225, y: 200 }, 0);

    const outcome = resolvePlayerSwing(context(state, runtimes, monsters, [0, 0.5, 0.9]), "s1", 0);

    expect(outcome!.hits).toEqual([]);
    expect(outcome!.killed).toEqual([]);
  });

  it("selects every target in the arc but not the one behind", () => {
    const state = new WorldState();
    const runtimes = new Map<string, PlayerRuntime>();
    const monsters = new Map<string, MonsterRuntime>();
    runtimes.set("s1", makePlayer(state));
    addMonster(state, monsters, "near", "wild_dog", { x: 230, y: 200 });
    addMonster(state, monsters, "far", "wild_dog", { x: 250, y: 210 });
    addMonster(state, monsters, "behind", "wild_dog", { x: 160, y: 200 });

    const outcome = resolvePlayerSwing(
      context(state, runtimes, monsters, [0, 0.5, 0.9, 0, 0.5, 0.9]),
      "s1",
      0,
    );

    const ids = outcome!.hits.map((hit) =>
      hit.target.kind === "monster" ? hit.target.monsterId : "player",
    );
    expect(ids).toEqual(["near", "far"]);
    expect(outcome!.damagedMonsterIds).toEqual(["near", "far"]);
  });

  it("sets the supplied direction as the visible facing", () => {
    const state = new WorldState();
    const runtimes = new Map<string, PlayerRuntime>();
    const monsters = new Map<string, MonsterRuntime>();
    runtimes.set("s1", makePlayer(state));

    resolvePlayerSwing(context(state, runtimes, monsters, [0], 0), "s1", 6);

    expect(state.players.get("s1")!.facing).toBe(3); // up
  });
});

describe("resolveMonsterAttack", () => {
  function setup(runtimeOverrides: Partial<MonsterRuntime> = {}) {
    const state = new WorldState();
    const runtimes = new Map<string, PlayerRuntime>();
    const monsters = new Map<string, MonsterRuntime>();
    const playerRuntime = makePlayer(state);
    runtimes.set("s1", playerRuntime);
    const monsterRuntime = addMonster(state, monsters, "m1", "wild_dog", { x: 230, y: 200 });
    Object.assign(monsterRuntime, runtimeOverrides);
    return { state, runtimes, monsters, playerRuntime, monsterRuntime };
  }

  it("damages the player with VIT defense and sets combat time", () => {
    const { state, runtimes, monsters, playerRuntime } = setup();
    const outcome = resolveMonsterAttack(
      context(state, runtimes, monsters, [0, 0.5, 0.9], 1000),
      "m1",
      "s1",
    );

    expect(outcome).not.toBeNull();
    expect(outcome!.hit).toMatchObject({ miss: false, crit: false, damage: 9 });
    expect(playerRuntime.progression.hp).toBe(307);
    expect(state.players.get("s1")!.hp).toBe(307);
    expect(playerRuntime.lastCombatAtMs).toBe(1000);
    expect(outcome!.victimDead).toBe(false);
  });

  it("records a miss and doubles crit damage", () => {
    const miss = setup();
    const missed = resolveMonsterAttack(
      context(miss.state, miss.runtimes, miss.monsters, [0.99]),
      "m1",
      "s1",
    );
    expect(missed!.hit.miss).toBe(true);
    expect(miss.playerRuntime.progression.hp).toBe(316);

    const crit = setup();
    const critical = resolveMonsterAttack(
      context(crit.state, crit.runtimes, crit.monsters, [0, 0.5, 0]),
      "m1",
      "s1",
    );
    expect(critical!.hit).toMatchObject({ crit: true, damage: 18 });
  });

  it("reports a killing blow and clamps HP at zero", () => {
    const { state, runtimes, monsters, playerRuntime } = setup();
    playerRuntime.progression.hp = 5;
    state.players.get("s1")!.hp = 5;

    const outcome = resolveMonsterAttack(
      context(state, runtimes, monsters, [0, 0.5, 0.9]),
      "m1",
      "s1",
    );

    expect(outcome!.victimDead).toBe(true);
    expect(playerRuntime.progression.hp).toBe(0);
    expect(state.players.get("s1")!.hp).toBe(0);
  });

  it("rejects dead, warping, returning and removed combatants", () => {
    const dead = setup();
    dead.playerRuntime.dead = true;
    expect(
      resolveMonsterAttack(context(dead.state, dead.runtimes, dead.monsters, [0]), "m1", "s1"),
    ).toBeNull();

    const warping = setup();
    warping.playerRuntime.warping = true;
    expect(
      resolveMonsterAttack(
        context(warping.state, warping.runtimes, warping.monsters, [0]),
        "m1",
        "s1",
      ),
    ).toBeNull();

    const returning = setup({ ai: "return" });
    expect(
      resolveMonsterAttack(
        context(returning.state, returning.runtimes, returning.monsters, [0]),
        "m1",
        "s1",
      ),
    ).toBeNull();

    expect(
      resolveMonsterAttack(context(dead.state, dead.runtimes, dead.monsters, [0]), "nope", "s1"),
    ).toBeNull();
  });
});

describe("resolvePlayerSwing against spirit stones", () => {
  it("returns a stone hit without mutating stone HP or damage credit", () => {
    const state = new WorldState();
    const runtimes = new Map<string, PlayerRuntime>();
    const monsters = new Map<string, MonsterRuntime>();
    const stones = new Map<string, StoneRuntime>();
    const player = makePlayer(state);
    runtimes.set("s1", player);
    const stone = addStone(stones, "stone-1", { x: 230, y: 200 });

    const outcome = resolvePlayerSwing(
      context(state, runtimes, monsters, [0.5, 0.9], 100, stones),
      "s1",
      0,
    );

    expect(outcome?.stoneHits).toHaveLength(1);
    expect(outcome?.stoneHits[0]).toMatchObject({
      target: { kind: "stone", stoneId: "stone-1" },
      miss: false,
      crit: false,
      damage: 10,
    });
    expect(outcome?.hits).toContain(outcome?.stoneHits[0]);
    expect(outcome?.killed).toEqual([]);
    expect(outcome?.damagedMonsterIds).toEqual([]);
    expect(stone.hp).toBe(12_000);
    expect(stone.damageBy.size).toBe(0);
    expect(player.lastCombatAtMs).toBe(100);
  });

  it("crits stones using their defense and no hit roll", () => {
    const state = new WorldState();
    const runtimes = new Map<string, PlayerRuntime>();
    runtimes.set("s1", makePlayer(state));
    const stones = new Map<string, StoneRuntime>();
    addStone(stones, "stone-1", { x: 230, y: 200 });

    const outcome = resolvePlayerSwing(
      context(state, runtimes, new Map(), [0, 0], 0, stones),
      "s1",
      0,
    );
    expect(outcome?.stoneHits[0]).toMatchObject({ crit: true, damage: 16 });
  });

  it("can hit a monster and a stone with the same raw id", () => {
    const state = new WorldState();
    const runtimes = new Map<string, PlayerRuntime>();
    const monsters = new Map<string, MonsterRuntime>();
    const stones = new Map<string, StoneRuntime>();
    runtimes.set("s1", makePlayer(state));
    addMonster(state, monsters, "shared", "wild_dog", { x: 220, y: 200 });
    addStone(stones, "shared", { x: 240, y: 200 });

    const outcome = resolvePlayerSwing(
      context(state, runtimes, monsters, [0.5, 0.9, 0.5, 0.9], 0, stones),
      "s1",
      0,
    );
    const kinds = outcome?.hits.map((hit) => hit.target.kind).sort();
    expect(kinds).toEqual(["monster", "stone"]);
  });

  it("ignores stones behind the player or out of range", () => {
    const state = new WorldState();
    const runtimes = new Map<string, PlayerRuntime>();
    runtimes.set("s1", makePlayer(state));
    const stones = new Map<string, StoneRuntime>();
    addStone(stones, "behind", { x: 150, y: 200 });
    const far = addStone(stones, "far", { x: 400, y: 200 });

    const outcome = resolvePlayerSwing(
      context(state, runtimes, new Map(), [0.5, 0.9], 0, stones),
      "s1",
      0,
    );
    expect(outcome?.stoneHits).toEqual([]);
    expect(outcome?.hits).toEqual([]);
    expect(far.hp).toBe(12_000);
  });
});

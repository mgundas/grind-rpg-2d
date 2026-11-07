import { describe, expect, it } from "vitest";
import type { ClassId, RandomSource, Vec2 } from "@jadethrone/shared";
import { getMonster } from "@jadethrone/data/monsters";
import { getSkill } from "@jadethrone/data/skills";
import { MonsterState, PlayerState, WorldState } from "../../src/rooms/state/WorldState";
import { createPlayerRuntime, type PlayerRuntime } from "../../src/rooms/playerRuntime";
import { createMonsterRuntime, type MonsterRuntime } from "../../src/rooms/monsterRuntime";
import type { StoneRuntime } from "../../src/rooms/stoneManager";
import { resolveSkillCast, type SkillCombatContext } from "../../src/skills/skillCombat";

const POS: Vec2 = { x: 200, y: 200 };

function fixed(values: number[]): RandomSource {
  let index = 0;
  return { next: () => values[Math.min(index++, values.length - 1)] ?? 0 };
}

function makePlayer(
  state: WorldState,
  sessionId: string,
  classId: ClassId = "warrior",
  pos: Vec2 = POS,
): PlayerRuntime {
  const runtime = createPlayerRuntime(pos, {
    accountId: `a-${sessionId}`,
    characterId: `c-${sessionId}`,
    tokenVersion: 0,
    progression: {
      hp: 300,
      maxHp: 300,
      mp: 100,
      maxMp: 100,
      level: 10,
      xp: 0,
      stats: { vit: 10, int: 20, str: 12, dex: 8 },
      statPoints: 0,
      doctrine: classId === "mystic" ? "grace" : classId === "hexblade" ? "dark_arts" : "blade",
      skillPoints: 0,
      skills: {},
    },
  });
  const player = new PlayerState();
  player.characterId = runtime.characterId;
  player.name = sessionId;
  player.kingdom = "ember";
  player.classId = classId;
  player.gender = "male";
  player.hairStyle = 0;
  player.hairColor = 0;
  player.level = 10;
  player.x = pos.x;
  player.y = pos.y;
  player.facing = 2;
  player.hp = 300;
  player.maxHp = 300;
  player.mp = 100;
  player.maxMp = 100;
  state.players.set(sessionId, player);
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
    groupId: "test",
    home: pos,
    maxHp: spec.hp,
    generation: 0,
    spawnIndex: 0,
    now: 0,
  });
  runtime.mover.pos = { x: pos.x, y: pos.y };
  if (hp !== undefined) runtime.hp = hp;
  const monster = new MonsterState();
  monster.typeId = spec.id;
  monster.name = spec.name;
  monster.level = spec.level;
  monster.x = pos.x;
  monster.y = pos.y;
  monster.hp = runtime.hp;
  monster.maxHp = spec.hp;
  state.monsters.set(id, monster);
  runtimes.set(id, runtime);
  return runtime;
}

function addStone(
  stones: Map<string, StoneRuntime>,
  id: string,
  pos: Vec2,
): StoneRuntime {
  const runtime: StoneRuntime = {
    stoneId: id,
    infoId: "ember_fields_stone",
    zoneId: "fields_stones",
    x: pos.x,
    y: pos.y,
    hp: 12_000,
    maxHp: 12_000,
    damageBy: new Map(),
    nextWaveIndex: 0,
  };
  stones.set(id, runtime);
  return runtime;
}

function context(
  state: WorldState,
  runtimes: Map<string, PlayerRuntime>,
  monsters: Map<string, MonsterRuntime>,
  stones: Map<string, StoneRuntime>,
  values: number[],
  now = 1000,
): SkillCombatContext {
  return {
    now,
    rng: fixed(values),
    state,
    runtimes,
    monsterRuntimes: monsters,
    stoneRuntimes: stones,
    grid: {
      width: 40,
      height: 40,
      tileSize: 32,
      solid: new Uint8Array(40 * 40),
    },
  };
}

describe("resolveSkillCast", () => {
  it("hits monsters in the melee arc and ignores those behind", () => {
    const state = new WorldState();
    const runtimes = new Map<string, PlayerRuntime>();
    const monsters = new Map<string, MonsterRuntime>();
    const stones = new Map<string, StoneRuntime>();
    runtimes.set("s1", makePlayer(state, "s1"));
    addMonster(state, monsters, "front", "wild_dog", { x: 250, y: 200 });
    addMonster(state, monsters, "behind", "wild_dog", { x: 150, y: 200 });
    const skill = getSkill("warrior_blade_whirlwind");
    runtimes.get("s1")!.progression.skills[skill.id] = 1;

    const outcome = resolveSkillCast(context(state, runtimes, monsters, stones, [0.5, 0.5, 0.9]), {
      sessionId: "s1",
      skill,
      rank: 1,
    });

    expect(outcome?.hits).toHaveLength(1);
    expect(outcome?.hits[0]?.target).toEqual({ kind: "monster", monsterId: "front" });
    expect(monsters.get("behind")?.hp).toBe(getMonster("wild_dog").hp);
  });

  it("creates buff intents without consuming RNG", () => {
    const state = new WorldState();
    const runtimes = new Map<string, PlayerRuntime>();
    runtimes.set("s1", makePlayer(state, "s1"));
    const skill = getSkill("warrior_blade_berserk");
    const ctx = context(state, runtimes, new Map(), new Map(), []);
    ctx.rng = {
      next: () => {
        throw new Error("buffs must not roll");
      },
    };

    const outcome = resolveSkillCast(ctx, { sessionId: "s1", skill, rank: 1 });
    expect(outcome?.buffs).toHaveLength(1);
    expect(outcome?.buffs[0]?.modifiers).toHaveLength(2);
    expect(outcome?.breaksStealth).toBe(false);
  });

  it("hits stones and monsters together in an area and leaves stone HP untouched", () => {
    const state = new WorldState();
    const runtimes = new Map<string, PlayerRuntime>();
    const monsters = new Map<string, MonsterRuntime>();
    const stones = new Map<string, StoneRuntime>();
    runtimes.set("s1", makePlayer(state, "s1", "hexblade"));
    addMonster(state, monsters, "m1", "wild_dog", { x: 220, y: 200 });
    const stone = addStone(stones, "stone-1", { x: 230, y: 210 });
    const skill = getSkill("hexblade_dark_arts_dark_nova");
    runtimes.get("s1")!.progression.skills[skill.id] = 1;

    const outcome = resolveSkillCast(context(state, runtimes, monsters, stones, [0.5, 0.5, 0.9, 0.5, 0.9]), {
      sessionId: "s1",
      skill,
      rank: 1,
      targetPos: { x: 225, y: 205 },
    });
    expect(outcome?.hits.some((hit) => hit.target.kind === "monster")).toBe(true);
    expect(outcome?.stoneHits).toHaveLength(1);
    expect(stone.hp).toBe(12_000);
  });

  it("emits poison status for a landed melee skill", () => {
    const state = new WorldState();
    const runtimes = new Map<string, PlayerRuntime>();
    const monsters = new Map<string, MonsterRuntime>();
    runtimes.set("s1", makePlayer(state, "s1", "assassin"));
    runtimes.get("s1")!.progression.doctrine = "shadow";
    addMonster(state, monsters, "m1", "wild_dog", { x: 220, y: 200 });
    const skill = getSkill("assassin_shadow_venom_strike");
    runtimes.get("s1")!.progression.skills[skill.id] = 1;

    const outcome = resolveSkillCast(context(state, runtimes, monsters, new Map(), [0.5, 0.5, 0.9]), {
      sessionId: "s1",
      skill,
      rank: 1,
    });
    expect(outcome?.statuses[0]).toMatchObject({
      kind: "poison",
      monsterId: "m1",
      damagePerTick: 4,
      tickMs: 1000,
    });
  });

  it("heals only the caster and party allies", () => {
    const state = new WorldState();
    const runtimes = new Map<string, PlayerRuntime>();
    const first = makePlayer(state, "s1", "mystic");
    const ally = makePlayer(state, "s2", "warrior", { x: 240, y: 200 });
    const outsider = makePlayer(state, "s3", "warrior", { x: 260, y: 200 });
    first.progression.skills.warrior_iron_body_war_cry = 1;
    ally.progression.hp = 200;
    runtimes.set("s1", first);
    runtimes.set("s2", ally);
    runtimes.set("s3", outsider);
    const skill = getSkill("mystic_grace_healing_light");

    const outcome = resolveSkillCast(context(state, runtimes, new Map(), new Map(), []), {
      sessionId: "s1",
      skill,
      rank: 1,
      allySessionId: "s2",
      partySessionIds: ["s2"],
    });
    expect(outcome?.heals.map((heal) => heal.targetSessionId)).toEqual(["s2"]);
    expect(outcome?.heals[0]!.amount).toBeGreaterThan(0);
  });

  it("applies self damage and lifesteal caps", () => {
    const state = new WorldState();
    const runtimes = new Map<string, PlayerRuntime>();
    const monsters = new Map<string, MonsterRuntime>();
    runtimes.set("s1", makePlayer(state, "s1", "hexblade"));
    runtimes.get("s1")!.progression.doctrine = "cursed_steel";
    runtimes.get("s1")!.progression.hp = 20;
    addMonster(state, monsters, "m1", "wild_dog", { x: 230, y: 200 });
    const bloodPrice = getSkill("hexblade_cursed_steel_blood_price");

    const self = resolveSkillCast(context(state, runtimes, monsters, new Map(), []), {
      sessionId: "s1",
      skill: bloodPrice,
      rank: 1,
    });
    expect(self?.selfDamage).toBe(19);

    const soulReap = getSkill("hexblade_cursed_steel_soul_reap");
    const outcome = resolveSkillCast(context(state, runtimes, monsters, new Map(), [0.5, 0.5, 0.9]), {
      sessionId: "s1",
      skill: soulReap,
      rank: 1,
    });
    expect(outcome?.heals.length).toBeGreaterThan(0);
    expect(outcome?.heals[0]!.amount).toBeLessThanOrEqual(19);
  });
});

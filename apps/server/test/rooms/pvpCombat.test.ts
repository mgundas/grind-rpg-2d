import { describe, expect, it } from "vitest";
import type { PvpActor, RandomSource } from "@jadethrone/shared";
import { PlayerState, WorldState } from "../../src/rooms/state/WorldState";
import { createPlayerRuntime, type PlayerRuntime } from "../../src/rooms/playerRuntime";
import {
  applyDamageToPlayer,
  resolvePlayerSwing,
  type CombatContext,
} from "../../src/rooms/combat";

function fixed(values: number[]): RandomSource {
  let index = 0;
  return { next: () => values[Math.min(index++, values.length - 1)] ?? 0 };
}

function player(
  state: WorldState,
  sessionId: string,
  characterId: string,
  x: number,
  actor: PvpActor,
): PlayerRuntime {
  const runtime = createPlayerRuntime(
    { x, y: 200 },
    {
      accountId: `account-${sessionId}`,
      characterId,
      tokenVersion: 0,
      progression: {
        hp: 300,
        maxHp: 300,
        mp: 50,
        maxMp: 50,
        level: 10,
        xp: 0,
        stats: { vit: 10, int: 3, str: 8, dex: 8 },
        statPoints: 0,
        doctrine: null,
        skillPoints: 0,
        skills: {},
      },
    },
  );
  runtime.pvpMode = actor.pvpMode;
  const schema = new PlayerState();
  schema.characterId = characterId;
  schema.name = characterId;
  schema.kingdom = actor.kingdom;
  schema.classId = "warrior";
  schema.gender = "male";
  schema.hairStyle = 0;
  schema.hairColor = 0;
  schema.level = 10;
  schema.x = x;
  schema.y = 200;
  schema.facing = 2;
  schema.hp = 300;
  schema.maxHp = 300;
  schema.mp = 50;
  schema.maxMp = 50;
  schema.dead = false;
  state.players.set(sessionId, schema);
  return runtime;
}

function actors(...entries: Array<[string, PvpActor]>): Map<string, PvpActor> {
  return new Map(entries);
}

function context(
  state: WorldState,
  runtimes: Map<string, PlayerRuntime>,
  actorMap: Map<string, PvpActor>,
  policy = { pvpAllowed: true, safe: false },
): CombatContext {
  return {
    now: 1_000,
    rng: fixed([0, 0.5, 0.9, 0.5]),
    state,
    runtimes,
    monsterRuntimes: new Map(),
    pvp: { policy, actors: actorMap },
  };
}

const ATTACKER: PvpActor = {
  characterId: "char-a",
  kingdom: "ember",
  pvpMode: "free",
};

describe("pvp combat", () => {
  it("includes a hostile player in a swing and applies HP separately", () => {
    const state = new WorldState();
    const runtimes = new Map<string, PlayerRuntime>();
    runtimes.set("s1", player(state, "s1", "char-a", 200, ATTACKER));
    const target: PvpActor = { ...ATTACKER, characterId: "char-b", kingdom: "gale" };
    runtimes.set("s2", player(state, "s2", "char-b", 230, target));
    const ctx = context(state, runtimes, actors(["s1", ATTACKER], ["s2", target]));

    const outcome = resolvePlayerSwing(ctx, "s1", 0)!;
    expect(outcome.playerHits).toHaveLength(1);
    expect(outcome.playerHits[0]?.target).toEqual({ kind: "player", sessionId: "s2" });
    expect(state.players.get("s2")?.hp).toBe(300);

    const applied = applyDamageToPlayer(
      { now: 1_000, runtimes, state },
      "s2",
      outcome.playerHits[0]!.damage,
    );
    expect(applied?.hp).toBeLessThan(300);
    expect(state.players.get("s2")?.hp).toBe(applied?.hp);
    expect(applyDamageToPlayer({ now: 1_000, runtimes, state }, "s2", 999)?.killed).toBe(
      true,
    );
    expect(applyDamageToPlayer({ now: 1_000, runtimes, state }, "s2", 1)).toBeNull();
  });

  it("blocks safe maps, peaceful targets, same party and same guild", () => {
    for (const policy of [
      { pvpAllowed: false, safe: true },
      { pvpAllowed: true, safe: false },
    ]) {
      const state = new WorldState();
      const runtimes = new Map<string, PlayerRuntime>();
      runtimes.set("s1", player(state, "s1", "char-a", 200, ATTACKER));
      const target: PvpActor = {
        ...ATTACKER,
        characterId: "char-b",
        kingdom: "gale",
        pvpMode: policy.safe ? "free" : "peaceful",
        partyId: policy.safe ? null : "party-1",
        guildId: null,
      };
      runtimes.set("s2", player(state, "s2", "char-b", 230, target));
      const attacker = { ...ATTACKER, partyId: policy.safe ? null : "party-1" };
      const outcome = resolvePlayerSwing(
        context(state, runtimes, actors(["s1", attacker], ["s2", target]), policy),
        "s1",
        0,
      )!;
      expect(outcome.playerHits).toHaveLength(0);
    }

    const state = new WorldState();
    const runtimes = new Map<string, PlayerRuntime>();
    const guildAttacker = { ...ATTACKER, guildId: "guild-1" };
    const guildTarget = {
      ...ATTACKER,
      characterId: "char-b",
      kingdom: "gale",
      guildId: "guild-1",
    };
    runtimes.set("s1", player(state, "s1", "char-a", 200, guildAttacker));
    runtimes.set("s2", player(state, "s2", "char-b", 230, guildTarget));
    expect(
      resolvePlayerSwing(
        context(state, runtimes, actors(["s1", guildAttacker], ["s2", guildTarget])),
        "s1",
        0,
      )?.playerHits,
    ).toHaveLength(0);
  });

  it("does not let a Kingdom attacker hit the same kingdom", () => {
    const state = new WorldState();
    const runtimes = new Map<string, PlayerRuntime>();
    const kingdom: PvpActor = { ...ATTACKER, pvpMode: "kingdom" };
    const same: PvpActor = { ...kingdom, characterId: "char-b" };
    runtimes.set("s1", player(state, "s1", "char-a", 200, kingdom));
    runtimes.set("s2", player(state, "s2", "char-b", 230, same));
    expect(
      resolvePlayerSwing(
        context(state, runtimes, actors(["s1", kingdom], ["s2", same])),
        "s1",
        0,
      )?.playerHits,
    ).toHaveLength(0);

    const other: PvpActor = { ...same, kingdom: "gale" };
    runtimes.get("s1")!.attackReadyAtMs = 0;
    expect(
      resolvePlayerSwing(
        context(state, runtimes, actors(["s1", kingdom], ["s2", other])),
        "s1",
        0,
      )?.playerHits,
    ).toHaveLength(1);
  });
});

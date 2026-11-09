import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  MSG,
  ROOM_NAME_VALLEY,
  ROOM_NAME_VILLAGE,
  type CombatEventPayload,
  type PvpMode,
  type SkillCastPayload,
} from "@jadethrone/shared";
import { createGameServer } from "../../src/server";
import type { MapRoom } from "../../src/rooms/MapRoom";
import type { JoinIdentity } from "../../src/auth/joinAuth";
import { applyPlayerBuff } from "../../src/skills/effects";
import { createFakeServices, type FakeServices } from "./fakes";

let colyseus: ColyseusTestServer;
let fake: FakeServices;
const savedModes = new Map<string, PvpMode>();

const PORT = 2604;

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitUntil timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function send(client: unknown, type: string, payload: unknown): void {
  (client as { send: (type: string, payload: unknown) => void }).send(type, payload);
}

async function join(room: MapRoom, identity: JoinIdentity) {
  const client = await colyseus.connectTo(room, {
    name: identity.character.name,
    characterId: identity.character.id,
  });
  await room.waitForNextPatch();
  await waitUntil(() => Boolean(fake.adminBus.get(identity.character.id)));
  return client;
}

async function setMode(client: unknown, mode: PvpMode, room: MapRoom, sessionId: string) {
  send(client, MSG.setPvpMode, { mode });
  await waitUntil(() => room.state.players.get(sessionId)?.pvpMode === mode);
}

interface PvpRuntime {
  mover: { pos: { x: number; y: number } };
  attackReadyAtMs: number;
  progression: { hp: number; xp: number };
  guildId: string | null;
  invisible: boolean;
  buffs: Parameters<typeof applyPlayerBuff>[0];
}

function runtimes(room: MapRoom): Map<string, PvpRuntime> {
  return (room as unknown as { runtimes: Map<string, PvpRuntime> }).runtimes;
}

function setGuild(room: MapRoom, sessionId: string, guildId: string): void {
  runtimes(room).get(sessionId)!.guildId = guildId;
}

function setInvisible(room: MapRoom, sessionId: string, invisible: boolean): void {
  runtimes(room).get(sessionId)!.invisible = invisible;
}

function addStealth(room: MapRoom, sessionId: string): void {
  applyPlayerBuff(
    runtimes(room).get(sessionId)!.buffs,
    {
      sourceSkillId: "test_stealth",
      name: "Stealth",
      iconKey: "icon.skill.stealth",
      modifiers: [],
      durationMs: 10_000,
      stealth: true,
    },
    Date.now(),
  );
}

function place(room: MapRoom, sessionId: string, x: number, y = 200): void {
  const internals = room as unknown as {
    runtimes: Map<string, { mover: { pos: { x: number; y: number } }; attackReadyAtMs: number }>;
  };
  const runtime = internals.runtimes.get(sessionId)!;
  runtime.mover.pos.x = x;
  runtime.mover.pos.y = y;
  runtime.attackReadyAtMs = 0;
  const player = room.state.players.get(sessionId)!;
  player.x = x;
  player.y = y;
}

beforeAll(async () => {
  fake = createFakeServices();
  const gameServer = createGameServer({
    joinAuthenticator: fake.joinAuthenticator,
    saveCharacter: fake.saveCharacter,
    saveCharacters: fake.saveCharacters,
    loadCharacter: fake.loadCharacter,
    saveSkillState: fake.saveSkillState,
    items: fake.items,
    adminBus: fake.adminBus,
    logChat: fake.logChat,
    logAdminAction: fake.logAdminAction,
    createRandomSource: () => ({ next: () => 0.5 }),
    setPvpMode: async (characterId, mode) => {
      savedModes.set(characterId, mode);
      return true;
    },
  });
  await gameServer.listen(PORT);
  colyseus = new ColyseusTestServer(gameServer);
}, 30_000);

afterEach(async () => {
  await colyseus.cleanup();
  fake.reset();
  savedModes.clear();
});

afterAll(async () => {
  await colyseus.shutdown();
});

describe("room pvp combat", () => {
  it("damages a hostile player in a PvP-allowed map", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VALLEY, {});
    const firstIdentity = fake.prepare({ name: "PvpOne", map: ROOM_NAME_VALLEY, kingdom: "ember" });
    const secondIdentity = fake.prepare({ name: "PvpTwo", map: ROOM_NAME_VALLEY, kingdom: "gale" });
    const first = await join(room, firstIdentity);
    const second = await join(room, secondIdentity);
    await setMode(first, "free", room, first.sessionId);
    await setMode(second, "free", room, second.sessionId);
    place(room, first.sessionId, 200);
    place(room, second.sessionId, 230);
    const before = room.state.players.get(second.sessionId)?.hp ?? 0;

    const combat = new Promise<CombatEventPayload>((resolve) => {
      first.onMessage(MSG.combat, (payload: CombatEventPayload) => {
        if (payload.hits.some((hit) => hit.target.kind === "player")) {
          resolve(payload);
        }
      });
    });
    send(first, MSG.attack, { dir: 0 });
    const event = await combat;
    const hit = event.hits.find((entry) => entry.target.kind === "player");
    expect(hit && !hit.miss).toBe(true);
    await waitUntil(
      () => (room.state.players.get(second.sessionId)?.hp ?? before) < before,
    );
  });

  it("does not damage players in the village safe zone", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const firstIdentity = fake.prepare({ name: "SafeOne", kingdom: "ember" });
    const secondIdentity = fake.prepare({ name: "SafeTwo", kingdom: "gale" });
    const first = await join(room, firstIdentity);
    const second = await join(room, secondIdentity);
    await setMode(first, "free", room, first.sessionId);
    await setMode(second, "free", room, second.sessionId);
    place(room, first.sessionId, 200);
    place(room, second.sessionId, 230);
    const before = room.state.players.get(second.sessionId)?.hp;

    let playerHit = false;
    first.onMessage(MSG.combat, (payload: CombatEventPayload) => {
      if (payload.hits.some((hit) => hit.target.kind === "player" && !hit.miss)) {
        playerHit = true;
      }
    });
    send(first, MSG.attack, { dir: 0 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(playerHit).toBe(false);
    expect(room.state.players.get(second.sessionId)?.hp).toBe(before);
  });

  it("blocks party friendly fire even in Free mode", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VALLEY, {});
    const firstIdentity = fake.prepare({ name: "PartyA", map: ROOM_NAME_VALLEY, kingdom: "ember" });
    const secondIdentity = fake.prepare({ name: "PartyB", map: ROOM_NAME_VALLEY, kingdom: "gale" });
    const first = await join(room, firstIdentity);
    const second = await join(room, secondIdentity);
    const invitePromise = second.waitForMessage(MSG.partyInvite, 2000);
    send(first, MSG.partyInvite, { characterId: secondIdentity.character.id });
    const invite = (await invitePromise) as { inviteId: string };
    const joined = first.waitForMessage(MSG.partyState, 2000);
    send(second, MSG.partyRespond, { inviteId: invite.inviteId, accept: true });
    await joined;
    await setMode(first, "free", room, first.sessionId);
    await setMode(second, "free", room, second.sessionId);
    place(room, first.sessionId, 200);
    place(room, second.sessionId, 230);
    const before = room.state.players.get(second.sessionId)?.hp;

    let playerHit = false;
    first.onMessage(MSG.combat, (payload: CombatEventPayload) => {
      if (payload.hits.some((hit) => hit.target.kind === "player" && !hit.miss)) {
        playerHit = true;
      }
    });
    send(first, MSG.attack, { dir: 0 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(playerHit).toBe(false);
    expect(room.state.players.get(second.sessionId)?.hp).toBe(before);
  });

  it("blocks guild friendly fire even in Free mode", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VALLEY, {});
    const firstIdentity = fake.prepare({ name: "GuildA", map: ROOM_NAME_VALLEY, kingdom: "ember" });
    const secondIdentity = fake.prepare({ name: "GuildB", map: ROOM_NAME_VALLEY, kingdom: "gale" });
    const first = await join(room, firstIdentity);
    const second = await join(room, secondIdentity);
    setGuild(room, first.sessionId, "guild-phase8");
    setGuild(room, second.sessionId, "guild-phase8");
    await setMode(first, "free", room, first.sessionId);
    await setMode(second, "free", room, second.sessionId);
    place(room, first.sessionId, 200);
    place(room, second.sessionId, 230);
    const before = room.state.players.get(second.sessionId)?.hp;

    let playerHit = false;
    first.onMessage(MSG.combat, (payload: CombatEventPayload) => {
      if (payload.hits.some((hit) => hit.target.kind === "player" && !hit.miss)) {
        playerHit = true;
      }
    });
    send(first, MSG.attack, { dir: 0 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(playerHit).toBe(false);
    expect(room.state.players.get(second.sessionId)?.hp).toBe(before);
  });

  it("filters party members from a hostile AoE crowd", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VALLEY, {});
    const firstIdentity = fake.prepare({
      name: "AoeCaster",
      map: ROOM_NAME_VALLEY,
      kingdom: "ember",
      level: 20,
      doctrine: "blade",
      skills: { warrior_blade_whirlwind: 1 },
    });
    const hostileIdentity = fake.prepare({
      name: "AoeHostile",
      map: ROOM_NAME_VALLEY,
      kingdom: "gale",
      level: 20,
    });
    const allyIdentity = fake.prepare({
      name: "AoeAlly",
      map: ROOM_NAME_VALLEY,
      kingdom: "gale",
      level: 20,
    });
    const first = await join(room, firstIdentity);
    const hostile = await join(room, hostileIdentity);
    const ally = await join(room, allyIdentity);

    const invitePromise = ally.waitForMessage(MSG.partyInvite, 2000);
    send(first, MSG.partyInvite, { characterId: allyIdentity.character.id });
    const invite = (await invitePromise) as { inviteId: string };
    const joined = ally.waitForMessage(MSG.partyState, 2000);
    send(ally, MSG.partyRespond, { inviteId: invite.inviteId, accept: true });
    await joined;

    await setMode(first, "free", room, first.sessionId);
    await setMode(hostile, "free", room, hostile.sessionId);
    await setMode(ally, "free", room, ally.sessionId);
    place(room, first.sessionId, 200);
    place(room, hostile.sessionId, 230);
    place(room, ally.sessionId, 270);
    const hostileHp = room.state.players.get(hostile.sessionId)?.hp ?? 0;
    const allyHp = room.state.players.get(ally.sessionId)?.hp ?? 0;

    const eventPromise = new Promise<SkillCastPayload>((resolve) => {
      first.onMessage(MSG.skillCast, (payload: SkillCastPayload) => {
        if (payload.hits.some((hit) => hit.target.kind === "player")) {
          resolve(payload);
        }
      });
    });
    send(first, MSG.castSkill, { skillId: "warrior_blade_whirlwind", dir: 0 });
    const event = await eventPromise;
    const targets = event.hits
      .filter((hit) => hit.target.kind === "player" && !hit.miss)
      .map((hit) => (hit.target as { sessionId: string }).sessionId);
    expect(targets).toContain(hostile.sessionId);
    expect(targets).not.toContain(ally.sessionId);
    await waitUntil(
      () => (room.state.players.get(hostile.sessionId)?.hp ?? hostileHp) < hostileHp,
    );
    expect(room.state.players.get(ally.sessionId)?.hp).toBe(allyHp);
  });

  it("cannot hit an invisible or stealthed player", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VALLEY, {});
    const firstIdentity = fake.prepare({
      name: "HiddenHunter",
      map: ROOM_NAME_VALLEY,
      kingdom: "ember",
    });
    const secondIdentity = fake.prepare({
      name: "HiddenTarget",
      map: ROOM_NAME_VALLEY,
      kingdom: "gale",
    });
    const first = await join(room, firstIdentity);
    const second = await join(room, secondIdentity);
    await setMode(first, "free", room, first.sessionId);
    await setMode(second, "free", room, second.sessionId);

    let playerHit = false;
    first.onMessage(MSG.combat, (payload: CombatEventPayload) => {
      if (payload.hits.some((hit) => hit.target.kind === "player" && !hit.miss)) {
        playerHit = true;
      }
    });

    setInvisible(room, second.sessionId, true);
    place(room, first.sessionId, 200);
    place(room, second.sessionId, 230);
    send(first, MSG.attack, { dir: 0 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(playerHit).toBe(false);

    setInvisible(room, second.sessionId, false);
    addStealth(room, second.sessionId);
    place(room, first.sessionId, 200);
    place(room, second.sessionId, 230);
    send(first, MSG.attack, { dir: 0 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(playerHit).toBe(false);
  });

  it("does not apply PvE XP loss or rewards on a PvP death", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VALLEY, {});
    const firstIdentity = fake.prepare({
      name: "DeathDealer",
      map: ROOM_NAME_VALLEY,
      kingdom: "ember",
    });
    const secondIdentity = fake.prepare({
      name: "DeathVictim",
      map: ROOM_NAME_VALLEY,
      kingdom: "gale",
    });
    const first = await join(room, firstIdentity);
    const second = await join(room, secondIdentity);
    await setMode(first, "free", room, first.sessionId);
    await setMode(second, "free", room, second.sessionId);
    place(room, first.sessionId, 200);
    place(room, second.sessionId, 230);
    const entries = runtimes(room);
    const attackerRuntime = entries.get(first.sessionId)!;
    const victimRuntime = entries.get(second.sessionId)!;
    attackerRuntime.progression.xp = 5000;
    victimRuntime.progression.xp = 5000;
    victimRuntime.progression.hp = 1;
    room.state.players.get(second.sessionId)!.hp = 1;
    const dropsBefore = room.state.groundItems.size;

    const deathPromise = second.waitForMessage(MSG.death, 2000);
    send(first, MSG.attack, { dir: 0 });
    await deathPromise;
    expect(victimRuntime.progression.xp).toBe(5000);
    expect(attackerRuntime.progression.xp).toBe(5000);
    expect(room.state.groundItems.size).toBe(dropsBefore);
  });

  it("rejects a peaceful target in a PvP map", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VALLEY, {});
    const firstIdentity = fake.prepare({ name: "Aggressor", map: ROOM_NAME_VALLEY, kingdom: "ember" });
    const secondIdentity = fake.prepare({ name: "Pacifist", map: ROOM_NAME_VALLEY, kingdom: "gale" });
    const first = await join(room, firstIdentity);
    const second = await join(room, secondIdentity);
    await setMode(first, "free", room, first.sessionId);
    place(room, first.sessionId, 200);
    place(room, second.sessionId, 230);
    const before = room.state.players.get(second.sessionId)?.hp;

    send(first, MSG.attack, { dir: 0 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(room.state.players.get(second.sessionId)?.hp).toBe(before);
  });
});

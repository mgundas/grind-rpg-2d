import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  MSG,
  ROOM_NAME_VILLAGE,
  type PartyInvitePayload,
  type SelfStatsPayload,
} from "@jadethrone/shared";
import { createGameServer } from "../../src/server";
import type { KilledMonster } from "../../src/rooms/combat";
import type { GroundItemRuntime } from "../../src/rooms/groundItems";
import type { MapRoom } from "../../src/rooms/MapRoom";
import type { PlayerRuntime } from "../../src/rooms/playerRuntime";
import type { PartyRegistry } from "../../src/rooms/party";
import { createFakeServices, type FakeServices } from "./fakes";

interface RoomInternals {
  awardXpForKill(killed: KilledMonster, killerSessionId: string): void;
  spawnDrops(killed: KilledMonster, killerSessionId: string, now: number): Promise<void>;
  groundItems: Map<string, GroundItemRuntime>;
  runtimes: Map<string, PlayerRuntime>;
  parties: PartyRegistry;
}

function internals(room: MapRoom): RoomInternals {
  return room as unknown as RoomInternals;
}

let colyseus: ColyseusTestServer;
let fake: FakeServices;

const PORT = 2582;

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

async function join(room: MapRoom, name: string) {
  const identity = fake.prepare({ name });
  const client = await colyseus.connectTo(room, {
    name: identity.character.name,
    characterId: identity.character.id,
  });
  await room.waitForNextPatch();
  await waitUntil(() => Boolean(fake.adminBus.get(identity.character.id)));
  return {
    client,
    identity,
    runtime: internals(room).runtimes.get(client.sessionId)!,
  };
}

async function formParty(
  room: MapRoom,
  first: Awaited<ReturnType<typeof join>>,
  second: Awaited<ReturnType<typeof join>>,
) {
  const invitePromise = second.client.waitForMessage(MSG.partyInvite, 2000);
  send(first.client, MSG.partyInvite, { characterId: second.identity.character.id });
  const invite = (await invitePromise) as PartyInvitePayload;
  const joined = first.client.waitForMessage(MSG.partyState, 2000);
  send(second.client, MSG.partyRespond, { inviteId: invite.inviteId, accept: true });
  await joined;
  return internals(room).parties.getByCharacter(first.identity.character.id)!;
}

function killedAt(
  runtime: PlayerRuntime,
  ownerSessionId: string,
  typeId = "wild_dog",
): KilledMonster {
  return {
    monsterId: "monster-1",
    typeId,
    x: runtime.mover.pos.x,
    y: runtime.mover.pos.y,
    ownerSessionId,
  };
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
  });
  await gameServer.listen(PORT);
  colyseus = new ColyseusTestServer(gameServer);
}, 30_000);

afterEach(async () => {
  await colyseus.cleanup();
  fake.reset();
});

afterAll(async () => {
  await colyseus.shutdown();
});

describe("party XP", () => {
  it("awards both nearby members the party bonus", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const first = await join(room, "XpLead");
    const second = await join(room, "XpMember");
    await formParty(room, first, second);

    const firstStats = first.client.waitForMessage(MSG.selfStats, 2000);
    const secondStats = second.client.waitForMessage(MSG.selfStats, 2000);
    internals(room).awardXpForKill(
      killedAt(first.runtime, first.client.sessionId),
      first.client.sessionId,
    );
    const [a, b] = (await Promise.all([firstStats, secondStats])) as [
      SelfStatsPayload,
      SelfStatsPayload,
    ];
    expect(a.xp).toBe(26);
    expect(b.xp).toBe(26);
    expect(fake.saved.map((save) => save.characterId).sort()).toEqual(
      [first.identity.character.id, second.identity.character.id].sort(),
    );
  });

  it("excludes a member outside 1500 px", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const first = await join(room, "XpNear");
    const second = await join(room, "XpFar");
    await formParty(room, first, second);
    second.runtime.mover.pos = { x: first.runtime.mover.pos.x + 2000, y: first.runtime.mover.pos.y };

    const firstStats = first.client.waitForMessage(MSG.selfStats, 2000);
    internals(room).awardXpForKill(
      killedAt(first.runtime, first.client.sessionId),
      first.client.sessionId,
    );
    expect(((await firstStats) as SelfStatsPayload).xp).toBe(24);
    await expect(second.client.waitForMessage(MSG.selfStats, 150)).rejects.toThrow();
  });
});

describe("party loot", () => {
  it("lets any member pick up a free-for-all drop", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const first = await join(room, "LootLead");
    const second = await join(room, "LootMember");
    const outsider = await join(room, "LootOutsider");
    const party = await formParty(room, first, second);
    const killed = killedAt(first.runtime, first.client.sessionId);
    await internals(room).spawnDrops(killed, first.client.sessionId, Date.now());

    const drops = [...internals(room).groundItems.values()];
    expect(drops.length).toBeGreaterThan(0);
    for (const drop of drops) {
      expect(drop.ownerPartyId).toBe(party.id);
      expect(drop.ownerCharacterId).toBe("");
    }

    const gold = drops.find((drop) => drop.kind === "gold")!;
    second.runtime.mover.pos = { x: gold.x, y: gold.y };
    await (
      room as unknown as {
        pickupDrop: (client: unknown, runtime: PlayerRuntime, dropId: string) => Promise<void>;
      }
    ).pickupDrop(second.client, second.runtime, gold.dropId);
    expect(internals(room).groundItems.has(gold.dropId)).toBe(false);

    const item = drops.find((drop) => drop.kind === "item");
    if (item) {
      outsider.runtime.mover.pos = { x: item.x, y: item.y };
      await expect(
        (
          room as unknown as {
            pickupDrop: (client: unknown, runtime: PlayerRuntime, dropId: string) => Promise<void>;
          }
        ).pickupDrop(outsider.client, outsider.runtime, item.dropId),
      ).rejects.toMatchObject({ code: "not_owner" });
    }
  });

  it("rotates round-robin ownership and releases it when the owner leaves", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const first = await join(room, "RrLead");
    const second = await join(room, "RrMember");
    const party = await formParty(room, first, second);
    internals(room).parties.setLootRule(first.identity.character.id, "round_robin");
    const killed = killedAt(first.runtime, first.client.sessionId);
    await internals(room).spawnDrops(killed, first.client.sessionId, Date.now());

    const drops = [...internals(room).groundItems.values()];
    expect(drops.length).toBeGreaterThanOrEqual(2);
    expect(drops[0]?.ownerCharacterId).toBe(first.identity.character.id);
    expect(drops[1]?.ownerCharacterId).toBe(second.identity.character.id);
    expect(drops.every((drop) => drop.ownerPartyId === party.id)).toBe(true);

    const firstDrop = drops[0]!;
    const left = first.client.waitForMessage(MSG.partyState, 2000);
    send(first.client, MSG.partyLeave, {});
    await left;
    expect(firstDrop.ownerCharacterId).toBe("");
    expect(firstDrop.ownerPartyId).toBe(party.id);
  });
});

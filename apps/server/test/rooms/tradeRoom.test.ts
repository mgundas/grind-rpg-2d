import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  MSG,
  ROOM_NAME_VILLAGE,
  type InventorySnapshotPayload,
  type TradeInvitePayload,
  type TradeStatePayload,
} from "@jadethrone/shared";
import { createGameServer } from "../../src/server";
import type { MapRoom } from "../../src/rooms/MapRoom";
import type { JoinIdentity } from "../../src/auth/joinAuth";
import { createFakeServices, type FakeServices } from "./fakes";

let colyseus: ColyseusTestServer;
let fake: FakeServices;

const PORT = 2590;

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

async function joinPrepared(room: MapRoom, identity: JoinIdentity) {
  const client = await colyseus.connectTo(room, {
    name: identity.character.name,
    characterId: identity.character.id,
  });
  await room.waitForNextPatch();
  await waitUntil(() => Boolean(fake.adminBus.get(identity.character.id)));
  return client;
}

async function openTrade(room: MapRoom, first: JoinIdentity, second: JoinIdentity) {
  const firstClient = await joinPrepared(room, first);
  const secondClient = await joinPrepared(room, second);
  const invitePromise = secondClient.waitForMessage(MSG.tradeInvite, 2000);
  send(firstClient, MSG.tradeInvite, { characterId: second.character.id });
  const invite = (await invitePromise) as TradeInvitePayload;
  const firstState = firstClient.waitForMessage(MSG.tradeState, 2000);
  const secondState = secondClient.waitForMessage(MSG.tradeState, 2000);
  send(secondClient, MSG.tradeRespond, { tradeId: invite.tradeId, accept: true });
  await Promise.all([firstState, secondState]);
  return { firstClient, secondClient, tradeId: invite.tradeId };
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

describe("room trade integration", () => {
  it("swaps an item and gold between two players", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const first = fake.prepare({ name: "TraderOne" });
    const second = fake.prepare({ name: "TraderTwo" });
    const swordId = randomUUID();
    const armorId = randomUUID();
    fake.giveItem({
      id: swordId,
      itemId: "sword_ember_t1",
      location: "inventory",
      slot: 0,
      ownerCharacterId: first.character.id,
    });
    fake.giveItem({
      id: armorId,
      itemId: "armor_warrior_t1",
      location: "inventory",
      slot: 0,
      ownerCharacterId: second.character.id,
    });
    fake.setGold(first.character.id, 1_000);
    fake.setGold(second.character.id, 500);

    const { firstClient, secondClient, tradeId } = await openTrade(room, first, second);

    const afterFirstOffer = [
      firstClient.waitForMessage(MSG.tradeState, 2000),
      secondClient.waitForMessage(MSG.tradeState, 2000),
    ];
    send(firstClient, MSG.tradeOffer, {
      tradeId,
      revision: 0,
      instanceIds: [swordId],
      gold: 100,
    });
    await Promise.all(afterFirstOffer);

    const afterSecondOffer = [
      firstClient.waitForMessage(MSG.tradeState, 2000),
      secondClient.waitForMessage(MSG.tradeState, 2000),
    ];
    send(secondClient, MSG.tradeOffer, {
      tradeId,
      revision: 1,
      instanceIds: [armorId],
      gold: 50,
    });
    const afterOffer = (await Promise.all(afterSecondOffer)) as [TradeStatePayload, TradeStatePayload];
    expect(afterOffer[0].revision).toBe(2);
    expect(afterOffer[0].you.items).toHaveLength(1);
    expect(afterOffer[0].other.items).toHaveLength(1);

    const firstLock = [
      firstClient.waitForMessage(MSG.tradeState, 2000),
      secondClient.waitForMessage(MSG.tradeState, 2000),
    ];
    send(firstClient, MSG.tradeLock, { tradeId, revision: 2, locked: true });
    await Promise.all(firstLock);
    const secondLock = [
      firstClient.waitForMessage(MSG.tradeState, 2000),
      secondClient.waitForMessage(MSG.tradeState, 2000),
    ];
    send(secondClient, MSG.tradeLock, { tradeId, revision: 2, locked: true });
    const locked = (await Promise.all(secondLock)) as [TradeStatePayload, TradeStatePayload];
    expect(locked[0].phase).toBe("locked");
    expect(locked[0].you.locked).toBe(true);
    expect(locked[0].other.locked).toBe(true);

    const firstAccepted = firstClient.waitForMessage(MSG.tradeState, 2000);
    send(firstClient, MSG.tradeAccept, { tradeId, revision: 2 });
    expect(((await firstAccepted) as TradeStatePayload).you.accepted).toBe(true);

    const firstDone = firstClient.waitForMessage(MSG.tradeState, 2000);
    const secondDone = secondClient.waitForMessage(MSG.tradeState, 2000);
    const firstInventory = firstClient.waitForMessage(MSG.inventory, 2000);
    const secondInventory = secondClient.waitForMessage(MSG.inventory, 2000);
    send(secondClient, MSG.tradeAccept, { tradeId, revision: 2 });

    const [done, , firstSnapshot, secondSnapshot] = (await Promise.all([
      firstDone,
      secondDone,
      firstInventory,
      secondInventory,
    ])) as [TradeStatePayload, TradeStatePayload, InventorySnapshotPayload, InventorySnapshotPayload];
    expect(done.phase).toBe("completed");
    expect(firstSnapshot.gold).toBe(950);
    expect(secondSnapshot.gold).toBe(550);
    expect(firstSnapshot.items.some((item) => item.id === armorId)).toBe(true);
    expect(firstSnapshot.items.some((item) => item.id === swordId)).toBe(false);
    expect(secondSnapshot.items.some((item) => item.id === swordId)).toBe(true);
    expect(secondSnapshot.items.some((item) => item.id === armorId)).toBe(false);
  });

  it("resets both locks when an offer changes", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const first = fake.prepare({ name: "LockOne" });
    const second = fake.prepare({ name: "LockTwo" });
    fake.setGold(first.character.id, 100);
    const firstItem = randomUUID();
    const secondItem = randomUUID();
    fake.giveItem({
      id: firstItem,
      itemId: "potion_hp_s",
      location: "inventory",
      slot: 0,
      ownerCharacterId: first.character.id,
    });
    fake.giveItem({
      id: secondItem,
      itemId: "potion_mp_s",
      location: "inventory",
      slot: 0,
      ownerCharacterId: second.character.id,
    });
    const { firstClient, secondClient, tradeId } = await openTrade(room, first, second);

    for (const [client, instanceId, revision] of [
      [firstClient, firstItem, 0],
      [secondClient, secondItem, 1],
    ] as const) {
      const states = [
        firstClient.waitForMessage(MSG.tradeState, 2000),
        secondClient.waitForMessage(MSG.tradeState, 2000),
      ];
      send(client, MSG.tradeOffer, { tradeId, revision, instanceIds: [instanceId], gold: 0 });
      await Promise.all(states);
    }
    for (const client of [firstClient, secondClient]) {
      const states = [
        firstClient.waitForMessage(MSG.tradeState, 2000),
        secondClient.waitForMessage(MSG.tradeState, 2000),
      ];
      send(client, MSG.tradeLock, { tradeId, revision: 2, locked: true });
      await Promise.all(states);
    }

    const resetStates = [
      firstClient.waitForMessage(MSG.tradeState, 2000),
      secondClient.waitForMessage(MSG.tradeState, 2000),
    ];
    send(firstClient, MSG.tradeOffer, {
      tradeId,
      revision: 2,
      instanceIds: [firstItem],
      gold: 25,
    });
    const [reset] = (await Promise.all(resetStates)) as [TradeStatePayload, TradeStatePayload];
    expect(reset.phase).toBe("open");
    expect(reset.revision).toBe(3);
    expect(reset.you.locked).toBe(false);
    expect(reset.other.locked).toBe(false);
  });

  it("cancels the trade when a player disconnects", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const first = fake.prepare({ name: "StayTrader" });
    const second = fake.prepare({ name: "LeaveTrader" });
    const { firstClient, secondClient } = await openTrade(room, first, second);

    const cancelled = firstClient.waitForMessage(MSG.tradeState, 2000);
    await secondClient.leave();
    expect(((await cancelled) as TradeStatePayload).phase).toBe("cancelled");
  });

  it("cancels the trade when an offered item is moved", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const first = fake.prepare({ name: "MoveTrader" });
    const second = fake.prepare({ name: "StillTrader" });
    const itemId = randomUUID();
    fake.giveItem({
      id: itemId,
      itemId: "potion_hp_s",
      location: "inventory",
      slot: 0,
      ownerCharacterId: first.character.id,
    });
    const { firstClient, secondClient, tradeId } = await openTrade(room, first, second);

    const offered = [
      firstClient.waitForMessage(MSG.tradeState, 2000),
      secondClient.waitForMessage(MSG.tradeState, 2000),
    ];
    send(firstClient, MSG.tradeOffer, {
      tradeId,
      revision: 0,
      instanceIds: [itemId],
      gold: 0,
    });
    await Promise.all(offered);

    const cancelled = firstClient.waitForMessage(MSG.tradeState, 2000);
    send(firstClient, MSG.moveItem, { instanceId: itemId, toSlot: 5 });
    expect(((await cancelled) as TradeStatePayload).phase).toBe("cancelled");
  });

  it("rejects an invite from out of range", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const first = fake.prepare({ name: "FarTrader" });
    const second = fake.prepare({ name: "NearTrader" });
    const firstClient = await joinPrepared(room, first);
    await joinPrepared(room, second);
    const internals = room as unknown as {
      runtimes: Map<string, { mover: { pos: { x: number; y: number } } }>;
    };
    const runtime = internals.runtimes.get(firstClient.sessionId)!;
    runtime.mover.pos.x += 5_000;

    const rejected = firstClient.waitForMessage(MSG.tradeError, 2000);
    send(firstClient, MSG.tradeInvite, { characterId: second.character.id });
    expect(((await rejected) as { code: string }).code).toBe("out_of_range");
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  MSG,
  ROOM_NAME_VILLAGE,
  type PartyInvitePayload,
  type PartyStatePayload,
} from "@jadethrone/shared";
import { createGameServer } from "../../src/server";
import type { MapRoom } from "../../src/rooms/MapRoom";
import { createFakeServices, type FakeServices } from "./fakes";

let colyseus: ColyseusTestServer;
let fake: FakeServices;

const PORT = 2580;

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
  return { client, identity };
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

describe("room party integration", () => {
  it("invites, accepts, changes loot and leaves", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const first = await join(room, "PartyLead");
    const second = await join(room, "PartyMember");

    const invitePromise = second.client.waitForMessage(MSG.partyInvite, 2000);
    send(first.client, MSG.partyInvite, { characterId: second.identity.character.id });
    const invite = (await invitePromise) as PartyInvitePayload;
    expect(invite.fromName).toBe("PartyLead");

    const leaderState = first.client.waitForMessage(MSG.partyState, 2000);
    const memberState = second.client.waitForMessage(MSG.partyState, 2000);
    send(second.client, MSG.partyRespond, { inviteId: invite.inviteId, accept: true });
    const [leaderSnapshot, memberSnapshot] = (await Promise.all([
      leaderState,
      memberState,
    ])) as [PartyStatePayload, PartyStatePayload];
    expect(leaderSnapshot.members).toHaveLength(2);
    expect(memberSnapshot.members.map((member) => member.name)).toEqual([
      "PartyLead",
      "PartyMember",
    ]);

    const lootPromise = second.client.waitForMessage(MSG.partyState, 2000);
    send(first.client, MSG.partySetLoot, { rule: "round_robin" });
    expect(((await lootPromise) as PartyStatePayload).lootRule).toBe("round_robin");

    const remainingPromise = first.client.waitForMessage(MSG.partyState, 2000);
    const leftPromise = second.client.waitForMessage(MSG.partyState, 2000);
    send(second.client, MSG.partyLeave, {});
    expect(((await remainingPromise) as PartyStatePayload).members).toHaveLength(1);
    expect(((await leftPromise) as PartyStatePayload).members).toHaveLength(0);
  });

  it("supports the /invite and /leave chat commands", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const first = await join(room, "ChatLead");
    const second = await join(room, "ChatMember");

    const invitePromise = second.client.waitForMessage(MSG.partyInvite, 2000);
    send(first.client, MSG.chat, { text: "/invite ChatMember" });
    const invite = (await invitePromise) as PartyInvitePayload;
    const memberState = second.client.waitForMessage(MSG.partyState, 2000);
    send(second.client, MSG.partyRespond, { inviteId: invite.inviteId, accept: true });
    await memberState;

    const leftPromise = second.client.waitForMessage(MSG.partyState, 2000);
    send(second.client, MSG.chat, { text: "/leave" });
    expect(((await leftPromise) as PartyStatePayload).members).toHaveLength(0);
  });

  it("drops a member from the party on disconnect", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const first = await join(room, "DropLead");
    const second = await join(room, "DropMember");
    const invitePromise = second.client.waitForMessage(MSG.partyInvite, 2000);
    send(first.client, MSG.partyInvite, { name: "DropMember" });
    const invite = (await invitePromise) as PartyInvitePayload;
    const joined = first.client.waitForMessage(MSG.partyState, 2000);
    send(second.client, MSG.partyRespond, { inviteId: invite.inviteId, accept: true });
    await joined;

    const remaining = first.client.waitForMessage(MSG.partyState, 2000);
    await second.client.leave();
    const snapshot = (await remaining) as PartyStatePayload;
    expect(snapshot.members.map((member) => member.name)).toEqual(["DropLead"]);
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  MSG,
  ROOM_NAME_VILLAGE,
  type ChatMsgPayload,
} from "@jadethrone/shared";
import type { JoinIdentity } from "../../src/auth/joinAuth";
import { createGameServer } from "../../src/server";
import type { MapRoom } from "../../src/rooms/MapRoom";
import { createFakeServices, type FakeServices } from "./fakes";

let colyseus: ColyseusTestServer;
let fake: FakeServices;

const PORT = 2598;

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

describe("room chat channels", () => {
  it("scrambles cross-kingdom local chat for the other kingdom only", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const ember = fake.prepare({ name: "EmberChat", kingdom: "ember" });
    const gale = fake.prepare({ name: "GaleChat", kingdom: "gale" });
    const first = await join(room, ember);
    const second = await join(room, gale);

    const firstMessage = first.waitForMessage(MSG.chatMsg, 2000);
    const secondMessage = second.waitForMessage(MSG.chatMsg, 2000);
    send(first, MSG.chat, { text: "golden sun rises" });

    const [own, other] = (await Promise.all([firstMessage, secondMessage])) as [
      ChatMsgPayload,
      ChatMsgPayload,
    ];
    expect(own.text).toBe("golden sun rises");
    expect(own.channel).toBe("local");
    expect(other.text).not.toBe("golden sun rises");
    expect(other.text).toHaveLength("golden sun rises".length);
    expect(other.channel).toBe("local");
  });

  it("delivers whispers across rooms and echoes the sender", async () => {
    const firstRoom = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const secondRoom = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const sender = fake.prepare({ name: "WhisperOne" });
    const receiver = fake.prepare({ name: "WhisperTwo" });
    const first = await join(firstRoom, sender);
    const second = await join(secondRoom, receiver);

    const echoPromise = first.waitForMessage(MSG.chatMsg, 2000);
    const deliveredPromise = second.waitForMessage(MSG.chatMsg, 2000);
    send(first, MSG.chat, {
      text: "meet at the forge",
      channel: "whisper",
      targetName: "WhisperTwo",
    });
    const [echo, delivered] = (await Promise.all([echoPromise, deliveredPromise])) as [
      ChatMsgPayload,
      ChatMsgPayload,
    ];
    expect(echo.channel).toBe("whisper");
    expect(echo.targetName).toBe("WhisperTwo");
    expect(delivered.name).toBe("WhisperOne");
    expect(delivered.text).toBe("meet at the forge");
  });

  it("gates shouts by level and kingdom", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const low = fake.prepare({ name: "LowShout", kingdom: "ember", level: 10 });
    const high = fake.prepare({ name: "HighShout", kingdom: "ember", level: 20 });
    const enemy = fake.prepare({ name: "EnemyShout", kingdom: "tide", level: 20 });
    const lowClient = await join(room, low);
    const highClient = await join(room, high);
    const enemyClient = await join(room, enemy);

    const blocked = lowClient.waitForMessage(MSG.chatMsg, 2000);
    send(lowClient, MSG.chat, { text: "rally", channel: "shout" });
    const blockedMessage = (await blocked) as ChatMsgPayload;
    expect(blockedMessage.channel).toBe("system");
    expect(blockedMessage.text).toContain("level 15");

    const sameKingdom = highClient.waitForMessage(MSG.chatMsg, 2000);
    send(highClient, MSG.chat, { text: "for the kingdom", channel: "shout" });
    const shout = (await sameKingdom) as ChatMsgPayload;
    expect(shout.channel).toBe("shout");
    expect(shout.text).toBe("for the kingdom");

    let enemyReceived = false;
    enemyClient.onMessage(MSG.chatMsg, () => {
      enemyReceived = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(enemyReceived).toBe(false);
  });

  it("filters profanity before delivery", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const one = fake.prepare({ name: "CleanChat" });
    const two = fake.prepare({ name: "ListenChat" });
    const first = await join(room, one);
    const second = await join(room, two);
    const received = second.waitForMessage(MSG.chatMsg, 2000);
    send(first, MSG.chat, { text: "oh hell yes" });
    expect(((await received) as ChatMsgPayload).text).toBe("oh **** yes");
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  MSG,
  ROOM_NAME_VILLAGE,
  type ChannelSwitchErrorPayload,
  type WarpPayload,
} from "@jadethrone/shared";
import type { JoinIdentity } from "../../src/auth/joinAuth";
import { createGameServer } from "../../src/server";
import type { MapRoom } from "../../src/rooms/MapRoom";
import { createFakeServices, type FakeServices } from "./fakes";

let colyseus: ColyseusTestServer;
let fake: FakeServices;

const PORT = 2602;

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
    channel: identity.channel,
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

describe("map channels", () => {
  it("puts different channels of one map in separate rooms", async () => {
    const channelOne = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, { channel: 1 });
    const channelTwo = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, { channel: 2 });
    expect(channelOne.roomId).not.toBe(channelTwo.roomId);
    expect(channelOne.metadata.channel).toBe(1);
    expect(channelTwo.metadata.channel).toBe(2);

    const first = fake.prepare({ channel: 1 });
    const second = fake.prepare({ channel: 2 });
    await join(channelOne, first);
    await join(channelTwo, second);
    expect(channelOne.state.players.size).toBe(1);
    expect(channelTwo.state.players.size).toBe(1);
  });

  it("clamps a stale requested channel to CH1", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, { channel: 99 });
    expect(room.metadata.channel).toBe(1);
  });

  it("switches channel at the same position and reports same_channel", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, { channel: 1 });
    const identity = fake.prepare({ channel: 1 });
    const client = await join(room, identity);

    const samePromise = client.waitForMessage(MSG.channelSwitchError, 2000);
    send(client, MSG.channelSwitch, { channel: 1 });
    expect(((await samePromise) as ChannelSwitchErrorPayload).code).toBe("same_channel");

    const warpPromise = client.waitForMessage(MSG.warp, 3000);
    send(client, MSG.channelSwitch, { channel: 2 });
    const warp = (await warpPromise) as WarpPayload;
    expect(warp.map).toBe(ROOM_NAME_VILLAGE);
    expect(warp.channel).toBe(2);
    expect(warp.x).toBeCloseTo(identity.character.x, 0);
    expect(warp.y).toBeCloseTo(identity.character.y, 0);
    await waitUntil(() => fake.saved.some((entry) => entry.channel === 2));
  });
});

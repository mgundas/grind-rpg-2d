import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { MSG, ROOM_NAME_VILLAGE } from "@jadethrone/shared";
import { createGameServer } from "../../src/server";
import type { MapRoom } from "../../src/rooms/MapRoom";
import { createFakeServices, type FakeServices } from "./fakes";

let colyseus: ColyseusTestServer;
let fake: FakeServices;

const PORT = 2606;

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitUntil timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
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

describe("mounts", () => {
  it("summons a mount from its item and dismounts on attack", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const identity = fake.prepare();
    const mountId = "11111111-2222-4333-8444-555555555555";
    fake.giveItem({
      id: mountId,
      itemId: "mount_jade_wolf",
      location: "inventory",
      slot: 10,
      quantity: 1,
      ownerCharacterId: identity.character.id,
    });
    const client = await colyseus.connectTo(room, {
      characterId: identity.character.id,
      name: identity.character.name,
    });
    await room.waitForNextPatch();
    await waitUntil(() => room.state.players.get(client.sessionId) !== undefined);

    client.send(MSG.useItem, { instanceId: mountId });
    await waitUntil(() => room.state.players.get(client.sessionId)?.mounted === true);
    // The mount item is reusable, not consumed.
    expect(fake.itemCount(identity.character.id)).toBe(1);

    client.send(MSG.attack, { dir: 0 });
    await waitUntil(() => room.state.players.get(client.sessionId)?.mounted === false);
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { MSG, ROOM_NAME_VILLAGE, type PvpMode } from "@jadethrone/shared";
import { createGameServer } from "../../src/server";
import type { MapRoom } from "../../src/rooms/MapRoom";
import { createFakeServices, type FakeServices } from "./fakes";

let colyseus: ColyseusTestServer;
let fake: FakeServices;
const savedModes = new Map<string, PvpMode>();

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

describe("pvp mode room toggle", () => {
  it("persists the stance and mirrors it into player state", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const identity = fake.prepare({ name: "PvpToggle" });
    const client = await colyseus.connectTo(room, {
      name: identity.character.name,
      characterId: identity.character.id,
    });
    await room.waitForNextPatch();
    await waitUntil(() => Boolean(fake.adminBus.get(identity.character.id)));
    expect(room.state.players.get(client.sessionId)?.pvpMode).toBe("peaceful");

    send(client, MSG.setPvpMode, { mode: "free" });
    await waitUntil(() => room.state.players.get(client.sessionId)?.pvpMode === "free");
    expect(savedModes.get(identity.character.id)).toBe("free");
  });
});

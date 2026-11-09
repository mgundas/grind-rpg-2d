import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  MSG,
  ROOM_NAME_FIELDS,
  ROOM_NAME_VILLAGE,
  type NpcDialogPayload,
  type TeleportDestination,
  type TeleportErrorPayload,
  type WarpPayload,
} from "@jadethrone/shared";
import type { JoinIdentity } from "../../src/auth/joinAuth";
import { createGameServer } from "../../src/server";
import type { MapRoom } from "../../src/rooms/MapRoom";
import { createFakeServices, type FakeServices } from "./fakes";

let colyseus: ColyseusTestServer;
let fake: FakeServices;

const PORT = 2601;

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

describe("teleporter NPC", () => {
  it("offers only connected maps, priced by the destination", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await join(room, fake.prepare());

    const dialogPromise = client.waitForMessage(MSG.npcDialog, 2000);
    send(client, MSG.interactNpc, { npcId: "waykeeper" });
    const dialog = (await dialogPromise) as NpcDialogPayload;

    expect(dialog.kind).toBe("teleporter");
    expect(dialog.destinations?.map((entry: TeleportDestination) => entry.mapId)).toEqual([ROOM_NAME_FIELDS]);
    expect(dialog.destinations?.[0]?.label).toBe("Ember Highlands");
    expect(dialog.destinations?.[0]?.cost).toBe(50);
  });

  it("rejects a destination that is not connected to this map", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await join(room, fake.prepare());

    const errorPromise = client.waitForMessage(MSG.teleportError, 2000);
    send(client, MSG.teleportRequest, {
      npcId: "waykeeper",
      targetMap: "map_valley_of_echoes",
    });
    expect(((await errorPromise) as TeleportErrorPayload).code).toBe("invalid_target");
  });

  it("rejects travel when the player is not next to the waykeeper", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const identity = fake.prepare({ spawnX: 40 * 32 + 16 + 400, spawnY: 40 * 32 + 16 });
    const client = await join(room, identity);

    const errorPromise = client.waitForMessage(MSG.teleportError, 2000);
    send(client, MSG.teleportRequest, { npcId: "waykeeper", targetMap: ROOM_NAME_FIELDS });
    expect(((await errorPromise) as TeleportErrorPayload).code).toBe("out_of_range");
  });

  it("charges the fee and warps to the connected highlands", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const identity = fake.prepare();
    fake.setGold(identity.character.id, 500);
    const client = await join(room, identity);
    const before = fake.goldOf(identity.character.id);

    const warpPromise = client.waitForMessage(MSG.warp, 3000);
    send(client, MSG.teleportRequest, { npcId: "waykeeper", targetMap: ROOM_NAME_FIELDS });
    const warp = (await warpPromise) as WarpPayload;

    expect(warp.map).toBe(ROOM_NAME_FIELDS);
    expect(fake.goldOf(identity.character.id)).toBe(before - 50);
  });
});

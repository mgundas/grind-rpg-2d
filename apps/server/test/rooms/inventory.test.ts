import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { MSG, ROOM_NAME_VILLAGE, type InventorySnapshotPayload } from "@jadethrone/shared";
import { createGameServer } from "../../src/server";
import type { MapRoom } from "../../src/rooms/MapRoom";
import type { JoinIdentity } from "../../src/auth/joinAuth";
import { createFakeServices, type FakeServices } from "./fakes";

let colyseus: ColyseusTestServer;
let fake: FakeServices;

function send(client: unknown, type: string, payload: unknown): void {
  (client as { send: (type: string, payload: unknown) => void }).send(type, payload);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitUntil timed out");
    }
    await sleep(10);
  }
}

async function joinWithInventory(
  name: string,
  seed?: (identity: JoinIdentity) => void,
) {
  const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
  const identity = fake.prepare({ name });
  seed?.(identity);
  const client = await colyseus.connectTo(room, {
    name,
    characterId: identity.character.id,
  });
  await room.waitForNextPatch();
  const pending = client.waitForMessage(MSG.inventory, 2000);
  send(client, MSG.requestInventory, {});
  return {
    room,
    client,
    identity,
    snapshot: (await pending) as InventorySnapshotPayload,
  };
}

beforeAll(async () => {
  fake = createFakeServices();
  const gameServer = createGameServer({
    joinAuthenticator: fake.joinAuthenticator,
    saveCharacter: fake.saveCharacter,
    saveCharacters: fake.saveCharacters,
    loadCharacter: fake.loadCharacter,
    items: fake.items,
    createRandomSource: () => ({ next: () => 0.5 }),
  });
  // `createGameServer` already returns a Server instance, and `boot()` ignores
  // its port argument for those. Listen explicitly on a private port so this
  // file can run beside rooms.test.ts without an EADDRINUSE.
  await gameServer.listen(2571);
  colyseus = new ColyseusTestServer(gameServer);
}, 30_000);

afterEach(async () => {
  await colyseus.cleanup();
  fake.reset();
});

afterAll(async () => {
  await colyseus.shutdown();
});

describe("MapRoom inventory snapshots", () => {
  it("sends the loaded inventory and gold on request", async () => {
    const potionId = randomUUID();
    const { snapshot, identity } = await joinWithInventory("Looter", (id) => {
      fake.setGold(id.character.id, 250);
      fake.giveItem({
        id: potionId,
        itemId: "potion_hp_s",
        location: "inventory",
        slot: 0,
        quantity: 5,
        ownerCharacterId: id.character.id,
      });
    });
    expect(snapshot.gold).toBe(250);
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0]?.id).toBe(potionId);
    expect(snapshot.equipment).toHaveLength(8);
    expect(identity.character.id.length).toBeGreaterThan(0);
  });

  it("moves and splits items through the command queue", async () => {
    const instanceId = randomUUID();
    const { client } = await joinWithInventory("Mover", (id) => {
      fake.giveItem({
        id: instanceId,
        itemId: "potion_hp_s",
        location: "inventory",
        slot: 0,
        quantity: 8,
        ownerCharacterId: id.character.id,
      });
    });

    const moved = client.waitForMessage(MSG.inventory, 2000);
    send(client, MSG.moveItem, { instanceId, toSlot: 7 });
    const afterMove = (await moved) as InventorySnapshotPayload;
    expect(afterMove.items.find((entry) => entry.id === instanceId)?.slot).toBe(7);

    const split = client.waitForMessage(MSG.inventory, 2000);
    send(client, MSG.splitStack, { instanceId, quantity: 3 });
    const afterSplit = (await split) as InventorySnapshotPayload;
    expect(afterSplit.items).toHaveLength(2);
    expect(afterSplit.items.reduce((sum, entry) => sum + entry.quantity, 0)).toBe(8);
  });

  it("equips a weapon and reports item-not-found errors", async () => {
    const swordId = randomUUID();
    const { client } = await joinWithInventory("Knight", (id) => {
      fake.giveItem({
        id: swordId,
        itemId: "sword_ember_t1",
        location: "inventory",
        slot: 0,
        ownerCharacterId: id.character.id,
      });
    });

    const equipped = client.waitForMessage(MSG.inventory, 2000);
    send(client, MSG.equipItem, { instanceId: swordId });
    const snapshot = (await equipped) as InventorySnapshotPayload;
    expect(snapshot.equipment[0]?.id).toBe(swordId);
    expect(snapshot.items).toHaveLength(0);

    const error = client.waitForMessage(MSG.inventoryError, 2000);
    send(client, MSG.equipItem, { instanceId: randomUUID() });
    expect(((await error) as { code: string }).code).toBe("item_not_found");
  });

  it("serializes two quick moves so the second sees the first result", async () => {
    const itemId = randomUUID();
    const { client } = await joinWithInventory("Fast", (id) => {
      fake.giveItem({
        id: itemId,
        itemId: "material_wolf_fang",
        location: "inventory",
        slot: 0,
        ownerCharacterId: id.character.id,
      });
    });

    const snapshots: InventorySnapshotPayload[] = [];
    client.onMessage(MSG.inventory, (payload: unknown) => {
      snapshots.push(payload as InventorySnapshotPayload);
    });
    send(client, MSG.moveItem, { instanceId: itemId, toSlot: 7 });
    send(client, MSG.moveItem, { instanceId: itemId, toSlot: 8 });
    await waitUntil(() => snapshots.length >= 2);
    expect(snapshots.at(-1)?.items[0]?.slot).toBe(8);
  });
});

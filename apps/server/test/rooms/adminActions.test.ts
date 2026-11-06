import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  MSG,
  ROOM_NAME_VILLAGE,
  type InventorySnapshotPayload,
  type SelfStatsPayload,
} from "@jadethrone/shared";
import { createGameServer } from "../../src/server";
import type { JoinIdentity } from "../../src/auth/joinAuth";
import type { MapRoom } from "../../src/rooms/MapRoom";
import { createFakeServices, type FakeServices } from "./fakes";

let colyseus: ColyseusTestServer;
let fake: FakeServices;

const PORT = 2572;

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitUntil timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function join(
  characterName: string,
  seed?: (identity: JoinIdentity) => void,
  role: "player" | "gm" | "admin" = "player",
) {
  const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
  const identity = fake.prepare({ name: characterName, role });
  seed?.(identity);
  const client = await colyseus.connectTo(room, {
    name: characterName,
    characterId: identity.character.id,
  });
  await room.waitForNextPatch();
  await waitUntil(() => Boolean(fake.adminBus.get(identity.character.id)));
  return { room, client, identity };
}

beforeAll(async () => {
  fake = createFakeServices();
  const gameServer = createGameServer({
    joinAuthenticator: fake.joinAuthenticator,
    saveCharacter: fake.saveCharacter,
    saveCharacters: fake.saveCharacters,
    loadCharacter: fake.loadCharacter,
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

describe("live admin actions", () => {
  it("registers presence on join and removes it on leave", async () => {
    const { client, identity } = await join("AdminTarget");
    const actions = fake.adminBus.get(identity.character.id);
    expect(actions?.presence()).toMatchObject({
      characterId: identity.character.id,
      sessionId: client.sessionId,
      mapId: ROOM_NAME_VILLAGE,
      role: "player",
    });
    await client.leave();
    await waitUntil(() => !fake.adminBus.get(identity.character.id));
  });

  it("grants a +5 sword into the live inventory", async () => {
    const { client, identity } = await join("Granted");
    const actions = fake.adminBus.get(identity.character.id)!;
    const snapshot = client.waitForMessage(MSG.inventory, 2000);
    const item = await actions.grantItem({
      definitionId: "sword_ember_t1",
      quantity: 1,
      upgradeLevel: 5,
      bonuses: [],
    });
    expect(item.upgradeLevel).toBe(5);
    const inventory = (await snapshot) as InventorySnapshotPayload;
    expect(inventory.items.some((entry) => entry.id === item.id)).toBe(true);
  });

  it("sets gold and updates level/stats live", async () => {
    const { room, client, identity } = await join("Editor");
    const actions = fake.adminBus.get(identity.character.id)!;
    const inventory = client.waitForMessage(MSG.inventory, 2000);
    await expect(actions.setGold(1234)).resolves.toBe(1234);
    expect(((await inventory) as InventorySnapshotPayload).gold).toBe(1234);
    expect(room.state.players.get(client.sessionId)).toBeDefined();

    const stats = client.waitForMessage(MSG.selfStats, 2000);
    await actions.updateCharacter({ level: 10, statVit: 20 });
    const updated = (await stats) as SelfStatsPayload;
    expect(updated.level).toBe(10);
    expect(updated.stats.vit).toBe(20);
    expect(updated.maxHp).toBeGreaterThan(316);
  });

  it("removes an equipped item and clears its visual layer", async () => {
    const swordId = randomUUID();
    const { client, identity } = await join("Stripped", (id) => {
      fake.giveItem({
        id: swordId,
        itemId: "sword_ember_t1",
        location: "equipment",
        slot: 0,
        ownerCharacterId: id.character.id,
      });
    });
    const actions = fake.adminBus.get(identity.character.id)!;
    const snapshot = client.waitForMessage(MSG.inventory, 2000);
    await actions.removeItem(swordId);
    const inventory = (await snapshot) as InventorySnapshotPayload;
    expect(inventory.equipment[0]).toBeNull();
  });

  it("executes GM chat commands for admin roles", async () => {
    const { room, client, identity } = await join("GameMaster", undefined, "admin");
    const runtime = (
      room as unknown as { runtimes: Map<string, { invisible: boolean }> }
    ).runtimes.get(client.sessionId)!;

    const inventory = client.waitForMessage(MSG.inventory, 2000);
    (client as { send: (type: string, payload: unknown) => void }).send(MSG.chat, {
      text: "/item sword_ember_t1 1",
    });
    const snapshot = (await inventory) as InventorySnapshotPayload;
    expect(snapshot.items.some((item) => item.itemId === "sword_ember_t1")).toBe(true);

    const stats = client.waitForMessage(MSG.selfStats, 2000);
    (client as { send: (type: string, payload: unknown) => void }).send(MSG.chat, {
      text: "/level 10",
    });
    expect(((await stats) as SelfStatsPayload).level).toBe(10);

    (client as { send: (type: string, payload: unknown) => void }).send(MSG.chat, {
      text: "/invisible",
    });
    await waitUntil(() => runtime.invisible);
    expect(fake.adminBus.get(identity.character.id)?.presence()?.level).toBe(10);

    const before = room.state.monsters.size;
    (client as { send: (type: string, payload: unknown) => void }).send(MSG.chat, {
      text: "/spawn wild_dog 2",
    });
    await waitUntil(() => room.state.monsters.size === before + 2);
  });

  it("spawns monsters and broadcasts an announcement", async () => {
    const { room, client, identity } = await join("Controller");
    const actions = fake.adminBus.get(identity.character.id)!;
    const before = room.state.monsters.size;
    const count = await actions.spawnMonster("wild_dog", 3);
    expect(count).toBe(3);
    expect(room.state.monsters.size).toBe(before + 3);

    const announcement = client.waitForMessage(MSG.announcement, 2000);
    fake.adminBus.broadcastAnnouncement({ message: "Maintenance soon", kind: "admin" });
    expect(((await announcement) as { message: string }).message).toBe("Maintenance soon");
  });
});

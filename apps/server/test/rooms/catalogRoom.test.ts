import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  MSG,
  ROOM_NAME_VILLAGE,
  type InventorySnapshotPayload,
  type NpcDialogPayload,
} from "@jadethrone/shared";
import {
  BASE_GAME_DATA,
  buildCatalog,
  mergeGameData,
} from "@jadethrone/data/catalog";
import { createGameServer } from "../../src/server";
import { createStaticGameDataStore } from "../../src/gameData/store";
import type { MapRoom } from "../../src/rooms/MapRoom";
import { createFakeServices, type FakeServices } from "./fakes";

let colyseus: ColyseusTestServer;
let fake: FakeServices;

const PORT = 2588;

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

function overriddenEntries() {
  const potion = BASE_GAME_DATA.items.find(
    (entry) => (entry as { id: string }).id === "potion_hp_s",
  ) as Record<string, unknown>;
  const blacksmith = BASE_GAME_DATA.npcs.find(
    (entry) => (entry as { id: string }).id === "blacksmith",
  ) as Record<string, unknown>;
  return mergeGameData(BASE_GAME_DATA, [
    {
      dataset: "items",
      entryId: "potion_hp_s",
      payload: { ...potion, buyPrice: 999 },
    },
    {
      dataset: "npcs",
      entryId: "blacksmith",
      payload: { ...blacksmith, greeting: "The forge burns hotter today." },
    },
  ]);
}

beforeAll(async () => {
  fake = createFakeServices();
  const entries = overriddenEntries();
  const gameServer = createGameServer({
    joinAuthenticator: fake.joinAuthenticator,
    saveCharacter: fake.saveCharacter,
    saveCharacters: fake.saveCharacters,
    loadCharacter: fake.loadCharacter,
    saveSkillState: fake.saveSkillState,
    items: fake.items,
    gameData: createStaticGameDataStore(entries, 2),
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

describe("room catalog", () => {
  it("uses overridden NPC text and shop prices without a restart", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const identity = fake.prepare({ name: "CatalogShopper" });
    fake.setGold(identity.character.id, 2_000);
    const client = await colyseus.connectTo(room, {
      name: identity.character.name,
      characterId: identity.character.id,
    });
    await room.waitForNextPatch();
    await waitUntil(() => Boolean(fake.adminBus.get(identity.character.id)));

    const internals = room as unknown as {
      runtimes: Map<string, { mover: { pos: { x: number; y: number } } }>;
    };
    const runtime = internals.runtimes.get(client.sessionId)!;
    const player = room.state.players.get(client.sessionId)!;
    const smithX = 36 * 32 + 16;
    const smithY = 40 * 32 + 12;
    runtime.mover.pos.x = smithX + 8;
    runtime.mover.pos.y = smithY + 8;
    player.x = smithX + 8;
    player.y = smithY + 8;

    const dialogPromise = client.waitForMessage(MSG.npcDialog, 2000);
    send(client, MSG.interactNpc, { npcId: "blacksmith" });
    const dialog = (await dialogPromise) as NpcDialogPayload;
    expect(dialog.greeting).toBe("The forge burns hotter today.");

    const shopX = 38 * 32 + 16;
    const shopY = 38 * 32 + 16;
    runtime.mover.pos.x = shopX + 8;
    runtime.mover.pos.y = shopY + 8;
    player.x = shopX + 8;
    player.y = shopY + 8;

    const bought = client.waitForMessage(MSG.inventory, 2000);
    send(client, MSG.shopBuy, {
      shopId: "general_goods",
      itemId: "potion_hp_s",
      quantity: 1,
    });
    const snapshot = (await bought) as InventorySnapshotPayload;
    expect(snapshot.gold).toBe(1_001);
  });

  it("builds the same catalog version the store exposes", () => {
    const catalog = buildCatalog(overriddenEntries(), 2);
    expect(catalog.version).toBe(2);
    expect(catalog.getNpc("blacksmith").greeting).toBe("The forge burns hotter today.");
  });
});

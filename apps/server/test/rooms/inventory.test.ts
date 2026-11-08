import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  MSG,
  ROOM_NAME_VILLAGE,
  type InventorySnapshotPayload,
  type NpcDialogPayload,
  type SelfStatsPayload,
  type UpgradePreview,
  type UpgradeResultPayload,
  type AnnouncementPayload,
  type BonusScrollAppliedPayload,
  type WarehouseSnapshotPayload,
} from "@jadethrone/shared";
import { createGameServer } from "../../src/server";
import type { KilledMonster } from "../../src/rooms/combat";
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

function moveToBlacksmith(room: MapRoom, sessionId: string): void {
  const internals = room as unknown as {
    runtimes: Map<string, { mover: { pos: { x: number; y: number } } }>;
  };
  const runtime = internals.runtimes.get(sessionId)!;
  const player = room.state.players.get(sessionId)!;
  const npcX = 36 * 32 + 16;
  const npcY = 40 * 32 + 12;
  runtime.mover.pos.x = npcX + 8;
  runtime.mover.pos.y = npcY + 8;
  player.x = npcX + 8;
  player.y = npcY + 8;
}

function setRoomRng(room: MapRoom, value: number): void {
  (room as unknown as { rng: { next: () => number } }).rng = { next: () => value };
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
    adminBus: fake.adminBus,
    logChat: fake.logChat,
    logAdminAction: fake.logAdminAction,
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

  it("applies weapon attack and publishes the visual layer", async () => {
    const swordId = randomUUID();
    const { client, room } = await joinWithInventory("Swordsman", (id) => {
      fake.giveItem({
        id: swordId,
        itemId: "sword_ember_t1",
        location: "inventory",
        slot: 0,
        ownerCharacterId: id.character.id,
      });
    });

    const stats = client.waitForMessage(MSG.selfStats, 2000);
    send(client, MSG.equipItem, { instanceId: swordId });
    const updated = (await stats) as SelfStatsPayload;
    expect(updated.attack).toBe(20); // warrior base 14 + 6 weapon attack
    await room.waitForNextPatch();
    const player = room.state.players.get(client.sessionId);
    expect(player?.weaponLayer).toBe("weapon.sword.t1");
  });

  it("adds armor max HP and clamps it again on unequip", async () => {
    const armorId = randomUUID();
    const { client } = await joinWithInventory("Tank", (id) => {
      fake.giveItem({
        id: armorId,
        itemId: "armor_warrior_t1",
        location: "inventory",
        slot: 0,
        ownerCharacterId: id.character.id,
      });
    });

    const equipped = client.waitForMessage(MSG.selfStats, 2000);
    send(client, MSG.equipItem, { instanceId: armorId });
    const withArmor = (await equipped) as SelfStatsPayload;
    expect(withArmor.maxHp).toBe(336); // 316 + 20

    const unequipped = client.waitForMessage(MSG.selfStats, 2000);
    send(client, MSG.unequipItem, { slot: 1 });
    const withoutArmor = (await unequipped) as SelfStatsPayload;
    expect(withoutArmor.maxHp).toBe(316);
  });

  it("spawns owned gold and the guaranteed material drop on a kill", async () => {
    const { room, client, identity } = await joinWithInventory("Hunter");
    const spawnDrops = (
      room as unknown as {
        spawnDrops: (
          killed: KilledMonster,
          killerSessionId: string,
          now: number,
        ) => Promise<void>;
      }
    ).spawnDrops.bind(room);

    await spawnDrops(
      {
        monsterId: "m0_g1_0",
        typeId: "wild_dog",
        x: 400,
        y: 400,
        ownerSessionId: client.sessionId,
      },
      client.sessionId,
      Date.now(),
    );

    const dropList = [...room.state.groundItems.values()];
    expect(dropList.some((drop) => drop.kind === "gold")).toBe(true);
    expect(dropList.some((drop) => drop.itemId === "material_wolf_fang")).toBe(true);
    expect(dropList.every((drop) => drop.ownerCharacterId === identity.character.id)).toBe(true);
  });

  it("despawns expired ground items", async () => {
    const { room, client } = await joinWithInventory("Sweeper");
    const internals = room as unknown as {
      spawnDrops: (
        killed: KilledMonster,
        killerSessionId: string,
        now: number,
      ) => Promise<void>;
      groundItems: Map<string, { despawnAtMs: number }>;
      tickGroundItems: (now: number) => void;
    };
    await internals.spawnDrops(
      {
        monsterId: "m0_g2_0",
        typeId: "wild_dog",
        x: 400,
        y: 400,
        ownerSessionId: client.sessionId,
      },
      client.sessionId,
      Date.now(),
    );
    expect(room.state.groundItems.size).toBeGreaterThan(0);
    for (const drop of internals.groundItems.values()) {
      drop.despawnAtMs = Date.now() - 1;
    }
    internals.tickGroundItems(Date.now());
    expect(room.state.groundItems.size).toBe(0);
    expect(internals.groundItems.size).toBe(0);
  });

  it("picks up an owned material drop into the inventory", async () => {
    const { room, client } = await joinWithInventory("Picker");
    const player = room.state.players.get(client.sessionId)!;
    const internals = room as unknown as {
      spawnDrops: (
        killed: KilledMonster,
        killerSessionId: string,
        now: number,
      ) => Promise<void>;
    };
    await internals.spawnDrops(
      {
        monsterId: "m0_g3_0",
        typeId: "wild_dog",
        x: player.x,
        y: player.y,
        ownerSessionId: client.sessionId,
      },
      client.sessionId,
      Date.now(),
    );
    const drop = [...room.state.groundItems.values()].find(
      (entry) => entry.itemId === "material_wolf_fang",
    );
    expect(drop).toBeDefined();

    const resultPromise = client.waitForMessage(MSG.pickupResult, 2000);
    const inventoryPromise = client.waitForMessage(MSG.inventory, 2000);
    send(client, MSG.pickup, { dropId: drop!.dropId });
    const result = (await resultPromise) as { ok: boolean; itemId?: string };
    const snapshot = (await inventoryPromise) as InventorySnapshotPayload;
    expect(result.ok).toBe(true);
    expect(result.itemId).toBe("material_wolf_fang");
    expect(snapshot.items.some((item) => item.itemId === "material_wolf_fang")).toBe(true);
    expect(room.state.groundItems.has(drop!.dropId)).toBe(false);
  });

  it("credits gold and refuses another player's owned drop", async () => {
    const { room, client } = await joinWithInventory("Coin");
    const player = room.state.players.get(client.sessionId)!;
    const internals = room as unknown as {
      spawnDrops: (
        killed: KilledMonster,
        killerSessionId: string,
        now: number,
      ) => Promise<void>;
      groundItems: Map<string, { ownerCharacterId: string; ownerUntilMs: number }>;
      addGroundItem: (item: {
        dropId: string;
        kind: "item" | "gold";
        itemId: string;
        quantity: number;
        rarity: "common";
        x: number;
        y: number;
        ownerCharacterId: string;
        ownerUntilMs: number;
        despawnAtMs: number;
      }) => void;
    };
    await internals.spawnDrops(
      {
        monsterId: "m0_g4_0",
        typeId: "wild_dog",
        x: player.x,
        y: player.y,
        ownerSessionId: client.sessionId,
      },
      client.sessionId,
      Date.now(),
    );
    const gold = [...room.state.groundItems.values()].find((entry) => entry.kind === "gold");
    expect(gold).toBeDefined();
    const resultPromise = client.waitForMessage(MSG.pickupResult, 2000);
    send(client, MSG.pickup, { dropId: gold!.dropId });
    const result = (await resultPromise) as { ok: boolean; gold?: number };
    expect(result.ok).toBe(true);
    expect(result.gold).toBeGreaterThan(0);

    // A manually owned item rejects the wrong character.
    const foreignId = randomUUID();
    internals.addGroundItem({
      dropId: foreignId,
      kind: "item",
      itemId: "material_wolf_fang",
      quantity: 1,
      rarity: "common",
      x: player.x,
      y: player.y,
      ownerCharacterId: "someone-else",
      ownerUntilMs: Date.now() + 30_000,
      despawnAtMs: Date.now() + 120_000,
    });
    const denied = client.waitForMessage(MSG.pickupResult, 2000);
    send(client, MSG.pickup, { dropId: foreignId });
    expect(((await denied) as { code?: string }).code).toBe("not_owner");
    expect(room.state.groundItems.has(foreignId)).toBe(true);
  });

  it("drinks a potion, heals and decrements the stack", async () => {
    const potionId = randomUUID();
    const { room, client } = await joinWithInventory("Healer", (id) => {
      fake.giveItem({
        id: potionId,
        itemId: "potion_hp_s",
        location: "inventory",
        slot: 0,
        quantity: 5,
        ownerCharacterId: id.character.id,
      });
    });
    const runtime = (
      room as unknown as {
        runtimes: Map<string, { progression: { hp: number } }>;
      }
    ).runtimes.get(client.sessionId)!;
    runtime.progression.hp = 50;
    const player = room.state.players.get(client.sessionId)!;
    player.hp = 50;

    const statsPromise = client.waitForMessage(MSG.selfStats, 2000);
    const inventoryPromise = client.waitForMessage(MSG.inventory, 2000);
    send(client, MSG.useItem, { instanceId: potionId });
    const stats = (await statsPromise) as SelfStatsPayload;
    const snapshot = (await inventoryPromise) as InventorySnapshotPayload;
    expect(stats.hp).toBe(170);
    expect(snapshot.items.find((item) => item.id === potionId)?.quantity).toBe(4);
  });

  it("refuses to drink at full HP and enforces the use cooldown", async () => {
    const potionId = randomUUID();
    const { room, client } = await joinWithInventory("Full", (id) => {
      fake.giveItem({
        id: potionId,
        itemId: "potion_hp_s",
        location: "inventory",
        slot: 0,
        quantity: 5,
        ownerCharacterId: id.character.id,
      });
    });
    const error = client.waitForMessage(MSG.inventoryError, 2000);
    send(client, MSG.useItem, { instanceId: potionId });
    expect(((await error) as { code: string }).code).toBe("at_full_health");

    const runtime = (
      room as unknown as {
        runtimes: Map<string, { progression: { hp: number } }>;
      }
    ).runtimes.get(client.sessionId)!;
    runtime.progression.hp = 50;
    const first = client.waitForMessage(MSG.selfStats, 2000);
    send(client, MSG.useItem, { instanceId: potionId });
    await first;

    const second = client.waitForMessage(MSG.inventoryError, 2000);
    send(client, MSG.useItem, { instanceId: potionId });
    expect(((await second) as { code: string }).code).toBe("cooldown");
  });

  it("opens NPC dialog and buys/sells only within shop range", async () => {
    const { room, client } = await joinWithInventory("Shopper", (id) => {
      fake.setGold(id.character.id, 500);
      fake.giveItem({
        id: randomUUID(),
        itemId: "material_wolf_fang",
        location: "inventory",
        slot: 1,
        quantity: 2,
        ownerCharacterId: id.character.id,
      });
    });
    const internals = room as unknown as {
      runtimes: Map<string, { mover: { pos: { x: number; y: number } } }>;
    };
    const runtime = internals.runtimes.get(client.sessionId)!;
    const player = room.state.players.get(client.sessionId)!;

    // Out of range first: the spawn is more than 64 px from the shop NPC.
    const rejected = client.waitForMessage(MSG.inventoryError, 2000);
    send(client, MSG.shopBuy, { shopId: "general_goods", itemId: "potion_hp_s", quantity: 1 });
    expect(((await rejected) as { code: string }).code).toBe("out_of_range");

    const npcX = 38 * 32 + 16;
    const npcY = 38 * 32 + 16;
    runtime.mover.pos.x = npcX + 8;
    runtime.mover.pos.y = npcY + 8;
    player.x = npcX + 8;
    player.y = npcY + 8;

    const dialogPromise = client.waitForMessage(MSG.npcDialog, 2000);
    send(client, MSG.interactNpc, { npcId: "general_goods" });
    const dialog = (await dialogPromise) as NpcDialogPayload;
    expect(dialog.kind).toBe("shop");
    expect(dialog.shopId).toBe("general_goods");

    const bought = client.waitForMessage(MSG.inventory, 2000);
    send(client, MSG.shopBuy, { shopId: "general_goods", itemId: "potion_hp_s", quantity: 1 });
    const afterBuy = (await bought) as InventorySnapshotPayload;
    expect(afterBuy.gold).toBe(460);
    expect(afterBuy.items).toHaveLength(2);
    const fang = afterBuy.items.find((item) => item.itemId === "material_wolf_fang")!;

    const sold = client.waitForMessage(MSG.inventory, 2000);
    send(client, MSG.shopSell, { instanceId: fang.id, quantity: 2 });
    const afterSell = (await sold) as InventorySnapshotPayload;
    expect(afterSell.gold).toBe(460 + 24);
    expect(afterSell.items.some((item) => item.itemId === "material_wolf_fang")).toBe(false);
  });

  it("deposits and withdraws through the warehouse NPC", async () => {
    const itemId = randomUUID();
    const { room, client } = await joinWithInventory("Keeper", (id) => {
      fake.giveItem({
        id: itemId,
        itemId: "material_wolf_fang",
        location: "inventory",
        slot: 0,
        quantity: 5,
        ownerCharacterId: id.character.id,
      });
    });
    const internals = room as unknown as {
      runtimes: Map<string, { mover: { pos: { x: number; y: number } } }>;
    };
    const runtime = internals.runtimes.get(client.sessionId)!;
    const player = room.state.players.get(client.sessionId)!;

    const rejected = client.waitForMessage(MSG.inventoryError, 2000);
    send(client, MSG.warehouseDeposit, { instanceId: itemId });
    expect(((await rejected) as { code: string }).code).toBe("out_of_range");

    const npcX = 38 * 32 + 16;
    const npcY = 42 * 32 + 16;
    runtime.mover.pos.x = npcX + 8;
    runtime.mover.pos.y = npcY + 8;
    player.x = npcX + 8;
    player.y = npcY + 8;

    const opened = client.waitForMessage(MSG.warehouse, 2000);
    send(client, MSG.warehouseOpen, { npcId: "warehouse_keeper" });
    expect(((await opened) as WarehouseSnapshotPayload).items).toHaveLength(0);

    const inventoryAfterDeposit = client.waitForMessage(MSG.inventory, 2000);
    const warehouseAfterDeposit = client.waitForMessage(MSG.warehouse, 2000);
    send(client, MSG.warehouseDeposit, { instanceId: itemId });
    const inventory1 = (await inventoryAfterDeposit) as InventorySnapshotPayload;
    const warehouse1 = (await warehouseAfterDeposit) as WarehouseSnapshotPayload;
    expect(inventory1.items).toHaveLength(0);
    expect(warehouse1.items.map((item) => item.id)).toEqual([itemId]);

    const inventoryAfterWithdraw = client.waitForMessage(MSG.inventory, 2000);
    const warehouseAfterWithdraw = client.waitForMessage(MSG.warehouse, 2000);
    send(client, MSG.warehouseWithdraw, { instanceId: itemId });
    const inventory2 = (await inventoryAfterWithdraw) as InventorySnapshotPayload;
    const warehouse2 = (await warehouseAfterWithdraw) as WarehouseSnapshotPayload;
    expect(inventory2.items[0]?.id).toBe(itemId);
    expect(warehouse2.items).toHaveLength(0);
  });

  it("uses a return scroll and still releases the inventory chain", async () => {
    const scrollId = randomUUID();
    const { client } = await joinWithInventory("Wanderer", (id) => {
      fake.giveItem({
        id: scrollId,
        itemId: "scroll_return",
        location: "inventory",
        slot: 0,
        ownerCharacterId: id.character.id,
      });
    });
    const inventory = client.waitForMessage(MSG.inventory, 2000);
    const warp = client.waitForMessage(MSG.warp, 6000);
    send(client, MSG.useItem, { instanceId: scrollId });
    const afterUse = (await inventory) as InventorySnapshotPayload;
    expect(afterUse.items).toHaveLength(0);
    const payload = (await warp) as { map: string };
    expect(payload.map).toBe(ROOM_NAME_VILLAGE);
    // Tear down the source room immediately instead of waiting for the server's
    // "client did not leave after warp" timeout.
    await client.leave();
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

  it("previews an upgrade only near the blacksmith", async () => {
    const swordId = randomUUID();
    const { room, client } = await joinWithInventory("Smith", (id) => {
      fake.setGold(id.character.id, 9_000);
      fake.giveItem({
        id: swordId,
        itemId: "sword_ember_t1",
        location: "inventory",
        slot: 0,
        upgradeLevel: 3,
        ownerCharacterId: id.character.id,
      });
      fake.giveItem({
        id: randomUUID(),
        itemId: "material_wolf_fang",
        location: "inventory",
        slot: 1,
        quantity: 2,
        ownerCharacterId: id.character.id,
      });
      fake.giveItem({
        id: randomUUID(),
        itemId: "scroll_blessing",
        location: "inventory",
        slot: 2,
        quantity: 1,
        ownerCharacterId: id.character.id,
      });
    });
    const internals = room as unknown as {
      runtimes: Map<string, { mover: { pos: { x: number; y: number } } }>;
    };
    const runtime = internals.runtimes.get(client.sessionId)!;
    const player = room.state.players.get(client.sessionId)!;

    const rejected = client.waitForMessage(MSG.blacksmithError, 2000);
    send(client, MSG.requestUpgradePreview, { instanceId: swordId });
    expect(((await rejected) as { code: string }).code).toBe("out_of_range");

    const npcX = 36 * 32 + 16;
    const npcY = 40 * 32 + 12;
    runtime.mover.pos.x = npcX + 8;
    runtime.mover.pos.y = npcY + 8;
    player.x = npcX + 8;
    player.y = npcY + 8;

    const previewPromise = client.waitForMessage(MSG.upgradePreview, 2000);
    send(client, MSG.requestUpgradePreview, { instanceId: swordId });
    const preview = (await previewPromise) as UpgradePreview;
    expect(preview.currentLevel).toBe(3);
    expect(preview.nextLevel).toBe(4);
    expect(preview.chance).toBeCloseTo(0.7);
    expect(preview.gold).toBe(8_000);
    expect(preview.materials).toEqual([
      { itemId: "material_wolf_fang", required: 1, owned: 2 },
    ]);
    expect(preview.blessingAvailable).toBe(true);
    expect(preview.canUpgrade).toBe(true);

    const unknown = client.waitForMessage(MSG.blacksmithError, 2000);
    send(client, MSG.requestUpgradePreview, { instanceId: randomUUID() });
    expect(((await unknown) as { code: string }).code).toBe("item_not_found");
  });

  it("executes a successful upgrade and consumes gold and materials once", async () => {
    const swordId = randomUUID();
    const fangId = randomUUID();
    const { room, client } = await joinWithInventory("Forger", (id) => {
      fake.setGold(id.character.id, 9_000);
      fake.giveItem({
        id: swordId,
        itemId: "sword_ember_t1",
        location: "inventory",
        slot: 0,
        upgradeLevel: 3,
        ownerCharacterId: id.character.id,
      });
      fake.giveItem({
        id: fangId,
        itemId: "material_wolf_fang",
        location: "inventory",
        slot: 1,
        ownerCharacterId: id.character.id,
      });
    });
    moveToBlacksmith(room, client.sessionId);
    setRoomRng(room, 0.1);

    const inventoryPromise = client.waitForMessage(MSG.inventory, 2000);
    const resultPromise = client.waitForMessage(MSG.upgradeResult, 2000);
    send(client, MSG.upgradeItem, { instanceId: swordId, useBlessing: false });

    const result = (await resultPromise) as UpgradeResultPayload;
    expect(result).toEqual({
      instanceId: swordId,
      success: true,
      previousLevel: 3,
      level: 4,
      destroyed: false,
      usedBlessing: false,
    });
    const snapshot = (await inventoryPromise) as InventorySnapshotPayload;
    expect(snapshot.gold).toBe(1_000);
    expect(snapshot.items.find((item) => item.id === swordId)?.upgradeLevel).toBe(4);
    expect(snapshot.items.some((item) => item.id === fangId)).toBe(false);
  });

  it("destroys the item on a failed roll without a blessing", async () => {
    const swordId = randomUUID();
    const { room, client } = await joinWithInventory("Doomed", (id) => {
      fake.setGold(id.character.id, 9_000);
      fake.giveItem({
        id: swordId,
        itemId: "sword_ember_t1",
        location: "inventory",
        slot: 0,
        upgradeLevel: 3,
        ownerCharacterId: id.character.id,
      });
      fake.giveItem({
        id: randomUUID(),
        itemId: "material_wolf_fang",
        location: "inventory",
        slot: 1,
        ownerCharacterId: id.character.id,
      });
    });
    moveToBlacksmith(room, client.sessionId);
    setRoomRng(room, 0.99);

    const resultPromise = client.waitForMessage(MSG.upgradeResult, 2000);
    const inventoryPromise = client.waitForMessage(MSG.inventory, 2000);
    send(client, MSG.upgradeItem, { instanceId: swordId, useBlessing: false });

    const result = (await resultPromise) as UpgradeResultPayload;
    expect(result.success).toBe(false);
    expect(result.destroyed).toBe(true);
    expect(result.level).toBeNull();
    const snapshot = (await inventoryPromise) as InventorySnapshotPayload;
    expect(snapshot.gold).toBe(1_000);
    expect(snapshot.items.some((item) => item.id === swordId)).toBe(false);
  });

  it("downgrades instead of destroying when a blessing is used", async () => {
    const swordId = randomUUID();
    const scrollId = randomUUID();
    const { room, client } = await joinWithInventory("Blessed", (id) => {
      fake.setGold(id.character.id, 9_000);
      fake.giveItem({
        id: swordId,
        itemId: "sword_ember_t1",
        location: "inventory",
        slot: 0,
        upgradeLevel: 3,
        ownerCharacterId: id.character.id,
      });
      fake.giveItem({
        id: randomUUID(),
        itemId: "material_wolf_fang",
        location: "inventory",
        slot: 1,
        ownerCharacterId: id.character.id,
      });
      fake.giveItem({
        id: scrollId,
        itemId: "scroll_blessing",
        location: "inventory",
        slot: 2,
        ownerCharacterId: id.character.id,
      });
    });
    moveToBlacksmith(room, client.sessionId);
    setRoomRng(room, 0.99);

    const resultPromise = client.waitForMessage(MSG.upgradeResult, 2000);
    const inventoryPromise = client.waitForMessage(MSG.inventory, 2000);
    send(client, MSG.upgradeItem, { instanceId: swordId, useBlessing: true });

    const result = (await resultPromise) as UpgradeResultPayload;
    expect(result.success).toBe(false);
    expect(result.destroyed).toBe(false);
    expect(result.usedBlessing).toBe(true);
    expect(result.level).toBe(2);
    const snapshot = (await inventoryPromise) as InventorySnapshotPayload;
    expect(snapshot.items.find((item) => item.id === swordId)?.upgradeLevel).toBe(2);
    expect(snapshot.items.some((item) => item.id === scrollId)).toBe(false);
  });

  it("refreshes equipped stats and announces +7 upgrades server-wide", async () => {
    const swordId = randomUUID();
    const { room, client } = await joinWithInventory("Legend", (id) => {
      fake.setGold(id.character.id, 60_000);
      fake.giveItem({
        id: swordId,
        itemId: "sword_ember_t1",
        location: "equipment",
        slot: 0,
        upgradeLevel: 6,
        ownerCharacterId: id.character.id,
      });
      fake.giveItem({
        id: randomUUID(),
        itemId: "material_spirit_shard",
        location: "inventory",
        slot: 1,
        quantity: 2,
        ownerCharacterId: id.character.id,
      });
    });
    moveToBlacksmith(room, client.sessionId);
    setRoomRng(room, 0.1);

    const selfStatsPromise = client.waitForMessage(MSG.selfStats, 2000);
    const announcementPromise = client.waitForMessage(MSG.announcement, 2000);
    const resultPromise = client.waitForMessage(MSG.upgradeResult, 2000);
    send(client, MSG.upgradeItem, { instanceId: swordId, useBlessing: false });

    const result = (await resultPromise) as UpgradeResultPayload;
    expect(result.level).toBe(7);
    await selfStatsPromise;
    const announcement = (await announcementPromise) as AnnouncementPayload;
    expect(announcement.kind).toBe("upgrade");
    expect(announcement.message).toContain("Ember Sword to +7");
  });

  it("applies an enchant scroll once and returns the rolled bonuses", async () => {
    const swordId = randomUUID();
    const scrollId = randomUUID();
    const { room, client } = await joinWithInventory("Enchanter", (id) => {
      fake.giveItem({
        id: swordId,
        itemId: "sword_ember_t1",
        location: "inventory",
        slot: 0,
        ownerCharacterId: id.character.id,
      });
      fake.giveItem({
        id: scrollId,
        itemId: "scroll_enchant",
        location: "inventory",
        slot: 1,
        quantity: 2,
        ownerCharacterId: id.character.id,
      });
    });
    setRoomRng(room, 0.99);

    const appliedPromise = client.waitForMessage(MSG.bonusScrollApplied, 2000);
    const inventoryPromise = client.waitForMessage(MSG.inventory, 2000);
    send(client, MSG.applyBonusScroll, {
      scrollInstanceId: scrollId,
      itemInstanceId: swordId,
    });

    const applied = (await appliedPromise) as BonusScrollAppliedPayload;
    expect(applied.kind).toBe("enchant");
    expect(applied.bonuses).toHaveLength(4);
    const snapshot = (await inventoryPromise) as InventorySnapshotPayload;
    expect(snapshot.items.find((item) => item.id === scrollId)?.quantity).toBe(1);
    expect(snapshot.items.find((item) => item.id === swordId)?.bonuses).toEqual(
      applied.bonuses,
    );

    const againPromise = client.waitForMessage(MSG.bonusScrollApplied, 2000);
    send(client, MSG.applyBonusScroll, {
      scrollInstanceId: scrollId,
      itemInstanceId: swordId,
    });
    await againPromise;
    const after = client.waitForMessage(MSG.inventory, 2000);
    send(client, MSG.requestInventory, {});
    expect(
      ((await after) as InventorySnapshotPayload).items.some((item) => item.id === scrollId),
    ).toBe(false);
  });

  it("leaves the scroll and target untouched when the target is invalid", async () => {
    const potionId = randomUUID();
    const scrollId = randomUUID();
    const { client } = await joinWithInventory("Fizzle", (id) => {
      fake.giveItem({
        id: potionId,
        itemId: "potion_hp_s",
        location: "inventory",
        slot: 0,
        ownerCharacterId: id.character.id,
      });
      fake.giveItem({
        id: scrollId,
        itemId: "scroll_enchant",
        location: "inventory",
        slot: 1,
        ownerCharacterId: id.character.id,
      });
    });

    const rejected = client.waitForMessage(MSG.inventoryError, 2000);
    send(client, MSG.applyBonusScroll, {
      scrollInstanceId: scrollId,
      itemInstanceId: potionId,
    });
    expect(((await rejected) as { code: string }).code).toBe("not_usable");

    const snapshotPromise = client.waitForMessage(MSG.inventory, 2000);
    send(client, MSG.requestInventory, {});
    const snapshot = (await snapshotPromise) as InventorySnapshotPayload;
    expect(snapshot.items.find((item) => item.id === scrollId)?.quantity).toBe(1);
    expect(snapshot.items.find((item) => item.id === potionId)?.bonuses).toEqual([]);
  });

  it("refreshes stats when reinforcing an equipped item", async () => {
    const armorId = randomUUID();
    const scrollId = randomUUID();
    const { room, client } = await joinWithInventory("Plater", (id) => {
      fake.giveItem({
        id: armorId,
        itemId: "armor_warrior_t1",
        location: "equipment",
        slot: 1,
        ownerCharacterId: id.character.id,
      });
      fake.giveItem({
        id: scrollId,
        itemId: "scroll_reinforce",
        location: "inventory",
        slot: 0,
        ownerCharacterId: id.character.id,
      });
    });
    setRoomRng(room, 0.5);

    const selfStatsPromise = client.waitForMessage(MSG.selfStats, 2000);
    const appliedPromise = client.waitForMessage(MSG.bonusScrollApplied, 2000);
    send(client, MSG.applyBonusScroll, {
      scrollInstanceId: scrollId,
      itemInstanceId: armorId,
    });

    const applied = (await appliedPromise) as BonusScrollAppliedPayload;
    expect(applied.kind).toBe("reinforce");
    expect(applied.bonuses).toHaveLength(1);
    await selfStatsPromise;
  });
});

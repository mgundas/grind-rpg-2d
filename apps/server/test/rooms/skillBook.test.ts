import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  MSG,
  ROOM_NAME_VILLAGE,
  type InventorySnapshotPayload,
  type SkillBookResultPayload,
  type SkillStatePayload,
} from "@jadethrone/shared";
import { createGameServer } from "../../src/server";
import type { MapRoom } from "../../src/rooms/MapRoom";
import { createFakeServices, type FakeServices } from "./fakes";

let colyseus: ColyseusTestServer;
let fake: FakeServices;
let rngValue = 0;

const PORT = 2600;
const SKILL = "warrior_blade_whirlwind";

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

async function joinWithBook(prefix: string, quantity = 1) {
  const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
  const identity = fake.prepare({
    name: prefix,
    classId: "warrior",
    doctrine: "blade",
    level: 30,
    skills: { [SKILL]: 20 },
  });
  const bookId = randomUUID();
  fake.giveItem({
    id: bookId,
    itemId: "skillbook_mastery",
    location: "inventory",
    slot: 0,
    quantity,
    ownerCharacterId: identity.character.id,
  });
  const client = await colyseus.connectTo(room, {
    name: identity.character.name,
    characterId: identity.character.id,
  });
  await room.waitForNextPatch();
  await waitUntil(() => Boolean(fake.adminBus.get(identity.character.id)));
  return { room, client, identity, bookId };
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
    createRandomSource: () => ({ next: () => rngValue }),
  });
  await gameServer.listen(PORT);
  colyseus = new ColyseusTestServer(gameServer);
}, 30_000);

afterEach(async () => {
  await colyseus.cleanup();
  fake.reset();
  rngValue = 0;
});

afterAll(async () => {
  await colyseus.shutdown();
});

describe("room skill-book reading", () => {
  it("succeeds, consumes the book and refreshes mastery state", async () => {
    const { client, identity, bookId } = await joinWithBook("ReaderOne");
    const resultPromise = client.waitForMessage(MSG.skillBookResult, 2000);
    const inventoryPromise = client.waitForMessage(MSG.inventory, 2000);
    const skillStatePromise = client.waitForMessage(MSG.skillState, 2000);
    send(client, MSG.readSkillBook, { bookInstanceId: bookId, skillId: SKILL });

    const result = (await resultPromise) as SkillBookResultPayload;
    expect(result).toMatchObject({
      ok: true,
      success: true,
      previousLevel: 0,
      masterLevel: 1,
    });
    expect(result.chance).toBe(0.9);
    const inventory = (await inventoryPromise) as InventorySnapshotPayload;
    expect(inventory.items.some((item) => item.id === bookId)).toBe(false);
    const skillState = (await skillStatePromise) as SkillStatePayload;
    expect(skillState.skills.find((skill) => skill.skillId === SKILL)?.masterLevel).toBe(1);
    expect(
      fake.identities.get(identity.character.id)?.character.skillMastery?.[SKILL]?.level,
    ).toBe(1);
  });

  it("commits a failed roll but keeps the mastery level", async () => {
    rngValue = 0.99;
    const { client, bookId } = await joinWithBook("ReaderTwo");
    const resultPromise = client.waitForMessage(MSG.skillBookResult, 2000);
    send(client, MSG.readSkillBook, { bookInstanceId: bookId, skillId: SKILL });
    const result = (await resultPromise) as SkillBookResultPayload;
    expect(result).toMatchObject({ ok: true, success: false, masterLevel: 0 });
    expect(result.nextReadAtMs).toBeGreaterThan(0);
  });

  it("serializes duplicate clicks: quantity two becomes one and then cools down", async () => {
    const { client, bookId } = await joinWithBook("ReaderThree", 2);
    const results: SkillBookResultPayload[] = [];
    client.onMessage(MSG.skillBookResult, (payload: SkillBookResultPayload) => {
      results.push(payload);
    });
    send(client, MSG.readSkillBook, { bookInstanceId: bookId, skillId: SKILL });
    send(client, MSG.readSkillBook, { bookInstanceId: bookId, skillId: SKILL });
    await waitUntil(() => results.length >= 2);
    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.ok).toBe(false);
    expect(results[1]?.code).toBe("mastery_cooldown");

    const snapshotPromise = client.waitForMessage(MSG.inventory, 2000);
    send(client, MSG.requestInventory, {});
    const snapshot = (await snapshotPromise) as InventorySnapshotPayload;
    expect(snapshot.items.find((item) => item.id === bookId)?.quantity).toBe(1);
  });

  it("rejects an unlearned rank without consuming the book", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const identity = fake.prepare({
      name: "ReaderLow",
      classId: "warrior",
      doctrine: "blade",
      level: 30,
      skills: { [SKILL]: 19 },
    });
    const bookId = randomUUID();
    fake.giveItem({
      id: bookId,
      itemId: "skillbook_mastery",
      location: "inventory",
      slot: 0,
      ownerCharacterId: identity.character.id,
    });
    const client = await colyseus.connectTo(room, {
      name: identity.character.name,
      characterId: identity.character.id,
    });
    await room.waitForNextPatch();
    await waitUntil(() => Boolean(fake.adminBus.get(identity.character.id)));

    const resultPromise = client.waitForMessage(MSG.skillBookResult, 2000);
    send(client, MSG.readSkillBook, { bookInstanceId: bookId, skillId: SKILL });
    const result = (await resultPromise) as SkillBookResultPayload;
    expect(result.ok).toBe(false);
    expect(result.code).toBe("rank_required");
  });
});

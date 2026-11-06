import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_GOLD, emptyInventory, type CreateCharacterRequest, type ItemStack } from "@jadethrone/shared";
import { registerAccount, type AuthDeps } from "../../src/auth/accountService";
import { createCharacter } from "../../src/characters/characterService";
import type { Db } from "../../src/db/client";
import { characters, goldLog, itemLog, items } from "../../src/db/schema";
import { creditGold } from "../../src/items/economy";
import { applyItemTransaction } from "../../src/items/itemTransactions";
import { planPickup } from "../../src/items/planning";
import { createTestDb, hasTestDatabase, type TestDb } from "./testDb";

const ACCESS_SECRET = "test-access-secret-at-least-32-characters";
const REFRESH_SECRET = "test-refresh-secret-at-least-32-characters";
const describeDb = hasTestDatabase() ? describe : describe.skip;

function suffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function deps(db: Db): AuthDeps {
  return {
    db,
    accessSecret: ACCESS_SECRET,
    refreshSecret: REFRESH_SECRET,
    accessTtlSeconds: 3600,
    refreshTtlSeconds: 3600,
  };
}

function input(): CreateCharacterRequest {
  return {
    name: `Pick${suffix()}`,
    classId: "warrior",
    gender: "male",
    hairStyle: 0,
    hairColor: 0,
  };
}

async function setup(db: Db) {
  const account = await registerAccount(deps(db), {
    email: `pick${suffix()}@example.com`,
    username: `Pick${suffix()}`,
    password: "correct-horse-battery",
    kingdom: "ember",
  });
  const character = await createCharacter(db, account.account.id, input());
  await db.delete(items).where(eq(items.ownerCharacterId, character.id));
  return { accountId: account.account.id, characterId: character.id };
}

async function insertGround(
  db: Db,
  characterId: string,
  itemId: string,
  quantity: number,
): Promise<string> {
  const id = randomUUID();
  await db.insert(items).values({
    id,
    definitionId: itemId,
    location: "ground",
    quantity,
    mapId: "map_ember_fields",
    roomId: "room-1",
    x: 100,
    y: 100,
    dropOwnerCharacterId: characterId,
    ownerUntil: new Date(Date.now() + 30_000),
    despawnAt: new Date(Date.now() + 120_000),
    createdBy: "drop",
  });
  return id;
}

async function insertInventory(db: Db, characterId: string, itemId: string, slot: number, quantity: number) {
  const id = randomUUID();
  await db.insert(items).values({
    id,
    definitionId: itemId,
    ownerCharacterId: characterId,
    location: "inventory",
    slot,
    quantity,
    createdBy: "test",
  });
  return id;
}

function idFactory(): () => string {
  let next = 0;
  return () => `extra-${++next}`;
}

function ground(itemId: string, id: string, quantity = 1) {
  return {
    id,
    itemId,
    quantity,
    upgradeLevel: 0,
    bonuses: [],
    mapId: "map_ember_fields",
  };
}

describeDb("pickup and gold persistence", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("updates a ground row into the inventory when there is no matching stack", async () => {
    const { db } = testDb;
    const { accountId, characterId } = await setup(db);
    const dropId = await insertGround(db, characterId, "material_wolf_fang", 1);

    const plan = planPickup(
      emptyInventory(),
      characterId,
      ground("material_wolf_fang", dropId),
      idFactory(),
    );
    await applyItemTransaction(db, { accountId, characterId }, plan.plan);

    const [row] = await db.select().from(items).where(eq(items.id, dropId));
    expect(row?.location).toBe("inventory");
    expect(row?.ownerCharacterId).toBe(characterId);
    expect(row?.slot).toBe(0);
    expect(row?.mapId).toBeNull();
    const logs = await db.select().from(itemLog).where(eq(itemLog.itemId, dropId));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe("pickup");
  });

  it("deletes the ground row when the drop fully merges", async () => {
    const { db } = testDb;
    const { accountId, characterId } = await setup(db);
    const existing = await insertInventory(
      db,
      characterId,
      "material_wolf_fang",
      0,
      998,
    );
    const dropId = await insertGround(db, characterId, "material_wolf_fang", 1);
    const before = {
      items: [
        {
          id: existing,
          itemId: "material_wolf_fang",
          slot: 0,
          quantity: 998,
          upgradeLevel: 0,
          bonuses: [],
        } satisfies ItemStack,
      ],
      equipment: Array.from({ length: 8 }, () => null),
    };

    const plan = planPickup(before, characterId, ground("material_wolf_fang", dropId), idFactory());
    await applyItemTransaction(db, { accountId, characterId }, plan.plan);

    const [groundRow] = await db.select().from(items).where(eq(items.id, dropId));
    expect(groundRow).toBeUndefined();
    const [stackRow] = await db.select().from(items).where(eq(items.id, existing));
    expect(stackRow?.quantity).toBe(999);
    const logs = await db.select().from(itemLog).where(eq(itemLog.itemId, dropId));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.detail).toMatchObject({ merged: 1, moved: 0 });
  });

  it("lets exactly one of two concurrent pickups claim a drop", async () => {
    const { db } = testDb;
    const { accountId, characterId } = await setup(db);
    const dropId = await insertGround(db, characterId, "material_wolf_fang", 1);
    const before = emptyInventory();
    const first = planPickup(before, characterId, ground("material_wolf_fang", dropId), idFactory());
    const second = planPickup(before, characterId, ground("material_wolf_fang", dropId), idFactory());

    const results = await Promise.allSettled([
      applyItemTransaction(db, { accountId, characterId }, first.plan),
      applyItemTransaction(db, { accountId, characterId }, second.plan),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(
      rejected && rejected.status === "rejected"
        ? (rejected.reason as { code?: string }).code
        : null,
    ).toBe("already_taken");

    const inventoryRows = await db
      .select()
      .from(items)
      .where(eq(items.ownerCharacterId, characterId));
    expect(inventoryRows).toHaveLength(1);
    expect(inventoryRows[0]?.quantity).toBe(1);
  });

  it("credits gold with a ledger row and clamps at MAX_GOLD", async () => {
    const { db } = testDb;
    const { accountId, characterId } = await setup(db);
    await creditGold(db, { accountId, characterId, amount: 100, reason: "pickup" });
    await creditGold(db, { accountId, characterId, amount: 25, reason: "pickup" });

    const [character] = await db.select().from(characters).where(eq(characters.id, characterId));
    expect(character?.gold).toBe(625);
    const logs = await db.select().from(goldLog).where(eq(goldLog.characterId, characterId));
    expect(logs.map((row) => row.balanceAfter)).toEqual([600, 625]);

    await db.update(characters).set({ gold: MAX_GOLD - 5 }).where(eq(characters.id, characterId));
    await creditGold(db, { accountId, characterId, amount: 10, reason: "pickup" });
    const [capped] = await db.select().from(characters).where(eq(characters.id, characterId));
    expect(capped?.gold).toBe(MAX_GOLD);
    const last = (await db.select().from(goldLog).where(eq(goldLog.characterId, characterId))).at(-1);
    expect(last?.delta).toBe(5);
  });
});

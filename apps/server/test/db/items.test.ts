import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateCharacterRequest } from "@jadethrone/shared";
import { EQUIP_SLOTS } from "@jadethrone/shared";
import { registerAccount, type AuthDeps } from "../../src/auth/accountService";
import { createCharacter, deleteCharacter } from "../../src/characters/characterService";
import type { Db } from "../../src/db/client";
import { accounts, characters, goldLog, itemLog, items } from "../../src/db/schema";
import { loadInventory } from "../../src/items/itemRepository";
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

function characterInput(overrides: Partial<CreateCharacterRequest> = {}): CreateCharacterRequest {
  return {
    name: `Item${suffix()}`,
    classId: "warrior",
    gender: "male",
    hairStyle: 0,
    hairColor: 0,
    ...overrides,
  };
}

async function newAccount(db: Db) {
  return registerAccount(deps(db), {
    email: `item${suffix()}@example.com`,
    username: `Item${suffix()}`,
    password: "correct-horse-battery",
    kingdom: "ember",
  });
}

async function clearItems(db: Db, characterId: string) {
  await db.delete(items).where(eq(items.ownerCharacterId, characterId));
}

describeDb("item loading and starter kit", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("creates the starter weapon, potions, gold and logs atomically", async () => {
    const { db } = testDb;
    const account = await newAccount(db);
    const summary = await createCharacter(db, account.account.id, characterInput());

    const rows = await db.select().from(items).where(eq(items.ownerCharacterId, summary.id));
    expect(rows).toHaveLength(2);
    const weapon = rows.find((row) => row.location === "equipment");
    expect(weapon?.definitionId).toBe("sword_ember_t1");
    expect(weapon?.slot).toBe(EQUIP_SLOTS.indexOf("weapon"));
    const potion = rows.find((row) => row.location === "inventory");
    expect(potion?.definitionId).toBe("potion_hp_s");
    expect(potion?.quantity).toBe(5);

    const [character] = await db.select().from(characters).where(eq(characters.id, summary.id));
    expect(character?.gold).toBe(500);

    const goldRows = await db.select().from(goldLog).where(eq(goldLog.characterId, summary.id));
    expect(goldRows).toHaveLength(1);
    expect(goldRows[0]?.delta).toBe(500);
    expect(goldRows[0]?.balanceAfter).toBe(500);

    const logRows = await db.select().from(itemLog).where(eq(itemLog.actorCharacterId, summary.id));
    expect(logRows.filter((row) => row.action === "starter")).toHaveLength(2);
  });

  it("does not leave items or gold when character creation fails", async () => {
    const { db } = testDb;
    const account = await newAccount(db);
    const input = characterInput();
    const first = await createCharacter(db, account.account.id, input);
    const beforeItems = await db
      .select()
      .from(items)
      .where(eq(items.ownerCharacterId, first.id));

    await expect(createCharacter(db, account.account.id, input)).rejects.toMatchObject({
      code: "name_taken",
    });

    const charRows = await db
      .select()
      .from(characters)
      .where(eq(characters.accountId, account.account.id));
    expect(charRows).toHaveLength(1);
    const afterItems = await db
      .select()
      .from(items)
      .where(eq(items.ownerCharacterId, first.id));
    expect(afterItems).toHaveLength(beforeItems.length);
    const goldRows = await db
      .select()
      .from(goldLog)
      .where(eq(goldLog.characterId, first.id));
    expect(goldRows).toHaveLength(1);
  });

  it("loads an empty inventory with the persisted gold balance", async () => {
    const { db } = testDb;
    const account = await newAccount(db);
    const summary = await createCharacter(db, account.account.id, characterInput());
    await clearItems(db, summary.id);

    const loaded = await loadInventory(db, account.account.id, summary.id);
    expect(loaded.inventory.items).toHaveLength(0);
    expect(loaded.inventory.equipment).toHaveLength(8);
    expect(loaded.gold).toBe(500);
    expect(loaded.repairs).toHaveLength(0);
  });

  it("repairs overlapping tall items and logs the repair once", async () => {
    const { db } = testDb;
    const account = await newAccount(db);
    const summary = await createCharacter(db, account.account.id, characterInput());
    await clearItems(db, summary.id);

    await db.insert(items).values([
      {
        id: randomUUID(),
        definitionId: "armor_warrior_t1",
        ownerCharacterId: summary.id,
        location: "inventory",
        slot: 0,
        quantity: 1,
        createdBy: "test",
      },
      {
        id: randomUUID(),
        definitionId: "armor_warrior_t2",
        ownerCharacterId: summary.id,
        location: "inventory",
        slot: 1,
        quantity: 1,
        createdBy: "test",
      },
    ]);

    const first = await loadInventory(db, account.account.id, summary.id);
    expect(first.repairs.length).toBeGreaterThan(0);
    const slots = first.inventory.items.map((item) => item.slot);
    expect(new Set(slots).size).toBe(slots.length);

    const repairsAfterFirst = await db
      .select()
      .from(itemLog)
      .where(eq(itemLog.actorCharacterId, summary.id));
    expect(repairsAfterFirst.some((row) => row.action === "repair")).toBe(true);

    const second = await loadInventory(db, account.account.id, summary.id);
    expect(second.repairs).toHaveLength(0);
    const repairsAfterSecond = await db
      .select()
      .from(itemLog)
      .where(eq(itemLog.actorCharacterId, summary.id));
    expect(repairsAfterSecond.filter((row) => row.action === "repair")).toHaveLength(
      repairsAfterFirst.filter((row) => row.action === "repair").length,
    );
  });

  it("repairs a misplaced equipment slot by moving the item to the inventory", async () => {
    const { db } = testDb;
    const account = await newAccount(db);
    const summary = await createCharacter(db, account.account.id, characterInput());
    await clearItems(db, summary.id);
    await db.insert(items).values({
      id: randomUUID(),
      definitionId: "sword_ember_t1",
      ownerCharacterId: summary.id,
      location: "equipment",
      slot: 5,
      quantity: 1,
      createdBy: "test",
    });

    const loaded = await loadInventory(db, account.account.id, summary.id);
    expect(loaded.inventory.equipment.every((entry) => entry === null)).toBe(true);
    expect(loaded.inventory.items[0]?.itemId).toBe("sword_ember_t1");
    expect(loaded.repairs[0]?.reason).toBe("equipment_slot");
  });

  it("keeps an unknown definition instead of deleting it", async () => {
    const { db } = testDb;
    const account = await newAccount(db);
    const summary = await createCharacter(db, account.account.id, characterInput());
    await clearItems(db, summary.id);
    const id = randomUUID();
    await db.insert(items).values({
      id,
      definitionId: "deleted_weapon",
      ownerCharacterId: summary.id,
      location: "equipment",
      slot: 0,
      quantity: 1,
      createdBy: "test",
    });

    const loaded = await loadInventory(db, account.account.id, summary.id);
    expect(loaded.inventory.items.some((item) => item.id === id)).toBe(true);
    expect(loaded.inventory.equipment[0]).toBeNull();
  });

  it("refuses to load a character from another account", async () => {
    const { db } = testDb;
    const owner = await newAccount(db);
    const other = await newAccount(db);
    const summary = await createCharacter(db, owner.account.id, characterInput());

    await expect(loadInventory(db, other.account.id, summary.id)).rejects.toMatchObject({
      code: "stale",
    });
  });

  it("cascades inventory items but keeps account warehouse rows", async () => {
    const { db } = testDb;
    const account = await newAccount(db);
    const summary = await createCharacter(db, account.account.id, characterInput());
    const warehouseId = randomUUID();
    await db.insert(items).values({
      id: warehouseId,
      definitionId: "potion_hp_s",
      ownerAccountId: account.account.id,
      location: "warehouse",
      slot: 0,
      quantity: 1,
      createdBy: "test",
    });

    await deleteCharacter(db, account.account.id, summary.id);
    const characterItems = await db
      .select()
      .from(items)
      .where(eq(items.ownerCharacterId, summary.id));
    expect(characterItems).toHaveLength(0);
    const warehouse = await db
      .select()
      .from(items)
      .where(eq(items.id, warehouseId));
    expect(warehouse).toHaveLength(1);

    await db.delete(accounts).where(eq(accounts.id, account.account.id));
    const afterAccountDelete = await db
      .select()
      .from(items)
      .where(inArray(items.id, [warehouseId]));
    expect(afterAccountDelete).toHaveLength(0);
  });
});

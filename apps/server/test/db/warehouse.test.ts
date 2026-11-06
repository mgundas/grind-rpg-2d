import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateCharacterRequest } from "@jadethrone/shared";
import { registerAccount, type AuthDeps } from "../../src/auth/accountService";
import { createCharacter } from "../../src/characters/characterService";
import type { Db } from "../../src/db/client";
import { items } from "../../src/db/schema";
import { applyItemTransaction } from "../../src/items/itemTransactions";
import { loadWarehouse } from "../../src/items/itemRepository";
import { planDeposit, planWithdraw } from "../../src/items/planning";
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

function input(overrides: Partial<CreateCharacterRequest> = {}): CreateCharacterRequest {
  return {
    name: `Store${suffix()}`,
    classId: "warrior",
    gender: "male",
    hairStyle: 0,
    hairColor: 0,
    ...overrides,
  };
}

async function setup(db: Db) {
  const account = await registerAccount(deps(db), {
    email: `store${suffix()}@example.com`,
    username: `Store${suffix()}`,
    password: "correct-horse-battery",
    kingdom: "ember",
  });
  const first = await createCharacter(db, account.account.id, input());
  const second = await createCharacter(db, account.account.id, input());
  await db.delete(items).where(eq(items.ownerCharacterId, first.id));
  await db.delete(items).where(eq(items.ownerCharacterId, second.id));
  return {
    accountId: account.account.id,
    firstId: first.id,
    secondId: second.id,
  };
}

async function insertInventory(
  db: Db,
  characterId: string,
  itemId: string,
  slot: number,
  quantity: number,
): Promise<string> {
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

describeDb("warehouse persistence", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("deposits a stack and withdraws it on another character of the same account", async () => {
    const { db } = testDb;
    const { accountId, firstId, secondId } = await setup(db);
    const id = await insertInventory(db, firstId, "material_wolf_fang", 0, 5);
    const inventory = {
      items: [
        {
          id,
          itemId: "material_wolf_fang",
          slot: 0,
          quantity: 5,
          upgradeLevel: 0,
          bonuses: [],
        },
      ],
      equipment: Array.from({ length: 8 }, () => null),
    };

    const deposit = planDeposit(inventory, { items: [] }, firstId, accountId, id);
    await applyItemTransaction(db, { accountId, characterId: firstId }, deposit.plan);

    let [row] = await db.select().from(items).where(eq(items.id, id));
    expect(row?.location).toBe("warehouse");
    expect(row?.ownerCharacterId).toBeNull();
    expect(row?.ownerAccountId).toBe(accountId);
    expect(row?.slot).toBe(0);

    const warehouse = await loadWarehouse(db, accountId);
    expect(warehouse.items.map((item) => item.id)).toEqual([id]);

    const withdraw = planWithdraw(
      {
        items: [],
        equipment: Array.from({ length: 8 }, () => null),
      },
      warehouse,
      secondId,
      accountId,
      id,
      null,
    );
    await applyItemTransaction(db, { accountId, characterId: secondId }, withdraw.plan);

    [row] = await db.select().from(items).where(eq(items.id, id));
    expect(row?.location).toBe("inventory");
    expect(row?.ownerCharacterId).toBe(secondId);
    expect(row?.ownerAccountId).toBeNull();
    expect(row?.quantity).toBe(5);

    const remaining = await loadWarehouse(db, accountId);
    expect(remaining.items).toHaveLength(0);
  });

  it("lets exactly one of two concurrent withdrawals claim a row", async () => {
    const { db } = testDb;
    const { accountId, firstId, secondId } = await setup(db);
    await db.insert(items).values({
      id: randomUUID(),
      definitionId: "material_wolf_fang",
      ownerAccountId: accountId,
      location: "warehouse",
      slot: 0,
      quantity: 1,
      createdBy: "test",
    });
    const warehouse = await loadWarehouse(db, accountId);
    const emptyInventory = {
      items: [],
      equipment: Array.from({ length: 8 }, () => null),
    };
    const first = planWithdraw(emptyInventory, warehouse, firstId, accountId, warehouse.items[0]!.id, null);
    const second = planWithdraw(
      emptyInventory,
      warehouse,
      secondId,
      accountId,
      warehouse.items[0]!.id,
      null,
    );
    const results = await Promise.allSettled([
      applyItemTransaction(db, { accountId, characterId: firstId }, first.plan),
      applyItemTransaction(db, { accountId, characterId: secondId }, second.plan),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(
      rejected && rejected.status === "rejected"
        ? (rejected.reason as { code?: string }).code
        : null,
    ).toBe("stale");
  });
});

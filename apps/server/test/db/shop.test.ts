import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyInventory, type CreateCharacterRequest, type ItemStack } from "@jadethrone/shared";
import { registerAccount, type AuthDeps } from "../../src/auth/accountService";
import { createCharacter } from "../../src/characters/characterService";
import type { Db } from "../../src/db/client";
import { characters, goldLog, itemLog, items } from "../../src/db/schema";
import { applyItemTransaction } from "../../src/items/itemTransactions";
import { planBuy, planSell } from "../../src/items/planning";
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
    name: `Shop${suffix()}`,
    classId: "warrior",
    gender: "male",
    hairStyle: 0,
    hairColor: 0,
    ...overrides,
  };
}

async function setup(db: Db) {
  const account = await registerAccount(deps(db), {
    email: `shop${suffix()}@example.com`,
    username: `Shop${suffix()}`,
    password: "correct-horse-battery",
    kingdom: "ember",
  });
  const character = await createCharacter(db, account.account.id, input());
  await db.delete(items).where(eq(items.ownerCharacterId, character.id));
  await db.delete(goldLog).where(eq(goldLog.characterId, character.id));
  return { accountId: account.account.id, characterId: character.id };
}

function idFactory(): () => string {
  return () => randomUUID();
}

function inventory(items: ItemStack[] = []) {
  return {
    items,
    equipment: Array.from({ length: 8 }, () => null),
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

describeDb("shop persistence", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("buys an item, debits gold and writes both ledgers", async () => {
    const { db } = testDb;
    const { accountId, characterId } = await setup(db);
    const plan = planBuy(
      emptyInventory(),
      characterId,
      500,
      "general_goods",
      "potion_hp_s",
      1,
      idFactory(),
    );
    await applyItemTransaction(db, { accountId, characterId }, plan.plan);

    const rows = await db.select().from(items).where(eq(items.ownerCharacterId, characterId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.definitionId).toBe("potion_hp_s");
    expect(rows[0]?.quantity).toBe(1);
    const [character] = await db.select().from(characters).where(eq(characters.id, characterId));
    expect(character?.gold).toBe(460);
    const goldRows = await db.select().from(goldLog).where(eq(goldLog.characterId, characterId));
    expect(goldRows[0]).toMatchObject({ delta: -40, balanceAfter: 460, reason: "shop_buy" });
    const logRows = await db
      .select()
      .from(itemLog)
      .where(eq(itemLog.actorCharacterId, characterId));
    expect(logRows.some((row) => row.action === "buy")).toBe(true);
  });

  it("splits a 105-potion purchase into two stacks", async () => {
    const { db } = testDb;
    const { accountId, characterId } = await setup(db);
    await db.update(characters).set({ gold: 5000 }).where(eq(characters.id, characterId));
    const plan = planBuy(
      emptyInventory(),
      characterId,
      5000,
      "general_goods",
      "potion_hp_s",
      105,
      idFactory(),
    );
    await applyItemTransaction(db, { accountId, characterId }, plan.plan);

    const rows = await db.select().from(items).where(eq(items.ownerCharacterId, characterId));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.quantity).sort((a, b) => a - b)).toEqual([5, 100]);
    const [character] = await db.select().from(characters).where(eq(characters.id, characterId));
    expect(character?.gold).toBe(5000 - 105 * 40);
  });

  it("lets exactly one of two concurrent purchases spend the last gold", async () => {
    const { db } = testDb;
    const { accountId, characterId } = await setup(db);
    await db.update(characters).set({ gold: 40 }).where(eq(characters.id, characterId));
    const first = planBuy(
      emptyInventory(),
      characterId,
      40,
      "general_goods",
      "potion_hp_s",
      1,
      idFactory(),
    );
    const second = planBuy(
      emptyInventory(),
      characterId,
      40,
      "general_goods",
      "potion_hp_s",
      1,
      idFactory(),
    );
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
    ).toBe("no_gold");

    const [character] = await db.select().from(characters).where(eq(characters.id, characterId));
    expect(character?.gold).toBe(0);
    const rows = await db.select().from(items).where(eq(items.ownerCharacterId, characterId));
    expect(rows).toHaveLength(1);
  });

  it("sells part of a stack and the whole stack", async () => {
    const { db } = testDb;
    const { accountId, characterId } = await setup(db);
    const id = await insertInventory(db, characterId, "material_wolf_fang", 0, 5);
    const before = inventory([
      {
        id,
        itemId: "material_wolf_fang",
        slot: 0,
        quantity: 5,
        upgradeLevel: 0,
        bonuses: [],
      },
    ]);

    const partial = planSell(before, characterId, id, 2);
    await applyItemTransaction(db, { accountId, characterId }, partial.plan);
    let [row] = await db.select().from(items).where(eq(items.id, id));
    expect(row?.quantity).toBe(3);

    const all = planSell(partial.state, characterId, id, 3);
    await applyItemTransaction(db, { accountId, characterId }, all.plan);
    [row] = await db.select().from(items).where(eq(items.id, id));
    expect(row).toBeUndefined();

    const [character] = await db.select().from(characters).where(eq(characters.id, characterId));
    expect(character?.gold).toBe(500 + 5 * 12);
    const goldRows = await db.select().from(goldLog).where(eq(goldLog.characterId, characterId));
    expect(goldRows.at(-1)?.reason).toBe("shop_sell");
  });

  it("rejects selling an item that belongs to another character", async () => {
    const { db } = testDb;
    const owner = await setup(db);
    const other = await setup(db);
    const id = await insertInventory(db, owner.characterId, "material_wolf_fang", 0, 1);
    const state = inventory([
      {
        id,
        itemId: "material_wolf_fang",
        slot: 0,
        quantity: 1,
        upgradeLevel: 0,
        bonuses: [],
      },
    ]);
    expect(() => planSell(state, other.characterId, id, 1)).not.toThrow();
    // The plan is valid in memory; the executor rejects the ownership mismatch.
    await expect(
      applyItemTransaction(
        db,
        { accountId: other.accountId, characterId: other.characterId },
        planSell(state, other.characterId, id, 1).plan,
      ),
    ).rejects.toMatchObject({ code: "stale" });
  });
});

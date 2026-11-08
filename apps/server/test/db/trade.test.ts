import { randomUUID } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateCharacterRequest, ItemBonus, ItemStack } from "@jadethrone/shared";
import { registerAccount, type AuthDeps } from "../../src/auth/accountService";
import { createCharacter } from "../../src/characters/characterService";
import type { Db } from "../../src/db/client";
import { characters, goldLog, itemLog, items, tradeLog } from "../../src/db/schema";
import { createItemService } from "../../src/items/service";
import {
  TradeExecutionError,
  applyTradeTransaction,
  type TradeExecutionInput,
} from "../../src/items/tradeTransaction";
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
    name: `Trade${suffix()}`,
    classId: "warrior",
    gender: "male",
    hairStyle: 0,
    hairColor: 0,
  };
}

async function newCharacter(db: Db) {
  const account = await registerAccount(deps(db), {
    email: `trade${suffix()}@example.com`,
    username: `Trade${suffix()}`,
    password: "correct-horse-battery",
    kingdom: "ember",
  });
  const character = await createCharacter(db, account.account.id, input());
  await db.delete(items).where(eq(items.ownerCharacterId, character.id));
  return { accountId: account.account.id, characterId: character.id };
}

async function insertItem(
  db: Db,
  characterId: string,
  definitionId: string,
  slot: number,
  options: { quantity?: number; upgradeLevel?: number; bonuses?: ItemBonus[] } = {},
): Promise<string> {
  const id = randomUUID();
  await db.insert(items).values({
    id,
    definitionId,
    ownerCharacterId: characterId,
    location: "inventory",
    slot,
    quantity: options.quantity ?? 1,
    upgradeLevel: options.upgradeLevel ?? 0,
    bonuses: options.bonuses ?? [],
    createdBy: "test",
  });
  return id;
}

async function setGold(db: Db, characterId: string, gold: number) {
  await db.update(characters).set({ gold }).where(eq(characters.id, characterId));
}

function codeOf(fn: () => Promise<unknown>): Promise<string> {
  return fn().then(
    () => "none",
    (error) => {
      if (error instanceof TradeExecutionError) {
        return error.code;
      }
      throw error;
    },
  );
}

describeDb("trade transaction", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  async function pair() {
    const one = await newCharacter(testDb.db);
    const two = await newCharacter(testDb.db);
    return { db: testDb.db, one, two };
  }

  function tradeInput(
    tradeId: string,
    one: { accountId: string; characterId: string; gold: number; items: ItemStack[] },
    two: { accountId: string; characterId: string; gold: number; items: ItemStack[] },
  ): TradeExecutionInput {
    return {
      tradeId,
      revision: 2,
      mapId: "village",
      participants: [one, two],
    };
  }

  it("swaps items and gold exactly once and writes all three ledgers", async () => {
    const { db, one, two } = await pair();
    const service = createItemService(db);
    const swordId = await insertItem(db, one.characterId, "sword_ember_t1", 0, {
      upgradeLevel: 3,
      bonuses: [{ type: "attack", value: 5 }],
    });
    await insertItem(db, two.characterId, "armor_warrior_t1", 2);
    await setGold(db, one.characterId, 1_000);
    await setGold(db, two.characterId, 500);

    const oneBefore = await service.loadInventory(one.accountId, one.characterId);
    const twoBefore = await service.loadInventory(two.accountId, two.characterId);
    const tradeId = randomUUID();
    const result = await applyTradeTransaction(
      db,
      tradeInput(
        tradeId,
        {
          ...one,
          gold: 100,
          items: oneBefore.inventory.items,
        },
        {
          ...two,
          gold: 50,
          items: twoBefore.inventory.items,
        },
      ),
    );

    expect(result.goldByCharacter[one.characterId]).toBe(950);
    expect(result.goldByCharacter[two.characterId]).toBe(550);

    const oneAfter = await service.loadInventory(one.accountId, one.characterId);
    const twoAfter = await service.loadInventory(two.accountId, two.characterId);
    const movedSword = twoAfter.inventory.items.find((item) => item.id === swordId)!;
    expect(movedSword.upgradeLevel).toBe(3);
    expect(movedSword.bonuses).toEqual([{ type: "attack", value: 5 }]);
    expect(oneAfter.inventory.items.some((item) => item.itemId === "armor_warrior_t1")).toBe(
      true,
    );
    expect(oneAfter.inventory.items.some((item) => item.itemId === "sword_ember_t1")).toBe(
      false,
    );

    const goldRows = await db
      .select()
      .from(goldLog)
      .where(
        and(
          eq(goldLog.reason, "trade"),
          or(eq(goldLog.characterId, one.characterId), eq(goldLog.characterId, two.characterId)),
        ),
      );
    expect(goldRows).toHaveLength(2);
    expect(goldRows.every((row) => row.detail.tradeId === tradeId)).toBe(true);

    const itemRows = await db
      .select()
      .from(itemLog)
      .where(
        and(
          eq(itemLog.action, "trade"),
          or(
            eq(itemLog.actorCharacterId, one.characterId),
            eq(itemLog.actorCharacterId, two.characterId),
          ),
        ),
      );
    expect(itemRows).toHaveLength(2);
    expect(itemRows.every((row) => row.detail.tradeId === tradeId)).toBe(true);

    const [tradeRow] = await db.select().from(tradeLog).where(eq(tradeLog.id, tradeId));
    const firstIsA = one.characterId < two.characterId;
    expect(tradeRow?.goldA).toBe(firstIsA ? 100 : 50);
    expect(tradeRow?.goldB).toBe(firstIsA ? 50 : 100);
    expect(tradeRow?.itemsA).toHaveLength(1);
    expect(tradeRow?.itemsB).toHaveLength(1);
  });

  it("rejects a full receiver and changes nothing", async () => {
    const { db, one, two } = await pair();
    const service = createItemService(db);
    const swordId = await insertItem(db, one.characterId, "sword_ember_t1", 0);
    for (let slot = 0; slot < 90; slot += 1) {
      await insertItem(db, two.characterId, "potion_hp_s", slot);
    }
    await setGold(db, one.characterId, 0);
    await setGold(db, two.characterId, 0);

    const oneBefore = await service.loadInventory(one.accountId, one.characterId);
    const tradeId = randomUUID();
    const code = await codeOf(() =>
      applyTradeTransaction(
        db,
        tradeInput(
          tradeId,
          { ...one, gold: 0, items: oneBefore.inventory.items },
          { ...two, gold: 0, items: [] },
        ),
      ),
    );
    expect(code).toBe("inventory_full");

    const [row] = await db.select().from(items).where(eq(items.id, swordId));
    expect(row?.ownerCharacterId).toBe(one.characterId);
    expect(await db.select().from(tradeLog).where(eq(tradeLog.id, tradeId))).toHaveLength(0);
  });

  it("rejects a stale item and insufficient gold without writes", async () => {
    const { db, one, two } = await pair();
    const service = createItemService(db);
    const swordId = await insertItem(db, one.characterId, "sword_ember_t1", 0);
    await setGold(db, one.characterId, 100);
    await setGold(db, two.characterId, 0);

    const oneBefore = await service.loadInventory(one.accountId, one.characterId);
    const frozen = oneBefore.inventory.items;
    await db.update(items).set({ slot: 1 }).where(eq(items.id, swordId));

    const staleTradeId = randomUUID();
    expect(
      await codeOf(() =>
        applyTradeTransaction(
          db,
          tradeInput(
            staleTradeId,
            { ...one, gold: 0, items: frozen },
            { ...two, gold: 0, items: [] },
          ),
        ),
      ),
    ).toBe("stale");

    const fresh = await service.loadInventory(one.accountId, one.characterId);
    const goldTradeId = randomUUID();
    expect(
      await codeOf(() =>
        applyTradeTransaction(
          db,
          tradeInput(
            goldTradeId,
            { ...one, gold: 101, items: fresh.inventory.items },
            { ...two, gold: 0, items: [] },
          ),
        ),
      ),
    ).toBe("no_gold");

    const [row] = await db.select().from(items).where(eq(items.id, swordId));
    expect(row?.ownerCharacterId).toBe(one.characterId);
    const [character] = await db
      .select()
      .from(characters)
      .where(eq(characters.id, one.characterId));
    expect(character?.gold).toBe(100);
  });

  it("rolls back when the trade id was already used", async () => {
    const { db, one, two } = await pair();
    const service = createItemService(db);
    const swordId = await insertItem(db, one.characterId, "sword_ember_t1", 0);
    await setGold(db, one.characterId, 0);
    await setGold(db, two.characterId, 0);
    const oneBefore = await service.loadInventory(one.accountId, one.characterId);

    const tradeId = randomUUID();
    await db.insert(tradeLog).values({
      id: tradeId,
      revision: 0,
      mapId: "village",
      characterAId: one.characterId,
      accountAId: one.accountId,
      characterBId: two.characterId,
      accountBId: two.accountId,
      goldA: 0,
      goldB: 0,
      itemsA: [],
      itemsB: [],
    });

    expect(
      await codeOf(() =>
        applyTradeTransaction(
          db,
          tradeInput(
            tradeId,
            { ...one, gold: 0, items: oneBefore.inventory.items },
            { ...two, gold: 0, items: [] },
          ),
        ),
      ),
    ).toBe("stale");

    const [row] = await db.select().from(items).where(eq(items.id, swordId));
    expect(row?.ownerCharacterId).toBe(one.characterId);
  });

  it("serialises two concurrent trades for the same item", async () => {
    const { db, one, two } = await pair();
    const service = createItemService(db);
    const swordId = await insertItem(db, one.characterId, "sword_ember_t1", 0);
    await setGold(db, one.characterId, 0);
    await setGold(db, two.characterId, 0);
    const oneBefore = await service.loadInventory(one.accountId, one.characterId);

    const input = () =>
      tradeInput(
        randomUUID(),
        { ...one, gold: 0, items: oneBefore.inventory.items },
        { ...two, gold: 0, items: [] },
      );
    const results = await Promise.allSettled([
      applyTradeTransaction(db, input()),
      applyTradeTransaction(db, input()),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toBeInstanceOf(TradeExecutionError);
      expect(["stale", "not_owner"]).toContain(
        (rejected.reason as TradeExecutionError).code,
      );
    }

    const rows = await db.select().from(items).where(eq(items.id, swordId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ownerCharacterId).toBe(two.characterId);
  });

  it("skips zero-delta gold logs but still writes the trade log", async () => {
    const { db, one, two } = await pair();
    const service = createItemService(db);
    await insertItem(db, one.characterId, "potion_hp_s", 0);
    await insertItem(db, two.characterId, "potion_mp_s", 0);
    await setGold(db, one.characterId, 0);
    await setGold(db, two.characterId, 0);
    const oneBefore = await service.loadInventory(one.accountId, one.characterId);
    const twoBefore = await service.loadInventory(two.accountId, two.characterId);
    const tradeId = randomUUID();

    await applyTradeTransaction(
      db,
      tradeInput(
        tradeId,
        { ...one, gold: 0, items: oneBefore.inventory.items },
        { ...two, gold: 0, items: twoBefore.inventory.items },
      ),
    );

    const goldRows = await db
      .select()
      .from(goldLog)
      .where(and(eq(goldLog.reason, "trade"), eq(goldLog.characterId, one.characterId)));
    expect(goldRows).toHaveLength(0);
    expect(await db.select().from(tradeLog).where(eq(tradeLog.id, tradeId))).toHaveLength(1);
  });
});

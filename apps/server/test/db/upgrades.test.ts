import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateCharacterRequest, ItemBonus } from "@jadethrone/shared";
import { registerAccount, type AuthDeps } from "../../src/auth/accountService";
import { createCharacter } from "../../src/characters/characterService";
import type { Db } from "../../src/db/client";
import { characters, goldLog, itemLog, items } from "../../src/db/schema";
import { createItemService } from "../../src/items/service";
import { planUpgrade } from "../../src/items/upgrade";
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
    name: `Up${suffix()}`,
    classId: "warrior",
    gender: "male",
    hairStyle: 0,
    hairColor: 0,
  };
}

async function setup(db: Db) {
  const account = await registerAccount(deps(db), {
    email: `up${suffix()}@example.com`,
    username: `Up${suffix()}`,
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
  quantity = 1,
  upgradeLevel = 0,
  bonuses: ItemBonus[] = [],
): Promise<string> {
  const id = randomUUID();
  await db.insert(items).values({
    id,
    definitionId,
    ownerCharacterId: characterId,
    location: "inventory",
    slot,
    quantity,
    upgradeLevel,
    bonuses,
    createdBy: "test",
  });
  return id;
}

describeDb("upgrade persistence", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("persists a +4 to +5 upgrade with material, gold and logs in one commit", async () => {
    const { db } = testDb;
    const { accountId, characterId } = await setup(db);
    const service = createItemService(db);
    const swordId = await insertItem(db, characterId, "sword_ember_t1", 0, 1, 4);
    const fangId = await insertItem(db, characterId, "material_wolf_fang", 1, 2);
    await db.update(characters).set({ gold: 15_000 }).where(eq(characters.id, characterId));

    const before = await service.loadInventory(accountId, characterId);
    const result = planUpgrade(before.inventory, before.gold, characterId, swordId, {
      useBlessing: false,
      rng: { next: () => 0.1 },
    });
    expect(result.success).toBe(true);
    expect(result.level).toBe(5);

    const applied = await service.apply(accountId, characterId, result.plan);
    expect(applied.gold).toBe(0);

    const after = await service.loadInventory(accountId, characterId);
    expect(after.gold).toBe(0);
    expect(after.inventory.items.find((item) => item.id === swordId)?.upgradeLevel).toBe(5);
    expect(after.inventory.items.some((item) => item.id === fangId)).toBe(false);

    const logs = await db
      .select()
      .from(itemLog)
      .where(and(eq(itemLog.itemId, swordId), eq(itemLog.action, "upgrade_success")));
    expect(logs).toHaveLength(1);

    const goldLogs = await db
      .select()
      .from(goldLog)
      .where(and(eq(goldLog.characterId, characterId), eq(goldLog.reason, "upgrade")));
    expect(goldLogs).toHaveLength(1);
    expect(goldLogs[0]?.delta).toBe(-15_000);
  });

  it("deletes the item row on a failed upgrade", async () => {
    const { db } = testDb;
    const { accountId, characterId } = await setup(db);
    const service = createItemService(db);
    const swordId = await insertItem(db, characterId, "sword_ember_t1", 0, 1, 3);
    await insertItem(db, characterId, "material_wolf_fang", 1, 1);
    await db.update(characters).set({ gold: 8_000 }).where(eq(characters.id, characterId));

    const before = await service.loadInventory(accountId, characterId);
    const result = planUpgrade(before.inventory, before.gold, characterId, swordId, {
      useBlessing: false,
      rng: { next: () => 0.99 },
    });
    expect(result.destroyed).toBe(true);

    await service.apply(accountId, characterId, result.plan);
    const rows = await db.select().from(items).where(eq(items.ownerCharacterId, characterId));
    expect(rows).toHaveLength(0);
  });
});

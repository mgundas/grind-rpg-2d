import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultSpawn } from "../../src/characters/spawn";
import type { CreateCharacterRequest, ItemStack } from "@jadethrone/shared";
import { registerAccount, type AuthDeps } from "../../src/auth/accountService";
import {
  createCharacter,
  getCharacterForAccount,
  saveCharacterState,
  type CharacterSave,
} from "../../src/characters/characterService";
import type { Db } from "../../src/db/client";
import { characters, itemLog, items } from "../../src/db/schema";
import { ItemError } from "../../src/items/errors";
import { applyItemTransaction } from "../../src/items/itemTransactions";
import { planEquip, planMove } from "../../src/items/planning";
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
    name: `Inv${suffix()}`,
    classId: "warrior",
    gender: "male",
    hairStyle: 0,
    hairColor: 0,
    ...overrides,
  };
}

async function setup(db: Db) {
  const account = await registerAccount(deps(db), {
    email: `inv${suffix()}@example.com`,
    username: `Inv${suffix()}`,
    password: "correct-horse-battery",
    kingdom: "ember",
  });
  const character = await createCharacter(db, account.account.id, input());
  await db.delete(items).where(eq(items.ownerCharacterId, character.id));
  return { accountId: account.account.id, characterId: character.id };
}

async function insertStack(
  db: Db,
  characterId: string,
  definitionId: string,
  slot: number,
  quantity = 1,
  location: "inventory" | "equipment" = "inventory",
): Promise<string> {
  const id = randomUUID();
  await db.insert(items).values({
    id,
    definitionId,
    ownerCharacterId: characterId,
    location,
    slot,
    quantity,
    createdBy: "test",
  });
  return id;
}

function stack(id: string, itemId: string, slot: number, quantity = 1): ItemStack {
  return { id, itemId, slot, quantity, upgradeLevel: 0, bonuses: [] };
}

function save(overrides: Partial<CharacterSave> = {}): CharacterSave {
  const spawn = defaultSpawn();
  return {
    mapId: spawn.mapId,
    x: spawn.x,
    y: spawn.y,
    hp: 316,
    mp: 92,
    xp: 0,
    level: 1,
    statVit: 4,
    statInt: 3,
    statStr: 6,
    statDex: 3,
    statPoints: 0,
    doctrine: null,
    skillPoints: 0,
    ...overrides,
  };
}

describeDb("inventory mutation transactions", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("moves an item and writes a move log", async () => {
    const { db } = testDb;
    const { accountId, characterId } = await setup(db);
    const id = await insertStack(db, characterId, "potion_hp_s", 0, 5);
    const state = {
      items: [stack(id, "potion_hp_s", 0, 5)],
      equipment: Array.from({ length: 8 }, () => null),
    };

    const plan = planMove(state, characterId, id, 7);
    await applyItemTransaction(db, { accountId, characterId }, plan.plan);

    const [row] = await db.select().from(items).where(eq(items.id, id));
    expect(row?.slot).toBe(7);
    const logs = await db.select().from(itemLog).where(eq(itemLog.itemId, id));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe("move");
    expect(logs[0]?.fromSlot).toBe(0);
    expect(logs[0]?.toSlot).toBe(7);
  });

  it("swaps two rows without tripping the unique slot index", async () => {
    const { db } = testDb;
    const { accountId, characterId } = await setup(db);
    const a = await insertStack(db, characterId, "potion_hp_s", 0, 1);
    const b = await insertStack(db, characterId, "material_wolf_fang", 1, 1);
    const state = {
      items: [stack(a, "potion_hp_s", 0), stack(b, "material_wolf_fang", 1)],
      equipment: Array.from({ length: 8 }, () => null),
    };

    const plan = planMove(state, characterId, a, 1);
    await applyItemTransaction(db, { accountId, characterId }, plan.plan);

    const rows = await db.select().from(items).where(eq(items.ownerCharacterId, characterId));
    expect(rows.find((row) => row.id === a)?.slot).toBe(1);
    expect(rows.find((row) => row.id === b)?.slot).toBe(0);
  });

  it("equips a weapon and moves the old one back", async () => {
    const { db } = testDb;
    const { accountId, characterId } = await setup(db);
    const old = await insertStack(db, characterId, "sword_ember_t1", 0, 1, "equipment");
    const next = await insertStack(db, characterId, "sword_ember_t1", 2, 1);
    const state = {
      items: [stack(next, "sword_ember_t1", 2)],
      equipment: [stack(old, "sword_ember_t1", 0), ...Array.from({ length: 7 }, () => null)],
    };

    const plan = planEquip(state, characterId, "warrior", 1, next);
    await applyItemTransaction(db, { accountId, characterId }, plan.plan);

    const rows = await db.select().from(items).where(eq(items.ownerCharacterId, characterId));
    expect(rows.find((row) => row.id === next)?.location).toBe("equipment");
    expect(rows.find((row) => row.id === next)?.slot).toBe(0);
    expect(rows.find((row) => row.id === old)?.location).toBe("inventory");
    expect(rows.find((row) => row.id === old)?.slot).toBe(2);
  });

  it("rejects a stale plan without writing anything", async () => {
    const { db } = testDb;
    const { accountId, characterId } = await setup(db);
    const id = await insertStack(db, characterId, "potion_hp_s", 0, 5);
    const state = {
      items: [stack(id, "potion_hp_s", 0, 5)],
      equipment: Array.from({ length: 8 }, () => null),
    };
    const plan = planMove(state, characterId, id, 7);

    await db.update(items).set({ slot: 1 }).where(eq(items.id, id));
    await expect(
      applyItemTransaction(db, { accountId, characterId }, plan.plan),
    ).rejects.toMatchObject({ code: "stale" });

    const [row] = await db.select().from(items).where(eq(items.id, id));
    expect(row?.slot).toBe(1);
    const logs = await db.select().from(itemLog).where(eq(itemLog.itemId, id));
    expect(logs).toHaveLength(0);
  });

  it("lets exactly one of two concurrent identical moves win", async () => {
    const { db } = testDb;
    const { accountId, characterId } = await setup(db);
    const id = await insertStack(db, characterId, "potion_hp_s", 0, 5);
    const state = {
      items: [stack(id, "potion_hp_s", 0, 5)],
      equipment: Array.from({ length: 8 }, () => null),
    };
    const first = planMove(state, characterId, id, 7);
    const second = planMove(state, characterId, id, 7);

    const results = await Promise.allSettled([
      applyItemTransaction(db, { accountId, characterId }, first.plan),
      applyItemTransaction(db, { accountId, characterId }, second.plan),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected && rejected.status === "rejected" ? (rejected.reason as ItemError).code : null).toBe(
      "stale",
    );
  });

  it("does not let a character save overwrite gold changed by an item transaction", async () => {
    const { db } = testDb;
    const { accountId, characterId } = await setup(db);
    await applyItemTransaction(db, { accountId, characterId }, {
      changes: [],
      logs: [],
      gold: { delta: 125, reason: "pickup", detail: { test: true } },
    });
    await saveCharacterState(db, characterId, save());
    const record = await getCharacterForAccount(db, accountId, characterId);
    expect(record?.gold).toBe(625);
    const [row] = await db.select().from(characters).where(eq(characters.id, characterId));
    expect(row?.gold).toBe(625);
  });
});

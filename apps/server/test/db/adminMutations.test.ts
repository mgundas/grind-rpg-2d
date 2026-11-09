import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VILLAGE_SPAWN } from "@jadethrone/data";
import type { CreateCharacterRequest } from "@jadethrone/shared";
import { registerAccount, type AuthDeps } from "../../src/auth/accountService";
import { createCharacter } from "../../src/characters/characterService";
import type { Db } from "../../src/db/client";
import { accounts, adminLog, characters, goldLog, itemLog, items } from "../../src/db/schema";
import {
  PERMANENT_BAN_UNTIL,
  banAccount,
  grantItemOffline,
  removeItemOffline,
  unbanAccount,
  updateCharacterOffline,
} from "../../src/admin/adminMutations";
import { createTestDb, hasTestDatabase, type TestDb } from "../db/testDb";

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
    name: `Mut${suffix()}`,
    classId: "warrior",
    gender: "male",
    hairStyle: 0,
    hairColor: 0,
  };
}

async function setup(db: Db) {
  const account = await registerAccount(deps(db), {
    email: `mut${suffix()}@example.com`,
    username: `Mut${suffix()}`,
    password: "correct-horse-battery",
    kingdom: "ember",
  });
  const character = await createCharacter(db, account.account.id, input());
  return { accountId: account.account.id, characterId: character.id };
}

describeDb("admin mutations", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("bans an account, bumps the token version and audits it", async () => {
    const { db } = testDb;
    const target = await setup(db);
    const [before] = await db.select().from(accounts).where(eq(accounts.id, target.accountId));

    const result = await banAccount(db, {
      actorAccountId: target.accountId,
      accountId: target.accountId,
      ban: { durationMinutes: 60, reason: "test" },
      ip: "127.0.0.1",
    });
    expect(result.bannedUntil).toBeTruthy();
    const [after] = await db.select().from(accounts).where(eq(accounts.id, target.accountId));
    expect(after?.banReason).toBe("test");
    expect(after?.bannedUntil?.getTime()).toBeGreaterThan(Date.now());
    expect(after?.tokenVersion).toBe((before?.tokenVersion ?? 0) + 1);

    const logs = await db
      .select()
      .from(adminLog)
      .where(
        and(eq(adminLog.targetAccountId, target.accountId), eq(adminLog.action, "account_ban")),
      );
    expect(logs).toHaveLength(1);
  });

  it("supports permanent bans and unbanning", async () => {
    const { db } = testDb;
    const target = await setup(db);
    await banAccount(db, {
      actorAccountId: target.accountId,
      accountId: target.accountId,
      ban: { durationMinutes: null },
    });
    const [banned] = await db.select().from(accounts).where(eq(accounts.id, target.accountId));
    expect(banned?.bannedUntil?.toISOString()).toBe(PERMANENT_BAN_UNTIL.toISOString());

    await unbanAccount(db, { actorAccountId: target.accountId, accountId: target.accountId });
    const [unbanned] = await db.select().from(accounts).where(eq(accounts.id, target.accountId));
    expect(unbanned?.bannedUntil).toBeNull();
    expect(unbanned?.banReason).toBeNull();
  });

  it("updates offline level, stats, gold and position with ledgers", async () => {
    const { db } = testDb;
    const target = await setup(db);

    const result = await updateCharacterOffline(db, {
      actorAccountId: target.accountId,
      characterId: target.characterId,
      update: {
        level: 10,
        statVit: 10,
        gold: 1000,
        x: VILLAGE_SPAWN.x,
        y: VILLAGE_SPAWN.y,
      },
    });
    expect(result).toMatchObject({ level: 10, gold: 1000 });
    const [row] = await db.select().from(characters).where(eq(characters.id, target.characterId));
    expect(row?.level).toBe(10);
    expect(row?.xp).toBe(0);
    expect(row?.statVit).toBe(10);
    expect(row?.gold).toBe(1000);
    expect(row?.hp).toBeLessThanOrEqual(880);

    const goldRows = await db
      .select()
      .from(goldLog)
      .where(eq(goldLog.characterId, target.characterId));
    expect(goldRows.some((gold) => gold.reason === "admin" && gold.delta === 500)).toBe(true);
    const logs = await db
      .select()
      .from(adminLog)
      .where(
        and(
          eq(adminLog.targetCharacterId, target.characterId),
          eq(adminLog.action, "character_update"),
        ),
      );
    expect(logs).toHaveLength(1);
  });

  it("rejects an unwalkable offline position", async () => {
    const { db } = testDb;
    const target = await setup(db);
    await expect(
      updateCharacterOffline(db, {
        actorAccountId: target.accountId,
        characterId: target.characterId,
        update: { x: 0, y: 0 },
      }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("grants a +5 item offline and removes it again", async () => {
    const { db } = testDb;
    const target = await setup(db);
    const granted = await grantItemOffline(db, {
      actorAccountId: target.accountId,
      characterId: target.characterId,
      request: {
        definitionId: "sword_ember_t1",
        quantity: 1,
        upgradeLevel: 5,
        bonuses: [],
      },
    });
    expect(granted.upgradeLevel).toBe(5);
    const [row] = await db.select().from(items).where(eq(items.id, granted.id));
    expect(row?.definitionId).toBe("sword_ember_t1");
    expect(row?.upgradeLevel).toBe(5);
    const logs = await db.select().from(itemLog).where(eq(itemLog.itemId, granted.id));
    expect(logs.some((log) => log.action === "admin_grant")).toBe(true);
    const auditRows = await db
      .select()
      .from(adminLog)
      .where(
        and(eq(adminLog.targetCharacterId, target.characterId), eq(adminLog.action, "item_grant")),
      );
    expect(auditRows).toHaveLength(1);

    await removeItemOffline(db, {
      actorAccountId: target.accountId,
      characterId: target.characterId,
      itemId: granted.id,
    });
    const removed = await db.select().from(items).where(eq(items.id, granted.id));
    expect(removed).toHaveLength(0);
  });

  it("aborts an offline grant or removal when the character is online", async () => {
    const { db } = testDb;
    const target = await setup(db);
    const before = await db
      .select()
      .from(items)
      .where(eq(items.ownerCharacterId, target.characterId));

    await expect(
      grantItemOffline(db, {
        actorAccountId: target.accountId,
        characterId: target.characterId,
        request: {
          definitionId: "sword_ember_t1",
          quantity: 1,
          upgradeLevel: 5,
          bonuses: [],
        },
        isOnline: () => true,
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    const afterGrant = await db
      .select()
      .from(items)
      .where(eq(items.ownerCharacterId, target.characterId));
    expect(afterGrant).toHaveLength(before.length);

    const starter = before.find((row) => row.definitionId === "sword_ember_t1");
    expect(starter).toBeDefined();
    await expect(
      removeItemOffline(db, {
        actorAccountId: target.accountId,
        characterId: target.characterId,
        itemId: starter!.id,
        isOnline: () => true,
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    const afterRemove = await db.select().from(items).where(eq(items.id, starter!.id));
    expect(afterRemove).toHaveLength(1);
  });

  it("refuses an offline grant when the bag is full", async () => {
    const { db } = testDb;
    const target = await setup(db);
    await db.delete(items).where(eq(items.ownerCharacterId, target.characterId));
    await db.insert(items).values(
      Array.from({ length: 90 }, (_, slot) => ({
        id: randomUUID(),
        definitionId: "potion_hp_s",
        ownerCharacterId: target.characterId,
        location: "inventory",
        slot,
        quantity: 100,
        createdBy: "test",
      })),
    );

    await expect(
      grantItemOffline(db, {
        actorAccountId: target.accountId,
        characterId: target.characterId,
        request: {
          definitionId: "sword_ember_t1",
          quantity: 1,
          upgradeLevel: 5,
          bonuses: [],
        },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

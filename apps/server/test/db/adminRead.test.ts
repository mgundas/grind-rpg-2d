import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateCharacterRequest } from "@jadethrone/shared";
import { registerAccount, type AuthDeps } from "../../src/auth/accountService";
import { createCharacter } from "../../src/characters/characterService";
import type { Db } from "../../src/db/client";
import { adminLog, chatLog, goldLog, itemLog, items, tradeLog } from "../../src/db/schema";
import { writeAdminLog } from "../../src/admin/adminLog";
import {
  dashboard,
  getCharacterDetail,
  listAdminLogs,
  listChatLogs,
  listGoldLogs,
  listItemLogs,
  listTradeLogs,
  searchAccountsAndCharacters,
} from "../../src/admin/adminService";
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

function input(name: string): CreateCharacterRequest {
  return {
    name,
    classId: "warrior",
    gender: "male",
    hairStyle: 0,
    hairColor: 0,
  };
}

async function accountWithCharacter(db: Db, characterName: string) {
  const account = await registerAccount(deps(db), {
    email: `adminread${suffix()}@example.com`,
    username: `Read${suffix()}`,
    password: "correct-horse-battery",
    kingdom: "ember",
  });
  const character = await createCharacter(db, account.account.id, input(characterName));
  return { accountId: account.account.id, characterId: character.id, account };
}

describeDb("admin read service", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("searches accounts by email and characters by name", async () => {
    const { db } = testDb;
    const owner = await accountWithCharacter(db, `Search${suffix()}`);
    const accountRows = await searchAccountsAndCharacters(
      db,
      owner.account.account.email,
      25,
      0,
    );
    expect(accountRows.accounts.some((row) => row.id === owner.accountId)).toBe(true);

    const allRows = await searchAccountsAndCharacters(db, "", 25, 0);
    expect(allRows.accounts.length).toBeGreaterThan(0);

    const named = await searchAccountsAndCharacters(db, "Search", 25, 0);
    expect(named.characters.some((row) => row.id === owner.characterId)).toBe(true);
    expect(named.characters.find((row) => row.id === owner.characterId)?.online).toBe(false);
  });

  it("loads full character detail with starter gear and warehouse", async () => {
    const { db } = testDb;
    const owner = await accountWithCharacter(db, `Detail${suffix()}`);
    const warehouseId = randomUUID();
    await db.insert(items).values({
      id: warehouseId,
      definitionId: "material_wolf_fang",
      ownerAccountId: owner.accountId,
      location: "warehouse",
      slot: 0,
      quantity: 2,
      createdBy: "test",
    });

    const detail = await getCharacterDetail(db, owner.characterId);
    expect(detail?.character.id).toBe(owner.characterId);
    expect(detail?.character.level).toBe(1);
    expect(detail?.character.stats.vit).toBe(4);
    expect(detail?.inventory.some((item) => item.itemId === "potion_hp_s")).toBe(true);
    expect(detail?.equipment[0]?.itemId).toBe("sword_ember_t1");
    expect(detail?.warehouse[0]?.id).toBe(warehouseId);
    expect(detail?.account.characters.some((row) => row.id === owner.characterId)).toBe(true);
  });

  it("lists and filters item, gold, admin and chat logs", async () => {
    const { db } = testDb;
    const owner = await accountWithCharacter(db, `Logs${suffix()}`);
    const itemId = randomUUID();
    const marker = `marker-${suffix()}`;

    await db.insert(itemLog).values({
      id: randomUUID(),
      itemId,
      actorCharacterId: owner.characterId,
      accountId: owner.accountId,
      action: "admin_grant",
      definitionId: marker,
      quantity: 1,
      toLocation: "inventory",
      toSlot: 0,
      detail: { source: "test" },
    });
    await db.insert(goldLog).values({
      id: randomUUID(),
      characterId: owner.characterId,
      accountId: owner.accountId,
      delta: 10,
      balanceAfter: 510,
      reason: "admin",
      detail: { source: "test" },
    });
    await db.insert(adminLog).values({
      id: randomUUID(),
      actorAccountId: owner.accountId,
      action: "test_action",
      targetAccountId: owner.accountId,
      targetCharacterId: owner.characterId,
      detail: { marker },
    });
    await db.insert(chatLog).values({
      id: randomUUID(),
      characterId: owner.characterId,
      name: "Logs",
      kingdom: "ember",
      mapId: "map_ember_village",
      channel: "guild",
      chatText: `${marker} hello`,
    });

    const itemRows = await listItemLogs(db, {
      characterId: owner.characterId,
      itemId,
      limit: 10,
      offset: 0,
    });
    expect(itemRows).toHaveLength(1);
    expect(itemRows[0]?.action).toBe("admin_grant");
    expect(itemRows[0]?.characterName).toBeTruthy();

    const goldRows = await listGoldLogs(db, {
      characterId: owner.characterId,
      limit: 10,
      offset: 0,
    });
    expect(goldRows[0]?.delta).toBe(10);

    const adminRows = await listAdminLogs(db, {
      characterId: owner.characterId,
      limit: 10,
      offset: 0,
    });
    expect(adminRows.some((row) => row.action === "test_action")).toBe(true);

    const chatRows = await listChatLogs(db, {
      characterId: owner.characterId,
      q: marker,
      limit: 10,
      offset: 0,
    });
    expect(chatRows[0]?.detail?.text).toContain(marker);
    expect(chatRows[0]?.channel).toBe("guild");
  });

  it("lists trade logs with participant, gold and trade-id filters", async () => {
    const { db } = testDb;
    const first = await accountWithCharacter(db, `TradeA${suffix()}`);
    const second = await accountWithCharacter(db, `TradeB${suffix()}`);
    const tradeId = randomUUID();
    await db.insert(tradeLog).values({
      id: tradeId,
      revision: 3,
      mapId: "map_ember_village",
      characterAId: first.characterId,
      accountAId: first.accountId,
      characterBId: second.characterId,
      accountBId: second.accountId,
      goldA: 25,
      goldB: 0,
      itemsA: [
        {
          instanceId: randomUUID(),
          itemId: "potion_hp_s",
          quantity: 1,
          upgradeLevel: 0,
          bonuses: [],
          fromSlot: 0,
          toSlot: 0,
        },
      ],
      itemsB: [],
    });

    const byTrade = await listTradeLogs(db, { tradeId, limit: 10, offset: 0 });
    expect(byTrade).toHaveLength(1);
    expect(byTrade[0]?.action).toBe("trade");
    expect(byTrade[0]?.characterName).toContain("Trade");
    expect(byTrade[0]?.detail?.goldA).toBe(25);
    expect(Array.isArray(byTrade[0]?.detail?.itemsA)).toBe(true);

    const byCharacter = await listTradeLogs(db, {
      characterId: second.characterId,
      limit: 10,
      offset: 0,
    });
    expect(byCharacter.map((row) => row.id)).toContain(tradeId);

    const bySearch = await listTradeLogs(db, { q: tradeId, limit: 10, offset: 0 });
    expect(bySearch.map((row) => row.id)).toContain(tradeId);

    const missing = await listTradeLogs(db, {
      tradeId: randomUUID(),
      limit: 10,
      offset: 0,
    });
    expect(missing).toHaveLength(0);
  });

  it("writes an admin audit row", async () => {
    const { db } = testDb;
    const owner = await accountWithCharacter(db, `Audit${suffix()}`);
    const action = `audit_${suffix()}`;
    await writeAdminLog(db, {
      actorAccountId: owner.accountId,
      action,
      targetCharacterId: owner.characterId,
      detail: { test: true },
      ip: "127.0.0.1",
    });
    const rows = await listAdminLogs(db, { q: action, limit: 5, offset: 0 });
    expect(rows.some((row) => row.action === action)).toBe(true);
  });

  it("builds a dashboard snapshot from DB and live presence", async () => {
    const { db } = testDb;
    await accountWithCharacter(db, `Dash${suffix()}`);
    const players = [
      {
        accountId: randomUUID(),
        characterId: randomUUID(),
        sessionId: "s1",
        name: "A",
        classId: "warrior",
        mapId: "map_ember_village",
        channel: 1,
        level: 1,
        role: "player" as const,
        x: 1,
        y: 2,
        hp: 10,
        maxHp: 10,
        dead: false,
      },
      {
        accountId: randomUUID(),
        characterId: randomUUID(),
        sessionId: "s2",
        name: "B",
        classId: "assassin",
        mapId: "map_ember_village",
        channel: 1,
        level: 2,
        role: "player" as const,
        x: 3,
        y: 4,
        hp: 10,
        maxHp: 10,
        dead: false,
      },
      {
        accountId: randomUUID(),
        characterId: randomUUID(),
        sessionId: "s3",
        name: "C",
        classId: "mystic",
        mapId: "map_ember_fields",
        channel: 1,
        level: 3,
        role: "player" as const,
        x: 5,
        y: 6,
        hp: 10,
        maxHp: 10,
        dead: false,
      },
    ];
    const snapshot = await dashboard(db, {
      list: () => players,
      history: () => [{ atMs: 1, online: 3 }],
    });
    expect(snapshot.online.total).toBe(3);
    expect(snapshot.online.byMap).toEqual([
      { mapId: "map_ember_fields", channel: 1, count: 1 },
      { mapId: "map_ember_village", channel: 1, count: 2 },
    ]);
    expect(snapshot.registrationsToday).toBeGreaterThan(0);
    expect(snapshot.goldInEconomy).toBeGreaterThanOrEqual(500);
    expect(snapshot.history).toEqual([{ atMs: 1, online: 3 }]);
  });
});

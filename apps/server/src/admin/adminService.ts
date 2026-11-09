import os from "node:os";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import type {
  AccountRole,
  AdminAccountSummary,
  AdminAnnouncementRow,
  AdminCharacterDetail,
  AdminCharacterSummary,
  AdminDashboardResponse,
  AdminLogRow,
  AdminLogQuery,
  AdminOnlinePlayer,
  AdminSearchResponse,
} from "@jadethrone/shared";
import type { Db } from "../db/client";
import {
  accounts,
  adminLog,
  announcements,
  characters,
  chatLog,
  goldLog,
  itemLog,
  tradeLog,
  type AccountRow,
  type AnnouncementRow,
  type CharacterRow,
} from "../db/schema";
import { toCharacterRecord } from "../characters/characterMappers";
import { progressionFromCharacter } from "../characters/progression";
import { equipmentBonusStats } from "../items/equipment";
import { toItemDto } from "../items/itemMappers";
import { loadInventory, loadWarehouse } from "../items/itemRepository";
import { isBanned } from "../auth/accountService";

/** Minimal read surface the live admin bus must provide. */
export interface AdminRoomInfo {
  roomId: string;
  mapId: string;
  startedAtMs: number;
  maxClients: number;
  players: number;
}

export interface AdminOnlineSource {
  list(): AdminOnlinePlayer[];
  history(): Array<{ atMs: number; online: number }>;
  rooms?(): AdminRoomInfo[];
}

function roleOf(value: string): AccountRole {
  return value === "admin" || value === "gm" ? value : "player";
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function pattern(q: string): string {
  return `%${q}%`;
}

function whereAll(parts: Array<ReturnType<typeof eq> | undefined>) {
  const filtered = parts.filter((part): part is NonNullable<typeof part> => Boolean(part));
  return filtered.length === 0 ? undefined : and(...filtered);
}

function toCharacterSummary(
  row: CharacterRow,
  account: AccountRow,
  online: boolean,
): AdminCharacterSummary {
  return {
    id: row.id,
    accountId: row.accountId,
    accountEmail: account.email,
    accountUsername: account.username,
    name: row.name,
    classId: row.classId as AdminCharacterSummary["classId"],
    level: row.level,
    mapId: row.mapId,
    gold: row.gold,
    online,
    role: roleOf(account.role),
    banned: isBanned(account.bannedUntil),
    bannedUntil: iso(account.bannedUntil),
    banReason: account.banReason,
  };
}

function toAccountSummary(
  account: AccountRow,
  characterRows: ReadonlyArray<CharacterRow>,
  isOnline: (characterId: string) => boolean,
): AdminAccountSummary {
  return {
    id: account.id,
    email: account.email,
    username: account.username,
    role: roleOf(account.role),
    banned: isBanned(account.bannedUntil),
    bannedUntil: iso(account.bannedUntil),
    banReason: account.banReason,
    characters: characterRows.map((row) => toCharacterSummary(row, account, isOnline(row.id))),
  };
}

/**
 * Search accounts by email/username and characters by name. The admin UI shows
 * one result list but keeps both shapes so account-only matches (no character)
 * are visible too.
 */
export async function searchAccountsAndCharacters(
  db: Db,
  q: string,
  limit: number,
  offset: number,
  isOnline: (characterId: string) => boolean = () => false,
): Promise<AdminSearchResponse> {
  const accountWhere = q
    ? or(ilike(accounts.email, pattern(q)), ilike(accounts.username, pattern(q)))
    : undefined;
  const characterWhere = q ? ilike(characters.name, pattern(q)) : undefined;

  const matchedAccounts = await db
    .select()
    .from(accounts)
    .where(accountWhere)
    .orderBy(desc(accounts.createdAt))
    .limit(limit)
    .offset(offset);

  const matchedCharacters = await db
    .select({ character: characters, account: accounts })
    .from(characters)
    .innerJoin(accounts, eq(characters.accountId, accounts.id))
    .where(characterWhere)
    .orderBy(desc(characters.createdAt))
    .limit(limit)
    .offset(offset);

  const accountIds = [
    ...new Set([
      ...matchedAccounts.map((row) => row.id),
      ...matchedCharacters.map((row) => row.account.id),
    ]),
  ];

  const allRows =
    accountIds.length === 0
      ? []
      : await db.select().from(characters).where(inArray(characters.accountId, accountIds));
  const byAccount = new Map<string, CharacterRow[]>();
  for (const row of allRows) {
    const list = byAccount.get(row.accountId) ?? [];
    list.push(row);
    byAccount.set(row.accountId, list);
  }

  const accountRows = new Map<string, AccountRow>();
  for (const row of matchedAccounts) {
    accountRows.set(row.id, row);
  }
  for (const row of matchedCharacters) {
    accountRows.set(row.account.id, row.account);
  }

  const accountsResult = [...accountRows.values()].map((row) =>
    toAccountSummary(row, byAccount.get(row.id) ?? [], isOnline),
  );

  const characterResult = allRows
    .filter((row) => {
      const account = accountRows.get(row.accountId);
      return Boolean(account);
    })
    .map((row) => {
      const account = accountRows.get(row.accountId)!;
      return toCharacterSummary(row, account, isOnline(row.id));
    });

  return { accounts: accountsResult, characters: characterResult };
}

/** Full admin view of one character, including private inventory/warehouse. */
export async function getCharacterDetail(
  db: Db,
  characterId: string,
  online: AdminOnlinePlayer | null = null,
  isOnline: (characterId: string) => boolean = (id) => online?.characterId === id,
): Promise<AdminCharacterDetail | null> {
  const [row] = await db
    .select({ character: characters, account: accounts })
    .from(characters)
    .innerJoin(accounts, eq(characters.accountId, accounts.id))
    .where(eq(characters.id, characterId))
    .limit(1);
  if (!row) {
    return null;
  }
  const record = toCharacterRecord(row.character);
  const accountCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.accountId, row.account.id))
    .orderBy(characters.createdAt);

  const loaded = await loadInventory(db, row.account.id, characterId);
  const warehouse = await loadWarehouse(db, row.account.id);
  const progression = progressionFromCharacter(
    record,
    equipmentBonusStats(loaded.inventory),
  );
  const summary = toCharacterSummary(row.character, row.account, isOnline(characterId));

  return {
    account: toAccountSummary(row.account, accountCharacters, isOnline),
    character: {
      ...summary,
      x: record.x,
      y: record.y,
      channel: record.channel,
      xp: record.xp,
      hp: record.hp,
      maxHp: progression.maxHp,
      mp: record.mp,
      maxMp: progression.maxMp,
      stats: {
        vit: record.statVit,
        int: record.statInt,
        str: record.statStr,
        dex: record.statDex,
      },
      statPoints: record.statPoints,
      skillPoints: record.skillPoints,
      pvpMode: record.pvpMode,
      createdAt: row.character.createdAt.toISOString(),
    },
    online,
    inventory: loaded.inventory.items.map(toItemDto),
    equipment: loaded.inventory.equipment.map((item) => (item ? toItemDto(item) : null)),
    warehouse: warehouse.items.map(toItemDto),
  };
}

export async function listItemLogs(db: Db, query: AdminLogQuery): Promise<AdminLogRow[]> {
  const conditions: Array<ReturnType<typeof eq> | undefined> = [];
  if (query.characterId) conditions.push(eq(itemLog.actorCharacterId, query.characterId));
  if (query.itemId) conditions.push(eq(itemLog.itemId, query.itemId));
  if (query.from) conditions.push(gte(itemLog.createdAt, new Date(query.from)));
  if (query.to) conditions.push(lte(itemLog.createdAt, new Date(query.to)));
  if (query.q) {
    conditions.push(
      or(ilike(itemLog.definitionId, pattern(query.q)), ilike(itemLog.action, pattern(query.q))),
    );
  }
  const rows = await db
    .select({
      id: itemLog.id,
      itemId: itemLog.itemId,
      characterId: itemLog.actorCharacterId,
      characterName: characters.name,
      accountId: itemLog.accountId,
      action: itemLog.action,
      definitionId: itemLog.definitionId,
      quantity: itemLog.quantity,
      fromLocation: itemLog.fromLocation,
      fromSlot: itemLog.fromSlot,
      toLocation: itemLog.toLocation,
      toSlot: itemLog.toSlot,
      detail: itemLog.detail,
      createdAt: itemLog.createdAt,
    })
    .from(itemLog)
    .leftJoin(characters, eq(itemLog.actorCharacterId, characters.id))
    .where(whereAll(conditions))
    .orderBy(desc(itemLog.createdAt))
    .limit(query.limit)
    .offset(query.offset);
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function listGoldLogs(db: Db, query: AdminLogQuery): Promise<AdminLogRow[]> {
  const conditions: Array<ReturnType<typeof eq> | undefined> = [];
  if (query.characterId) conditions.push(eq(goldLog.characterId, query.characterId));
  if (query.from) conditions.push(gte(goldLog.createdAt, new Date(query.from)));
  if (query.to) conditions.push(lte(goldLog.createdAt, new Date(query.to)));
  if (query.q) conditions.push(ilike(goldLog.reason, pattern(query.q)));
  const rows = await db
    .select({
      id: goldLog.id,
      characterId: goldLog.characterId,
      characterName: characters.name,
      accountId: goldLog.accountId,
      action: goldLog.reason,
      delta: goldLog.delta,
      balanceAfter: goldLog.balanceAfter,
      detail: goldLog.detail,
      createdAt: goldLog.createdAt,
    })
    .from(goldLog)
    .leftJoin(characters, eq(goldLog.characterId, characters.id))
    .where(whereAll(conditions))
    .orderBy(desc(goldLog.createdAt))
    .limit(query.limit)
    .offset(query.offset);
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export async function listAdminLogs(db: Db, query: AdminLogQuery): Promise<AdminLogRow[]> {
  const conditions: Array<ReturnType<typeof eq> | undefined> = [];
  if (query.characterId) conditions.push(eq(adminLog.targetCharacterId, query.characterId));
  if (query.itemId) {
    // Item grants/removals store the instance or definition id in `detail`.
    conditions.push(sql`${adminLog.detail}->>'itemId' = ${query.itemId}`);
  }
  if (query.from) conditions.push(gte(adminLog.createdAt, new Date(query.from)));
  if (query.to) conditions.push(lte(adminLog.createdAt, new Date(query.to)));
  if (query.q) {
    conditions.push(
      or(ilike(adminLog.action, pattern(query.q)), ilike(accounts.username, pattern(query.q))),
    );
  }
  const targetCharacters = characters;
  const rows = await db
    .select({
      id: adminLog.id,
      characterId: adminLog.targetCharacterId,
      characterName: targetCharacters.name,
      accountId: adminLog.targetAccountId,
      action: adminLog.action,
      detail: adminLog.detail,
      ip: adminLog.ip,
      createdAt: adminLog.createdAt,
    })
    .from(adminLog)
    .leftJoin(accounts, eq(adminLog.actorAccountId, accounts.id))
    .leftJoin(targetCharacters, eq(adminLog.targetCharacterId, targetCharacters.id))
    .where(whereAll(conditions))
    .orderBy(desc(adminLog.createdAt))
    .limit(query.limit)
    .offset(query.offset);
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export async function listChatLogs(db: Db, query: AdminLogQuery): Promise<AdminLogRow[]> {
  const conditions: Array<ReturnType<typeof eq> | undefined> = [];
  if (query.characterId) conditions.push(eq(chatLog.characterId, query.characterId));
  if (query.from) conditions.push(gte(chatLog.createdAt, new Date(query.from)));
  if (query.to) conditions.push(lte(chatLog.createdAt, new Date(query.to)));
  if (query.q) {
    conditions.push(
      or(
        ilike(chatLog.name, pattern(query.q)),
        ilike(chatLog.chatText, pattern(query.q)),
        ilike(chatLog.channel, pattern(query.q)),
      ),
    );
  }
  const rows = await db
    .select({
      id: chatLog.id,
      characterId: chatLog.characterId,
      characterName: chatLog.name,
      action: chatLog.mapId,
      channel: chatLog.channel,
      detail: sql<Record<string, unknown>>`jsonb_build_object('text', ${chatLog.chatText}, 'kingdom', ${chatLog.kingdom}, 'channel', ${chatLog.channel})`,
      createdAt: chatLog.createdAt,
    })
    .from(chatLog)
    .where(whereAll(conditions))
    .orderBy(desc(chatLog.createdAt))
    .limit(query.limit)
    .offset(query.offset);
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export async function listTradeLogs(db: Db, query: AdminLogQuery): Promise<AdminLogRow[]> {
  const conditions: Array<ReturnType<typeof eq> | undefined> = [];
  if (query.tradeId) conditions.push(eq(tradeLog.id, query.tradeId));
  if (query.itemId) {
    conditions.push(sql`(
      EXISTS (SELECT 1 FROM jsonb_array_elements(${tradeLog.itemsA}) entry WHERE entry->>'instanceId' = ${query.itemId})
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(${tradeLog.itemsB}) entry WHERE entry->>'instanceId' = ${query.itemId})
    )`);
  }
  if (query.characterId) {
    conditions.push(
      or(
        eq(tradeLog.characterAId, query.characterId),
        eq(tradeLog.characterBId, query.characterId),
      ),
    );
  }
  if (query.from) conditions.push(gte(tradeLog.createdAt, new Date(query.from)));
  if (query.to) conditions.push(lte(tradeLog.createdAt, new Date(query.to)));
  if (query.q) {
    conditions.push(sql`${tradeLog.id}::text ILIKE ${pattern(query.q)}`);
  }
  const rows = await db
    .select()
    .from(tradeLog)
    .where(whereAll(conditions))
    .orderBy(desc(tradeLog.createdAt))
    .limit(query.limit)
    .offset(query.offset);

  const characterIds = [...new Set(rows.flatMap((row) => [row.characterAId, row.characterBId]))];
  const names =
    characterIds.length === 0
      ? []
      : await db
          .select({ id: characters.id, name: characters.name })
          .from(characters)
          .where(inArray(characters.id, characterIds));
  const nameById = new Map(names.map((row) => [row.id, row.name]));

  return rows.map((row) => {
    const nameA = nameById.get(row.characterAId) ?? row.characterAId;
    const nameB = nameById.get(row.characterBId) ?? row.characterBId;
    return {
      id: row.id,
      characterId: row.characterAId,
      characterName: `${nameA} vs ${nameB}`,
      action: "trade",
      detail: {
        tradeId: row.id,
        revision: row.revision,
        mapId: row.mapId,
        goldA: row.goldA,
        goldB: row.goldB,
        participants: [
          { characterId: row.characterAId, name: nameA, accountId: row.accountAId, gold: row.goldA },
          { characterId: row.characterBId, name: nameB, accountId: row.accountBId, gold: row.goldB },
        ],
        itemsA: row.itemsA,
        itemsB: row.itemsB,
      },
      createdAt: row.createdAt.toISOString(),
    };
  });
}

export async function listAnnouncements(db: Db): Promise<AdminAnnouncementRow[]> {
  const rows = await db.select().from(announcements).orderBy(desc(announcements.createdAt)).limit(100);
  return rows.map((row: AnnouncementRow) => ({
    id: row.id,
    message: row.message,
    kind: row.kind as AdminAnnouncementRow["kind"],
    intervalMs: row.intervalMs,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    lastSentAt: iso(row.lastSentAt),
    expiresAt: iso(row.expiresAt),
  }));
}

/** Dashboard snapshot. Online presence/history come from the live admin bus. */
export async function dashboard(
  db: Db,
  onlineSource: AdminOnlineSource,
): Promise<AdminDashboardResponse> {
  const [registration] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accounts)
    .where(gte(accounts.createdAt, startOfToday()));
  const [gold] = await db
    .select({ total: sql<string>`coalesce(sum(${characters.gold}), 0)::text` })
    .from(characters);

  const players = onlineSource.list();
  const groups = new Map<string, { mapId: string; channel: number; count: number }>();
  for (const player of players) {
    const key = `${player.mapId}:${player.channel}`;
    const entry = groups.get(key) ?? { mapId: player.mapId, channel: player.channel, count: 0 };
    entry.count++;
    groups.set(key, entry);
  }

  const usage = process.cpuUsage();
  const uptime = Math.max(0.001, process.uptime());
  const cpuCount = Math.max(1, os.cpus().length);
  const cpuPercent = Math.min(
    100,
    Math.round(((usage.user + usage.system) / (uptime * 1_000_000 * cpuCount)) * 1000) / 10,
  );
  const memory = process.memoryUsage();
  const history = onlineSource.history();

  return {
    online: {
      total: players.length,
      byMap: [...groups.values()].sort((a, b) =>
        `${a.mapId}:${a.channel}`.localeCompare(`${b.mapId}:${b.channel}`),
      ),
      players,
    },
    server: {
      uptimeSeconds: Math.round(uptime),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      cpuPercent,
      nodeVersion: process.version,
    },
    registrationsToday: registration?.count ?? 0,
    goldInEconomy: Number(gold?.total ?? 0),
    history: history.length > 0 ? history : [{ atMs: Date.now(), online: players.length }],
    rooms: onlineSource.rooms?.() ?? [],
  };
}

function startOfToday(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

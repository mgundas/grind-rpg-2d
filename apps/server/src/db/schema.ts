import { sql } from "drizzle-orm";
import type { ItemBonus } from "@jadethrone/shared";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  check,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Phase-2 database schema (GAME_DESIGN.md §10.3). Only the tables this phase
 * needs are defined; items, guilds, logs and announcements arrive with their
 * own phases.
 *
 * Case-insensitive uniqueness (email, username, character name) is enforced by
 * expression indexes so a race can never create `Alice` and `alice`.
 * IDs are generated in the application (`crypto.randomUUID()`) so tests and
 * services can construct rows without a database round-trip.
 */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    kingdom: text("kingdom").notNull(),
    role: text("role").notNull().default("player"),
    /** Bumped on login/logout; stale access tokens fail this check. */
    tokenVersion: integer("token_version").notNull().default(0),
    bannedUntil: timestamp("banned_until", { withTimezone: true }),
    banReason: text("ban_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastLogin: timestamp("last_login", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("accounts_email_lower_uq").on(sql`lower(${table.email})`),
    uniqueIndex("accounts_username_lower_uq").on(sql`lower(${table.username})`),
  ],
);

export const characters = pgTable(
  "characters",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    classId: text("class_id").notNull(),
    doctrine: text("doctrine"),
    gender: text("gender").notNull(),
    hairStyle: smallint("hair_style").notNull(),
    hairColor: smallint("hair_color").notNull(),
    level: integer("level").notNull().default(1),
    xp: bigint("xp", { mode: "number" }).notNull().default(0),
    gold: bigint("gold", { mode: "number" }).notNull().default(0),
    hp: integer("hp").notNull(),
    mp: integer("mp").notNull(),
    statVit: integer("stat_vit").notNull(),
    statInt: integer("stat_int").notNull(),
    statStr: integer("stat_str").notNull(),
    statDex: integer("stat_dex").notNull(),
    statPoints: integer("stat_points").notNull().default(0),
    skillPoints: integer("skill_points").notNull().default(0),
    mapId: text("map_id").notNull(),
    x: real("x").notNull(),
    y: real("y").notNull(),
    channel: integer("channel").notNull().default(1),
    pvpMode: text("pvp_mode").notNull().default("peaceful"),
    playtimeSeconds: integer("playtime_seconds").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("characters_name_lower_uq").on(sql`lower(${table.name})`),
    index("characters_account_idx").on(table.accountId),
  ],
);

export const characterSkills = pgTable(
  "character_skills",
  {
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    skillId: text("skill_id").notNull(),
    rank: smallint("rank").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.characterId, table.skillId], name: "character_skills_pk" }),
    check("character_skills_rank_check", sql`${table.rank} >= 1 AND ${table.rank} <= 20`),
  ],
);

export type CharacterSkillRow = typeof characterSkills.$inferSelect;

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_uq").on(table.tokenHash),
    index("sessions_account_idx").on(table.accountId),
  ],
);

/**
 * Item instances (GAME_DESIGN.md §7.2). `location` decides which owner column
 * is authoritative: inventory/equipment use the character, warehouse uses the
 * account, and ground rows use the map columns. A UUID is never reused.
 */
export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey(),
    definitionId: text("definition_id").notNull(),
    ownerCharacterId: uuid("owner_character_id").references(() => characters.id, {
      onDelete: "cascade",
    }),
    ownerAccountId: uuid("owner_account_id").references(() => accounts.id, {
      onDelete: "cascade",
    }),
    /** inventory | equipment | warehouse | ground */
    location: text("location").notNull(),
    /** Top-left inventory/warehouse cell, equipment index, or null on ground. */
    slot: integer("slot"),
    quantity: integer("quantity").notNull().default(1),
    upgradeLevel: smallint("upgrade_level").notNull().default(0),
    bonuses: jsonb("bonuses").$type<ItemBonus[]>().notNull().default(sql`'[]'::jsonb`),
    /** drop | shop | starter | admin | craft | quest */
    createdBy: text("created_by").notNull().default("unknown"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Ground-only fields. They remain null for owned rows.
    mapId: text("map_id"),
    roomId: text("room_id"),
    x: real("x"),
    y: real("y"),
    dropOwnerCharacterId: uuid("drop_owner_character_id"),
    ownerUntil: timestamp("owner_until", { withTimezone: true }),
    despawnAt: timestamp("despawn_at", { withTimezone: true }),
  },
  (table) => [
    index("items_character_idx").on(table.ownerCharacterId, table.location),
    index("items_account_idx").on(table.ownerAccountId, table.location),
    index("items_ground_idx").on(table.mapId, table.despawnAt),
    // Only the top-left cell is stored, so one slot can hold one item. Overlap
    // of taller items is prevented by the application inside a transaction.
    uniqueIndex("items_inventory_slot_uq")
      .on(table.ownerCharacterId, table.slot)
      .where(sql`${table.location} = 'inventory'`),
    uniqueIndex("items_equipment_slot_uq")
      .on(table.ownerCharacterId, table.slot)
      .where(sql`${table.location} = 'equipment'`),
    uniqueIndex("items_warehouse_slot_uq")
      .on(table.ownerAccountId, table.slot)
      .where(sql`${table.location} = 'warehouse'`),
  ],
);

/** Every item-changing operation writes one row here (GAME_DESIGN.md §7.2). */
export const itemLog = pgTable(
  "item_log",
  {
    id: uuid("id").primaryKey(),
    itemId: uuid("item_id").notNull(),
    actorCharacterId: uuid("actor_character_id"),
    accountId: uuid("account_id"),
    action: text("action").notNull(),
    definitionId: text("definition_id").notNull(),
    quantity: integer("quantity").notNull().default(1),
    fromLocation: text("from_location"),
    fromSlot: integer("from_slot"),
    toLocation: text("to_location"),
    toSlot: integer("to_slot"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("item_log_item_idx").on(table.itemId),
    index("item_log_character_idx").on(table.actorCharacterId, table.createdAt),
  ],
);

/** Currency ledger; `characters.gold` is the current balance (GAME_DESIGN.md §7.6). */
export const goldLog = pgTable(
  "gold_log",
  {
    id: uuid("id").primaryKey(),
    characterId: uuid("character_id").notNull(),
    accountId: uuid("account_id"),
    delta: bigint("delta", { mode: "number" }).notNull(),
    balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
    /** kill | pickup | shop_buy | shop_sell | admin */
    reason: text("reason").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("gold_log_character_idx").on(table.characterId, table.createdAt)],
);

/** Every GM/admin action, including in-game commands (GAME_DESIGN.md §10.5). */
export const adminLog = pgTable(
  "admin_log",
  {
    id: uuid("id").primaryKey(),
    actorAccountId: uuid("actor_account_id").notNull(),
    action: text("action").notNull(),
    targetAccountId: uuid("target_account_id"),
    targetCharacterId: uuid("target_character_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("admin_log_actor_idx").on(table.actorAccountId, table.createdAt),
    index("admin_log_target_idx").on(table.targetCharacterId, table.createdAt),
  ],
);

/** Admin-editable game data overrides; base JSON always remains the fallback. */
export const gameDataOverrides = pgTable(
  "game_data_overrides",
  {
    dataset: text("dataset").notNull(),
    entryId: text("entry_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    updatedBy: uuid("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.dataset, table.entryId],
      name: "game_data_overrides_pk",
    }),
    check(
      "game_data_overrides_dataset_check",
      sql`${table.dataset} in ('items', 'monsters', 'dropTables', 'shops', 'spawnGroups', 'npcs', 'skills', 'stones', 'upgrades', 'bonuses')`,
    ),
  ],
);

/** Immediate, recurring and shutdown announcements. */
export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey(),
    message: text("message").notNull(),
    /** immediate | recurring | shutdown */
    kind: text("kind").notNull(),
    intervalMs: integer("interval_ms"),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [index("announcements_active_idx").on(table.active, table.lastSentAt)],
);

/** Chat history for the admin log viewer (local chat is still range-filtered). */
export const chatLog = pgTable(
  "chat_log",
  {
    id: uuid("id").primaryKey(),
    characterId: uuid("character_id"),
    name: text("name").notNull(),
    kingdom: text("kingdom").notNull(),
    mapId: text("map_id").notNull(),
    /** Column name `text` is explicit; the property avoids shadowing. */
    chatText: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("chat_log_created_idx").on(table.createdAt),
    index("chat_log_character_idx").on(table.characterId, table.createdAt),
  ],
);

/** Immutable snapshot of one offered stack in a completed trade. */
export interface TradeItemSnapshot {
  instanceId: string;
  itemId: string;
  quantity: number;
  upgradeLevel: number;
  bonuses: ItemBonus[];
  fromSlot: number;
  toSlot: number;
}

/** One row per committed trade; failed swaps roll back and leave no row. */
export const tradeLog = pgTable(
  "trade_log",
  {
    id: uuid("id").primaryKey(),
    revision: integer("revision").notNull(),
    mapId: text("map_id").notNull(),
    characterAId: uuid("character_a_id").notNull(),
    accountAId: uuid("account_a_id").notNull(),
    characterBId: uuid("character_b_id").notNull(),
    accountBId: uuid("account_b_id").notNull(),
    goldA: bigint("gold_a", { mode: "number" }).notNull(),
    goldB: bigint("gold_b", { mode: "number" }).notNull(),
    itemsA: jsonb("items_a").$type<TradeItemSnapshot[]>().notNull(),
    itemsB: jsonb("items_b").$type<TradeItemSnapshot[]>().notNull(),
    /** completed now; aborted rows can be added later without a migration. */
    result: text("result").notNull().default("completed"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("trade_log_a_idx").on(table.characterAId, table.createdAt),
    index("trade_log_b_idx").on(table.characterBId, table.createdAt),
    index("trade_log_created_idx").on(table.createdAt),
  ],
);

export type AccountRow = typeof accounts.$inferSelect;
export type CharacterRow = typeof characters.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type ItemRow = typeof items.$inferSelect;
export type NewItemRow = typeof items.$inferInsert;
export type ItemLogRow = typeof itemLog.$inferSelect;
export type GoldLogRow = typeof goldLog.$inferSelect;
export type AdminLogRow = typeof adminLog.$inferSelect;
export type AnnouncementRow = typeof announcements.$inferSelect;
export type ChatLogRow = typeof chatLog.$inferSelect;
export type TradeLogRow = typeof tradeLog.$inferSelect;
export type GameDataOverrideRow = typeof gameDataOverrides.$inferSelect;

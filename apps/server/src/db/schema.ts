import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  pgTable,
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

export type AccountRow = typeof accounts.$inferSelect;
export type CharacterRow = typeof characters.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;

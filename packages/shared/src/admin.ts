import { z } from "zod";
import { MAX_GOLD, MAP_IDS } from "./constants";
import type { AccountRole } from "./auth";
import type { ClassId } from "./characterRules";
import type { ItemInstanceDto } from "./protocol";

/**
 * Admin-panel request schemas and response DTOs shared by the server routes and
 * `apps/admin`. Every request is validated server-side; the client only uses
 * the inferred types and the same bounds for form validation.
 */

export const adminItemBonusSchema = z
  .object({
    type: z.string().trim().min(1).max(40),
    value: z.number().finite().min(-10_000).max(10_000),
  })
  .strict();

export const adminGiveItemSchema = z
  .object({
    definitionId: z.string().min(1).max(64),
    quantity: z.number().int().min(1).max(9999).default(1),
    upgradeLevel: z.number().int().min(0).max(9).default(0),
    bonuses: z.array(adminItemBonusSchema).max(5).default([]),
  })
  .strict();
export type AdminGiveItemRequest = z.infer<typeof adminGiveItemSchema>;

export const adminUpdateCharacterSchema = z
  .object({
    level: z.number().int().min(1).max(99).optional(),
    gold: z.number().int().min(0).max(MAX_GOLD).optional(),
    statVit: z.number().int().min(0).max(90).optional(),
    statInt: z.number().int().min(0).max(90).optional(),
    statStr: z.number().int().min(0).max(90).optional(),
    statDex: z.number().int().min(0).max(90).optional(),
    x: z.number().finite().min(0).max(65_535).optional(),
    y: z.number().finite().min(0).max(65_535).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one character field is required.",
  });
export type AdminUpdateCharacterRequest = z.infer<typeof adminUpdateCharacterSchema>;

/** `null` duration means a permanent ban. */
export const adminBanSchema = z
  .object({
    durationMinutes: z.number().int().min(1).max(5_256_000).nullable(),
    reason: z.string().trim().max(200).optional(),
  })
  .strict();
export type AdminBanRequest = z.infer<typeof adminBanSchema>;

export const adminRatesSchema = z
  .object({
    xpRate: z.number().min(0).max(100),
    dropRate: z.number().min(0).max(100),
  })
  .strict();
export type AdminRatesRequest = z.infer<typeof adminRatesSchema>;

export const adminSpawnSchema = z
  .object({
    typeId: z.string().min(1).max(64),
    count: z.number().int().min(1).max(50).default(1),
    /** Optional world position; defaults to the admin's current position. */
    x: z.number().finite().min(0).max(65_535).optional(),
    y: z.number().finite().min(0).max(65_535).optional(),
  })
  .strict();
export type AdminSpawnRequest = z.infer<typeof adminSpawnSchema>;

export const adminShutdownSchema = z
  .object({
    delayMinutes: z.number().int().min(1).max(1440),
    message: z.string().trim().min(1).max(300),
  })
  .strict();
export type AdminShutdownRequest = z.infer<typeof adminShutdownSchema>;

export const adminAnnouncementSchema = z
  .object({
    message: z.string().trim().min(1).max(500),
    /** Minutes between repeats; null/absent means a one-off announcement. */
    intervalMinutes: z.number().int().min(1).max(10_080).nullable().optional(),
    expiresInMinutes: z.number().int().min(1).max(43_200).optional(),
  })
  .strict();
export type AdminAnnouncementRequest = z.infer<typeof adminAnnouncementSchema>;

export const adminSearchQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type AdminSearchQuery = z.infer<typeof adminSearchQuerySchema>;

export const adminLogQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  characterId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
export type AdminLogQuery = z.infer<typeof adminLogQuerySchema>;

export interface AdminOnlinePlayer {
  accountId: string;
  characterId: string;
  sessionId: string;
  name: string;
  classId: ClassId | string;
  mapId: string;
  channel: number;
  level: number;
  role: AccountRole;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dead: boolean;
}

export interface AdminDashboardResponse {
  online: {
    total: number;
    byMap: Array<{ mapId: string; channel: number; count: number }>;
    players: AdminOnlinePlayer[];
  };
  server: {
    uptimeSeconds: number;
    rssBytes: number;
    heapUsedBytes: number;
    cpuPercent: number;
    nodeVersion: string;
  };
  registrationsToday: number;
  goldInEconomy: number;
  history: Array<{ atMs: number; online: number }>;
}

export interface AdminAccountSummary {
  id: string;
  email: string;
  username: string;
  role: AccountRole;
  bannedUntil: string | null;
  banReason: string | null;
  characters: AdminCharacterSummary[];
}

export interface AdminCharacterSummary {
  id: string;
  accountId: string;
  accountEmail: string;
  accountUsername: string;
  name: string;
  classId: ClassId;
  level: number;
  mapId: string;
  gold: number;
  online: boolean;
  role: AccountRole;
  bannedUntil: string | null;
  banReason: string | null;
}

export interface AdminSearchResponse {
  accounts: AdminAccountSummary[];
  characters: AdminCharacterSummary[];
}

export interface AdminCharacterDetail {
  account: AdminAccountSummary;
  character: AdminCharacterSummary & {
    x: number;
    y: number;
    channel: number;
    xp: number;
    hp: number;
    mp: number;
    stats: { vit: number; int: number; str: number; dex: number };
    statPoints: number;
    skillPoints: number;
    pvpMode: string;
    createdAt: string;
  };
  online: AdminOnlinePlayer | null;
  inventory: ItemInstanceDto[];
  equipment: (ItemInstanceDto | null)[];
  warehouse: ItemInstanceDto[];
}

export interface AdminItemGrantResponse {
  item: ItemInstanceDto;
}

export interface AdminLogRow {
  id: string;
  itemId?: string | null;
  characterId?: string | null;
  characterName?: string | null;
  accountId?: string | null;
  action: string;
  definitionId?: string | null;
  quantity?: number | null;
  fromLocation?: string | null;
  fromSlot?: number | null;
  toLocation?: string | null;
  toSlot?: number | null;
  delta?: number | null;
  balanceAfter?: number | null;
  detail?: Record<string, unknown>;
  ip?: string | null;
  createdAt: string;
}

export interface AdminAnnouncementRow {
  id: string;
  message: string;
  kind: "immediate" | "recurring" | "shutdown";
  intervalMs: number | null;
  active: boolean;
  createdAt: string;
  lastSentAt: string | null;
  expiresAt: string | null;
}

export interface AdminServerStatus {
  xpRate: number;
  dropRate: number;
  shutdownAtMs: number | null;
  shutdownMessage: string | null;
  uptimeSeconds: number;
  online: number;
}

export interface AdminMonitorStatus {
  ok: boolean;
  expiresAtMs: number | null;
}

export const ADMIN_MAP_IDS = MAP_IDS;

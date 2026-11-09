import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  adminAnnouncementSchema,
  adminBanSchema,
  adminGiveItemSchema,
  adminLogQuerySchema,
  adminRatesSchema,
  adminSearchQuerySchema,
  adminShutdownSchema,
  adminSpawnSchema,
  adminUpdateCharacterSchema,
  type AdminMonitorStatus,
  type AdminServerStatus,
} from "@jadethrone/shared";
import { announcements, accounts, characters } from "../db/schema";
import {
  banAccount,
  grantItemOffline,
  removeItemOffline,
  unbanAccount,
  updateCharacterOffline,
} from "../admin/adminMutations";
import { writeAdminLog } from "../admin/adminLog";
import type { AuthDeps } from "../auth/accountService";
import type { SessionRegistry } from "../auth/sessionRegistry";
import type { Db } from "../db/client";
import type { AdminBus } from "../admin/liveBus";
import type { AdminRuntime } from "../admin/adminRuntime";
import type { GameDataStore } from "../gameData/store";
import { createAdminDataRouter } from "./adminData";
import {
  dashboard,
  getCharacterDetail,
  listAdminLogs,
  listAnnouncements,
  listChatLogs,
  listGoldLogs,
  listItemLogs,
  listTradeLogs,
  searchAccountsAndCharacters,
} from "../admin/adminService";
import { adminCookieStatus } from "../http/adminCookie";
import { authedAccount, requireAuth } from "../http/requireAuth";
import { requireAdmin } from "../http/requireRole";
import { parseBody } from "../http/validation";
import { logger } from "../logger";

export interface AdminRouteDeps {
  db: Db;
  authDeps: AuthDeps;
  sessionRegistry: SessionRegistry;
  adminBus: AdminBus;
  adminRuntime: AdminRuntime;
  gameData: GameDataStore;
}

const characterIdSchema = z.string().uuid();

/**
 * Post-commit audit writes must never turn a successful mutation into a 500
 * (the admin would retry and duplicate the action). Offline mutations keep
 * their audit inside the transaction instead.
 */
async function writeAuditLog(
  deps: AdminRouteDeps,
  entry: Parameters<typeof writeAdminLog>[1],
): Promise<void> {
  try {
    await writeAdminLog(deps.db, entry);
  } catch (error) {
    logger.error(
      {
        err: error,
        action: entry.action,
        actorAccountId: entry.actorAccountId,
        targetCharacterId: entry.targetCharacterId ?? null,
      },
      "admin audit log write failed; reconcile admin_log manually",
    );
  }
}

export function createAdminRouter(deps: AdminRouteDeps): Router {
  const router = Router();
  router.use(requireAuth(deps));
  router.use(requireAdmin());
  router.use("/data", createAdminDataRouter({ db: deps.db, gameData: deps.gameData }));

  router.get("/dashboard", async (_req, res) => {
    res.json(await dashboard(deps.db, deps.adminBus));
  });

  router.get("/online", (_req, res) => {
    res.json({ players: deps.adminBus.list() });
  });

  router.get("/players", async (req, res) => {
    const query = parseBody(adminSearchQuerySchema, req.query);
    const isOnline = (characterId: string) => Boolean(deps.adminBus.get(characterId));
    res.json(
      await searchAccountsAndCharacters(
        deps.db,
        query.q,
        query.limit,
        query.offset,
        isOnline,
      ),
    );
  });

  router.get("/players/:characterId", async (req, res) => {
    const characterId = parseBody(characterIdSchema, req.params.characterId);
    const online = deps.adminBus.get(characterId)?.presence() ?? null;
    const detail = await getCharacterDetail(
      deps.db,
      characterId,
      online,
      (id) => Boolean(deps.adminBus.get(id)),
    );
    if (!detail) {
      res.status(404).json({
        error: { code: "not_found", message: "Character not found." },
      });
      return;
    }
    res.json(detail);
  });

  router.get("/logs/item", async (req, res) => {
    res.json({ entries: await listItemLogs(deps.db, parseBody(adminLogQuerySchema, req.query)) });
  });
  router.get("/logs/gold", async (req, res) => {
    res.json({ entries: await listGoldLogs(deps.db, parseBody(adminLogQuerySchema, req.query)) });
  });
  router.get("/logs/admin", async (req, res) => {
    res.json({ entries: await listAdminLogs(deps.db, parseBody(adminLogQuerySchema, req.query)) });
  });
  router.get("/logs/chat", async (req, res) => {
    res.json({ entries: await listChatLogs(deps.db, parseBody(adminLogQuerySchema, req.query)) });
  });
  router.get("/logs/trade", async (req, res) => {
    res.json({ entries: await listTradeLogs(deps.db, parseBody(adminLogQuerySchema, req.query)) });
  });

  router.get("/server", (_req, res) => {
    const status: AdminServerStatus = deps.adminRuntime.status();
    res.json(status);
  });

  async function targetAccount(characterId: string): Promise<string> {
    const [row] = await deps.db
      .select({ accountId: characters.accountId })
      .from(characters)
      .where(eq(characters.id, characterId))
      .limit(1);
    return row?.accountId ?? "";
  }

  router.patch("/players/:characterId", async (req, res) => {
    const characterId = parseBody(characterIdSchema, req.params.characterId);
    const update = parseBody(adminUpdateCharacterSchema, req.body);
    const account = authedAccount(res);
    const actions = deps.adminBus.get(characterId);
    if (actions) {
      await actions.updateCharacter(update);
      await writeAuditLog(deps, {
        actorAccountId: account.id,
        action: "character_update",
        targetCharacterId: characterId,
        detail: { fields: Object.keys(update), live: true },
        ip: req.ip,
      });
    } else {
      await updateCharacterOffline(deps.db, {
        actorAccountId: account.id,
        characterId,
        update,
        ip: req.ip,
        isOnline: (id) => Boolean(deps.adminBus.get(id)),
      });
    }
    res.json({ ok: true });
  });

  router.post("/players/:characterId/teleport-town", async (req, res) => {
    const characterId = parseBody(characterIdSchema, req.params.characterId);
    const actions = deps.adminBus.get(characterId);
    if (!actions) {
      res.status(409).json({
        error: { code: "conflict", message: "Character must be online to teleport." },
      });
      return;
    }
    await actions.teleportTown();
    await writeAuditLog(deps, {
      actorAccountId: authedAccount(res).id,
      action: "teleport_town",
      targetCharacterId: characterId,
      detail: {},
      ip: req.ip,
    });
    res.json({ ok: true });
  });

  router.post("/players/:characterId/kick", async (req, res) => {
    const characterId = parseBody(characterIdSchema, req.params.characterId);
    const kicked = await deps.sessionRegistry.kickCharacter(characterId, "admin");
    if (!kicked) {
      res.status(409).json({
        error: { code: "conflict", message: "That character is not online." },
      });
      return;
    }
    await writeAuditLog(deps, {
      actorAccountId: authedAccount(res).id,
      action: "kick",
      targetCharacterId: characterId,
      detail: {},
      ip: req.ip,
    });
    res.status(204).end();
  });

  router.post("/players/:characterId/ban", async (req, res) => {
    const characterId = parseBody(characterIdSchema, req.params.characterId);
    const accountId = await targetAccount(characterId);
    if (!accountId) {
      res.status(404).json({ error: { code: "not_found", message: "Character not found." } });
      return;
    }
    const actor = authedAccount(res);
    if (accountId === actor.id) {
      res.status(400).json({
        error: { code: "validation", message: "You cannot ban your own account." },
      });
      return;
    }
    const [target] = await deps.db
      .select({ role: accounts.role })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);
    if (target?.role === "admin" && actor.role !== "admin") {
      res.status(403).json({
        error: { code: "forbidden", message: "Only an admin can ban another admin." },
      });
      return;
    }
    const ban = parseBody(adminBanSchema, req.body);
    const result = await banAccount(deps.db, {
      actorAccountId: actor.id,
      accountId,
      ban,
      ip: req.ip,
    });
    // Advance the generation before the kick, so a join that passed onAuth
    // before this ban cannot register with its stale reservation afterwards.
    deps.sessionRegistry.noteAccount(accountId, result.tokenVersion);
    await deps.sessionRegistry.kickAccount(accountId, "ban");
    res.json({ bannedUntil: result.bannedUntil, banReason: result.banReason });
  });

  router.post("/accounts/:accountId/unban", async (req, res) => {
    const accountId = parseBody(z.string().uuid(), req.params.accountId);
    await unbanAccount(deps.db, {
      actorAccountId: authedAccount(res).id,
      accountId,
      ip: req.ip,
    });
    res.json({ ok: true });
  });

  router.post("/players/:characterId/items", async (req, res) => {
    const characterId = parseBody(characterIdSchema, req.params.characterId);
    const request = parseBody(adminGiveItemSchema, req.body);
    const actions = deps.adminBus.get(characterId);
    if (actions) {
      const item = await actions.grantItem(request);
      await writeAuditLog(deps, {
        actorAccountId: authedAccount(res).id,
        action: "item_grant",
        targetCharacterId: characterId,
        detail: {
          definitionId: request.definitionId,
          quantity: request.quantity,
          upgradeLevel: request.upgradeLevel,
          live: true,
        },
        ip: req.ip,
      });
      res.status(201).json({ item });
      return;
    }
    const item = await grantItemOffline(deps.db, {
      actorAccountId: authedAccount(res).id,
      characterId,
      request,
      ip: req.ip,
      isOnline: (id) => Boolean(deps.adminBus.get(id)),
      catalog: deps.gameData.getCatalog(),
    });
    res.status(201).json({ item });
  });

  router.delete("/players/:characterId/items/:itemId", async (req, res) => {
    const characterId = parseBody(characterIdSchema, req.params.characterId);
    const itemId = parseBody(z.string().uuid(), req.params.itemId);
    const actions = deps.adminBus.get(characterId);
    if (actions) {
      await actions.removeItem(itemId);
      await writeAuditLog(deps, {
        actorAccountId: authedAccount(res).id,
        action: "item_remove",
        targetCharacterId: characterId,
        detail: { itemId, live: true },
        ip: req.ip,
      });
    } else {
      await removeItemOffline(deps.db, {
        actorAccountId: authedAccount(res).id,
        characterId,
        itemId,
        ip: req.ip,
        isOnline: (id) => Boolean(deps.adminBus.get(id)),
        catalog: deps.gameData.getCatalog(),
      });
    }
    res.status(204).end();
  });

  router.get("/monitor/status", (req, res) => {
    const account = authedAccount(res);
    const status: AdminMonitorStatus = adminCookieStatus(req, deps.authDeps, account);
    res.json(status);
  });

  router.get("/announcements", async (_req, res) => {
    res.json({ announcements: await listAnnouncements(deps.db) });
  });

  router.post("/announcements", async (req, res) => {
    const input = parseBody(adminAnnouncementSchema, req.body);
    const account = authedAccount(res);
    const now = Date.now();
    const recurring = input.intervalMinutes != null;
    const id = randomUUID();
    const expiresAt =
      input.expiresInMinutes === undefined
        ? null
        : new Date(now + input.expiresInMinutes * 60_000);
    await deps.db.insert(announcements).values({
      id,
      message: input.message,
      kind: recurring ? "recurring" : "immediate",
      intervalMs: recurring ? input.intervalMinutes! * 60_000 : null,
      active: recurring,
      createdBy: account.id,
      createdAt: new Date(now),
      lastSentAt: null,
      expiresAt,
    });
    if (!recurring) {
      const delivered = deps.adminBus.broadcastAnnouncement({
        id,
        message: input.message,
        kind: "admin",
        sentAtMs: now,
      });
      // An immediate announcement with no recipients stays unsent in history
      // instead of claiming it was delivered.
      if (delivered > 0) {
        await deps.db
          .update(announcements)
          .set({ lastSentAt: new Date(now) })
          .where(eq(announcements.id, id));
      }
    }
    await writeAuditLog(deps, {
      actorAccountId: account.id,
      action: "announcement_create",
      detail: {
        id,
        message: input.message,
        recurring,
        intervalMinutes: input.intervalMinutes ?? null,
      },
      ip: req.ip,
    });
    res.status(201).json({ id });
  });

  router.delete("/announcements/:id", async (req, res) => {
    const id = parseBody(z.string().uuid(), req.params.id);
    const deleted = await deps.db
      .delete(announcements)
      .where(eq(announcements.id, id))
      .returning({ id: announcements.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: { code: "not_found", message: "Announcement not found." } });
      return;
    }
    await writeAuditLog(deps, {
      actorAccountId: authedAccount(res).id,
      action: "announcement_delete",
      detail: { id },
      ip: req.ip,
    });
    res.status(204).end();
  });

  router.post("/server/rates", async (req, res) => {
    const input = parseBody(adminRatesSchema, req.body);
    deps.adminRuntime.setRates(input.xpRate, input.dropRate);
    await writeAuditLog(deps, {
      actorAccountId: authedAccount(res).id,
      action: "server_rates",
      detail: input,
      ip: req.ip,
    });
    res.json(deps.adminRuntime.status());
  });

  router.post("/server/spawn", async (req, res) => {
    const input = parseBody(adminSpawnSchema, req.body);
    const players = deps.adminBus.list();
    const target = input.mapId
      ? players.find((player) => player.mapId === input.mapId)
      : players[0];
    if (!target) {
      res.status(409).json({
        error: {
          code: "conflict",
          message: input.mapId
            ? `No player is online on map ${input.mapId}.`
            : "At least one player must be online to spawn.",
        },
      });
      return;
    }
    const actions = deps.adminBus.get(target.characterId);
    if (!actions) {
      res.status(409).json({ error: { code: "conflict", message: "Player just left." } });
      return;
    }
    const count = await actions.spawnMonster(input.typeId, input.count, input.x, input.y);
    await writeAuditLog(deps, {
      actorAccountId: authedAccount(res).id,
      action: "server_spawn",
      targetCharacterId: target.characterId,
      detail: { ...input, spawned: count, mapId: target.mapId },
      ip: req.ip,
    });
    res.json({ spawned: count, mapId: target.mapId });
  });

  router.post("/server/shutdown", async (req, res) => {
    const input = parseBody(adminShutdownSchema, req.body);
    deps.adminRuntime.scheduleShutdown(input.delayMinutes, input.message);
    await writeAuditLog(deps, {
      actorAccountId: authedAccount(res).id,
      action: "server_shutdown_schedule",
      detail: input,
      ip: req.ip,
    });
    res.json(deps.adminRuntime.status());
  });

  router.post("/server/shutdown/cancel", async (req, res) => {
    deps.adminRuntime.cancelShutdown();
    await writeAuditLog(deps, {
      actorAccountId: authedAccount(res).id,
      action: "server_shutdown_cancel",
      detail: {},
      ip: req.ip,
    });
    res.json(deps.adminRuntime.status());
  });

  return router;
}

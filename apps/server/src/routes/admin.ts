import { Router } from "express";
import { z } from "zod";
import {
  adminBanSchema,
  adminGiveItemSchema,
  adminLogQuerySchema,
  adminSearchQuerySchema,
  adminUpdateCharacterSchema,
  type AdminMonitorStatus,
  type AdminServerStatus,
} from "@jadethrone/shared";
import { eq } from "drizzle-orm";
import { characters } from "../db/schema";
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
import {
  dashboard,
  getCharacterDetail,
  listAdminLogs,
  listChatLogs,
  listGoldLogs,
  listItemLogs,
  searchAccountsAndCharacters,
} from "../admin/adminService";
import { adminCookieStatus } from "../http/adminCookie";
import { authedAccount, requireAuth } from "../http/requireAuth";
import { requireAdmin } from "../http/requireRole";
import { parseBody } from "../http/validation";

export interface AdminRouteDeps {
  db: Db;
  authDeps: AuthDeps;
  sessionRegistry: SessionRegistry;
  adminBus: AdminBus;
  adminRuntime: AdminRuntime;
}

const characterIdSchema = z.string().uuid();

export function createAdminRouter(deps: AdminRouteDeps): Router {
  const router = Router();
  router.use(requireAuth(deps));
  router.use(requireAdmin());

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
      await writeAdminLog(deps.db, {
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
    await writeAdminLog(deps.db, {
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
    await deps.sessionRegistry.kickCharacter(characterId, "admin");
    await writeAdminLog(deps.db, {
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
    const ban = parseBody(adminBanSchema, req.body);
    const result = await banAccount(deps.db, {
      actorAccountId: authedAccount(res).id,
      accountId,
      ban,
      ip: req.ip,
    });
    await deps.sessionRegistry.kickAccount(accountId, "ban");
    res.json(result);
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
      await writeAdminLog(deps.db, {
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
    });
    res.status(201).json({ item });
  });

  router.delete("/players/:characterId/items/:itemId", async (req, res) => {
    const characterId = parseBody(characterIdSchema, req.params.characterId);
    const itemId = parseBody(characterIdSchema, req.params.itemId);
    const actions = deps.adminBus.get(characterId);
    if (actions) {
      await actions.removeItem(itemId);
      await writeAdminLog(deps.db, {
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
      });
    }
    res.status(204).end();
  });

  router.get("/monitor/status", (req, res) => {
    const account = authedAccount(res);
    const status: AdminMonitorStatus = adminCookieStatus(req, deps.authDeps, account);
    res.json(status);
  });

  return router;
}

import { Router } from "express";
import { z } from "zod";
import {
  adminGameDataParamsSchema,
  adminGameDataPutSchema,
  gameDataDatasetSchema,
  type AdminGameDataDatasetResponse,
  type AdminGameDataMutationResponse,
  type AdminGameDataReloadResponse,
} from "@jadethrone/shared";
import type { Db } from "../db/client";
import { authedAccount } from "../http/requireAuth";
import { parseBody } from "../http/validation";
import {
  deleteGameDataOverride,
  reloadGameData,
  saveGameDataOverride,
} from "../gameData/overrideService";
import type { GameDataStore } from "../gameData/store";

export interface AdminDataRouteDeps {
  db: Db;
  gameData: GameDataStore;
}

const datasetParamsSchema = z.object({ dataset: gameDataDatasetSchema }).strict();

export function createAdminDataRouter(deps: AdminDataRouteDeps): Router {
  const router = Router();

  router.get("/reload", (_req, res) => {
    res.status(405).json({ error: { code: "validation", message: "Use POST." } });
  });

  router.post("/reload", async (req, res) => {
    const account = authedAccount(res);
    const result = await reloadGameData({
      db: deps.db,
      store: deps.gameData,
      actorAccountId: account.id,
      ip: req.ip,
    });
    const snapshot = deps.gameData.getSnapshot();
    const body: AdminGameDataReloadResponse = {
      version: result.version,
      overrides: result.overrides,
      counts: Object.fromEntries(
        Object.entries(snapshot.entries).map(([dataset, entries]) => [
          dataset,
          entries.length,
        ]),
      ) as AdminGameDataReloadResponse["counts"],
    };
    res.json(body);
  });

  router.get("/:dataset", (req, res) => {
    const { dataset } = parseBody(datasetParamsSchema, req.params);
    const snapshot = deps.gameData.getSnapshot();
    const body: AdminGameDataDatasetResponse = {
      dataset,
      version: snapshot.version,
      base: [...snapshot.baseEntries[dataset]],
      merged: [...snapshot.entries[dataset]],
      overrides: deps.gameData.listOverrides(dataset).map((override) => ({
        entryId: override.entryId,
        payload: override.payload,
        updatedBy: override.updatedBy,
        updatedAt: override.updatedAt,
      })),
    };
    res.json(body);
  });

  router.put("/:dataset/:entryId", async (req, res) => {
    const { dataset, entryId } = parseBody(adminGameDataParamsSchema, req.params);
    const { payload } = parseBody(adminGameDataPutSchema, req.body);
    const account = authedAccount(res);
    const result = await saveGameDataOverride({
      db: deps.db,
      store: deps.gameData,
      dataset,
      entryId,
      payload,
      actorAccountId: account.id,
      ip: req.ip,
    });
    const body: AdminGameDataMutationResponse = {
      dataset,
      entryId,
      version: result.version,
    };
    res.json(body);
  });

  router.delete("/:dataset/:entryId", async (req, res) => {
    const { dataset, entryId } = parseBody(adminGameDataParamsSchema, req.params);
    const account = authedAccount(res);
    const result = await deleteGameDataOverride({
      db: deps.db,
      store: deps.gameData,
      dataset,
      entryId,
      actorAccountId: account.id,
      ip: req.ip,
    });
    const body: AdminGameDataMutationResponse = {
      dataset,
      entryId,
      version: result.version,
      reverted: true,
    };
    res.json(body);
  });

  return router;
}

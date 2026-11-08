import { and, eq } from "drizzle-orm";
import {
  GameDataValidationError,
} from "@jadethrone/data/catalog";
import type { GameDataDataset } from "@jadethrone/shared";
import type { Db } from "../db/client";
import { gameDataOverrides } from "../db/schema";
import { writeAdminLog } from "../admin/adminLog";
import { ServiceError } from "../errors";
import { logger } from "../logger";
import type { GameDataStore } from "./store";

function validationError(error: GameDataValidationError): ServiceError {
  return new ServiceError(
    "validation",
    `Invalid ${error.dataset} data.`,
    Object.fromEntries(
      error.issues.map((issue) => [
        `${error.dataset}.${issue.path || "_"}`,
        issue.message,
      ]),
    ),
  );
}

async function reloadAfterWrite(store: GameDataStore): Promise<number> {
  try {
    const result = await store.reloadLocked();
    return result.version;
  } catch (error) {
    logger.error({ error }, "game data committed but catalog reload failed");
    throw new ServiceError(
      "conflict",
      "The override was saved but the catalog could not be reloaded.",
    );
  }
}

export async function saveGameDataOverride(input: {
  db: Db;
  store: GameDataStore;
  dataset: GameDataDataset;
  entryId: string;
  payload: Record<string, unknown>;
  actorAccountId: string;
  ip?: string | null;
}): Promise<{ version: number }> {
  return input.store.runLocked(async () => {
    try {
      input.store.validateCandidate(input.dataset, input.entryId, input.payload);
    } catch (error) {
      if (error instanceof GameDataValidationError) {
        throw validationError(error);
      }
      throw error;
    }

    await input.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(gameDataOverrides)
        .where(
          and(
            eq(gameDataOverrides.dataset, input.dataset),
            eq(gameDataOverrides.entryId, input.entryId),
          ),
        )
        .limit(1)
        .for("update");
      await tx
        .insert(gameDataOverrides)
        .values({
          dataset: input.dataset,
          entryId: input.entryId,
          payload: input.payload,
          updatedBy: input.actorAccountId,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [gameDataOverrides.dataset, gameDataOverrides.entryId],
          set: {
            payload: input.payload,
            updatedBy: input.actorAccountId,
            updatedAt: new Date(),
          },
        });
      await writeAdminLog(tx, {
        actorAccountId: input.actorAccountId,
        action: "game_data_update",
        detail: {
          dataset: input.dataset,
          entryId: input.entryId,
          before: before?.payload ?? null,
          after: input.payload,
        },
        ip: input.ip ?? null,
      });
    });

    return { version: await reloadAfterWrite(input.store) };
  });
}

export async function deleteGameDataOverride(input: {
  db: Db;
  store: GameDataStore;
  dataset: GameDataDataset;
  entryId: string;
  actorAccountId: string;
  ip?: string | null;
}): Promise<{ version: number }> {
  return input.store.runLocked(async () => {
    try {
      input.store.validateCandidate(input.dataset, input.entryId, null);
    } catch (error) {
      if (error instanceof GameDataValidationError) {
        throw validationError(error);
      }
      throw error;
    }

    const deleted = await input.db.transaction(async (tx) => {
      const rows = await tx
        .delete(gameDataOverrides)
        .where(
          and(
            eq(gameDataOverrides.dataset, input.dataset),
            eq(gameDataOverrides.entryId, input.entryId),
          ),
        )
        .returning();
      const before = rows[0];
      if (!before) {
        return null;
      }
      await writeAdminLog(tx, {
        actorAccountId: input.actorAccountId,
        action: "game_data_delete",
        detail: {
          dataset: input.dataset,
          entryId: input.entryId,
          before: before.payload,
          after: null,
        },
        ip: input.ip ?? null,
      });
      return before;
    });

    if (!deleted) {
      throw new ServiceError("not_found", "That override does not exist.");
    }
    return { version: await reloadAfterWrite(input.store) };
  });
}

export async function reloadGameData(input: {
  db: Db;
  store: GameDataStore;
  actorAccountId: string;
  ip?: string | null;
}): Promise<{ version: number; overrides: number }> {
  return input.store.runLocked(async () => {
    const result = await input.store.reloadLocked();
    await writeAdminLog(input.db, {
      actorAccountId: input.actorAccountId,
      action: "game_data_reload",
      detail: { version: result.version, overrides: result.overrides },
      ip: input.ip ?? null,
    });
    return { version: result.version, overrides: result.overrides };
  });
}

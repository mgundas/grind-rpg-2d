import { and, eq } from "drizzle-orm";
import type { GameDataDataset } from "@jadethrone/shared";
import type { Db, Tx } from "../db/client";
import { gameDataOverrides, type GameDataOverrideRow } from "../db/schema";
import type { GameDataOverrideRecord } from "./store";

function toRecord(row: GameDataOverrideRow): GameDataOverrideRecord {
  return {
    dataset: row.dataset as GameDataDataset,
    entryId: row.entryId,
    payload: row.payload,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  };
}

export async function loadGameDataOverrides(db: Db): Promise<GameDataOverrideRecord[]> {
  const rows = await db.select().from(gameDataOverrides);
  return rows.map(toRecord);
}

export async function getGameDataOverride(
  db: Db,
  dataset: GameDataDataset,
  entryId: string,
): Promise<GameDataOverrideRow | null> {
  const [row] = await db
    .select()
    .from(gameDataOverrides)
    .where(and(eq(gameDataOverrides.dataset, dataset), eq(gameDataOverrides.entryId, entryId)))
    .limit(1);
  return row ?? null;
}

export async function upsertGameDataOverride(
  tx: Tx,
  input: {
    dataset: GameDataDataset;
    entryId: string;
    payload: Record<string, unknown>;
    actorAccountId: string;
  },
): Promise<void> {
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
}

export async function deleteGameDataOverride(
  tx: Tx,
  dataset: GameDataDataset,
  entryId: string,
): Promise<GameDataOverrideRow | null> {
  const rows = await tx
    .delete(gameDataOverrides)
    .where(and(eq(gameDataOverrides.dataset, dataset), eq(gameDataOverrides.entryId, entryId)))
    .returning();
  return rows[0] ?? null;
}

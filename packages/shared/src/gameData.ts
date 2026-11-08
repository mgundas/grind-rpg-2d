import { z } from "zod";

/** Datasets editable through the admin hot-reload API (Phase 7 §3.4). */
export const GAME_DATA_DATASETS = [
  "items",
  "monsters",
  "dropTables",
  "shops",
  "spawnGroups",
  "npcs",
  "skills",
  "stones",
  "upgrades",
  "bonuses",
] as const;
export type GameDataDataset = (typeof GAME_DATA_DATASETS)[number];

export const gameDataDatasetSchema = z.enum(GAME_DATA_DATASETS);

export const adminGameDataPutSchema = z
  .object({ payload: z.record(z.string(), z.unknown()) })
  .strict();

export const adminGameDataParamsSchema = z
  .object({ dataset: gameDataDatasetSchema, entryId: z.string().trim().min(1).max(64) })
  .strict();

export interface AdminGameDataOverrideDto {
  entryId: string;
  payload: Record<string, unknown>;
  updatedBy: string;
  updatedAt: string;
}

export interface AdminGameDataDatasetResponse {
  dataset: GameDataDataset;
  version: number;
  base: unknown[];
  merged: unknown[];
  overrides: AdminGameDataOverrideDto[];
}

export interface AdminGameDataMutationResponse {
  dataset: GameDataDataset;
  entryId: string;
  version: number;
  reverted?: boolean;
}

export type AdminGameDataReloadResponse = {
  version: number;
  overrides: number;
  counts: Record<GameDataDataset, number>;
};

export type PublicGameDataEntries = Record<GameDataDataset, unknown[]>;

export interface PublicGameDataCatalogResponse {
  version: number;
  entries: PublicGameDataEntries;
}

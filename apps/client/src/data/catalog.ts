import {
  BASE_CATALOG,
  buildCatalog,
  type GameDataCatalog,
  type GameDataEntries,
} from "@jadethrone/data/catalog";
import { GAME_DATA_DATASETS, type GameDataDataset } from "@jadethrone/shared";

/**
 * Client-side merged catalog. The static base is always available; a successful
 * `/api/data/catalog` refresh swaps one validated snapshot. UI components read
 * through this module so an admin edit changes tooltips/prices after refresh.
 */
let current: GameDataCatalog = BASE_CATALOG;

export function getClientCatalog(): GameDataCatalog {
  return current;
}

export function setClientCatalog(catalog: GameDataCatalog): void {
  current = catalog;
}

export class ClientCatalogError extends Error {}

function isEntries(value: unknown): value is Record<GameDataDataset, unknown[]> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return GAME_DATA_DATASETS.every((dataset) => Array.isArray(record[dataset]));
}

/** Validate a public catalog payload; throws ClientCatalogError on bad shapes. */
export function buildClientCatalog(payload: unknown): GameDataCatalog {
  if (typeof payload !== "object" || payload === null) {
    throw new ClientCatalogError("Catalog payload is not an object.");
  }
  const record = payload as { version?: unknown; entries?: unknown };
  if (typeof record.version !== "number" || !Number.isFinite(record.version)) {
    throw new ClientCatalogError("Catalog version is missing.");
  }
  if (!isEntries(record.entries)) {
    throw new ClientCatalogError("Catalog entries are incomplete.");
  }
  return buildCatalog(record.entries as GameDataEntries, record.version);
}

/** Fetch and apply the server catalog. Returns true when the version changed. */
export async function refreshClientCatalog(
  fetchFn: (input: string) => Promise<Response> = (input) => fetch(input),
): Promise<boolean> {
  const response = await fetchFn("/api/data/catalog");
  if (!response.ok) {
    throw new ClientCatalogError(`Catalog request failed (HTTP ${response.status}).`);
  }
  const catalog = buildClientCatalog(await response.json());
  if (catalog.version === current.version) {
    return false;
  }
  current = catalog;
  return true;
}

export function getItem(id: string) {
  return current.getItem(id);
}

export function hasItem(id: string): boolean {
  return current.hasItem(id);
}

export function findItem(id: string) {
  return current.findItem(id);
}

export function getSkill(id: string) {
  return current.getSkill(id);
}

export function hasSkill(id: string): boolean {
  return current.hasSkill(id);
}

export function skillsForDoctrine(
  classId: Parameters<GameDataCatalog["skillsForDoctrine"]>[0],
  doctrineId: string,
) {
  return current.skillsForDoctrine(classId, doctrineId);
}

export function getMonster(id: string) {
  return current.getMonster(id);
}

export function getBonusDefinition(type: string) {
  return current.getBonusDefinition(type);
}

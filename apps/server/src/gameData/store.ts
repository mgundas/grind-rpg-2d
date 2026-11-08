import {
  BASE_GAME_DATA,
  GameDataValidationError,
  buildCatalog,
  entryIdOf,
  mergeGameData,
  type GameDataCatalog,
  type GameDataEntries,
  type GameDataOverrideInput,
} from "@jadethrone/data/catalog";
import {
  GAME_DATA_DATASETS,
  type GameDataDataset,
} from "@jadethrone/shared";

export interface GameDataOverrideRecord {
  dataset: GameDataDataset;
  entryId: string;
  payload: Record<string, unknown>;
  updatedBy: string;
  updatedAt: Date;
}

export interface GameDataOverrideView extends Omit<GameDataOverrideRecord, "updatedAt"> {
  updatedAt: string;
}

export interface GameDataSnapshot {
  version: number;
  baseEntries: GameDataEntries;
  entries: GameDataEntries;
  catalog: GameDataCatalog;
  overrides: ReadonlyMap<string, GameDataOverrideView>;
}

export interface GameDataReloadResult {
  version: number;
  overrides: number;
  counts: Record<GameDataDataset, number>;
}

export interface GameDataStore {
  getSnapshot(): GameDataSnapshot;
  getCatalog(): GameDataCatalog;
  getVersion(): number;
  getEntries(): GameDataEntries;
  getBaseEntries(): GameDataEntries;
  getOverride(dataset: GameDataDataset, entryId: string): GameDataOverrideView | null;
  listOverrides(dataset: GameDataDataset): readonly GameDataOverrideView[];
  ensureLoaded(): Promise<void>;
  runLocked<T>(task: () => Promise<T>): Promise<T>;
  reloadLocked(): Promise<GameDataReloadResult>;
  reload(): Promise<GameDataReloadResult>;
  validateCandidate(
    dataset: GameDataDataset,
    entryId: string,
    payload: Record<string, unknown> | null,
  ): void;
  getPublicCatalog(): { version: number; entries: GameDataEntries };
}

export interface GameDataStoreOptions {
  loadOverrides: () => Promise<readonly GameDataOverrideRecord[]>;
  baseEntries?: GameDataEntries;
  onReloadError?: (error: unknown) => void;
}

function overrideKey(dataset: GameDataDataset, entryId: string): string {
  return `${dataset}:${entryId}`;
}

function toView(record: GameDataOverrideRecord): GameDataOverrideView {
  return {
    dataset: record.dataset,
    entryId: record.entryId,
    payload: record.payload,
    updatedBy: record.updatedBy,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function countsFor(entries: GameDataEntries): Record<GameDataDataset, number> {
  return Object.fromEntries(
    GAME_DATA_DATASETS.map((dataset) => [dataset, entries[dataset].length]),
  ) as Record<GameDataDataset, number>;
}

function validateOverride(record: {
  dataset: GameDataDataset;
  entryId: string;
  payload: unknown;
}): void {
  const identity = entryIdOf(record.dataset, record.payload);
  if (identity !== record.entryId) {
    throw new GameDataValidationError(record.dataset, [
      {
        path: "id",
        message: `override identity "${identity}" does not match "${record.entryId}"`,
      },
    ]);
  }
}

export function createGameDataStore(options: GameDataStoreOptions): GameDataStore {
  const baseEntries = options.baseEntries ?? BASE_GAME_DATA;
  let loaded = false;
  let loading: Promise<void> | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let snapshot: GameDataSnapshot = {
    version: 1,
    baseEntries,
    entries: baseEntries,
    catalog: buildCatalog(baseEntries, 1),
    overrides: new Map(),
  };

  function buildState(records: readonly GameDataOverrideRecord[]): GameDataSnapshot {
    const overrides = new Map<string, GameDataOverrideView>();
    const inputs: GameDataOverrideInput[] = [];
    for (const record of records) {
      validateOverride(record);
      overrides.set(overrideKey(record.dataset, record.entryId), toView(record));
      inputs.push({
        dataset: record.dataset,
        entryId: record.entryId,
        payload: record.payload,
      });
    }
    const entries = mergeGameData(baseEntries, inputs);
    const version = snapshot.version + 1;
    return {
      version,
      baseEntries,
      entries,
      catalog: buildCatalog(entries, version),
      overrides,
    };
  }

  function runLocked<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function reloadLocked(): Promise<GameDataReloadResult> {
    const records = await options.loadOverrides();
    const next = buildState(records);
    snapshot = next;
    loaded = true;
    return {
      version: next.version,
      overrides: next.overrides.size,
      counts: countsFor(next.entries),
    };
  }

  async function reload(): Promise<GameDataReloadResult> {
    try {
      return await runLocked(reloadLocked);
    } catch (error) {
      options.onReloadError?.(error);
      throw error;
    }
  }

  async function ensureLoaded(): Promise<void> {
    if (loaded) {
      return;
    }
    loading ??= runLocked(reloadLocked)
      .then(() => undefined)
      .catch((error: unknown) => {
        loading = null;
        options.onReloadError?.(error);
        throw error;
      });
    await loading;
  }

  function validateCandidate(
    dataset: GameDataDataset,
    entryId: string,
    payload: Record<string, unknown> | null,
  ): void {
    const inputs: GameDataOverrideInput[] = [];
    for (const view of snapshot.overrides.values()) {
      if (view.dataset === dataset && view.entryId === entryId) {
        continue;
      }
      inputs.push({
        dataset: view.dataset,
        entryId: view.entryId,
        payload: view.payload,
      });
    }
    if (payload !== null) {
      validateOverride({ dataset, entryId, payload });
      inputs.push({ dataset, entryId, payload });
    }
    const entries = mergeGameData(baseEntries, inputs);
    buildCatalog(entries, snapshot.version);
  }

  return {
    getSnapshot: () => snapshot,
    getCatalog: () => snapshot.catalog,
    getVersion: () => snapshot.version,
    getEntries: () => snapshot.entries,
    getBaseEntries: () => snapshot.baseEntries,
    getOverride: (dataset, entryId) =>
      snapshot.overrides.get(overrideKey(dataset, entryId)) ?? null,
    listOverrides: (dataset) =>
      [...snapshot.overrides.values()]
        .filter((override) => override.dataset === dataset)
        .sort((one, two) => one.entryId.localeCompare(two.entryId)),
    ensureLoaded,
    runLocked,
    reloadLocked,
    reload,
    validateCandidate,
    getPublicCatalog: () => ({ version: snapshot.version, entries: snapshot.entries }),
  };
}

/** Fixed catalog for tests and non-DB rooms; reload is a no-op. */
export function createStaticGameDataStore(
  entries: GameDataEntries = BASE_GAME_DATA,
  version = 1,
): GameDataStore {
  const snapshot: GameDataSnapshot = {
    version,
    baseEntries: entries,
    entries,
    catalog: buildCatalog(entries, version),
    overrides: new Map(),
  };
  const result: GameDataReloadResult = {
    version,
    overrides: 0,
    counts: countsFor(entries),
  };
  return {
    getSnapshot: () => snapshot,
    getCatalog: () => snapshot.catalog,
    getVersion: () => version,
    getEntries: () => entries,
    getBaseEntries: () => entries,
    getOverride: () => null,
    listOverrides: () => [],
    ensureLoaded: async () => undefined,
    runLocked: async (task) => task(),
    reloadLocked: async () => result,
    reload: async () => result,
    validateCandidate: (dataset, entryId, payload) => {
      if (payload === null) {
        return;
      }
      validateOverride({ dataset, entryId, payload });
      buildCatalog(
        mergeGameData(entries, [{ dataset, entryId, payload }]),
        version,
      );
    },
    getPublicCatalog: () => ({ version, entries }),
  };
}

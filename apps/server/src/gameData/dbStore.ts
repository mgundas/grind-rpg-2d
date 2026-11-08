import type { Db } from "../db/client";
import { logger } from "../logger";
import { loadGameDataOverrides } from "./overrideRepository";
import { createGameDataStore, type GameDataStore } from "./store";

/** DB-backed catalog store. Nothing is read until `reload`/`ensureLoaded`. */
export function createDbGameDataStore(db: Db): GameDataStore {
  return createGameDataStore({
    loadOverrides: () => loadGameDataOverrides(db),
    onReloadError: (error) => {
      logger.error({ error }, "game data reload failed; keeping the previous catalog");
    },
  });
}

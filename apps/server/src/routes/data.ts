import { Router } from "express";
import type { PublicGameDataCatalogResponse } from "@jadethrone/shared";
import type { GameDataStore } from "../gameData/store";

/** Public merged catalog so clients can rebuild the same definitions. */
export function createDataRouter(deps: { gameData: GameDataStore }): Router {
  const router = Router();

  router.get("/catalog", async (_req, res) => {
    try {
      await deps.gameData.ensureLoaded();
    } catch {
      // Serve the current (base) snapshot rather than failing the whole client.
    }
    const catalog = deps.gameData.getPublicCatalog();
    const body: PublicGameDataCatalogResponse = {
      version: catalog.version,
      entries: Object.fromEntries(
        Object.entries(catalog.entries).map(([dataset, entries]) => [dataset, [...entries]]),
      ) as PublicGameDataCatalogResponse["entries"],
    };
    res.setHeader("Cache-Control", "no-store");
    res.json(body);
  });

  return router;
}

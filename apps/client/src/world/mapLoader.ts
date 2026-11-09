import Phaser from "phaser";
import { loadMapJson } from "@jadethrone/data/mapLoader";
import type { MapId } from "@jadethrone/shared";
import { TILEMAP_KEYS } from "./mapKeys";

/**
 * Ensures Phaser's tilemap cache holds one map. Maps load on demand as their
 * own chunk (Phase 10 lazy-map work); the cache key is the same one World has
 * always used, so nothing downstream changes.
 */
export async function ensureMapTilemap(scene: Phaser.Scene, mapId: MapId): Promise<void> {
  const key = TILEMAP_KEYS[mapId];
  if (scene.cache.tilemap.exists(key)) {
    return;
  }
  const data = await loadMapJson(mapId);
  if (!scene.cache.tilemap.exists(key)) {
    scene.cache.tilemap.add(key, {
      format: Phaser.Tilemaps.Formats.TILED_JSON,
      data,
    });
  }
}

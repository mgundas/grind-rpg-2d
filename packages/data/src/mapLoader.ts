import type { MapId } from "@jadethrone/shared";

/**
 * Dynamic per-map JSON loaders. The client only imports this module, so Vite
 * emits one chunk per map instead of bundling every Tiled map into the initial
 * payload. The server keeps using the static `MAP_JSON` map from `maps.ts`; both
 * paths import the exact same committed file, so collision parity is preserved.
 */
const LOADERS: Record<MapId, () => Promise<unknown>> = {
  map_ember_village: () => import("../maps/map_ember_village.json").then((m) => m.default),
  map_ember_fields: () => import("../maps/map_ember_fields.json").then((m) => m.default),
  map_gale_village: () => import("../maps/map_gale_village.json").then((m) => m.default),
  map_gale_highlands: () => import("../maps/map_gale_highlands.json").then((m) => m.default),
  map_tide_village: () => import("../maps/map_tide_village.json").then((m) => m.default),
  map_tide_highlands: () => import("../maps/map_tide_highlands.json").then((m) => m.default),
  map_valley_of_echoes: () => import("../maps/map_valley_of_echoes.json").then((m) => m.default),
  map_corrupted_forest: () => import("../maps/map_corrupted_forest.json").then((m) => m.default),
  map_spider_cave: () => import("../maps/map_spider_cave.json").then((m) => m.default),
};

/** Loads one map's Tiled JSON as a separate chunk. */
export function loadMapJson(mapId: MapId): Promise<unknown> {
  return LOADERS[mapId]();
}

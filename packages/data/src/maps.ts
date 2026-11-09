import type { MapId } from "@jadethrone/shared";
import emberVillage from "../maps/map_ember_village.json";
import emberHighlands from "../maps/map_ember_fields.json";
import galeVillage from "../maps/map_gale_village.json";
import galeHighlands from "../maps/map_gale_highlands.json";
import tideVillage from "../maps/map_tide_village.json";
import tideHighlands from "../maps/map_tide_highlands.json";
import valley from "../maps/map_valley_of_echoes.json";
import forest from "../maps/map_corrupted_forest.json";
import spiderCave from "../maps/map_spider_cave.json";

/**
 * Every generated Tiled map as raw JSON. Client and server import this single
 * module so they always parse the exact same bytes (collision parity, D11).
 */
export const MAP_JSON: Record<MapId, unknown> = {
  map_ember_village: emberVillage,
  map_ember_fields: emberHighlands,
  map_gale_village: galeVillage,
  map_gale_highlands: galeHighlands,
  map_tide_village: tideVillage,
  map_tide_highlands: tideHighlands,
  map_valley_of_echoes: valley,
  map_corrupted_forest: forest,
  map_spider_cave: spiderCave,
};

export function getMapJson(mapId: MapId): unknown {
  return MAP_JSON[mapId];
}

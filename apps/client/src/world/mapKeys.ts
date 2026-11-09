import {
  MAP_IDS,
  ROOM_NAME_VILLAGE,
  type MapId,
} from "@jadethrone/shared";

/** Phaser tilemap cache keys for every Tiled map loaded in Preload. */
export const TILEMAP_KEYS: Record<MapId, string> = {
  map_ember_village: "tmj.ember_village",
  map_ember_fields: "tmj.ember_fields",
  map_gale_village: "tmj.gale_village",
  map_gale_highlands: "tmj.gale_highlands",
  map_tide_village: "tmj.tide_village",
  map_tide_highlands: "tmj.tide_highlands",
  map_valley_of_echoes: "tmj.valley_of_echoes",
  map_corrupted_forest: "tmj.corrupted_forest",
  map_spider_cave: "tmj.spider_cave",
};

/** Villages use the town tileset; every outdoor and cave map uses the field one. */
const TILESET_NAMES: Record<MapId, string> = Object.fromEntries(
  MAP_IDS.map((mapId) => [mapId, mapId.includes("village") ? "village" : "fields"]),
) as Record<MapId, string>;

export const TILESET_TEXTURE_KEYS = ["tileset.village", "tileset.fields"] as const;

export function tilemapKeyFor(mapId: MapId): string {
  return TILEMAP_KEYS[mapId];
}

export function tilesetNameFor(mapId: MapId): string {
  return TILESET_NAMES[mapId];
}

export function tilesetTextureKeyFor(mapId: MapId): string {
  return `tileset.${TILESET_NAMES[mapId]}`;
}

/** Default map shown behind the join panel. */
export const DEFAULT_MAP: MapId = ROOM_NAME_VILLAGE;

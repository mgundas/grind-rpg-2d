import { ROOM_NAME_FIELDS, ROOM_NAME_VILLAGE, type MapId } from "@jadethrone/shared";

/** Phaser cache keys for the Tiled maps loaded in Preload. */
export const TILEMAP_KEYS = {
  village: "tmj.village",
  fields: "tmj.fields",
} as const;

export function tilemapKeyFor(mapId: MapId): string {
  return mapId === ROOM_NAME_FIELDS ? TILEMAP_KEYS.fields : TILEMAP_KEYS.village;
}

export function tilesetNameFor(mapId: MapId): string {
  return mapId === ROOM_NAME_FIELDS ? "fields" : "village";
}

export const TILESET_TEXTURE_KEYS = ["tileset.village", "tileset.fields"] as const;

export function tilesetTextureKeyFor(mapId: MapId): string {
  return mapId === ROOM_NAME_FIELDS ? "tileset.fields" : "tileset.village";
}

/** Default map shown behind the join panel. */
export const DEFAULT_MAP: MapId = ROOM_NAME_VILLAGE;

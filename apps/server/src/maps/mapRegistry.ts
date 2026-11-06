import villageMapJson from "@jadethrone/data/maps/map_ember_village.json";
import fieldsMapJson from "@jadethrone/data/maps/map_ember_fields.json";
import {
  ROOM_NAME_FIELDS,
  ROOM_NAME_VILLAGE,
  buildCollisionGrid,
  extractMapObjects,
  parseTiledMap,
  type CollisionGrid,
  type MapId,
  type Vec2,
  type WarpZone,
} from "@jadethrone/shared";

/**
 * Server-side map assets. The client parses the exact same JSON files, so
 * collision built here matches the client predictor bit for bit.
 */

export interface MapAssets {
  mapId: MapId;
  grid: CollisionGrid;
  warps: WarpZone[];
  spawn: Vec2;
  widthPx: number;
  heightPx: number;
}

const RAW_MAPS: Record<MapId, unknown> = {
  [ROOM_NAME_VILLAGE]: villageMapJson,
  [ROOM_NAME_FIELDS]: fieldsMapJson,
};

const cache = new Map<MapId, MapAssets>();

export function isMapId(value: string): value is MapId {
  return value === ROOM_NAME_VILLAGE || value === ROOM_NAME_FIELDS;
}

export function loadMapAssets(mapId: MapId): MapAssets {
  const cached = cache.get(mapId);
  if (cached) {
    return cached;
  }
  const map = parseTiledMap(RAW_MAPS[mapId]);
  const objects = extractMapObjects(map);
  const assets: MapAssets = {
    mapId,
    grid: buildCollisionGrid(map),
    warps: objects.warps,
    spawn: objects.spawn,
    widthPx: map.width * map.tilewidth,
    heightPx: map.height * map.tileheight,
  };
  cache.set(mapId, assets);
  return assets;
}

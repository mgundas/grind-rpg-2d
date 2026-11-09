import villageMapJson from "@jadethrone/data/maps/map_ember_village.json";
import fieldsMapJson from "@jadethrone/data/maps/map_ember_fields.json";
import {
  ROOM_NAME_FIELDS,
  ROOM_NAME_VILLAGE,
  buildCollisionGrid,
  extractMapObjects,
  isMapId as isSharedMapId,
  parseTiledMap,
  type CollisionGrid,
  type MapId,
  type MobZone,
  type NpcSpawn,
  type TiledObjectJson,
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
  mobZones: MobZone[];
  npcs: NpcSpawn[];
  stoneZones: TiledObjectJson[];
  spawn: Vec2;
  widthPx: number;
  heightPx: number;
}

/**
 * Raw map JSON is registered as each map file lands; until Phase 9 task 7 every
 * id in `MAP_IDS` must have an entry here (the client mirrors this in Preload).
 */
const RAW_MAPS: Partial<Record<MapId, unknown>> = {
  [ROOM_NAME_VILLAGE]: villageMapJson,
  [ROOM_NAME_FIELDS]: fieldsMapJson,
};

const cache = new Map<MapId, MapAssets>();

export function isMapId(value: string): value is MapId {
  return isSharedMapId(value);
}

export function loadMapAssets(mapId: MapId): MapAssets {
  const cached = cache.get(mapId);
  if (cached) {
    return cached;
  }
  const raw = RAW_MAPS[mapId];
  if (raw === undefined) {
    throw new Error(`map assets not generated yet: "${mapId}"`);
  }
  const map = parseTiledMap(raw);
  const objects = extractMapObjects(map);
  const assets: MapAssets = {
    mapId,
    grid: buildCollisionGrid(map),
    warps: objects.warps,
    mobZones: objects.mobZones,
    npcs: objects.npcs,
    stoneZones: objects.stoneZones,
    spawn: objects.spawn,
    widthPx: map.width * map.tilewidth,
    heightPx: map.height * map.tileheight,
  };
  cache.set(mapId, assets);
  return assets;
}

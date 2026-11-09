import { MAP_JSON } from "@jadethrone/data/maps";
import {
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

const cache = new Map<MapId, MapAssets>();

export function isMapId(value: string): value is MapId {
  return isSharedMapId(value);
}

export function loadMapAssets(mapId: MapId): MapAssets {
  const cached = cache.get(mapId);
  if (cached) {
    return cached;
  }
  const map = parseTiledMap(MAP_JSON[mapId]);
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

/**
 * Deterministic map generation for Jade Throne (GAME_DESIGN.md §3.2).
 *
 * Maps are valid Tiled JSON committed under `maps/`; regenerate with
 * `pnpm generate:maps`. The seeded RNG from `@jadethrone/shared` makes every
 * run byte-identical.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ROOM_NAME_FIELDS,
  ROOM_NAME_FOREST,
  ROOM_NAME_GALE_HIGHLANDS,
  ROOM_NAME_GALE_VILLAGE,
  ROOM_NAME_SPIDER_CAVE,
  ROOM_NAME_TIDE_HIGHLANDS,
  ROOM_NAME_TIDE_VILLAGE,
  ROOM_NAME_VALLEY,
  ROOM_NAME_VILLAGE,
  TILE_SIZE,
  mulberry32,
  seedFromString,
  type MapId,
} from "@jadethrone/shared";

/** Tile gids in our placeholder tileset strip: grass, dirt, stone, water, wall. */
export const TILE_GRASS = 1;
export const TILE_DIRT = 2;
export const TILE_STONE = 3;
export const TILE_WATER = 4;
export const TILE_WALL = 5;

export interface TiledLayer {
  id: number;
  name: string;
  type: "tilelayer";
  width: number;
  height: number;
  x: number;
  y: number;
  opacity: number;
  visible: boolean;
  data: number[];
}

export interface TiledObject {
  id: number;
  name: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  point?: boolean;
  rotation?: number;
  type?: string;
  visible?: boolean;
  properties?: Array<{ name: string; type: string; value: unknown }>;
}

export interface TiledObjectLayer {
  id: number;
  name: string;
  type: "objectgroup";
  draworder: "topdown";
  opacity: number;
  visible: boolean;
  x: number;
  y: number;
  objects: TiledObject[];
}

export interface TiledMapFile {
  type: "map";
  version: string;
  tiledversion: string;
  orientation: "orthogonal";
  renderorder: "right-down";
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  infinite: false;
  nextlayerid: number;
  nextobjectid: number;
  layers: Array<TiledLayer | TiledObjectLayer>;
  tilesets: Array<{
    firstgid: number;
    name: string;
    tilewidth: number;
    tileheight: number;
    tilecount: number;
    columns: number;
    image: string;
    imagewidth: number;
    imageheight: number;
    margin: number;
    spacing: number;
  }>;
}

export const VILLAGE_WIDTH = 80;
export const VILLAGE_HEIGHT = 80;
export const FIELDS_WIDTH = 160;
export const FIELDS_HEIGHT = 160;

/** Spawn used by both the village map and arrivals from the fields. */
export const VILLAGE_SPAWN = { x: 40 * TILE_SIZE + 16, y: 40 * TILE_SIZE + 16 };
/** Spawn used by the fields map and arrivals from the village. */
export const FIELDS_SPAWN = { x: 5 * TILE_SIZE + 16, y: 80 * TILE_SIZE + 16 };
/** Kingdom village spawns (all use the central plaza). */
export const GALE_VILLAGE_SPAWN = { x: 40 * TILE_SIZE + 16, y: 40 * TILE_SIZE + 16 };
export const TIDE_VILLAGE_SPAWN = { x: 40 * TILE_SIZE + 16, y: 40 * TILE_SIZE + 16 };
/** Highlands arrival points (western gate, same shape as the Ember fields). */
export const GALE_HIGHLANDS_SPAWN = { x: 5 * TILE_SIZE + 16, y: 80 * TILE_SIZE + 16 };
export const TIDE_HIGHLANDS_SPAWN = { x: 5 * TILE_SIZE + 16, y: 80 * TILE_SIZE + 16 };
/** Valley arrival points, one per kingdom (west edge, spread apart). */
export const VALLEY_EMBER_SPAWN = { x: 5 * TILE_SIZE + 16, y: 40 * TILE_SIZE + 16 };
export const VALLEY_GALE_SPAWN = { x: 5 * TILE_SIZE + 16, y: 100 * TILE_SIZE + 16 };
export const VALLEY_TIDE_SPAWN = { x: 5 * TILE_SIZE + 16, y: 140 * TILE_SIZE + 16 };
/** Corrupted Forest arrival and the Spider Cave entrance point. */
export const FOREST_SPAWN = { x: 5 * TILE_SIZE + 16, y: 90 * TILE_SIZE + 16 };
export const SPIDER_CAVE_SPAWN = { x: 10 * TILE_SIZE + 16, y: 20 * TILE_SIZE + 16 };

function emptyLayer(width: number, height: number, fill: number): number[] {
  return new Array<number>(width * height).fill(fill);
}

function index(width: number, x: number, y: number): number {
  return y * width + x;
}

function paint(
  width: number,
  height: number,
  data: number[],
  x: number,
  y: number,
  tile: number,
): void {
  if (x >= 0 && y >= 0 && x < width && y < height) {
    data[index(width, x, y)] = tile;
  }
}

function paintRect(
  width: number,
  height: number,
  data: number[],
  x: number,
  y: number,
  w: number,
  h: number,
  tile: number,
): void {
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      paint(width, height, data, tx, ty, tile);
    }
  }
}

function paintDisc(
  width: number,
  height: number,
  data: number[],
  cx: number,
  cy: number,
  radius: number,
  tile: number,
): void {
  const r2 = radius * radius;
  for (let ty = cy - radius; ty <= cy + radius; ty++) {
    for (let tx = cx - radius; tx <= cx + radius; tx++) {
      const dx = tx - cx;
      const dy = ty - cy;
      if (dx * dx + dy * dy <= r2) {
        paint(width, height, data, tx, ty, tile);
      }
    }
  }
}

function tileLayer(
  id: number,
  name: string,
  width: number,
  height: number,
  data: number[],
  visible = true,
): TiledLayer {
  return {
    id,
    name,
    type: "tilelayer",
    width,
    height,
    x: 0,
    y: 0,
    opacity: 1,
    visible,
    data,
  };
}

function objectLayer(id: number, objects: TiledObject[]): TiledObjectLayer {
  return {
    id,
    name: "objects",
    type: "objectgroup",
    draworder: "topdown",
    opacity: 1,
    visible: true,
    x: 0,
    y: 0,
    objects,
  };
}

function tileset(name: string): TiledMapFile["tilesets"][number] {
  return {
    firstgid: 1,
    name,
    tilewidth: TILE_SIZE,
    tileheight: TILE_SIZE,
    tilecount: 5,
    columns: 5,
    image: `tilesets/${name}.png`,
    imagewidth: TILE_SIZE * 5,
    imageheight: TILE_SIZE,
    margin: 0,
    spacing: 0,
  };
}

function baseMap(
  width: number,
  height: number,
  tilesetName: string,
  layers: Array<TiledLayer | TiledObjectLayer>,
): TiledMapFile {
  const objectIds = layers.flatMap((layer) =>
    layer.type === "objectgroup" ? layer.objects.map((object) => object.id) : [],
  );
  const nextObjectId = objectIds.length > 0 ? Math.max(...objectIds) + 1 : 1;
  return {
    type: "map",
    version: "1.10",
    tiledversion: "1.10.2",
    orientation: "orthogonal",
    renderorder: "right-down",
    width,
    height,
    tilewidth: TILE_SIZE,
    tileheight: TILE_SIZE,
    infinite: false,
    nextlayerid: layers.length + 1,
    nextobjectid: nextObjectId,
    layers,
    tilesets: [tileset(tilesetName)],
  };
}

/** Axis-aligned tile rectangle used by the village specs. */
export interface VillageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Declarative description of a kingdom village (GAME_DESIGN.md §3.2). */
export interface VillageSpec {
  mapId: MapId;
  spawn: { x: number; y: number };
  plaza: VillageRect;
  roads: VillageRect[];
  water: VillageRect[];
  bridge: VillageRect | null;
  pond: { x: number; y: number; r: number } | null;
  houses: VillageRect[];
  groves: Array<{ x: number; y: number }>;
  fences: VillageRect[];
  dirtPatches: number;
  stonePatches: number;
  /** Dirt approach to the warp rectangle. */
  exit: VillageRect;
  warp: VillageRect;
  targetMap: MapId;
  targetSpawn: { x: number; y: number };
}

/** Houses of the Ember village: solid footprints painted with wall tiles. */
const VILLAGE_HOUSES: VillageRect[] = [
  { x: 10, y: 8, w: 8, h: 6 },
  { x: 10, y: 52, w: 8, h: 6 },
  { x: 56, y: 8, w: 9, h: 6 },
  { x: 56, y: 52, w: 8, h: 7 },
];

/** Tree groves; only placed on plain grass so roads and the plaza stay open. */
const VILLAGE_GROVES = [
  { x: 16, y: 18 },
  { x: 18, y: 62 },
  { x: 62, y: 18 },
  { x: 62, y: 62 },
  { x: 30, y: 16 },
  { x: 50, y: 66 },
  { x: 12, y: 40 },
  { x: 68, y: 44 },
];

/** Fences: short solid segments in the open areas. */
const VILLAGE_FENCES: VillageRect[] = [
  { x: 46, y: 22, w: 8, h: 1 },
  { x: 54, y: 22, w: 1, h: 5 },
  { x: 26, y: 56, w: 8, h: 1 },
];

/** NPCs stand around the plaza; offsets are px relative to the spawn. */
const VILLAGE_NPCS: ReadonlyArray<{ id: string; dx: number; dy: number }> = [
  { id: "blacksmith", dx: -4 * TILE_SIZE, dy: -4 },
  { id: "general_goods", dx: -2 * TILE_SIZE, dy: -2 * TILE_SIZE },
  { id: "weaponsmith", dx: 2 * TILE_SIZE, dy: -2 * TILE_SIZE },
  { id: "armorer", dx: 2 * TILE_SIZE, dy: 2 * TILE_SIZE },
  { id: "warehouse_keeper", dx: -2 * TILE_SIZE, dy: 2 * TILE_SIZE },
];

function buildVillage(spec: VillageSpec): TiledMapFile {
  const w = VILLAGE_WIDTH;
  const h = VILLAGE_HEIGHT;
  const rng = mulberry32(seedFromString(spec.mapId));

  const ground = emptyLayer(w, h, TILE_GRASS);
  const decor = emptyLayer(w, h, 0);
  const above = emptyLayer(w, h, 0);
  const collision = emptyLayer(w, h, 0);

  // Kingdom-specific organic ground variation, kept off the roads below.
  for (let i = 0; i < spec.dirtPatches; i++) {
    const cx = 4 + Math.floor(rng() * (w - 8));
    const cy = 4 + Math.floor(rng() * (h - 8));
    paintDisc(w, h, ground, cx, cy, 2 + Math.floor(rng() * 3), TILE_DIRT);
  }
  for (let i = 0; i < spec.stonePatches; i++) {
    const cx = 4 + Math.floor(rng() * (w - 8));
    const cy = 4 + Math.floor(rng() * (h - 8));
    paintDisc(w, h, ground, cx, cy, 1 + Math.floor(rng() * 2), TILE_STONE);
  }

  // Plaza and the main roads.
  paintRect(w, h, ground, spec.plaza.x, spec.plaza.y, spec.plaza.w, spec.plaza.h, TILE_DIRT);
  for (const road of spec.roads) {
    paintRect(w, h, ground, road.x, road.y, road.w, road.h, TILE_DIRT);
  }

  // River segments with a bridge on the crossing road (and an optional pond).
  for (const water of spec.water) {
    paintRect(w, h, ground, water.x, water.y, water.w, water.h, TILE_WATER);
    paintRect(w, h, collision, water.x, water.y, water.w, water.h, 1);
  }
  if (spec.bridge) {
    paintRect(w, h, ground, spec.bridge.x, spec.bridge.y, spec.bridge.w, spec.bridge.h, TILE_DIRT);
    paintRect(w, h, collision, spec.bridge.x, spec.bridge.y, spec.bridge.w, spec.bridge.h, 0);
  }
  if (spec.pond) {
    paintDisc(w, h, ground, spec.pond.x, spec.pond.y, spec.pond.r, TILE_WATER);
    paintDisc(w, h, collision, spec.pond.x, spec.pond.y, spec.pond.r, 1);
  }

  // Houses.
  for (const house of spec.houses) {
    paintRect(w, h, ground, house.x, house.y, house.w, house.h, TILE_WALL);
    paintRect(w, h, collision, house.x, house.y, house.w, house.h, 1);
  }

  // Solid tree border (two tiles thick), with decor so it reads as trees.
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      if (tx < 2 || ty < 2 || tx >= w - 2 || ty >= h - 2) {
        collision[index(w, tx, ty)] = 1;
        decor[index(w, tx, ty)] = TILE_WALL;
      }
    }
  }

  // Interior tree groves (seeded jitter decides whether each tile sprouts).
  for (const grove of spec.groves) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = grove.x + dx;
        const ty = grove.y + dy;
        if (tx < 2 || ty < 2 || tx >= w - 2 || ty >= h - 2) {
          continue;
        }
        if (ground[index(w, tx, ty)] !== TILE_GRASS) {
          continue;
        }
        if (rng() < 0.75) {
          collision[index(w, tx, ty)] = 1;
          decor[index(w, tx, ty)] = TILE_WALL;
        }
      }
    }
  }

  // Fences.
  for (const fence of spec.fences) {
    paintRect(w, h, collision, fence.x, fence.y, fence.w, fence.h, 1);
    paintRect(w, h, decor, fence.x, fence.y, fence.w, fence.h, TILE_WALL);
  }

  // Clear dirt approach to the warp tile, then the warp itself.
  paintRect(w, h, ground, spec.exit.x, spec.exit.y, spec.exit.w, spec.exit.h, TILE_DIRT);
  paintRect(w, h, collision, spec.exit.x, spec.exit.y, spec.exit.w, spec.exit.h, 0);

  const objects: TiledObject[] = [
    {
      id: 1,
      name: "spawn_player",
      x: spec.spawn.x,
      y: spec.spawn.y,
      width: 0,
      height: 0,
      point: true,
      rotation: 0,
      type: "",
      visible: true,
    },
    {
      id: 2,
      name: "warp",
      x: spec.warp.x,
      y: spec.warp.y,
      width: spec.warp.w,
      height: spec.warp.h,
      rotation: 0,
      type: "",
      visible: true,
      properties: [
        { name: "targetMap", type: "string", value: spec.targetMap satisfies MapId },
        { name: "targetX", type: "int", value: spec.targetSpawn.x },
        { name: "targetY", type: "int", value: spec.targetSpawn.y },
      ],
    },
    ...VILLAGE_NPCS.map((npc, i) => ({
      id: 3 + i,
      name: "npc" as const,
      x: spec.spawn.x + npc.dx,
      y: spec.spawn.y + npc.dy,
      width: 0,
      height: 0,
      point: true,
      rotation: 0,
      type: "",
      visible: true,
      properties: [{ name: "npcId", type: "string", value: npc.id }],
    })),
  ];

  return baseMap(w, h, "village", [
    tileLayer(1, "ground", w, h, ground),
    tileLayer(2, "decor", w, h, decor),
    tileLayer(3, "above", w, h, above),
    tileLayer(4, "collision", w, h, collision, false),
    objectLayer(5, objects),
  ]);
}

/** Ember's spawn is the original village plaza; kept for saved characters. */
const EMBER_VILLAGE_SPEC: VillageSpec = {
  mapId: ROOM_NAME_VILLAGE,
  spawn: VILLAGE_SPAWN,
  plaza: { x: 34, y: 34, w: 12, h: 12 },
  roads: [
    { x: 10, y: 39, w: 65, h: 3 },
    { x: 39, y: 10, w: 3, h: 65 },
  ],
  water: [
    { x: 23, y: 6, w: 3, h: 33 },
    { x: 23, y: 42, w: 3, h: 33 },
  ],
  bridge: { x: 23, y: 39, w: 3, h: 3 },
  pond: null,
  houses: VILLAGE_HOUSES,
  groves: VILLAGE_GROVES,
  fences: VILLAGE_FENCES,
  dirtPatches: 0,
  stonePatches: 0,
  exit: { x: 72, y: 38, w: 5, h: 5 },
  warp: { x: 74 * TILE_SIZE, y: 38 * TILE_SIZE, w: TILE_SIZE * 2, h: TILE_SIZE * 5 },
  targetMap: ROOM_NAME_FIELDS,
  targetSpawn: FIELDS_SPAWN,
};

/** Open, wind-swept plains town with a northern gate and a horizontal river. */
const GALE_VILLAGE_SPEC: VillageSpec = {
  mapId: ROOM_NAME_GALE_VILLAGE,
  spawn: GALE_VILLAGE_SPAWN,
  plaza: { x: 34, y: 34, w: 12, h: 12 },
  roads: [
    { x: 10, y: 39, w: 65, h: 3 },
    { x: 39, y: 10, w: 3, h: 65 },
  ],
  water: [
    { x: 6, y: 22, w: 33, h: 3 },
    { x: 42, y: 22, w: 33, h: 3 },
  ],
  bridge: { x: 39, y: 22, w: 3, h: 3 },
  pond: null,
  houses: [
    { x: 12, y: 10, w: 9, h: 5 },
    { x: 12, y: 54, w: 8, h: 6 },
    { x: 56, y: 10, w: 8, h: 6 },
    { x: 58, y: 56, w: 7, h: 5 },
  ],
  groves: [
    { x: 16, y: 28 },
    { x: 64, y: 32 },
    { x: 18, y: 48 },
    { x: 62, y: 48 },
    { x: 28, y: 68 },
    { x: 52, y: 66 },
    { x: 8, y: 34 },
    { x: 70, y: 34 },
  ],
  fences: [
    { x: 46, y: 18, w: 8, h: 1 },
    { x: 54, y: 18, w: 1, h: 5 },
    { x: 26, y: 58, w: 6, h: 1 },
  ],
  dirtPatches: 3,
  stonePatches: 1,
  exit: { x: 38, y: 4, w: 5, h: 6 },
  warp: { x: 38 * TILE_SIZE, y: 4 * TILE_SIZE, w: TILE_SIZE * 5, h: TILE_SIZE * 2 },
  targetMap: ROOM_NAME_GALE_HIGHLANDS,
  targetSpawn: GALE_HIGHLANDS_SPAWN,
};

/** Coastal shrine town with an eastern river, a pond and a western gate. */
const TIDE_VILLAGE_SPEC: VillageSpec = {
  mapId: ROOM_NAME_TIDE_VILLAGE,
  spawn: TIDE_VILLAGE_SPAWN,
  plaza: { x: 34, y: 34, w: 12, h: 12 },
  roads: [
    { x: 10, y: 39, w: 65, h: 3 },
    { x: 39, y: 10, w: 3, h: 65 },
  ],
  water: [
    { x: 64, y: 6, w: 3, h: 33 },
    { x: 64, y: 42, w: 3, h: 31 },
  ],
  bridge: { x: 64, y: 39, w: 3, h: 3 },
  pond: { x: 24, y: 60, r: 7 },
  houses: [
    { x: 10, y: 8, w: 8, h: 6 },
    { x: 10, y: 52, w: 6, h: 5 },
    { x: 52, y: 8, w: 9, h: 5 },
    { x: 54, y: 54, w: 8, h: 6 },
  ],
  groves: [
    { x: 18, y: 20 },
    { x: 20, y: 34 },
    { x: 46, y: 20 },
    { x: 48, y: 68 },
    { x: 30, y: 20 },
    { x: 30, y: 60 },
    { x: 68, y: 20 },
    { x: 72, y: 50 },
  ],
  fences: [
    { x: 46, y: 26, w: 8, h: 1 },
    { x: 54, y: 26, w: 1, h: 5 },
    { x: 28, y: 52, w: 6, h: 1 },
  ],
  dirtPatches: 4,
  stonePatches: 2,
  exit: { x: 4, y: 38, w: 6, h: 5 },
  warp: { x: 4 * TILE_SIZE, y: 38 * TILE_SIZE, w: TILE_SIZE * 2, h: TILE_SIZE * 5 },
  targetMap: ROOM_NAME_TIDE_HIGHLANDS,
  targetSpawn: TIDE_HIGHLANDS_SPAWN,
};

export function generateVillageMap(): TiledMapFile {
  return buildVillage(EMBER_VILLAGE_SPEC);
}

export function generateGaleVillageMap(): TiledMapFile {
  return buildVillage(GALE_VILLAGE_SPEC);
}

export function generateTideVillageMap(): TiledMapFile {
  return buildVillage(TIDE_VILLAGE_SPEC);
}

/** Axis-aligned rect used for highlands corridors and warp approaches. */
export interface HighlandsRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A warp out of an outdoor map. */
export interface HighlandsWarp extends HighlandsRect {
  targetMap: MapId;
  targetSpawn: { x: number; y: number };
}

/** Declarative description of an outdoor map (GAME_DESIGN.md §3.1). */
export interface HighlandsSpec {
  mapId: MapId;
  width: number;
  height: number;
  /** Default arrival point (used for fresh characters with no saved position). */
  spawn: { x: number; y: number };
  clearings: Array<{ x: number; y: number; r: number }>;
  /** Rects kept free of trees and rocks (arrival corridors and warp approaches). */
  corridors: HighlandsRect[];
  dirtPatches: number;
  stonePatches: number;
  treeClusters: number;
  rocks: number;
  treeChance: number;
  mobZones: Array<{ groupId: string; x: number; y: number; w: number; h: number }>;
  stoneZones: Array<{ zoneId: string; x: number; y: number; w: number; h: number }>;
  warps: HighlandsWarp[];
}

/** Ember's original fields layout: the western entrance corridor. */
const FIELDS_CORRIDOR: HighlandsRect = { x: 2, y: 77, w: 12, h: 7 };
/** Eastern approach shared by every highlands map. */
const VALLEY_APPROACH: HighlandsRect = { x: 146, y: 77, w: 11, h: 6 };

function insideClearing(
  clearings: HighlandsSpec["clearings"],
  tx: number,
  ty: number,
  padding = 0,
): boolean {
  return clearings.some((clearing) => {
    const dx = tx - clearing.x;
    const dy = ty - clearing.y;
    const r = clearing.r + padding;
    return dx * dx + dy * dy <= r * r;
  });
}

function insideRect(rect: HighlandsRect, tx: number, ty: number): boolean {
  return tx >= rect.x && ty >= rect.y && tx < rect.x + rect.w && ty < rect.y + rect.h;
}

function buildHighlands(spec: HighlandsSpec): TiledMapFile {
  const w = spec.width;
  const h = spec.height;
  const rng = mulberry32(seedFromString(spec.mapId));

  const ground = emptyLayer(w, h, TILE_GRASS);
  const decor = emptyLayer(w, h, 0);
  const above = emptyLayer(w, h, 0);
  const collision = emptyLayer(w, h, 0);

  // Organic dirt and stone patches.
  for (let i = 0; i < spec.dirtPatches; i++) {
    const cx = 4 + Math.floor(rng() * (w - 8));
    const cy = 4 + Math.floor(rng() * (h - 8));
    paintDisc(w, h, ground, cx, cy, 2 + Math.floor(rng() * 4), TILE_DIRT);
  }
  for (let i = 0; i < spec.stonePatches; i++) {
    const cx = 4 + Math.floor(rng() * (w - 8));
    const cy = 4 + Math.floor(rng() * (h - 8));
    paintDisc(w, h, ground, cx, cy, 1 + Math.floor(rng() * 2), TILE_STONE);
  }

  // Arrival and warp-approach roads stay clear of collision.
  for (const corridor of spec.corridors) {
    paintRect(w, h, ground, corridor.x, corridor.y, corridor.w, corridor.h, TILE_DIRT);
    paintRect(w, h, collision, corridor.x, corridor.y, corridor.w, corridor.h, 0);
  }

  // Solid tree border, two tiles thick.
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      if (tx < 2 || ty < 2 || tx >= w - 2 || ty >= h - 2) {
        collision[index(w, tx, ty)] = 1;
        decor[index(w, tx, ty)] = TILE_WALL;
      }
    }
  }

  const blocked = (tx: number, ty: number): boolean =>
    insideClearing(spec.clearings, tx, ty) || spec.corridors.some((c) => insideRect(c, tx, ty));

  // Seeded tree clusters, kept out of clearings and the travel corridors.
  for (let i = 0; i < spec.treeClusters; i++) {
    const cx = 5 + Math.floor(rng() * (w - 10));
    const cy = 5 + Math.floor(rng() * (h - 10));
    if (blocked(cx, cy)) {
      continue;
    }
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx < 2 || ty < 2 || tx >= w - 2 || ty >= h - 2) {
          continue;
        }
        if (blocked(tx, ty)) {
          continue;
        }
        if (rng() < spec.treeChance) {
          collision[index(w, tx, ty)] = 1;
          decor[index(w, tx, ty)] = TILE_WALL;
        }
      }
    }
  }

  // Scattered rocks.
  for (let i = 0; i < spec.rocks; i++) {
    const tx = 4 + Math.floor(rng() * (w - 8));
    const ty = 4 + Math.floor(rng() * (h - 8));
    if (blocked(tx, ty)) {
      continue;
    }
    collision[index(w, tx, ty)] = 1;
    decor[index(w, tx, ty)] = TILE_WALL;
  }

  let nextId = 3;
  const objects: TiledObject[] = [
    {
      id: 1,
      name: "spawn_player",
      x: spec.spawn.x,
      y: spec.spawn.y,
      width: 0,
      height: 0,
      point: true,
      rotation: 0,
      type: "",
      visible: true,
    },
    ...spec.warps.map((warp) => ({
      id: nextId++,
      name: "warp" as const,
      x: warp.x,
      y: warp.y,
      width: warp.w,
      height: warp.h,
      rotation: 0,
      type: "",
      visible: true,
      properties: [
        { name: "targetMap", type: "string", value: warp.targetMap satisfies MapId },
        { name: "targetX", type: "int", value: warp.targetSpawn.x },
        { name: "targetY", type: "int", value: warp.targetSpawn.y },
      ],
    })),
    ...spec.mobZones.map((zone) => ({
      id: nextId++,
      name: "mob_zone" as const,
      x: zone.x * TILE_SIZE,
      y: zone.y * TILE_SIZE,
      width: zone.w * TILE_SIZE,
      height: zone.h * TILE_SIZE,
      rotation: 0,
      type: "",
      visible: true,
      properties: [{ name: "spawnGroupId", type: "string", value: zone.groupId }],
    })),
    ...spec.stoneZones.map((zone) => ({
      id: nextId++,
      name: "stone_zone" as const,
      x: zone.x * TILE_SIZE,
      y: zone.y * TILE_SIZE,
      width: zone.w * TILE_SIZE,
      height: zone.h * TILE_SIZE,
      rotation: 0,
      type: "",
      visible: true,
      properties: [{ name: "zoneId", type: "string", value: zone.zoneId }],
    })),
  ];

  return baseMap(w, h, "fields", [
    tileLayer(1, "ground", w, h, ground),
    tileLayer(2, "decor", w, h, decor),
    tileLayer(3, "above", w, h, above),
    tileLayer(4, "collision", w, h, collision, false),
    objectLayer(5, objects),
  ]);
}

/** Ember Highlands (the Phase-1 "fields") keeps its original layout and zones. */
const EMBER_HIGHLANDS_SPEC: HighlandsSpec = {
  mapId: ROOM_NAME_FIELDS,
  width: FIELDS_WIDTH,
  height: FIELDS_HEIGHT,
  spawn: FIELDS_SPAWN,
  clearings: [
    { x: 5, y: 80, r: 11 },
    { x: 42, y: 42, r: 12 },
    { x: 80, y: 80, r: 18 },
    { x: 122, y: 112, r: 14 },
    { x: 138, y: 129, r: 10 },
  ],
  corridors: [FIELDS_CORRIDOR, VALLEY_APPROACH],
  dirtPatches: 20,
  stonePatches: 8,
  treeClusters: 28,
  rocks: 16,
  treeChance: 0.45,
  mobZones: [
    { groupId: "field_wolves", x: 36, y: 34, w: 14, h: 14 },
    { groupId: "field_boars", x: 70, y: 70, w: 16, h: 14 },
    { groupId: "field_bandits", x: 112, y: 104, w: 16, h: 12 },
    { groupId: "field_boss", x: 130, y: 124, w: 12, h: 10 },
  ],
  stoneZones: [{ zoneId: "fields_stones", x: 92, y: 116, w: 14, h: 10 }],
  warps: [
    {
      x: 2 * TILE_SIZE,
      y: 78 * TILE_SIZE,
      w: TILE_SIZE,
      h: TILE_SIZE * 5,
      targetMap: ROOM_NAME_VILLAGE,
      targetSpawn: VILLAGE_SPAWN,
    },
    {
      x: 154 * TILE_SIZE,
      y: 78 * TILE_SIZE,
      w: TILE_SIZE * 3,
      h: TILE_SIZE * 4,
      targetMap: ROOM_NAME_VALLEY,
      targetSpawn: VALLEY_EMBER_SPAWN,
    },
  ],
};

/** Windy plains with open grinding fields and a bandit camp. */
const GALE_HIGHLANDS_SPEC: HighlandsSpec = {
  mapId: ROOM_NAME_GALE_HIGHLANDS,
  width: FIELDS_WIDTH,
  height: FIELDS_HEIGHT,
  spawn: GALE_HIGHLANDS_SPAWN,
  clearings: [
    { x: 5, y: 80, r: 11 },
    { x: 36, y: 36, r: 13 },
    { x: 70, y: 78, r: 14 },
    { x: 116, y: 112, r: 13 },
    { x: 139, y: 131, r: 9 },
  ],
  corridors: [FIELDS_CORRIDOR, VALLEY_APPROACH],
  dirtPatches: 24,
  stonePatches: 4,
  treeClusters: 22,
  rocks: 12,
  treeChance: 0.4,
  mobZones: [
    { groupId: "gale_highlands_wolves", x: 30, y: 30, w: 14, h: 14 },
    { groupId: "gale_highlands_boars", x: 66, y: 74, w: 16, h: 14 },
    { groupId: "gale_highlands_bandits", x: 110, y: 108, w: 16, h: 12 },
    { groupId: "gale_highlands_boss", x: 134, y: 128, w: 12, h: 10 },
  ],
  stoneZones: [{ zoneId: "gale_highlands_stones", x: 94, y: 120, w: 12, h: 10 }],
  warps: [
    {
      x: 2 * TILE_SIZE,
      y: 78 * TILE_SIZE,
      w: TILE_SIZE,
      h: TILE_SIZE * 5,
      targetMap: ROOM_NAME_GALE_VILLAGE,
      targetSpawn: GALE_VILLAGE_SPAWN,
    },
    {
      x: 154 * TILE_SIZE,
      y: 78 * TILE_SIZE,
      w: TILE_SIZE * 3,
      h: TILE_SIZE * 4,
      targetMap: ROOM_NAME_VALLEY,
      targetSpawn: VALLEY_GALE_SPAWN,
    },
  ],
};

/** Rocky coastal slopes with tide pools replaced by stone patches. */
const TIDE_HIGHLANDS_SPEC: HighlandsSpec = {
  mapId: ROOM_NAME_TIDE_HIGHLANDS,
  width: FIELDS_WIDTH,
  height: FIELDS_HEIGHT,
  spawn: TIDE_HIGHLANDS_SPAWN,
  clearings: [
    { x: 5, y: 80, r: 11 },
    { x: 48, y: 38, r: 13 },
    { x: 82, y: 70, r: 14 },
    { x: 120, y: 104, r: 13 },
    { x: 140, y: 128, r: 9 },
  ],
  corridors: [FIELDS_CORRIDOR, VALLEY_APPROACH],
  dirtPatches: 14,
  stonePatches: 10,
  treeClusters: 26,
  rocks: 20,
  treeChance: 0.45,
  mobZones: [
    { groupId: "tide_highlands_wolves", x: 42, y: 34, w: 14, h: 14 },
    { groupId: "tide_highlands_boars", x: 78, y: 68, w: 16, h: 14 },
    { groupId: "tide_highlands_bandits", x: 116, y: 100, w: 16, h: 12 },
    { groupId: "tide_highlands_boss", x: 136, y: 124, w: 12, h: 10 },
  ],
  stoneZones: [{ zoneId: "tide_highlands_stones", x: 94, y: 120, w: 12, h: 10 }],
  warps: [
    {
      x: 2 * TILE_SIZE,
      y: 78 * TILE_SIZE,
      w: TILE_SIZE,
      h: TILE_SIZE * 5,
      targetMap: ROOM_NAME_TIDE_VILLAGE,
      targetSpawn: TIDE_VILLAGE_SPAWN,
    },
    {
      x: 154 * TILE_SIZE,
      y: 78 * TILE_SIZE,
      w: TILE_SIZE * 3,
      h: TILE_SIZE * 4,
      targetMap: ROOM_NAME_VALLEY,
      targetSpawn: VALLEY_TIDE_SPAWN,
    },
  ],
};

/** Neutral 25–45 crossroads: three kingdom entrances, two stone fields, five packs. */
const VALLEY_SPEC: HighlandsSpec = {
  mapId: ROOM_NAME_VALLEY,
  width: 180,
  height: 180,
  spawn: { x: 90 * TILE_SIZE + 16, y: 90 * TILE_SIZE + 16 },
  clearings: [
    { x: 90, y: 90, r: 10 },
    { x: 8, y: 40, r: 9 },
    { x: 8, y: 100, r: 9 },
    { x: 8, y: 140, r: 9 },
    { x: 30, y: 30, r: 11 },
    { x: 64, y: 62, r: 12 },
    { x: 104, y: 44, r: 11 },
    { x: 124, y: 122, r: 12 },
    { x: 152, y: 150, r: 10 },
    { x: 170, y: 92, r: 8 },
  ],
  corridors: [
    { x: 2, y: 38, w: 10, h: 5 },
    { x: 2, y: 98, w: 10, h: 5 },
    { x: 2, y: 138, w: 10, h: 5 },
    { x: 168, y: 88, w: 10, h: 7 },
  ],
  dirtPatches: 26,
  stonePatches: 10,
  treeClusters: 34,
  rocks: 22,
  treeChance: 0.42,
  mobZones: [
    { groupId: "valley_wolves", x: 25, y: 25, w: 16, h: 14 },
    { groupId: "valley_spirits", x: 58, y: 56, w: 16, h: 14 },
    { groupId: "valley_bandits", x: 98, y: 38, w: 16, h: 14 },
    { groupId: "valley_dead", x: 118, y: 116, w: 16, h: 14 },
    { groupId: "valley_boss", x: 148, y: 146, w: 14, h: 12 },
  ],
  stoneZones: [
    { zoneId: "valley_stones_west", x: 38, y: 108, w: 12, h: 10 },
    { zoneId: "valley_stones_east", x: 132, y: 80, w: 12, h: 10 },
  ],
  warps: [
    {
      x: 2 * TILE_SIZE,
      y: 38 * TILE_SIZE,
      w: TILE_SIZE,
      h: TILE_SIZE * 5,
      targetMap: ROOM_NAME_FIELDS,
      targetSpawn: FIELDS_SPAWN,
    },
    {
      x: 2 * TILE_SIZE,
      y: 98 * TILE_SIZE,
      w: TILE_SIZE,
      h: TILE_SIZE * 5,
      targetMap: ROOM_NAME_GALE_HIGHLANDS,
      targetSpawn: GALE_HIGHLANDS_SPAWN,
    },
    {
      x: 2 * TILE_SIZE,
      y: 138 * TILE_SIZE,
      w: TILE_SIZE,
      h: TILE_SIZE * 5,
      targetMap: ROOM_NAME_TIDE_HIGHLANDS,
      targetSpawn: TIDE_HIGHLANDS_SPAWN,
    },
    {
      x: 176 * TILE_SIZE,
      y: 89 * TILE_SIZE,
      w: TILE_SIZE * 2,
      h: TILE_SIZE * 5,
      targetMap: ROOM_NAME_FOREST,
      targetSpawn: FOREST_SPAWN,
    },
  ],
};

/** Neutral 40–60 corrupted woodland between the valley and the spider cave. */
const FOREST_SPEC: HighlandsSpec = {
  mapId: ROOM_NAME_FOREST,
  width: 180,
  height: 180,
  spawn: FOREST_SPAWN,
  clearings: [
    { x: 8, y: 90, r: 9 },
    { x: 40, y: 40, r: 11 },
    { x: 90, y: 60, r: 10 },
    { x: 60, y: 120, r: 12 },
    { x: 120, y: 100, r: 12 },
    { x: 150, y: 40, r: 9 },
    { x: 150, y: 150, r: 10 },
    { x: 172, y: 92, r: 8 },
  ],
  corridors: [
    { x: 2, y: 88, w: 12, h: 7 },
    { x: 166, y: 88, w: 12, h: 7 },
  ],
  dirtPatches: 10,
  stonePatches: 12,
  treeClusters: 44,
  rocks: 24,
  treeChance: 0.55,
  mobZones: [
    { groupId: "forest_wolves", x: 34, y: 34, w: 16, h: 14 },
    { groupId: "forest_spirits", x: 84, y: 54, w: 16, h: 14 },
    { groupId: "forest_bandits", x: 54, y: 114, w: 16, h: 14 },
    { groupId: "forest_elites", x: 114, y: 94, w: 16, h: 14 },
    { groupId: "forest_boss", x: 144, y: 144, w: 14, h: 12 },
  ],
  stoneZones: [
    { zoneId: "forest_stones_west", x: 60, y: 72, w: 12, h: 10 },
    { zoneId: "forest_stones_east", x: 140, y: 112, w: 12, h: 10 },
  ],
  warps: [
    {
      x: 2 * TILE_SIZE,
      y: 89 * TILE_SIZE,
      w: TILE_SIZE,
      h: TILE_SIZE * 5,
      targetMap: ROOM_NAME_VALLEY,
      targetSpawn: { x: 172 * TILE_SIZE + 16, y: 91 * TILE_SIZE + 16 },
    },
    {
      x: 176 * TILE_SIZE,
      y: 89 * TILE_SIZE,
      w: TILE_SIZE * 2,
      h: TILE_SIZE * 5,
      targetMap: ROOM_NAME_SPIDER_CAVE,
      targetSpawn: SPIDER_CAVE_SPAWN,
    },
  ],
};

export function generateFieldsMap(): TiledMapFile {
  return buildHighlands(EMBER_HIGHLANDS_SPEC);
}

export function generateGaleHighlandsMap(): TiledMapFile {
  return buildHighlands(GALE_HIGHLANDS_SPEC);
}

export function generateTideHighlandsMap(): TiledMapFile {
  return buildHighlands(TIDE_HIGHLANDS_SPEC);
}

export function generateValleyMap(): TiledMapFile {
  return buildHighlands(VALLEY_SPEC);
}

export function generateForestMap(): TiledMapFile {
  return buildHighlands(FOREST_SPEC);
}

export interface MapFileDefinition {
  fileName: string;
  build: () => TiledMapFile;
}

/** Every generated map file, in stable write order. */
export const MAP_FILES: readonly MapFileDefinition[] = [
  { fileName: "map_ember_village.json", build: generateVillageMap },
  { fileName: "map_ember_fields.json", build: generateFieldsMap },
  { fileName: "map_gale_village.json", build: generateGaleVillageMap },
  { fileName: "map_tide_village.json", build: generateTideVillageMap },
  { fileName: "map_gale_highlands.json", build: generateGaleHighlandsMap },
  { fileName: "map_tide_highlands.json", build: generateTideHighlandsMap },
  { fileName: "map_valley_of_echoes.json", build: generateValleyMap },
  { fileName: "map_corrupted_forest.json", build: generateForestMap },
];

/** Write the generated map files. Run via `pnpm generate:maps`. */
export function writeMapFiles(dir?: string): void {
  const mapsDir = dir ?? fileURLToPath(new URL("../maps/", import.meta.url));
  mkdirSync(mapsDir, { recursive: true });
  for (const map of MAP_FILES) {
    const target = join(mapsDir, map.fileName);
    writeFileSync(target, `${JSON.stringify(map.build(), null, 2)}\n`);
    console.info(`Wrote ${target}`);
  }
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  writeMapFiles();
}

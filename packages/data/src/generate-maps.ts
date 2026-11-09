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
  ROOM_NAME_GALE_HIGHLANDS,
  ROOM_NAME_GALE_VILLAGE,
  ROOM_NAME_TIDE_HIGHLANDS,
  ROOM_NAME_TIDE_VILLAGE,
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

/** Clearings where the fields generator keeps trees and rocks out. */
const FIELDS_CLEARINGS = [
  { x: 5, y: 80, r: 11 },
  { x: 42, y: 42, r: 12 },
  { x: 80, y: 80, r: 18 },
  { x: 122, y: 112, r: 14 },
  { x: 138, y: 129, r: 10 },
];

function insideClearing(tx: number, ty: number, padding = 0): boolean {
  return FIELDS_CLEARINGS.some((clearing) => {
    const dx = tx - clearing.x;
    const dy = ty - clearing.y;
    const r = clearing.r + padding;
    return dx * dx + dy * dy <= r * r;
  });
}

export function generateFieldsMap(): TiledMapFile {
  const w = FIELDS_WIDTH;
  const h = FIELDS_HEIGHT;
  const rng = mulberry32(seedFromString(ROOM_NAME_FIELDS));

  const ground = emptyLayer(w, h, TILE_GRASS);
  const decor = emptyLayer(w, h, 0);
  const above = emptyLayer(w, h, 0);
  const collision = emptyLayer(w, h, 0);

  // Organic dirt and stone patches.
  for (let i = 0; i < 20; i++) {
    const cx = 4 + Math.floor(rng() * (w - 8));
    const cy = 4 + Math.floor(rng() * (h - 8));
    paintDisc(w, h, ground, cx, cy, 2 + Math.floor(rng() * 4), TILE_DIRT);
  }
  for (let i = 0; i < 8; i++) {
    const cx = 4 + Math.floor(rng() * (w - 8));
    const cy = 4 + Math.floor(rng() * (h - 8));
    paintDisc(w, h, ground, cx, cy, 1 + Math.floor(rng() * 2), TILE_STONE);
  }

  // West entrance: clear road, arrival point and the warp back to the village.
  paintRect(w, h, ground, 2, 77, 12, 7, TILE_DIRT);
  paintRect(w, h, collision, 2, 77, 12, 7, 0);

  // Solid tree border, two tiles thick.
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      if (tx < 2 || ty < 2 || tx >= w - 2 || ty >= h - 2) {
        collision[index(w, tx, ty)] = 1;
        decor[index(w, tx, ty)] = TILE_WALL;
      }
    }
  }

  // Seeded tree clusters, kept out of clearings and the western corridor.
  for (let i = 0; i < 28; i++) {
    const cx = 5 + Math.floor(rng() * (w - 10));
    const cy = 5 + Math.floor(rng() * (h - 10));
    if (insideClearing(cx, cy, 1) || (cx < 13 && cy >= 74 && cy <= 87)) {
      continue;
    }
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx < 2 || ty < 2 || tx >= w - 2 || ty >= h - 2) {
          continue;
        }
        if (insideClearing(tx, ty) || (tx < 13 && ty >= 74 && ty <= 87)) {
          continue;
        }
        if (rng() < 0.45) {
          collision[index(w, tx, ty)] = 1;
          decor[index(w, tx, ty)] = TILE_WALL;
        }
      }
    }
  }

  // Scattered rocks.
  for (let i = 0; i < 16; i++) {
    const tx = 4 + Math.floor(rng() * (w - 8));
    const ty = 4 + Math.floor(rng() * (h - 8));
    if (insideClearing(tx, ty) || (tx < 13 && ty >= 74 && ty <= 87)) {
      continue;
    }
    collision[index(w, tx, ty)] = 1;
    decor[index(w, tx, ty)] = TILE_WALL;
  }

  const objects: TiledObject[] = [
    {
      id: 1,
      name: "spawn_player",
      x: FIELDS_SPAWN.x,
      y: FIELDS_SPAWN.y,
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
      x: 2 * TILE_SIZE,
      y: 78 * TILE_SIZE,
      width: TILE_SIZE,
      height: TILE_SIZE * 5,
      rotation: 0,
      type: "",
      visible: true,
      properties: [
        { name: "targetMap", type: "string", value: ROOM_NAME_VILLAGE satisfies MapId },
        { name: "targetX", type: "int", value: VILLAGE_SPAWN.x },
        { name: "targetY", type: "int", value: VILLAGE_SPAWN.y },
      ],
    },
    {
      id: 3,
      name: "mob_zone",
      x: 36 * TILE_SIZE,
      y: 34 * TILE_SIZE,
      width: 14 * TILE_SIZE,
      height: 14 * TILE_SIZE,
      rotation: 0,
      type: "",
      visible: true,
      properties: [{ name: "spawnGroupId", type: "string", value: "field_wolves" }],
    },
    {
      id: 4,
      name: "mob_zone",
      x: 70 * TILE_SIZE,
      y: 70 * TILE_SIZE,
      width: 16 * TILE_SIZE,
      height: 14 * TILE_SIZE,
      rotation: 0,
      type: "",
      visible: true,
      properties: [{ name: "spawnGroupId", type: "string", value: "field_boars" }],
    },
    {
      id: 5,
      name: "mob_zone",
      x: 112 * TILE_SIZE,
      y: 104 * TILE_SIZE,
      width: 16 * TILE_SIZE,
      height: 12 * TILE_SIZE,
      rotation: 0,
      type: "",
      visible: true,
      properties: [{ name: "spawnGroupId", type: "string", value: "field_bandits" }],
    },
    {
      id: 6,
      name: "stone_zone",
      x: 92 * TILE_SIZE,
      y: 116 * TILE_SIZE,
      width: 14 * TILE_SIZE,
      height: 10 * TILE_SIZE,
      rotation: 0,
      type: "",
      visible: true,
      properties: [{ name: "zoneId", type: "string", value: "fields_stones" }],
    },
    {
      id: 7,
      name: "mob_zone",
      x: 130 * TILE_SIZE,
      y: 124 * TILE_SIZE,
      width: 12 * TILE_SIZE,
      height: 10 * TILE_SIZE,
      rotation: 0,
      type: "",
      visible: true,
      properties: [{ name: "spawnGroupId", type: "string", value: "field_boss" }],
    },
  ];

  return baseMap(w, h, "fields", [
    tileLayer(1, "ground", w, h, ground),
    tileLayer(2, "decor", w, h, decor),
    tileLayer(3, "above", w, h, above),
    tileLayer(4, "collision", w, h, collision, false),
    objectLayer(5, objects),
  ]);
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

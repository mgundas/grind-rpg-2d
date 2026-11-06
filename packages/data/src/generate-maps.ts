/**
 * Deterministic map generation for Jade Throne (GAME_DESIGN.md §3.2).
 *
 * Maps are valid Tiled JSON committed under `maps/`; regenerate with
 * `pnpm generate:maps`. The seeded RNG from `@jadethrone/shared` makes every
 * run byte-identical.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  ROOM_NAME_FIELDS,
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

/** Houses of the village: solid footprints painted with wall tiles. */
const VILLAGE_HOUSES = [
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
const VILLAGE_FENCES = [
  { x: 46, y: 22, w: 8, h: 1 },
  { x: 54, y: 22, w: 1, h: 5 },
  { x: 26, y: 56, w: 8, h: 1 },
];

export function generateVillageMap(): TiledMapFile {
  const w = VILLAGE_WIDTH;
  const h = VILLAGE_HEIGHT;
  const rng = mulberry32(seedFromString(ROOM_NAME_VILLAGE));

  const ground = emptyLayer(w, h, TILE_GRASS);
  const decor = emptyLayer(w, h, 0);
  const above = emptyLayer(w, h, 0);
  const collision = emptyLayer(w, h, 0);

  // Plaza and the two main roads.
  paintRect(w, h, ground, 34, 34, 12, 12, TILE_DIRT);
  paintRect(w, h, ground, 10, 39, 65, 3, TILE_DIRT);
  paintRect(w, h, ground, 39, 10, 3, 65, TILE_DIRT);

  // River with a three-tile bridge on the east-west road.
  paintRect(w, h, ground, 23, 6, 3, 69, TILE_WATER);
  paintRect(w, h, ground, 23, 39, 3, 3, TILE_DIRT);
  paintRect(w, h, collision, 23, 6, 3, 33, 1);
  paintRect(w, h, collision, 23, 42, 3, 33, 1);

  // Houses.
  for (const house of VILLAGE_HOUSES) {
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
  for (const grove of VILLAGE_GROVES) {
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
  for (const fence of VILLAGE_FENCES) {
    paintRect(w, h, collision, fence.x, fence.y, fence.w, fence.h, 1);
    paintRect(w, h, decor, fence.x, fence.y, fence.w, fence.h, TILE_WALL);
  }

  // East exit: a clear dirt approach to the warp tile, then the warp itself.
  paintRect(w, h, ground, 72, 38, 5, 5, TILE_DIRT);
  paintRect(w, h, collision, 72, 38, 5, 5, 0);
  const warpX = 74 * TILE_SIZE;
  const warpY = 38 * TILE_SIZE;

  const objects: TiledObject[] = [
    {
      id: 1,
      name: "spawn_player",
      x: VILLAGE_SPAWN.x,
      y: VILLAGE_SPAWN.y,
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
      x: warpX,
      y: warpY,
      width: TILE_SIZE * 2,
      height: TILE_SIZE * 5,
      rotation: 0,
      type: "",
      visible: true,
      properties: [
        { name: "targetMap", type: "string", value: ROOM_NAME_FIELDS satisfies MapId },
        { name: "targetX", type: "int", value: FIELDS_SPAWN.x },
        { name: "targetY", type: "int", value: FIELDS_SPAWN.y },
      ],
    },
    {
      id: 3,
      name: "npc",
      x: 36 * TILE_SIZE + 16,
      y: 40 * TILE_SIZE + 12,
      width: 0,
      height: 0,
      point: true,
      rotation: 0,
      type: "",
      visible: true,
      properties: [{ name: "npcId", type: "string", value: "blacksmith" }],
    },
  ];

  return baseMap(w, h, "village", [
    tileLayer(1, "ground", w, h, ground),
    tileLayer(2, "decor", w, h, decor),
    tileLayer(3, "above", w, h, above),
    tileLayer(4, "collision", w, h, collision, false),
    objectLayer(5, objects),
  ]);
}

// Placeholder so this file compiles before the fields generator lands in the
// next task; replaced by a real export there.
export const MAP_NAMES = { village: ROOM_NAME_VILLAGE, fields: ROOM_NAME_FIELDS };

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

/** Write the generated map files. Run via `pnpm generate:maps`. */
export function writeMapFiles(): void {
  const mapsDir = new URL("../maps/", import.meta.url);
  mkdirSync(mapsDir, { recursive: true });
  writeFileSync(
    new URL("../maps/map_ember_village.json", import.meta.url),
    `${JSON.stringify(generateVillageMap(), null, 2)}\n`,
  );
  writeFileSync(
    new URL("../maps/map_ember_fields.json", import.meta.url),
    `${JSON.stringify(generateFieldsMap(), null, 2)}\n`,
  );
  console.info("Wrote packages/data/maps/map_ember_village.json");
  console.info("Wrote packages/data/maps/map_ember_fields.json");
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  writeMapFiles();
}

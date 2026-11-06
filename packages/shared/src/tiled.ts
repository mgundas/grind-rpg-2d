import { z } from "zod";
import { MAP_IDS, TILE_SIZE, type MapId } from "./constants";
import type { Vec2 } from "./direction";

/**
 * Minimal, strict reader for the Tiled JSON subset Jade Throne uses
 * (GAME_DESIGN.md §3.2). The same file is parsed by the client and the
 * server, so both build the identical collision grid.
 */

const tiledPropertySchema = z.looseObject({
  name: z.string(),
  type: z.string().optional(),
  value: z.unknown(),
});

const tiledObjectSchema = z.looseObject({
  id: z.number().int().optional(),
  name: z.string(),
  type: z.string().optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  point: z.boolean().optional(),
  properties: z.array(tiledPropertySchema).optional(),
});

const tileLayerSchema = z.looseObject({
  type: z.literal("tilelayer"),
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  data: z.array(z.number().int().min(0)),
});

const objectLayerSchema = z.looseObject({
  type: z.literal("objectgroup"),
  name: z.string(),
  objects: z.array(tiledObjectSchema),
});

const layerSchema = z.discriminatedUnion("type", [tileLayerSchema, objectLayerSchema]);

const tilesetSchema = z.looseObject({
  firstgid: z.number().int().min(1),
  name: z.string().min(1),
  tilewidth: z.number().int().positive(),
  tileheight: z.number().int().positive(),
  image: z.string().optional(),
  columns: z.number().int().positive().optional(),
  tilecount: z.number().int().positive().optional(),
});

export const tiledMapSchema = z
  .looseObject({
    type: z.literal("map").optional(),
    version: z.union([z.string(), z.number()]).optional(),
    orientation: z.literal("orthogonal"),
    renderorder: z.string().optional(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    tilewidth: z.number().int().positive(),
    tileheight: z.number().int().positive(),
    layers: z.array(layerSchema).min(1),
    tilesets: z.array(tilesetSchema).min(1),
  })
  .superRefine((map, ctx) => {
    if (map.tilewidth !== TILE_SIZE || map.tileheight !== TILE_SIZE) {
      ctx.addIssue({
        code: "custom",
        message: `tile size must be ${TILE_SIZE}x${TILE_SIZE}, got ${map.tilewidth}x${map.tileheight}`,
      });
    }

    for (const required of ["ground", "decor", "above", "collision"] as const) {
      const layer = map.layers.find((l) => l.name === required);
      if (!layer) {
        ctx.addIssue({ code: "custom", message: `missing tile layer "${required}"` });
        continue;
      }
      if (layer.type !== "tilelayer") {
        ctx.addIssue({ code: "custom", message: `layer "${required}" must be a tile layer` });
        continue;
      }
      const expected = map.width * map.height;
      if (layer.data.length !== expected) {
        ctx.addIssue({
          code: "custom",
          message: `layer "${required}" has ${layer.data.length} cells, expected ${expected}`,
        });
      }
      if (layer.width !== map.width || layer.height !== map.height) {
        ctx.addIssue({
          code: "custom",
          message: `layer "${required}" is ${layer.width}x${layer.height}, expected ${map.width}x${map.height}`,
        });
      }
    }

    const objects = map.layers.find((l) => l.name === "objects");
    if (!objects) {
      ctx.addIssue({ code: "custom", message: 'missing object layer "objects"' });
    } else if (objects.type !== "objectgroup") {
      ctx.addIssue({ code: "custom", message: 'layer "objects" must be an object layer' });
    }

    const names = map.layers.map((l) => l.name);
    for (const name of new Set(names)) {
      if (names.filter((n) => n === name).length > 1) {
        ctx.addIssue({ code: "custom", message: `duplicate layer "${name}"` });
      }
    }
  });

export type TiledMapJson = z.infer<typeof tiledMapSchema>;
export type TileLayerJson = z.infer<typeof tileLayerSchema>;
export type ObjectLayerJson = z.infer<typeof objectLayerSchema>;
export type TiledObjectJson = z.infer<typeof tiledObjectSchema>;

/** Strict parse with a readable, aggregated error message. */
export function parseTiledMap(value: unknown): TiledMapJson {
  const parsed = tiledMapSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid Tiled map:\n${issues}`);
  }
  return parsed.data;
}

export interface WarpZone {
  /** Rectangle in pixels, top-left anchored. */
  x: number;
  y: number;
  w: number;
  h: number;
  targetMap: MapId;
  targetX: number;
  targetY: number;
}

/** A Tiled `mob_zone` rectangle, linked to a spawn group in data. */
export interface MobZone {
  x: number;
  y: number;
  w: number;
  h: number;
  spawnGroupId: string;
}

/** A static town NPC point from a Tiled `npc` object. */
export interface NpcSpawn {
  npcId: string;
  x: number;
  y: number;
}

export interface MapObjects {
  spawn: Vec2;
  warps: WarpZone[];
  npcs: NpcSpawn[];
  mobZones: MobZone[];
  stoneZones: TiledObjectJson[];
}

function objectProperty(object: TiledObjectJson, name: string): unknown {
  return object.properties?.find((prop) => prop.name === name)?.value;
}

function requiredString(object: TiledObjectJson, name: string): string {
  const value = objectProperty(object, name);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`object "${object.name}" needs a non-empty string "${name}" property`);
  }
  return value;
}

function requiredNumber(object: TiledObjectJson, name: string): number {
  const value = objectProperty(object, name);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`object "${object.name}" needs a numeric "${name}" property`);
  }
  return value;
}

function requiredMapId(object: TiledObjectJson, name: string): MapId {
  const value = objectProperty(object, name);
  if (typeof value !== "string" || !(MAP_IDS as readonly string[]).includes(value)) {
    throw new Error(
      `object "${object.name}" property "${name}" must be one of ${MAP_IDS.join(", ")}`,
    );
  }
  return value as MapId;
}

/** Extract spawn, warps and (parsed-but-unused) future zone objects. */
export function extractMapObjects(map: TiledMapJson): MapObjects {
  const objectsLayer = map.layers.find((l) => l.name === "objects");
  if (!objectsLayer || objectsLayer.type !== "objectgroup") {
    throw new Error('missing object layer "objects"');
  }
  const objects = objectsLayer.objects;

  const spawnObject = objects.find((object) => object.name === "spawn_player");
  if (!spawnObject) {
    throw new Error('map has no "spawn_player" object');
  }

  const warps: WarpZone[] = objects
    .filter((object) => object.name === "warp")
    .map((object) => ({
      x: object.x,
      y: object.y,
      w: object.width ?? TILE_SIZE,
      h: object.height ?? TILE_SIZE,
      targetMap: requiredMapId(object, "targetMap"),
      targetX: requiredNumber(object, "targetX"),
      targetY: requiredNumber(object, "targetY"),
    }));

  const mobZones: MobZone[] = objects
    .filter((object) => object.name === "mob_zone")
    .map((object) => ({
      x: object.x,
      y: object.y,
      w: object.width ?? TILE_SIZE,
      h: object.height ?? TILE_SIZE,
      spawnGroupId: requiredString(object, "spawnGroupId"),
    }));

  return {
    spawn: { x: spawnObject.x, y: spawnObject.y },
    warps,
    npcs: objects
      .filter((object) => object.name === "npc")
      .map((object) => ({
        npcId: requiredString(object, "npcId"),
        x: object.x,
        y: object.y,
      })),
    mobZones,
    stoneZones: objects.filter((object) => object.name === "stone_zone"),
  };
}

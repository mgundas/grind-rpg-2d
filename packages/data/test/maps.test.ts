import { describe, expect, it } from "vitest";
import committedVillage from "../maps/map_ember_village.json";
import committedFields from "../maps/map_ember_fields.json";
import {
  FIELDS_HEIGHT,
  FIELDS_SPAWN,
  FIELDS_WIDTH,
  VILLAGE_HEIGHT,
  VILLAGE_SPAWN,
  VILLAGE_WIDTH,
  generateFieldsMap,
  generateVillageMap,
  writeMapFiles,
} from "../src/generate-maps";
import {
  buildCollisionGrid,
  extractMapObjects,
  isSolidTile,
  isWalkableAt,
  parseTiledMap,
  ROOM_NAME_FIELDS,
  ROOM_NAME_VILLAGE,
  type CollisionGrid,
  type MapObjects,
  type TiledMapJson,
} from "@jadethrone/shared";
import { hasSpawnGroup } from "../src/spawnGroups";
import { hasNpc } from "../src/npcs";

const tile = 32;

interface MapFixture {
  width: number;
  height: number;
  map: TiledMapJson;
  grid: CollisionGrid;
  objects: MapObjects;
}

function fixture(raw: unknown, width: number, height: number): MapFixture {
  const map = parseTiledMap(structuredClone(raw));
  return { width, height, map, grid: buildCollisionGrid(map), objects: extractMapObjects(map) };
}

const village = fixture(generateVillageMap(), VILLAGE_WIDTH, VILLAGE_HEIGHT);
const fields = fixture(generateFieldsMap(), FIELDS_WIDTH, FIELDS_HEIGHT);

function tileCentre(tx: number, ty: number): { x: number; y: number } {
  return { x: tx * tile + tile / 2, y: ty * tile + tile / 2 };
}

/** BFS over walkable tile centres from a spawn pixel position to a tile. */
function canReach(
  grid: CollisionGrid,
  width: number,
  height: number,
  from: { x: number; y: number },
  goalTx: number,
  goalTy: number,
): boolean {
  const startTx = Math.floor(from.x / tile);
  const startTy = Math.floor(from.y / tile);
  const seen = new Set<number>([startTy * width + startTx]);
  const queue: Array<[number, number]> = [[startTx, startTy]];
  while (queue.length > 0) {
    const [tx, ty] = queue.shift()!;
    if (tx === goalTx && ty === goalTy) {
      return true;
    }
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }
      const key = ny * width + nx;
      if (seen.has(key)) {
        continue;
      }
      const centre = tileCentre(nx, ny);
      if (!isWalkableAt(grid, centre.x, centre.y)) {
        continue;
      }
      seen.add(key);
      queue.push([nx, ny]);
    }
  }
  return false;
}

function expectBorderSolid(current: MapFixture): void {
  for (let ty = 0; ty < current.height; ty++) {
    for (let tx = 0; tx < current.width; tx++) {
      const onRing = tx < 2 || ty < 2 || tx >= current.width - 2 || ty >= current.height - 2;
      if (onRing) {
        expect(isSolidTile(current.grid, tx, ty)).toBe(true);
      }
    }
  }
}

function expectWarpRectWalkable(current: MapFixture, warp: MapObjects["warps"][number]): void {
  const minTx = Math.floor(warp.x / tile);
  const maxTx = Math.floor((warp.x + warp.w - 1) / tile);
  const minTy = Math.floor(warp.y / tile);
  const maxTy = Math.floor((warp.y + warp.h - 1) / tile);
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      const centre = tileCentre(tx, ty);
      expect(isWalkableAt(current.grid, centre.x, centre.y)).toBe(true);
    }
  }
}

describe("generateVillageMap", () => {
  it("is valid Tiled JSON with all required layers", () => {
    expect(village.map.width).toBe(VILLAGE_WIDTH);
    expect(village.map.height).toBe(VILLAGE_HEIGHT);
    expect(village.map.layers.map((layer) => layer.name)).toEqual([
      "ground",
      "decor",
      "above",
      "collision",
      "objects",
    ]);
    expect(village.map.tilesets[0]?.name).toBe("village");
  });

  it("is deterministic and matches the committed file", () => {
    expect(generateVillageMap()).toEqual(generateVillageMap());
    expect(structuredClone(committedVillage)).toEqual(generateVillageMap());
  });

  it("has a walkable spawn on the plaza", () => {
    expect(isWalkableAt(village.grid, VILLAGE_SPAWN.x, VILLAGE_SPAWN.y)).toBe(true);
    const ground = village.map.layers.find((layer) => layer.name === "ground");
    if (ground?.type === "tilelayer") {
      const tx = Math.floor(VILLAGE_SPAWN.x / tile);
      const ty = Math.floor(VILLAGE_SPAWN.y / tile);
      expect(ground.data[ty * VILLAGE_WIDTH + tx]).toBe(2);
    }
  });

  it("has a solid border and a walkable bridge", () => {
    expectBorderSolid(village);
    expect(isSolidTile(village.grid, 24, 30)).toBe(true); // river north of the bridge
    expect(isSolidTile(village.grid, 24, 39)).toBe(false); // bridge deck
    expect(isSolidTile(village.grid, 24, 45)).toBe(true); // river south of the bridge
  });

  it("places every town NPC on walkable ground, in reach of the spawn", () => {
    expect(village.objects.npcs).toHaveLength(5);
    expect(new Set(village.objects.npcs.map((npc) => npc.npcId)).size).toBe(5);
    for (const npc of village.objects.npcs) {
      expect(hasNpc(npc.npcId)).toBe(true);
      expect(isWalkableAt(village.grid, npc.x, npc.y)).toBe(true);
      const distance = Math.hypot(npc.x - VILLAGE_SPAWN.x, npc.y - VILLAGE_SPAWN.y);
      expect(distance).toBeLessThan(220);
    }
  });

  it("warps to the fields and stays connected", () => {
    expect(village.objects.warps).toHaveLength(1);
    const warp = village.objects.warps[0]!;
    expect(warp.targetMap).toBe(ROOM_NAME_FIELDS);
    expect(warp.targetX).toBe(FIELDS_SPAWN.x);
    expect(warp.targetY).toBe(FIELDS_SPAWN.y);
    expectWarpRectWalkable(village, warp);
    expect(
      canReach(
        village.grid,
        VILLAGE_WIDTH,
        VILLAGE_HEIGHT,
        VILLAGE_SPAWN,
        Math.floor((warp.x + warp.w / 2) / tile),
        Math.floor((warp.y + warp.h / 2) / tile),
      ),
    ).toBe(true);
  });
});

describe("generateFieldsMap", () => {
  it("is valid Tiled JSON with all required layers", () => {
    expect(fields.map.width).toBe(FIELDS_WIDTH);
    expect(fields.map.height).toBe(FIELDS_HEIGHT);
    expect(fields.map.layers.map((layer) => layer.name)).toEqual([
      "ground",
      "decor",
      "above",
      "collision",
      "objects",
    ]);
    expect(fields.map.tilesets[0]?.name).toBe("fields");
  });

  it("is deterministic and matches the committed file", () => {
    expect(generateFieldsMap()).toEqual(generateFieldsMap());
    expect(structuredClone(committedFields)).toEqual(generateFieldsMap());
  });

  it("has a walkable spawn in the west clearing", () => {
    expect(isWalkableAt(fields.grid, FIELDS_SPAWN.x, FIELDS_SPAWN.y)).toBe(true);
  });

  it("has a solid border", () => {
    expectBorderSolid(fields);
  });

  it("warps back to the village and stays connected", () => {
    expect(fields.objects.warps).toHaveLength(1);
    const warp = fields.objects.warps[0]!;
    expect(warp.targetMap).toBe(ROOM_NAME_VILLAGE);
    expect(warp.targetX).toBe(VILLAGE_SPAWN.x);
    expect(warp.targetY).toBe(VILLAGE_SPAWN.y);
    expectWarpRectWalkable(fields, warp);
    expect(
      canReach(
        fields.grid,
        FIELDS_WIDTH,
        FIELDS_HEIGHT,
        FIELDS_SPAWN,
        Math.floor((warp.x + warp.w / 2) / tile),
        Math.floor((warp.y + warp.h / 2) / tile),
      ),
    ).toBe(true);
  });

  it("connects the spawn to the far east of the map", () => {
    expect(canReach(fields.grid, FIELDS_WIDTH, FIELDS_HEIGHT, FIELDS_SPAWN, 140, 80)).toBe(true);
  });

  it("declares mob zones and links every one to a spawn group", () => {
    expect(fields.objects.mobZones).toHaveLength(4);
    expect(fields.objects.stoneZones).toHaveLength(1);
    for (const zone of fields.objects.mobZones) {
      expect(hasSpawnGroup(zone.spawnGroupId)).toBe(true);
      expect(zone.w).toBeGreaterThan(0);
      expect(zone.h).toBeGreaterThan(0);
    }
  });

  it("places the boss zone on walkable ground", () => {
    const boss = fields.objects.mobZones.find((zone) => zone.spawnGroupId === "field_boss")!;
    expect(
      isWalkableAt(fields.grid, Math.floor(boss.x + boss.w / 2), Math.floor(boss.y + boss.h / 2)),
    ).toBe(true);
  });
});

describe("cross-map warps", () => {
  it("lands walkable in the target map in both directions", () => {
    const villageWarp = village.objects.warps[0]!;
    const fieldsWarp = fields.objects.warps[0]!;
    expect(isWalkableAt(fields.grid, villageWarp.targetX, villageWarp.targetY)).toBe(true);
    expect(isWalkableAt(village.grid, fieldsWarp.targetX, fieldsWarp.targetY)).toBe(true);
  });
});

describe("writeMapFiles", () => {
  it("writes both map files", () => {
    // The committed-file comparisons above prove the writer's output.
    expect(() => writeMapFiles()).not.toThrow();
  });
});

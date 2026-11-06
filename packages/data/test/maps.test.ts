import { describe, expect, it } from "vitest";
import committedVillage from "../maps/map_ember_village.json";
import {
  FIELDS_SPAWN,
  VILLAGE_HEIGHT,
  VILLAGE_SPAWN,
  VILLAGE_WIDTH,
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
} from "@jadethrone/shared";

const generated = generateVillageMap();
const map = parseTiledMap(structuredClone(generated));
const grid = buildCollisionGrid(map);
const objects = extractMapObjects(map);
const tile = 32;

function tileCentre(tx: number, ty: number): { x: number; y: number } {
  return { x: tx * tile + tile / 2, y: ty * tile + tile / 2 };
}

/** BFS over walkable tile centres from the spawn to the goal tile. */
function canReach(goalTx: number, goalTy: number): boolean {
  const startTx = Math.floor(VILLAGE_SPAWN.x / tile);
  const startTy = Math.floor(VILLAGE_SPAWN.y / tile);
  const seen = new Set<number>([startTy * VILLAGE_WIDTH + startTx]);
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
      if (nx < 0 || ny < 0 || nx >= VILLAGE_WIDTH || ny >= VILLAGE_HEIGHT) {
        continue;
      }
      const key = ny * VILLAGE_WIDTH + nx;
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

describe("generateVillageMap", () => {
  it("is valid Tiled JSON with all required layers", () => {
    expect(map.width).toBe(VILLAGE_WIDTH);
    expect(map.height).toBe(VILLAGE_HEIGHT);
    expect(map.layers.map((layer) => layer.name)).toEqual([
      "ground",
      "decor",
      "above",
      "collision",
      "objects",
    ]);
    expect(map.tilesets[0]?.name).toBe("village");
  });

  it("is deterministic", () => {
    expect(generateVillageMap()).toEqual(generateVillageMap());
  });

  it("matches the committed map file (regenerate with pnpm generate:maps)", () => {
    expect(structuredClone(committedVillage)).toEqual(generateVillageMap());
  });

  it("has a walkable spawn on the plaza", () => {
    expect(isWalkableAt(grid, VILLAGE_SPAWN.x, VILLAGE_SPAWN.y)).toBe(true);
    const ground = map.layers.find((layer) => layer.name === "ground");
    expect(ground?.type).toBe("tilelayer");
    if (ground?.type === "tilelayer") {
      const tx = Math.floor(VILLAGE_SPAWN.x / tile);
      const ty = Math.floor(VILLAGE_SPAWN.y / tile);
      expect(ground.data[ty * VILLAGE_WIDTH + tx]).toBe(2);
    }
  });

  it("has a solid two-tile border ring", () => {
    for (let ty = 0; ty < VILLAGE_HEIGHT; ty++) {
      for (let tx = 0; tx < VILLAGE_WIDTH; tx++) {
        const onRing = tx < 2 || ty < 2 || tx >= VILLAGE_WIDTH - 2 || ty >= VILLAGE_HEIGHT - 2;
        if (onRing) {
          expect(isSolidTile(grid, tx, ty)).toBe(true);
        }
      }
    }
  });

  it("has a warp to the fields with a walkable rectangle", () => {
    expect(objects.warps).toHaveLength(1);
    const warp = objects.warps[0]!;
    expect(warp.targetMap).toBe(ROOM_NAME_FIELDS);
    expect(warp.targetX).toBe(FIELDS_SPAWN.x);
    expect(warp.targetY).toBe(FIELDS_SPAWN.y);
    const minTx = Math.floor(warp.x / tile);
    const maxTx = Math.floor((warp.x + warp.w - 1) / tile);
    const minTy = Math.floor(warp.y / tile);
    const maxTy = Math.floor((warp.y + warp.h - 1) / tile);
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        const centre = tileCentre(tx, ty);
        expect(isWalkableAt(grid, centre.x, centre.y)).toBe(true);
      }
    }
  });

  it("connects the spawn to the warp across the bridge", () => {
    const warp = objects.warps[0]!;
    const goalTx = Math.floor((warp.x + warp.w / 2) / tile);
    const goalTy = Math.floor((warp.y + warp.h / 2) / tile);
    expect(canReach(goalTx, goalTy)).toBe(true);
  });

  it("keeps the bridge walkable and the river solid", () => {
    expect(isSolidTile(grid, 24, 30)).toBe(true); // river north of the bridge
    expect(isSolidTile(grid, 24, 39)).toBe(false); // bridge deck
    expect(isSolidTile(grid, 24, 45)).toBe(true); // river south of the bridge
  });

  it("writes map files to disk", () => {
    // Exercise the writer used by `pnpm generate:maps`; the committed file
    // comparison above already proves the output matches.
    expect(() => writeMapFiles()).not.toThrow();
  });
});

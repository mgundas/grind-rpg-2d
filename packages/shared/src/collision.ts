import { PLAYER_BODY } from "./constants";
import type { Vec2 } from "./direction";
import type { TiledMapJson } from "./tiled";

/**
 * Collision grid built from the Tiled `collision` layer. Any non-zero gid is
 * solid. Out-of-bounds is solid, so map bounds act as walls on both sides.
 */
export interface CollisionGrid {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly solid: Uint8Array;
}

const COLLISION_LAYER = "collision";

export function buildCollisionGrid(map: TiledMapJson): CollisionGrid {
  const layer = map.layers.find((candidate) => candidate.name === COLLISION_LAYER);
  if (!layer || layer.type !== "tilelayer") {
    throw new Error(`map has no tile layer "${COLLISION_LAYER}"`);
  }
  if (layer.data.length !== map.width * map.height) {
    throw new Error(`collision layer size mismatch: ${layer.data.length} cells`);
  }
  const solid = new Uint8Array(layer.data.length);
  for (let i = 0; i < layer.data.length; i++) {
    solid[i] = (layer.data[i] ?? 0) > 0 ? 1 : 0;
  }
  return { width: map.width, height: map.height, tileSize: map.tilewidth, solid };
}

export function isSolidTile(grid: CollisionGrid, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) {
    return true;
  }
  return grid.solid[ty * grid.width + tx] === 1;
}

export function isSolidAt(grid: CollisionGrid, px: number, py: number): boolean {
  return isSolidTile(grid, Math.floor(px / grid.tileSize), Math.floor(py / grid.tileSize));
}

/** Edge-aware conversion used to avoid touching the next tile on exact bounds. */
function firstTile(px: number, tileSize: number): number {
  return Math.floor(px / tileSize);
}

function lastTile(px: number, tileSize: number): number {
  return Math.ceil(px / tileSize) - 1;
}

/**
 * True when the feet AABB overlaps any solid tile. All overlapped tiles are
 * checked (not just sampled points), so thin walls cannot be stepped over.
 */
export function rectOverlapsSolid(
  grid: CollisionGrid,
  cx: number,
  cy: number,
  halfW: number = PLAYER_BODY.halfW,
  halfH: number = PLAYER_BODY.halfH,
): boolean {
  const minTx = firstTile(cx - halfW, grid.tileSize);
  const maxTx = lastTile(cx + halfW, grid.tileSize);
  const minTy = firstTile(cy - halfH, grid.tileSize);
  const maxTy = lastTile(cy + halfH, grid.tileSize);
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (isSolidTile(grid, tx, ty)) {
        return true;
      }
    }
  }
  return false;
}

export function isWalkableAt(grid: CollisionGrid, px: number, py: number): boolean {
  return !rectOverlapsSolid(grid, px, py);
}

/**
 * BFS ring search for the closest walkable tile centre. Deterministic: within
 * a ring, candidates are sorted by squared distance then y then x.
 * Returns the input position unchanged when it is already walkable.
 */
export function nearestWalkable(
  grid: CollisionGrid,
  px: number,
  py: number,
  maxRadiusTiles = 8,
): Vec2 | null {
  if (isWalkableAt(grid, px, py)) {
    return { x: px, y: py };
  }
  const startTx = Math.floor(px / grid.tileSize);
  const startTy = Math.floor(py / grid.tileSize);
  for (let radius = 0; radius <= maxRadiusTiles; radius++) {
    const candidates: Array<{ x: number; y: number; d2: number }> = [];
    for (let ty = startTy - radius; ty <= startTy + radius; ty++) {
      for (let tx = startTx - radius; tx <= startTx + radius; tx++) {
        const chebyshev = Math.max(Math.abs(tx - startTx), Math.abs(ty - startTy));
        if (chebyshev !== radius) {
          continue;
        }
        if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) {
          continue;
        }
        const cx = tx * grid.tileSize + grid.tileSize / 2;
        const cy = ty * grid.tileSize + grid.tileSize / 2;
        if (!isWalkableAt(grid, cx, cy)) {
          continue;
        }
        const dx = cx - px;
        const dy = cy - py;
        candidates.push({ x: cx, y: cy, d2: dx * dx + dy * dy });
      }
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.d2 - b.d2 || a.y - b.y || a.x - b.x);
      const best = candidates[0]!;
      return { x: best.x, y: best.y };
    }
  }
  return null;
}

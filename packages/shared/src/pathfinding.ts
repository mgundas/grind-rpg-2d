import { MAX_PATH_EXPAND } from "./constants";
import { isWalkableAt, nearestWalkable, type CollisionGrid } from "./collision";
import type { Vec2 } from "./direction";

/**
 * Deterministic A* over the collision grid. Used by the server (authoritative)
 * and by the client predictor (optimistic); both start from the same position
 * with the same grid, so replays reproduce identical paths.
 */

/** Neighbour order matches Dir8: E, SE, S, SW, W, NW, N, NE. */
const NEIGHBOURS: ReadonlyArray<Readonly<{ dx: number; dy: number; diagonal: boolean }>> = [
  { dx: 1, dy: 0, diagonal: false },
  { dx: 1, dy: 1, diagonal: true },
  { dx: 0, dy: 1, diagonal: false },
  { dx: -1, dy: 1, diagonal: true },
  { dx: -1, dy: 0, diagonal: false },
  { dx: -1, dy: -1, diagonal: true },
  { dx: 0, dy: -1, diagonal: false },
  { dx: 1, dy: -1, diagonal: true },
];

/** sqrt(2), as a literal (see INV_SQRT2 in constants.ts). */
const SQRT2 = 1.4142135623730951;

export interface PathOptions {
  /** Max number of expanded nodes before giving up (default MAX_PATH_EXPAND). */
  maxExpand?: number;
}

interface HeapNode {
  index: number;
  f: number;
  h: number;
  order: number;
}

class MinHeap {
  private items: HeapNode[] = [];
  private counter = 0;

  get size(): number {
    return this.items.length;
  }

  push(index: number, f: number, h: number): void {
    this.items.push({ index, f, h, order: this.counter++ });
    this.bubbleUp(this.items.length - 1);
  }

  pop(): HeapNode | undefined {
    const first = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last) {
      this.items[0] = last;
      this.bubbleDown(0);
    }
    return first;
  }

  private less(a: HeapNode, b: HeapNode): boolean {
    return a.f < b.f || (a.f === b.f && (a.h < b.h || (a.h === b.h && a.order < b.order)));
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      const node = this.items[index]!;
      const parentNode = this.items[parent]!;
      if (!this.less(node, parentNode)) {
        break;
      }
      this.items[index] = parentNode;
      this.items[parent] = node;
      index = parent;
    }
  }

  private bubbleDown(index: number): void {
    const length = this.items.length;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < length && this.less(this.items[left]!, this.items[smallest]!)) {
        smallest = left;
      }
      if (right < length && this.less(this.items[right]!, this.items[smallest]!)) {
        smallest = right;
      }
      if (smallest === index) {
        return;
      }
      const node = this.items[index]!;
      this.items[index] = this.items[smallest]!;
      this.items[smallest] = node;
      index = smallest;
    }
  }
}

function tileOf(grid: CollisionGrid, point: Vec2): { tx: number; ty: number } {
  return {
    tx: Math.floor(point.x / grid.tileSize),
    ty: Math.floor(point.y / grid.tileSize),
  };
}

function isFreeTile(grid: CollisionGrid, tx: number, ty: number): boolean {
  return (
    tx >= 0 &&
    ty >= 0 &&
    tx < grid.width &&
    ty < grid.height &&
    grid.solid[ty * grid.width + tx] === 0
  );
}

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  const min = Math.min(dx, dy);
  return dx + dy + (SQRT2 - 2) * min;
}

/**
 * Find a walkable path between two pixel positions. Returns waypoints in
 * pixels (start excluded, final point included), or `[]` when the start is
 * unusable, no walkable target exists nearby, or the node budget runs out.
 */
export function findPath(
  grid: CollisionGrid,
  fromPx: Vec2,
  toPx: Vec2,
  options: PathOptions = {},
): Vec2[] {
  const maxExpand = options.maxExpand ?? MAX_PATH_EXPAND;

  const mapW = grid.width * grid.tileSize;
  const mapH = grid.height * grid.tileSize;
  if (toPx.x < 0 || toPx.y < 0 || toPx.x > mapW || toPx.y > mapH) {
    return [];
  }

  let start = tileOf(grid, fromPx);
  if (!isWalkableAt(grid, fromPx.x, fromPx.y)) {
    const safe = nearestWalkable(grid, fromPx.x, fromPx.y, 2);
    if (!safe) {
      return [];
    }
    start = tileOf(grid, safe);
  }

  let targetPoint = toPx;
  let goal = tileOf(grid, toPx);
  if (!isWalkableAt(grid, toPx.x, toPx.y)) {
    const safe = nearestWalkable(grid, toPx.x, toPx.y, 3);
    if (!safe) {
      return [];
    }
    targetPoint = safe;
    goal = tileOf(grid, safe);
  }

  if (start.tx === goal.tx && start.ty === goal.ty) {
    const samePoint =
      Math.abs(fromPx.x - targetPoint.x) < 0.001 && Math.abs(fromPx.y - targetPoint.y) < 0.001;
    return samePoint ? [] : [{ x: targetPoint.x, y: targetPoint.y }];
  }

  const width = grid.width;
  const height = grid.height;
  const total = width * height;
  const gScore = new Float64Array(total).fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);

  const startIndex = start.ty * width + start.tx;
  const goalIndex = goal.ty * width + goal.tx;
  gScore[startIndex] = 0;

  const open = new MinHeap();
  const startH = heuristic(start.tx, start.ty, goal.tx, goal.ty);
  open.push(startIndex, startH, startH);

  let expanded = 0;
  let reached = false;

  while (open.size > 0) {
    const current = open.pop()!;
    if (closed[current.index] === 1) {
      continue;
    }
    if (current.index === goalIndex) {
      reached = true;
      break;
    }
    closed[current.index] = 1;
    if (++expanded > maxExpand) {
      return [];
    }

    const cx = current.index % width;
    const cy = Math.floor(current.index / width);
    const base = gScore[current.index]!;

    for (const neighbour of NEIGHBOURS) {
      const nx = cx + neighbour.dx;
      const ny = cy + neighbour.dy;
      if (!isFreeTile(grid, nx, ny)) {
        continue;
      }
      if (
        neighbour.diagonal &&
        (!isFreeTile(grid, cx + neighbour.dx, cy) || !isFreeTile(grid, cx, cy + neighbour.dy))
      ) {
        continue;
      }
      const index = ny * width + nx;
      if (closed[index] === 1) {
        continue;
      }
      const cost = neighbour.diagonal ? SQRT2 : 1;
      const candidate = base + cost;
      if (candidate < gScore[index]!) {
        gScore[index] = candidate;
        cameFrom[index] = current.index;
        const h = heuristic(nx, ny, goal.tx, goal.ty);
        open.push(index, candidate + h, h);
      }
    }
  }

  if (!reached) {
    return [];
  }

  const tiles: Array<{ tx: number; ty: number }> = [];
  let cursor = goalIndex;
  while (cursor !== -1 && cursor !== startIndex) {
    tiles.push({ tx: cursor % width, ty: Math.floor(cursor / width) });
    cursor = cameFrom[cursor]!;
  }
  tiles.reverse();

  const centers: Vec2[] = tiles.map((tile) => ({
    x: tile.tx * grid.tileSize + grid.tileSize / 2,
    y: tile.ty * grid.tileSize + grid.tileSize / 2,
  }));

  const last = centers[centers.length - 1];
  if (!last || last.x !== targetPoint.x || last.y !== targetPoint.y) {
    centers.push({ x: targetPoint.x, y: targetPoint.y });
  }

  return simplifyPath(grid, [{ x: fromPx.x, y: fromPx.y }, ...centers]);
}

/**
 * Greedy string-pulling: drop intermediate waypoints when the body can walk
 * straight to a later one. `waypoints[0]` is treated as the start and is not
 * included in the result.
 */
export function simplifyPath(grid: CollisionGrid, waypoints: Vec2[]): Vec2[] {
  if (waypoints.length <= 1) {
    return [];
  }
  const result: Vec2[] = [];
  let index = 0;
  while (index < waypoints.length - 1) {
    let next = waypoints.length - 1;
    while (next > index + 1 && !hasLineOfWalk(grid, waypoints[index]!, waypoints[next]!)) {
      next--;
    }
    result.push(waypoints[next]!);
    index = next;
  }
  return result;
}

/**
 * Whether the player body can walk in a straight line between two points.
 * Samples along the longer axis every quarter tile and checks the feet AABB
 * at each sample (division only — deterministic).
 */
export function hasLineOfWalk(grid: CollisionGrid, a: Vec2, b: Vec2): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const longest = Math.max(Math.abs(dx), Math.abs(dy));
  if (longest === 0) {
    return isWalkableAt(grid, a.x, a.y);
  }
  const steps = Math.ceil(longest / (grid.tileSize / 4));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + dx * t;
    const y = a.y + dy * t;
    if (!isWalkableAt(grid, x, y)) {
      return false;
    }
  }
  return true;
}

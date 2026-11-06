import { PLAYER_BODY, WALK_SPEED } from "./constants";
import { rectOverlapsSolid, type CollisionGrid } from "./collision";
import { DIR8_VECTORS, dir8Towards, type Dir8, type Vec2 } from "./direction";

/**
 * Deterministic movement step shared by the client predictor and the
 * authoritative server (GAME_DESIGN.md §5.1). Same input, grid and dt must
 * always produce the same output — so this file uses only arithmetic,
 * comparisons and table lookups (no Math.sqrt/hypot/trig at runtime).
 */

export type MoveIntent =
  | { kind: "dir"; dir: Dir8 }
  /** Follow the waypoints already stored on the mover (click-to-move). */
  | { kind: "path" }
  | { kind: "none" };

export interface MoverState {
  pos: Vec2;
  /** Remaining waypoints in pixels, nearest first. */
  path: Vec2[];
}

export function createMover(pos: Vec2): MoverState {
  return { pos: { x: pos.x, y: pos.y }, path: [] };
}

function waypointTolerance(speed: number, dtMs: number): number {
  return (speed * dtMs) / 1000 / 4 + 0.5;
}

function distanceSquared(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Advance a mover by one fixed tick.
 *
 * - `dir`: move in that 8-direction unit vector; clears any stored path.
 * - `path`: consume waypoints that are within one step, then walk toward the
 *   next one using the octant direction (no square roots).
 * - `none`: no movement; keeps the path.
 *
 * Axis-separated collide-and-slide: X is attempted first, then Y, so a
 * diagonal into a corner stops and a diagonal along a wall slides.
 */
export function stepMover(
  mover: MoverState,
  intent: MoveIntent,
  grid: CollisionGrid,
  dtMs: number,
  speed: number = WALK_SPEED,
): MoverState {
  const dt = Math.max(0, dtMs);
  const stepDistance = (speed * dt) / 1000;
  let path = mover.path;
  let velocity: Readonly<Vec2> | null = null;

  if (intent.kind === "dir") {
    path = [];
    velocity = DIR8_VECTORS[intent.dir] ?? null;
  } else if (intent.kind === "path") {
    const consumeRadius = stepDistance + waypointTolerance(speed, dtMs);
    const consumeSquared = consumeRadius * consumeRadius;
    const toleranceSquared = waypointTolerance(speed, dtMs) ** 2;
    path = path.slice();
    // Peel off intermediate waypoints the next step would cross anyway. This
    // also stops an octant step from oscillating around a waypoint.
    while (path.length > 1 && distanceSquared(mover.pos, path[0]!) <= consumeSquared) {
      path.shift();
    }
    if (path.length === 0) {
      return { pos: { x: mover.pos.x, y: mover.pos.y }, path };
    }
    if (path.length === 1) {
      const distance = distanceSquared(mover.pos, path[0]!);
      if (distance <= toleranceSquared) {
        return { pos: { x: mover.pos.x, y: mover.pos.y }, path: [] };
      }
      // Land exactly on the final waypoint when the next step could reach it
      // (it is guaranteed walkable by findPath), avoiding octant overshoot.
      if (distance <= stepDistance * stepDistance) {
        const last = path[0]!;
        if (!rectOverlapsSolid(grid, last.x, last.y, PLAYER_BODY.halfW, PLAYER_BODY.halfH)) {
          return { pos: { x: last.x, y: last.y }, path: [] };
        }
      }
    }
    const dir = dir8Towards(mover.pos, path[0]!);
    velocity = dir === null ? null : DIR8_VECTORS[dir]!;
  }

  if (!velocity || stepDistance === 0) {
    return { pos: { x: mover.pos.x, y: mover.pos.y }, path };
  }

  const vx = velocity.x * stepDistance;
  const vy = velocity.y * stepDistance;
  let x = mover.pos.x;
  let y = mover.pos.y;

  if (!rectOverlapsSolid(grid, x + vx, y, PLAYER_BODY.halfW, PLAYER_BODY.halfH)) {
    x += vx;
  }
  if (!rectOverlapsSolid(grid, x, y + vy, PLAYER_BODY.halfW, PLAYER_BODY.halfH)) {
    y += vy;
  }

  const maxX = grid.width * grid.tileSize;
  const maxY = grid.height * grid.tileSize;
  x = Math.min(Math.max(x, 0), maxX);
  y = Math.min(Math.max(y, 0), maxY);

  return { pos: { x, y }, path };
}

import { INV_SQRT2 } from "./constants";

/**
 * 8 movement directions and 4 visible facings (GAME_DESIGN.md §5).
 *
 * Direction order is E, SE, S, SW, W, NW, N, NE — clockwise from +X. The
 * diagonal unit components use the INV_SQRT2 literal (never Math.sqrt), so
 * movement stays deterministic across engines.
 */

export type Dir8 = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Vec2 {
  x: number;
  y: number;
}

export const DIR8_VECTORS: readonly Readonly<Vec2>[] = [
  { x: 1, y: 0 },
  { x: INV_SQRT2, y: INV_SQRT2 },
  { x: 0, y: 1 },
  { x: -INV_SQRT2, y: INV_SQRT2 },
  { x: -1, y: 0 },
  { x: -INV_SQRT2, y: -INV_SQRT2 },
  { x: 0, y: -1 },
  { x: INV_SQRT2, y: -INV_SQRT2 },
];

/** LPC-visible facing, in the sheet's row order: down, left, right, up. */
export type Facing4 = "down" | "left" | "right" | "up";

/**
 * Sprite sheets only have 4 rows; diagonals use the closer horizontal
 * direction (GAME_DESIGN.md §5), i.e. E/SE/NE look right, W/SW/NW look left.
 */
export function facing4FromDir8(dir: Dir8): Facing4 {
  switch (dir) {
    case 0:
    case 1:
    case 7:
      return "right";
    case 2:
      return "down";
    case 3:
    case 4:
    case 5:
      return "left";
    case 6:
      return "up";
  }
}

/** Map held WASD/arrow axes to a direction; null when nothing is pressed. */
export function dir8FromAxes(dx: -1 | 0 | 1, dy: -1 | 0 | 1): Dir8 | null {
  if (dx === 0 && dy === 0) {
    return null;
  }
  if (dx === 1) {
    return dy === 0 ? 0 : dy === 1 ? 1 : 7;
  }
  if (dx === -1) {
    return dy === 0 ? 4 : dy === 1 ? 3 : 5;
  }
  return dy === 1 ? 2 : 6;
}

/** tan(67.5°) = 1 + sqrt(2); beyond this ratio a vector is axis-aligned. */
const TAN_67_5 = 2.414213562373095;

/**
 * Direction from `from` toward `to` for hold-to-steer. Returns null for
 * (near-)identical points. Octant boundaries at 22.5° from each axis.
 */
export function dir8Towards(from: Vec2, to: Vec2): Dir8 | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) {
    return null;
  }
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax >= ay * TAN_67_5) {
    return dx > 0 ? 0 : 4;
  }
  if (ay >= ax * TAN_67_5) {
    return dy > 0 ? 2 : 6;
  }
  if (dx > 0) {
    return dy > 0 ? 1 : 7;
  }
  return dy > 0 ? 3 : 5;
}

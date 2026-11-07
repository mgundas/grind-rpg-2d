import { ATTACK_ARC_HALF_COS, ATTACK_RANGE_PAD_PX } from "./constants";
import type { Facing4, Vec2 } from "./direction";

/**
 * Deterministic melee arc selection (GAME_DESIGN.md §5). No trig: a target is
 * inside the 120° frontal arc when the dot product with the facing axis is
 * non-negative (in front) and its squared length passes the cosine test.
 */

export interface ArcTarget {
  id: string;
  x: number;
  y: number;
}

export interface ArcQuery {
  origin: Vec2;
  facing: Facing4;
  rangePx: number;
  /** Extra reach for entity body radius; defaults to half a tile. */
  padPx?: number;
  maxTargets?: number;
}

const FACING_VECTORS: Record<Facing4, Readonly<Vec2>> = {
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
};

const DEFAULT_MAX_TARGETS = 8;

/** Squared distance, useful to callers that also sort by range. */
export function distanceSquared(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function isInMeleeArc(
  origin: Vec2,
  target: Vec2,
  facing: Facing4,
  rangePx: number,
  padPx = ATTACK_RANGE_PAD_PX,
): boolean {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const squared = dx * dx + dy * dy;
  const reach = Math.max(0, rangePx) + Math.max(0, padPx);
  if (squared > reach * reach) {
    return false;
  }

  const axis = FACING_VECTORS[facing];
  const dot = axis.x * dx + axis.y * dy;
  if (dot < 0) {
    return false; // behind the attacker
  }

  // cos²(60°) = 0.25. The epsilon keeps a target exactly on the arc boundary
  // inside despite floating-point rounding.
  return dot * dot + 1e-9 >= squared * ATTACK_ARC_HALF_COS * ATTACK_ARC_HALF_COS;
}

/**
 * Returns the ids of every entity inside the frontal arc, nearest first with a
 * stable id tie-break, capped at `maxTargets`.
 */
export function findArcTargets(candidates: readonly ArcTarget[], query: ArcQuery): string[] {
  const padPx = query.padPx ?? ATTACK_RANGE_PAD_PX;
  const maxTargets = Math.max(0, query.maxTargets ?? DEFAULT_MAX_TARGETS);
  if (maxTargets === 0) {
    return [];
  }

  const hits: Array<{ id: string; squared: number }> = [];
  for (const candidate of candidates) {
    if (isInMeleeArc(query.origin, candidate, query.facing, query.rangePx, padPx)) {
      hits.push({ id: candidate.id, squared: distanceSquared(query.origin, candidate) });
    }
  }

  hits.sort((a, b) => {
    if (a.squared !== b.squared) {
      return a.squared - b.squared;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return hits.slice(0, maxTargets).map((hit) => hit.id);
}

export interface CircleQuery {
  center: Vec2;
  radiusPx: number;
  /** Extra reach for entity body radius. */
  padPx?: number;
  maxTargets?: number;
}

/** Ids inside a circle, nearest first with a stable id tie-break. */
export function findCircleTargets(
  candidates: readonly ArcTarget[],
  query: CircleQuery,
): string[] {
  const padPx = query.padPx ?? ATTACK_RANGE_PAD_PX;
  const maxTargets = Math.max(0, query.maxTargets ?? DEFAULT_MAX_TARGETS);
  if (maxTargets === 0) {
    return [];
  }
  const reach = Math.max(0, query.radiusPx) + Math.max(0, padPx);
  const reachSquared = reach * reach;
  const hits: Array<{ id: string; squared: number }> = [];
  for (const candidate of candidates) {
    const squared = distanceSquared(query.center, candidate);
    if (squared <= reachSquared) {
      hits.push({ id: candidate.id, squared });
    }
  }
  hits.sort((a, b) => (a.squared !== b.squared ? a.squared - b.squared : compareIds(a.id, b.id)));
  return hits.slice(0, maxTargets).map((hit) => hit.id);
}

export interface LineQuery {
  origin: Vec2;
  end: Vec2;
  /** Total corridor width in pixels; half-width is used for the test. */
  widthPx: number;
  padPx?: number;
  maxTargets?: number;
}

function distanceToSegmentSquared(point: Vec2, start: Vec2, end: Vec2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return distanceSquared(point, start);
  }
  const projection = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  const t = Math.min(1, Math.max(0, projection));
  const closestX = start.x + dx * t;
  const closestY = start.y + dy * t;
  const offsetX = point.x - closestX;
  const offsetY = point.y - closestY;
  return offsetX * offsetX + offsetY * offsetY;
}

/** Ids inside a line corridor between `origin` and `end`, nearest first. */
export function findLineTargets(candidates: readonly ArcTarget[], query: LineQuery): string[] {
  const maxTargets = Math.max(0, query.maxTargets ?? DEFAULT_MAX_TARGETS);
  if (maxTargets === 0) {
    return [];
  }
  const halfWidth = Math.max(0, query.widthPx) / 2 + Math.max(0, query.padPx ?? 0);
  const halfWidthSquared = halfWidth * halfWidth;
  const hits: Array<{ id: string; squared: number }> = [];
  for (const candidate of candidates) {
    const fromOrigin = distanceSquared(query.origin, candidate);
    if (
      distanceToSegmentSquared(candidate, query.origin, query.end) <= halfWidthSquared &&
      fromOrigin <= distanceSquared(query.origin, query.end) + halfWidthSquared
    ) {
      hits.push({ id: candidate.id, squared: fromOrigin });
    }
  }
  hits.sort((a, b) => (a.squared !== b.squared ? a.squared - b.squared : compareIds(a.id, b.id)));
  return hits.slice(0, maxTargets).map((hit) => hit.id);
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

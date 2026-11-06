import {
  MONSTER_ATTACK_RANGE_HYSTERESIS_PX,
  MONSTER_CHASE_REPATH_MS,
  MONSTER_SLEEP_RADIUS_PX,
  MONSTER_WANDER_RADIUS_PX,
  TICK_MS,
  TILE_SIZE,
  facing4FromDelta,
  facing4FromIndex,
  facing4Index,
  findPath,
  isWalkableAt,
  nearestWalkable,
  stepMover,
  type CollisionGrid,
  type MoveIntent,
  type Vec2,
} from "@jadethrone/shared";
import type { MonsterAggroType } from "@jadethrone/data/monsters";
import type { MonsterAiState, MonsterRuntime } from "./monsterRuntime";
import type { MonsterState } from "./state/WorldState";

/**
 * Monster AI state machine (GAME_DESIGN.md §6.1).
 *
 * `idle -> chase -> attack -> return -> idle`. The function only mutates the
 * monster's own runtime/schema objects; the room supplies a per-tick player
 * snapshot and an A* budget so a room full of chasing monsters cannot blow the
 * tick budget. Damage is never applied here — the room's combat phase resolves
 * the returned attack intent.
 */

export interface AiPlayerSnapshot {
  sessionId: string;
  /** Authoritative `PlayerRuntime.mover.pos` (never the float32 state). */
  pos: Vec2;
  dead: boolean;
  warping: boolean;
}

export interface AiContext {
  grid: CollisionGrid;
  /** Room-injected clock, so tests can advance time deterministically. */
  now: number;
  players: readonly AiPlayerSnapshot[];
  /** False when the room's per-tick A* budget is exhausted. */
  takeAstar: () => boolean;
  rng: () => number;
}

export interface MonsterAiSpec {
  moveSpeed: number;
  attackRange: number;
  attackCooldownMs: number;
  aggroType: MonsterAggroType;
  aggroRange: number;
  leashRange: number;
}

export interface MonsterAiResult {
  attackTargetId?: string;
  arrivedHome?: boolean;
}

const SLEEP_RADIUS_SQ = MONSTER_SLEEP_RADIUS_PX * MONSTER_SLEEP_RADIUS_PX;
const WANDER_RADIUS_SQ = MONSTER_WANDER_RADIUS_PX * MONSTER_WANDER_RADIUS_PX;
/** Snap-to-home radius for the return state. */
const HOME_ARRIVAL_SQ = 32 * 32;
const REPATH_BUDGET_RETRY_MS = MONSTER_CHASE_REPATH_MS;

function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function tileKey(pos: Vec2): number {
  return Math.floor(pos.y / TILE_SIZE) * 4096 + Math.floor(pos.x / TILE_SIZE);
}

function isLive(player: AiPlayerSnapshot): boolean {
  return !player.dead && !player.warping;
}

function anyPlayerWithin(
  players: readonly AiPlayerSnapshot[],
  pos: Vec2,
  radiusSq: number,
): boolean {
  for (const player of players) {
    if (isLive(player) && distanceSq(pos, player.pos) <= radiusSq) {
      return true;
    }
  }
  return false;
}

function findPlayer(
  players: readonly AiPlayerSnapshot[],
  sessionId: string,
): AiPlayerSnapshot | undefined {
  const found = players.find((player) => player.sessionId === sessionId);
  return found && isLive(found) ? found : undefined;
}

/**
 * Nearest live player, deterministic on equal distance (lower session id wins).
 * `rangeSq` is inclusive.
 */
function nearestPlayer(
  players: readonly AiPlayerSnapshot[],
  pos: Vec2,
  range: number,
): AiPlayerSnapshot | undefined {
  const rangeSq = range * range;
  let best: AiPlayerSnapshot | undefined;
  let bestSq = Number.POSITIVE_INFINITY;
  for (const player of players) {
    if (!isLive(player)) {
      continue;
    }
    const squared = distanceSq(pos, player.pos);
    if (squared > rangeSq) {
      continue;
    }
    if (
      best === undefined ||
      squared < bestSq ||
      (squared === bestSq && player.sessionId < best.sessionId)
    ) {
      best = player;
      bestSq = squared;
    }
  }
  return best;
}

function enterChase(runtime: MonsterRuntime, sessionId: string, nextRepathAtMs = 0): void {
  runtime.ai = "chase";
  runtime.targetSessionId = sessionId;
  runtime.nextRepathAtMs = nextRepathAtMs;
  runtime.failedRepaths = 0;
  runtime.lastTargetTileKey = null;
  runtime.mover.path = [];
}

function beginReturn(runtime: MonsterRuntime): void {
  runtime.ai = "return";
  runtime.targetSessionId = null;
  runtime.mover.path = [];
  runtime.failedRepaths = 0;
  runtime.lastTargetTileKey = null;
  runtime.nextRepathAtMs = 0;
}

/** Write the authoritative mover position/facing into the schema entity. */
function syncMonsterState(
  state: MonsterState,
  runtime: MonsterRuntime,
  from: Vec2,
  faceToward: Vec2 | null,
): void {
  const pos = runtime.mover.pos;
  const dx = pos.x - from.x;
  const dy = pos.y - from.y;
  if (dx !== 0 || dy !== 0) {
    state.x = pos.x;
    state.y = pos.y;
    state.moving = true;
    state.facing = facing4Index(facing4FromDelta(dx, dy, facing4FromIndex(state.facing)));
    return;
  }

  state.moving = false;
  if (faceToward) {
    state.facing = facing4Index(
      facing4FromDelta(faceToward.x - pos.x, faceToward.y - pos.y, facing4FromIndex(state.facing)),
    );
  }
}

function wanderPoint(ctx: AiContext, runtime: MonsterRuntime): Vec2 | null {
  const angle = ctx.rng() * Math.PI * 2;
  const radius = ctx.rng() * MONSTER_WANDER_RADIUS_PX;
  const candidate: Vec2 = {
    x: runtime.home.x + Math.cos(angle) * radius,
    y: runtime.home.y + Math.sin(angle) * radius,
  };
  if (distanceSq(candidate, runtime.home) > WANDER_RADIUS_SQ) {
    return null;
  }
  if (isWalkableAt(ctx.grid, candidate.x, candidate.y)) {
    return candidate;
  }
  return nearestWalkable(ctx.grid, candidate.x, candidate.y, 4);
}

export function stepMonsterAi(
  ctx: AiContext,
  runtime: MonsterRuntime,
  state: MonsterState,
  spec: MonsterAiSpec,
): MonsterAiResult {
  const now = ctx.now;
  const from: Vec2 = { x: runtime.mover.pos.x, y: runtime.mover.pos.y };
  let intent: MoveIntent = { kind: "none" };
  let faceToward: Vec2 | null = null;
  let attackTargetId: string | undefined;
  let arrivedHome = false;

  // Leash first: a target that fled far enough must not freeze the monster in
  // chase because the sleep gate would otherwise stop it from walking home.
  if (
    (runtime.ai === "chase" || runtime.ai === "attack") &&
    distanceSq(runtime.mover.pos, runtime.home) > spec.leashRange * spec.leashRange
  ) {
    beginReturn(runtime);
  }

  // Sleeping monsters do nothing at all: no movement, no RNG consumption, no
  // wander reschedule. Returning monsters always finish their walk home.
  if (
    runtime.ai !== "return" &&
    !anyPlayerWithin(ctx.players, runtime.mover.pos, SLEEP_RADIUS_SQ)
  ) {
    syncMonsterState(state, runtime, from, null);
    return {};
  }

  let target = runtime.targetSessionId
    ? findPlayer(ctx.players, runtime.targetSessionId)
    : undefined;

  // A passive monster that was just damaged has a target while idle; promote it
  // before the idle/wander branch.
  if (runtime.ai === "idle" && target) {
    enterChase(runtime, target.sessionId);
  }

  if (runtime.ai === "idle" && spec.aggroType === "aggressive") {
    const nearby = nearestPlayer(ctx.players, runtime.mover.pos, spec.aggroRange);
    if (nearby) {
      enterChase(runtime, nearby.sessionId);
      target = nearby;
    }
  }

  if (runtime.ai === "chase" || runtime.ai === "attack") {
    if (!target) {
      // The target died, left the map or warped. Aggressive monsters may pick a
      // replacement slightly beyond aggro range so they do not give up at the
      // exact boundary; passive monsters always go home.
      const replacement =
        spec.aggroType === "aggressive"
          ? nearestPlayer(ctx.players, runtime.mover.pos, spec.aggroRange + 100)
          : undefined;
      if (replacement) {
        enterChase(runtime, replacement.sessionId);
        target = replacement;
      } else {
        beginReturn(runtime);
      }
    }

    if (target) {
      const squared = distanceSq(runtime.mover.pos, target.pos);
      const attackRangeSq = spec.attackRange * spec.attackRange;
      const leaveRange = spec.attackRange + MONSTER_ATTACK_RANGE_HYSTERESIS_PX;
      const leaveRangeSq = leaveRange * leaveRange;

      if (runtime.ai === "attack" && squared > leaveRangeSq) {
        runtime.ai = "chase";
        runtime.nextRepathAtMs = 0;
      }
      if (runtime.ai === "chase" && squared <= attackRangeSq) {
        runtime.ai = "attack";
        runtime.mover.path = [];
        runtime.failedRepaths = 0;
        runtime.nextRepathAtMs = 0;
      }

      if (runtime.ai === "attack") {
        faceToward = target.pos;
        if (now >= runtime.attackReadyAtMs) {
          runtime.attackReadyAtMs = now + spec.attackCooldownMs;
          attackTargetId = target.sessionId;
        }
      } else {
        const key = tileKey(target.pos);
        const due = now >= runtime.nextRepathAtMs;
        const targetMoved = runtime.lastTargetTileKey !== key;
        if (due && (targetMoved || runtime.mover.path.length === 0)) {
          runtime.nextRepathAtMs = now + REPATH_BUDGET_RETRY_MS;
          if (ctx.takeAstar()) {
            runtime.mover.path = findPath(ctx.grid, runtime.mover.pos, target.pos);
            runtime.lastTargetTileKey = key;
            if (runtime.mover.path.length === 0) {
              runtime.failedRepaths++;
              if (runtime.failedRepaths >= 3) {
                beginReturn(runtime);
              }
            } else {
              runtime.failedRepaths = 0;
            }
          }
        }
        if (runtime.ai === "chase" && runtime.mover.path.length > 0) {
          intent = { kind: "path" };
        }
      }
    }
  }

  if (runtime.ai === "idle" && now >= runtime.nextWanderAtMs) {
    runtime.nextWanderAtMs = now + 4000 + ctx.rng() * 4000;
    if (ctx.takeAstar()) {
      const point = wanderPoint(ctx, runtime);
      if (point && tileKey(point) !== tileKey(runtime.mover.pos)) {
        const path = findPath(ctx.grid, runtime.mover.pos, point);
        runtime.mover.path = path;
        if (path.length > 0) {
          intent = { kind: "path" };
        }
      }
    }
  }

  if (runtime.ai === "return") {
    if (distanceSq(runtime.mover.pos, runtime.home) <= HOME_ARRIVAL_SQ) {
      runtime.mover.pos.x = runtime.home.x;
      runtime.mover.pos.y = runtime.home.y;
      runtime.mover.path = [];
      runtime.hp = runtime.maxHp;
      state.hp = runtime.maxHp;
      runtime.ai = "idle";
      runtime.targetSessionId = null;
      runtime.failedRepaths = 0;
      runtime.lastTargetTileKey = null;
      runtime.nextWanderAtMs = now + 4000;
      arrivedHome = true;
    } else {
      if (runtime.mover.path.length === 0 && now >= runtime.nextRepathAtMs) {
        runtime.nextRepathAtMs = now + REPATH_BUDGET_RETRY_MS;
        if (ctx.takeAstar()) {
          runtime.mover.path = findPath(ctx.grid, runtime.mover.pos, runtime.home);
        }
      }
      if (runtime.mover.path.length > 0) {
        intent = { kind: "path" };
      }
    }
  }

  runtime.mover = stepMover(runtime.mover, intent, ctx.grid, TICK_MS, spec.moveSpeed);
  syncMonsterState(state, runtime, from, faceToward);

  return { attackTargetId, arrivedHome: arrivedHome || undefined };
}

/** Exposed for spawn/combat code and tests: force a monster to chase a player. */
export function aggroMonster(runtime: MonsterRuntime, sessionId: string): void {
  if (runtime.ai === "return") {
    return; // returning monsters are invulnerable and ignore damage aggro
  }
  enterChase(runtime, sessionId, 0);
}

/** Exposed for tests/debug: current AI state. */
export function monsterAiState(runtime: MonsterRuntime): MonsterAiState {
  return runtime.ai;
}

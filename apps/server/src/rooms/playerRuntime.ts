import {
  createMover,
  type Dir8,
  type InputMessage,
  type MoveIntent,
  type MoverState,
  type Vec2,
} from "@jadethrone/shared";
import type { PlayerProgression } from "../characters/progression";

/**
 * Server-private per-player state. Never synchronized; the schema state is
 * derived from `mover.pos` and `progression` after each tick.
 */
export interface PlayerRuntime {
  /** Authenticated account/character this session belongs to. */
  accountId: string;
  characterId: string;
  /** Account token generation captured at authentication. */
  tokenVersion: number;
  mover: MoverState;
  /**
   * Authoritative HP/MP/XP/stats. Public HP/MP are mirrored into PlayerState;
   * XP and stat points are sent only to the owner.
   */
  progression: PlayerProgression;
  /** Inputs received since the last tick, applied in seq order. */
  pending: InputMessage[];
  /** Highest applied input sequence. */
  lastSeq: number;
  /** Intent used to keep following a click-to-move path between inputs. */
  lastIntent: MoveIntent;
  /** Epoch ms before which chat is rate-limited. */
  chatReadyAtMs: number;
  /** A warp is in flight; skip movement/warp checks. */
  warping: boolean;
  /** Arrival guard so a warp cannot immediately bounce back. */
  warpCooldownUntilMs: number;
  /** Ticks left to keep applying the last direction after input stops. */
  graceTicksRemaining: number;
  /** Last click-to-move target tile, used to reject rapid retargets. */
  lastPathTargetKey: string | null;
  /** Last time a new path target was accepted (rate limit). */
  lastPathRetargetAtMs: number;
  /** Recent A* failures keyed by goal tile, so hostile spam cannot repeat them. */
  failedPathUntilMs: Map<string, number>;
  /** Number of A* runs performed (debug/test counter). */
  pathComputations: number;
  /** Inputs dropped because the pending queue was full (debug/test counter). */
  droppedInputs: number;
  /** True when authoritative state has changed since the last save. */
  dirty: boolean;
  /** Serialized save chain so autosave/kick/leave/warp writes cannot reorder. */
  saveChain: Promise<unknown> | null;

  /** Basic-attack cooldown gate. */
  attackReadyAtMs: number;
  /** Attack requested by the client, resolved once on the next tick. */
  pendingAttack: { dir: Dir8 | null } | null;
  /** Last damage dealt or taken; drives in-combat regen. */
  lastCombatAtMs: number;
  /** Accumulator for the 3 s regen interval. */
  regenAccumMs: number;
  /** PvE death state: no movement, no attacks, ignored by monsters. */
  dead: boolean;
  diedAtMs: number;
  /** Respawn choice queued by the client, resolved on the next tick. */
  pendingRespawn: "here" | "town" | null;
  /** Monster this player clicked and is walking to / auto-attacking. */
  targetMonsterId: string | null;
  /** Epoch ms before the next auto-walk repath. */
  nextChaseRepathAtMs: number;
  /** Best squared distance to the current chase target. */
  bestTargetDistSq: number;
  /** Epoch ms when the current best distance was recorded (give-up timer). */
  noProgressSinceMs: number;
  /** Consecutive empty auto-walk paths. */
  emptyChasePaths: number;
}

export interface PlayerIdentity {
  accountId: string;
  characterId: string;
  tokenVersion: number;
  progression?: PlayerProgression;
}

const FALLBACK_PROGRESSION: PlayerProgression = {
  hp: 1,
  maxHp: 1,
  mp: 0,
  maxMp: 0,
  level: 1,
  xp: 0,
  stats: { vit: 0, int: 0, str: 0, dex: 0 },
  statPoints: 0,
};

export function createPlayerRuntime(spawn: Vec2, identity: PlayerIdentity): PlayerRuntime {
  const now = Date.now();
  return {
    accountId: identity.accountId,
    characterId: identity.characterId,
    tokenVersion: identity.tokenVersion,
    mover: createMover(spawn),
    progression: identity.progression ?? {
      ...FALLBACK_PROGRESSION,
      stats: { ...FALLBACK_PROGRESSION.stats },
    },
    pending: [],
    lastSeq: 0,
    lastIntent: { kind: "none" },
    chatReadyAtMs: 0,
    warping: false,
    warpCooldownUntilMs: 0,
    graceTicksRemaining: 0,
    lastPathTargetKey: null,
    lastPathRetargetAtMs: 0,
    failedPathUntilMs: new Map(),
    pathComputations: 0,
    droppedInputs: 0,
    dirty: false,
    saveChain: null,
    attackReadyAtMs: 0,
    pendingAttack: null,
    lastCombatAtMs: 0,
    regenAccumMs: 0,
    dead: false,
    diedAtMs: 0,
    pendingRespawn: null,
    targetMonsterId: null,
    nextChaseRepathAtMs: now,
    bestTargetDistSq: Number.POSITIVE_INFINITY,
    noProgressSinceMs: 0,
    emptyChasePaths: 0,
  };
}

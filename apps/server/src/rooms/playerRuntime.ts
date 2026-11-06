import {
  createMover,
  type InputMessage,
  type MoveIntent,
  type MoverState,
  type Vec2,
} from "@jadethrone/shared";

/**
 * Server-private per-player state. Never synchronized; the schema state is
 * derived from `mover.pos` after each tick.
 */
export interface PlayerRuntime {
  /** Authenticated account/character this session belongs to. */
  accountId: string;
  characterId: string;
  /** Account token generation captured at authentication. */
  tokenVersion: number;
  mover: MoverState;
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
  /** True when the authoritative position has changed since the last save. */
  dirty: boolean;
  /** Serialized save chain so autosave/kick/leave/warp writes cannot reorder. */
  saveChain: Promise<unknown> | null;
}

export interface PlayerIdentity {
  accountId: string;
  characterId: string;
  tokenVersion: number;
}

export function createPlayerRuntime(spawn: Vec2, identity: PlayerIdentity): PlayerRuntime {
  return {
    accountId: identity.accountId,
    characterId: identity.characterId,
    tokenVersion: identity.tokenVersion,
    mover: createMover(spawn),
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
  };
}

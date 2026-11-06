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
}

export function createPlayerRuntime(spawn: Vec2): PlayerRuntime {
  return {
    mover: createMover(spawn),
    pending: [],
    lastSeq: 0,
    lastIntent: { kind: "none" },
    chatReadyAtMs: 0,
    warping: false,
    warpCooldownUntilMs: 0,
  };
}

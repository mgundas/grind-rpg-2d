import {
  ERROR_SMOOTH_MS,
  INPUT_HISTORY_SIZE,
  MAX_FRAME_DELTA_MS,
  SNAP_THRESHOLD_PX,
  TICK_MS,
  createMover,
  findPath,
  stepMover,
  type CollisionGrid,
  type Dir8,
  type InputMessage,
  type MoverState,
  type Vec2,
} from "@jadethrone/shared";

/** What the player is asking for this render frame. */
export type DesiredInput =
  { kind: "dir"; dir: Dir8 } | { kind: "path"; x: number; y: number } | { kind: "none" };

interface HistoryEntry {
  seq: number;
  intent: DesiredInput;
}

export interface ReconcileResult {
  snapped: boolean;
  errorPx: number;
}

/**
 * Own-character prediction (GAME_DESIGN.md §5.1).
 *
 * The client runs the same deterministic `stepMover`/`findPath` as the server
 * at a fixed 20 Hz and sends every effectful intent with a sequence number.
 * Each patch carries the authoritative `(x, y, lastSeq)`; reconciliation
 * replays the still-unacknowledged intents from that position, then either
 * snaps (>64 px) or keeps the current visual position and decays the offset
 * over 100 ms.
 */
export class LocalPredictor {
  private mover: MoverState;
  private history: HistoryEntry[] = [];
  private seq = 0;
  private lastAck = 0;
  private accumulatorMs = 0;
  private visualOffset: Vec2 = { x: 0, y: 0 };
  private correctionMs = 0;
  private snapCount = 0;
  private lastSentKind: DesiredInput["kind"] | null = null;

  constructor(
    private readonly grid: CollisionGrid,
    spawn: Vec2,
    private readonly send: (message: InputMessage) => void,
  ) {
    this.mover = createMover(spawn);
  }

  /** Authoritative local simulation position. */
  get position(): Vec2 {
    return { x: this.mover.pos.x, y: this.mover.pos.y };
  }

  /** Position to render (simulation + decaying correction offset). */
  get visualPosition(): Vec2 {
    return {
      x: this.mover.pos.x + this.visualOffset.x,
      y: this.mover.pos.y + this.visualOffset.y,
    };
  }

  get pendingInputs(): number {
    return this.history.length;
  }

  get ackSeq(): number {
    return this.lastAck;
  }

  get snaps(): number {
    return this.snapCount;
  }

  /** True while a click-to-move path still has waypoints. */
  get isFollowingPath(): boolean {
    return this.mover.path.length > 0;
  }

  /**
   * Advance by one render frame. Runs the fixed 20 Hz accumulator and decays
   * any visual correction offset.
   */
  update(deltaMs: number, input: DesiredInput): void {
    const delta = Math.max(0, deltaMs);
    this.accumulatorMs = Math.min(this.accumulatorMs + delta, MAX_FRAME_DELTA_MS);
    while (this.accumulatorMs >= TICK_MS) {
      this.accumulatorMs -= TICK_MS;
      this.tick(input);
    }

    if (this.correctionMs > 0) {
      const factor = Math.min(1, delta / this.correctionMs);
      this.visualOffset.x *= 1 - factor;
      this.visualOffset.y *= 1 - factor;
      this.correctionMs = Math.max(0, this.correctionMs - delta);
      if (this.correctionMs === 0) {
        this.visualOffset = { x: 0, y: 0 };
      }
    }
  }

  /** Apply an authoritative patch. Safe to call for repeated seqs. */
  reconcile(serverX: number, serverY: number, ackSeq: number): ReconcileResult {
    if (ackSeq <= this.lastAck) {
      return { snapped: false, errorPx: 0 };
    }
    const previousVisual = this.visualPosition;
    this.lastAck = ackSeq;
    this.history = this.history.filter((entry) => entry.seq > ackSeq);

    let mover = createMover({ x: serverX, y: serverY });
    for (const entry of this.history) {
      mover = this.applyIntent(mover, entry.intent);
    }
    this.mover = mover;

    const dx = previousVisual.x - mover.pos.x;
    const dy = previousVisual.y - mover.pos.y;
    const errorPx = Math.hypot(dx, dy);
    if (errorPx > SNAP_THRESHOLD_PX) {
      this.visualOffset = { x: 0, y: 0 };
      this.correctionMs = 0;
      this.snapCount++;
      return { snapped: true, errorPx };
    }
    // Keep the sprite where it is and let the offset decay over 100 ms.
    this.visualOffset = { x: dx, y: dy };
    this.correctionMs = ERROR_SMOOTH_MS;
    return { snapped: false, errorPx };
  }

  private tick(input: DesiredInput): void {
    // `none` is sent once on the transition to idle; the server then stops
    // after its grace ticks. Everything effectful is sent and recorded.
    const shouldSend = input.kind !== "none" || this.lastSentKind !== "none";
    if (shouldSend) {
      this.seq++;
      this.send(this.toMessage(this.seq, input));
      this.history.push({ seq: this.seq, intent: input });
      if (this.history.length > INPUT_HISTORY_SIZE) {
        this.history.shift();
      }
      this.lastSentKind = input.kind;
    }
    this.mover = this.applyIntent(this.mover, input);
  }

  private applyIntent(mover: MoverState, intent: DesiredInput): MoverState {
    switch (intent.kind) {
      case "dir":
        return stepMover(
          { pos: mover.pos, path: [] },
          { kind: "dir", dir: intent.dir },
          this.grid,
          TICK_MS,
        );
      case "path": {
        // Recompute from the current position every tick so replay from any
        // acknowledged position is identical to what the server does.
        const path = findPath(this.grid, mover.pos, { x: intent.x, y: intent.y });
        return stepMover({ pos: mover.pos, path }, { kind: "path" }, this.grid, TICK_MS);
      }
      case "none":
        return stepMover({ pos: mover.pos, path: [] }, { kind: "none" }, this.grid, TICK_MS);
    }
  }

  private toMessage(seq: number, intent: DesiredInput): InputMessage {
    switch (intent.kind) {
      case "dir":
        return { seq, kind: "dir", dir: intent.dir };
      case "path":
        return { seq, kind: "path", x: intent.x, y: intent.y };
      case "none":
        return { seq, kind: "none" };
    }
  }
}

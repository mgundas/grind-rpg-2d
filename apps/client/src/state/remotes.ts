import { REMOTE_INTERP_DELAY_MS, TELEPORT_THRESHOLD_PX, type Vec2 } from "@jadethrone/shared";

/**
 * Buffered interpolation for remote players (GAME_DESIGN.md §5.1): samples are
 * timestamped on receipt and rendered ~100 ms in the past. No extrapolation —
 * before the first sample the first position is held, after the last the last
 * position is held.
 */

interface Sample {
  t: number;
  x: number;
  y: number;
}

export class SampleBuffer {
  private samples: Sample[] = [];

  constructor(private readonly capacity = 32) {}

  get size(): number {
    return this.samples.length;
  }

  push(t: number, x: number, y: number): void {
    const last = this.samples[this.samples.length - 1];
    if (last) {
      if (t < last.t) {
        return; // out-of-order receipt
      }
      const dx = x - last.x;
      const dy = y - last.y;
      if (dx * dx + dy * dy > TELEPORT_THRESHOLD_PX * TELEPORT_THRESHOLD_PX) {
        this.samples = [{ t, x, y }]; // discontinuity: drop history, snap to the new point
        return;
      }
      if (t === last.t) {
        // Patches can arrive in a burst within one render frame; keep the
        // latest authoritative position for that instant instead of dropping
        // everything after the first one.
        last.x = x;
        last.y = y;
        return;
      }
    }
    this.samples.push({ t, x, y });
    if (this.samples.length > this.capacity) {
      this.samples.shift();
    }
  }

  /** Interpolated position at time `t`, or null while the buffer is empty. */
  sample(t: number): Vec2 | null {
    if (this.samples.length === 0) {
      return null;
    }
    const first = this.samples[0]!;
    if (t <= first.t) {
      return { x: first.x, y: first.y };
    }
    const last = this.samples[this.samples.length - 1]!;
    if (t >= last.t) {
      return { x: last.x, y: last.y };
    }

    let low = 0;
    let high = this.samples.length - 1;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (this.samples[middle]!.t <= t) {
        low = middle;
      } else {
        high = middle;
      }
    }
    const a = this.samples[low]!;
    const b = this.samples[high]!;
    const factor = (t - a.t) / (b.t - a.t);
    return { x: a.x + (b.x - a.x) * factor, y: a.y + (b.y - a.y) * factor };
  }
}

export interface RemotePlayerData {
  name: string;
  kingdom: string;
  facing: number;
  x: number;
  y: number;
}

export interface RemoteEntity {
  sessionId: string;
  name: string;
  kingdom: string;
  facing: number;
  buffer: SampleBuffer;
}

/** Data-side registry of visible remote players (the scene owns sprites). */
export class RemoteRegistry {
  readonly entities = new Map<string, RemoteEntity>();

  /** Sync with the current StateView-filtered player map; returns removals. */
  sync(
    players: Record<string, RemotePlayerData>,
    ownSessionId: string,
    now: number,
  ): { removed: string[] } {
    const seen = new Set<string>();
    for (const [sessionId, player] of Object.entries(players)) {
      if (sessionId === ownSessionId) {
        continue;
      }
      seen.add(sessionId);
      let entity = this.entities.get(sessionId);
      if (!entity) {
        entity = {
          sessionId,
          name: player.name,
          kingdom: player.kingdom,
          facing: player.facing,
          buffer: new SampleBuffer(),
        };
        this.entities.set(sessionId, entity);
      }
      entity.name = player.name;
      entity.kingdom = player.kingdom;
      entity.facing = player.facing;
      entity.buffer.push(now, player.x, player.y);
    }

    const removed: string[] = [];
    for (const sessionId of this.entities.keys()) {
      if (!seen.has(sessionId)) {
        removed.push(sessionId);
      }
    }
    for (const sessionId of removed) {
      this.entities.delete(sessionId);
    }
    return { removed };
  }

  /** Render-time position for an entity, 100 ms in the past. */
  renderPosition(entity: RemoteEntity, now: number): Vec2 | null {
    return entity.buffer.sample(now - REMOTE_INTERP_DELAY_MS);
  }
}

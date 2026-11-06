import { type Client, Room } from "@colyseus/core";
import { StateView } from "@colyseus/schema";
import { z } from "zod";
import {
  CHAT_COOLDOWN_MS,
  INTEREST_ADD_RADIUS_PX,
  INTEREST_INTERVAL_MS,
  INTEREST_RADIUS_PX,
  MAX_MESSAGES_PER_SECOND,
  MAX_PLAYERS_PER_CHANNEL,
  MSG,
  SERVER_TICK_GRACE_TICKS,
  TICK_MS,
  chatMessageSchema,
  chatRecipients,
  facing4FromDelta,
  facing4FromIndex,
  facing4Index,
  findPath,
  inputMessageSchema,
  isWalkableAt,
  nearestWalkable,
  stepMover,
  type ChatMsgPayload,
  type Dir8,
  type InputMessage,
  type MapId,
  type Vec2,
} from "@jadethrone/shared";
import { logger } from "../logger";
import { isMapId, loadMapAssets, type MapAssets } from "../maps/mapRegistry";
import { createPlayerRuntime, type PlayerRuntime } from "./playerRuntime";
import { PlayerState, WorldState } from "./state/WorldState";

const KINGDOM_IDS = ["ember", "gale", "tide"] as const;

/** Client-controlled join options are validated with Zod, never trusted. */
const joinOptionsSchema = z.looseObject({
  name: z.string().optional().catch(undefined),
  kingdom: z.enum(KINGDOM_IDS).optional().catch(undefined),
  /** Only honored for server-issued warp reservations; clamped + walkable-checked. */
  x: z.number().finite().optional().catch(undefined),
  y: z.number().finite().optional().catch(undefined),
});

/** Max queued input messages per player; older inputs are dropped. */
const MAX_PENDING_INPUTS = 8;

/**
 * One room instance per map (GAME_DESIGN.md §10.2). Phase 1 handles guest
 * join, movement, chat (task 9), interest management (task 10) and warps.
 */
export class MapRoom extends Room {
  maxClients = MAX_PLAYERS_PER_CHANNEL;
  maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND;
  patchRate = 50;

  state = new WorldState();

  private mapId!: MapId;
  private assets!: MapAssets;
  private runtimes = new Map<string, PlayerRuntime>();

  onCreate(): void {
    if (!isMapId(this.roomName)) {
      throw new Error(`unknown map room "${this.roomName}"`);
    }
    this.mapId = this.roomName;
    this.assets = loadMapAssets(this.mapId);

    this.onMessage(MSG.input, (client, raw) => {
      const parsed = inputMessageSchema.safeParse(raw);
      if (!parsed.success) {
        // A malformed message from a buggy/hostile client is dropped, not a
        // reason to disconnect a legitimate session.
        logger.warn(
          { session: client.sessionId, issues: parsed.error.issues.map((issue) => issue.message) },
          "dropped invalid input message",
        );
        return;
      }
      const runtime = this.runtimes.get(client.sessionId);
      if (!runtime) {
        return;
      }
      if (runtime.pending.length >= MAX_PENDING_INPUTS) {
        runtime.pending.shift();
      }
      runtime.pending.push(parsed.data);
    });

    this.onMessage(MSG.chat, (client, raw) => {
      const parsed = chatMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid chat message");
        return;
      }
      const runtime = this.runtimes.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      if (!runtime || !player) {
        return;
      }
      const now = Date.now();
      if (now < runtime.chatReadyAtMs) {
        return;
      }
      runtime.chatReadyAtMs = now + CHAT_COOLDOWN_MS;

      const participants = [...this.state.players.entries()].map(([sessionId, other]) => ({
        sessionId,
        x: other.x,
        y: other.y,
      }));
      const recipients = chatRecipients(participants, {
        sessionId: client.sessionId,
        x: player.x,
        y: player.y,
      });
      const payload: ChatMsgPayload = {
        from: client.sessionId,
        name: player.name,
        kingdom: player.kingdom,
        text: parsed.data.text,
      };
      for (const otherClient of this.clients) {
        if (recipients.includes(otherClient.sessionId)) {
          otherClient.send(MSG.chatMsg, payload);
        }
      }
    });

    this.setSimulationInterval(() => this.tick(), TICK_MS);
    // Interest management runs at 4 Hz, not every tick (GAME_DESIGN.md §5.1).
    this.clock.setInterval(() => this.updateInterest(), INTEREST_INTERVAL_MS);
    logger.info({ roomId: this.roomId, mapId: this.mapId }, "map room created");
  }

  onJoin(client: Client, options: unknown): void {
    const parsed = joinOptionsSchema.safeParse(options ?? {});
    const join = parsed.success ? parsed.data : {};
    const spawn = this.resolveSpawn(join.x, join.y);
    const runtime = createPlayerRuntime(spawn);

    const player = new PlayerState();
    player.name = sanitizeDisplayName(join.name);
    player.kingdom = join.kingdom ?? "ember";
    player.x = runtime.mover.pos.x;
    player.y = runtime.mover.pos.y;
    player.facing = facing4Index("down");
    player.moving = false;
    player.lastSeq = 0;
    this.state.players.set(client.sessionId, player);
    this.runtimes.set(client.sessionId, runtime);

    client.view = new StateView();
    // Immediate pass so joiners see everyone relevant without waiting for the
    // next 250 ms interval. Hysteresis inside updateInterest() prevents
    // boundary flicker.
    this.updateInterest();

    logger.info(
      { roomId: this.roomId, mapId: this.mapId, session: client.sessionId, name: player.name },
      "player joined",
    );
  }

  onLeave(client: Client, code: number): void {
    this.state.players.delete(client.sessionId);
    this.runtimes.delete(client.sessionId);
    logger.info({ roomId: this.roomId, session: client.sessionId, closeCode: code }, "player left");
  }

  /**
   * StateView interest management: a player is added to a client's view inside
   * INTEREST_ADD_RADIUS_PX and removed beyond INTEREST_RADIUS_PX. The gap is
   * hysteresis; the own player is always visible.
   */
  private updateInterest(): void {
    const addSquared = INTEREST_ADD_RADIUS_PX * INTEREST_ADD_RADIUS_PX;
    const removeSquared = INTEREST_RADIUS_PX * INTEREST_RADIUS_PX;

    for (const client of this.clients) {
      const view = client.view;
      const own = this.state.players.get(client.sessionId);
      if (!view || !own) {
        continue;
      }
      for (const [sessionId, player] of this.state.players) {
        if (sessionId === client.sessionId) {
          if (!view.has(player)) {
            view.add(player);
          }
          continue;
        }
        const dx = player.x - own.x;
        const dy = player.y - own.y;
        const distanceSquared = dx * dx + dy * dy;
        const visible = view.has(player);
        if (!visible && distanceSquared <= addSquared) {
          view.add(player);
        } else if (visible && distanceSquared > removeSquared) {
          view.remove(player);
        }
      }
    }
  }

  /**
   * Fixed 20 Hz step, in the GAME_DESIGN order `input -> movement -> ...`.
   * Each queued intent advances exactly one tick, so delayed input still
   * covers the same distance; path intents keep walking without new input.
   */
  private tick(): void {
    for (const client of this.clients) {
      const runtime = this.runtimes.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      if (!runtime || !player) {
        continue;
      }
      this.stepPlayer(runtime, player);
    }
  }

  private stepPlayer(runtime: PlayerRuntime, player: PlayerState): void {
    const from = { x: runtime.mover.pos.x, y: runtime.mover.pos.y };
    let applied = 0;

    if (runtime.pending.length > 0) {
      const queued = runtime.pending.sort((a, b) => a.seq - b.seq);
      runtime.pending = [];
      for (const message of queued) {
        if (message.seq <= runtime.lastSeq) {
          continue; // stale or duplicated input
        }
        runtime.lastSeq = message.seq;
        this.applyMessage(runtime, message);
        applied++;
      }
    }

    if (applied === 0) {
      if (runtime.lastIntent.kind === "path" && runtime.mover.path.length > 0) {
        runtime.mover = stepMover(runtime.mover, runtime.lastIntent, this.assets.grid, TICK_MS);
      } else if (runtime.ticksSinceInput < SERVER_TICK_GRACE_TICKS) {
        runtime.ticksSinceInput++;
        runtime.mover = stepMover(runtime.mover, runtime.lastIntent, this.assets.grid, TICK_MS);
      } else if (runtime.mover.path.length > 0) {
        runtime.mover = { ...runtime.mover, path: [] };
      }
    }

    const to = runtime.mover.pos;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const moved = dx !== 0 || dy !== 0;

    if (moved) {
      player.x = to.x;
      player.y = to.y;
      player.facing = facing4Index(facing4FromDelta(dx, dy, facing4FromIndex(player.facing)));
      player.moving = true;
    } else if (player.moving) {
      player.moving = false;
    }
    if (player.lastSeq !== runtime.lastSeq) {
      player.lastSeq = runtime.lastSeq;
    }
  }

  /** Convert a validated intent into mover state and step it once. */
  private applyMessage(runtime: PlayerRuntime, message: InputMessage): void {
    switch (message.kind) {
      case "dir":
        runtime.mover.path = [];
        runtime.lastIntent = { kind: "dir", dir: message.dir as Dir8 };
        runtime.lastPathTarget = null;
        break;
      case "path": {
        const target = { x: message.x, y: message.y };
        const previous = runtime.lastPathTarget;
        const sameTarget =
          previous !== null &&
          Math.abs(previous.x - target.x) < 2 &&
          Math.abs(previous.y - target.y) < 2;
        if (!sameTarget) {
          runtime.mover.path = findPath(this.assets.grid, runtime.mover.pos, target);
          runtime.lastPathTarget = target;
        }
        runtime.lastIntent = { kind: "path" };
        break;
      }
      case "none":
        runtime.mover.path = [];
        runtime.lastIntent = { kind: "none" };
        runtime.lastPathTarget = null;
        break;
    }
    runtime.mover = stepMover(runtime.mover, runtime.lastIntent, this.assets.grid, TICK_MS);
    runtime.ticksSinceInput = 0;
  }

  /** Reservation position when valid, otherwise the map spawn; always walkable. */
  private resolveSpawn(x: number | undefined, y: number | undefined): Vec2 {
    const requested = {
      x: Math.min(Math.max(x ?? this.assets.spawn.x, 0), this.assets.widthPx),
      y: Math.min(Math.max(y ?? this.assets.spawn.y, 0), this.assets.heightPx),
    };
    if (isWalkableAt(this.assets.grid, requested.x, requested.y)) {
      return requested;
    }
    return nearestWalkable(this.assets.grid, requested.x, requested.y, 10) ?? this.assets.spawn;
  }
}

/**
 * The server is authoritative from day one: names from clients are sanitized
 * before entering state. Full character-creation rules (3-16 chars, letters
 * and numbers, uniqueness) arrive in Phase 2.
 */
function sanitizeDisplayName(value: unknown): string {
  if (typeof value !== "string") {
    return "Guest";
  }
  const cleaned = value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .trim()
    .slice(0, 16);
  return cleaned.length >= 3 ? cleaned : "Guest";
}

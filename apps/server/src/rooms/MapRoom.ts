import { matchMaker, type Client, Room } from "@colyseus/core";
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
  PATH_RETARGET_MIN_MS,
  SERVER_TICK_GRACE_TICKS,
  TICK_MS,
  TILE_SIZE,
  WARP_COOLDOWN_MS,
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
  type WarpPayload,
  type WarpZone,
} from "@jadethrone/shared";
import { logger } from "../logger";
import { isMapId, loadMapAssets, type MapAssets } from "../maps/mapRegistry";
import { createPlayerRuntime, type PlayerRuntime } from "./playerRuntime";
import { PlayerState, WorldState } from "./state/WorldState";
import { consumeWarpToken, issueWarpToken } from "./warpTokens";

const KINGDOM_IDS = ["ember", "gale", "tide"] as const;

/** Client-controlled join options are validated with Zod, never trusted. */
const joinOptionsSchema = z.looseObject({
  name: z.string().optional().catch(undefined),
  kingdom: z.enum(KINGDOM_IDS).optional().catch(undefined),
  /** Single-use token issued by the server for a warp; proves the spawn. */
  warpToken: z.string().optional().catch(undefined),
});

/** Max queued input messages per player; older inputs are dropped. */
const MAX_PENDING_INPUTS = 8;

/** Unreachable path targets are not retried before this delay. */
const PATH_FAILURE_CACHE_MS = 1000;

/** A client that never leaves after a warp is disconnected after this delay. */
const WARP_CLIENT_LEAVE_TIMEOUT_MS = 2000;

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
        runtime.droppedInputs++;
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
    const warpSpawn = join.warpToken ? consumeWarpToken(join.warpToken, this.mapId) : null;
    const spawn = this.resolveSpawn(warpSpawn?.x, warpSpawn?.y);
    const runtime = createPlayerRuntime(spawn);
    if (warpSpawn) {
      runtime.warpCooldownUntilMs = Date.now() + WARP_COOLDOWN_MS;
    }

    const player = new PlayerState();
    player.name = sanitizeDisplayName(join.name);
    player.kingdom = join.kingdom ?? "ember";
    player.x = runtime.mover.pos.x;
    player.y = runtime.mover.pos.y;
    player.facing = facing4Index("down");
    player.moving = false;
    player.lastSeq = 0;
    // The view must exist before the player is added, so the very first
    // encoded state is already filtered for this client.
    client.view = new StateView();
    this.state.players.set(client.sessionId, player);
    this.runtimes.set(client.sessionId, runtime);

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
    this.checkWarps();
  }

  /** Trigger any warp zone the player is standing on (after movement). */
  private checkWarps(): void {
    const now = Date.now();
    for (const client of [...this.clients]) {
      const runtime = this.runtimes.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      if (!runtime || !player || runtime.warping || now < runtime.warpCooldownUntilMs) {
        continue;
      }
      const warp = this.assets.warps.find(
        (zone) =>
          player.x >= zone.x &&
          player.x <= zone.x + zone.w &&
          player.y >= zone.y &&
          player.y <= zone.y + zone.h,
      );
      if (warp) {
        void this.startWarp(client, warp);
      }
    }
  }

  /**
   * Reserve a seat in the target map room, send it to the client, and remove
   * the player from this room. The client leaves and consumes the reservation
   * (Phase 1 has no character persistence, so name/kingdom/position travel in
   * the join options).
   */
  private async startWarp(client: Client, warp: WarpZone): Promise<void> {
    const runtime = this.runtimes.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!runtime || !player) {
      return;
    }
    runtime.warping = true;
    const name = player.name;
    const kingdom = player.kingdom;
    this.state.players.delete(client.sessionId);
    this.runtimes.delete(client.sessionId);

    try {
      const token = issueWarpToken(warp.targetMap, warp.targetX, warp.targetY);
      const reservation = await this.reserveSeat(warp.targetMap, {
        name,
        kingdom,
        warpToken: token,
      });
      if (!this.clients.some((candidate) => candidate.sessionId === client.sessionId)) {
        // Client left during the reservation; its seat expires on its own.
        return;
      }
      const payload: WarpPayload = {
        map: warp.targetMap,
        x: warp.targetX,
        y: warp.targetY,
        reservation,
      };
      client.send(MSG.warp, payload);

      // A client that ignores the warp message must not keep occupying a seat
      // here (and holding a target-room reservation) forever.
      const leaveTimer = setTimeout(() => {
        if (this.clients.some((candidate) => candidate.sessionId === client.sessionId)) {
          logger.warn(
            { roomId: this.roomId, session: client.sessionId },
            "client did not leave after warp; disconnecting",
          );
          client.leave(4000);
        }
      }, WARP_CLIENT_LEAVE_TIMEOUT_MS);
      leaveTimer.unref?.();

      logger.info(
        {
          roomId: this.roomId,
          session: client.sessionId,
          from: this.mapId,
          to: warp.targetMap,
        },
        "player warped",
      );
    } catch (error) {
      // Restore the player only if the client is still connected here.
      if (this.clients.some((candidate) => candidate.sessionId === client.sessionId)) {
        runtime.warping = false;
        // Do not retry every tick while the warp zone still overlaps: without
        // this cooldown a persistent matchmaker failure would issue a token
        // and run a full reservation attempt 20 times per second.
        runtime.warpCooldownUntilMs = Date.now() + WARP_COOLDOWN_MS;
        this.state.players.set(client.sessionId, player);
        this.runtimes.set(client.sessionId, runtime);
        this.updateInterest();
      }
      logger.error({ roomId: this.roomId, session: client.sessionId, error }, "warp failed");
    }
  }

  /**
   * Overridable seam so tests can exercise matchmaker failures without
   * replacing the ESM namespace (which is not configurable).
   */
  reserveSeat(
    map: MapId,
    options: { name: string; kingdom: string; warpToken: string },
  ): ReturnType<typeof matchMaker.joinOrCreate> {
    return matchMaker.joinOrCreate(map, options);
  }

  private stepPlayer(runtime: PlayerRuntime, player: PlayerState): void {
    const from = { x: runtime.mover.pos.x, y: runtime.mover.pos.y };
    let applied = false;

    // Apply at most ONE intent per tick. Bursty clients therefore cannot move
    // faster than 20 steps/s; excess inputs stay queued for later ticks.
    while (runtime.pending.length > 0) {
      const message = runtime.pending.shift()!;
      if (message.seq <= runtime.lastSeq) {
        continue; // stale or duplicated input
      }
      runtime.lastSeq = message.seq;
      this.applyMessage(runtime, message);
      applied = true;
      break;
    }

    if (!applied) {
      if (runtime.lastIntent.kind === "path" && runtime.mover.path.length > 0) {
        // Click-to-move keeps following its path (speed-bounded by movement).
        runtime.mover = stepMover(runtime.mover, runtime.lastIntent, this.assets.grid, TICK_MS);
      } else if (runtime.lastIntent.kind === "dir" && runtime.graceTicksRemaining > 0) {
        // Packet loss must not stop the character mid-step: keep the last
        // direction for a few ticks. An explicit `none` clears the grace and
        // stops immediately.
        runtime.graceTicksRemaining--;
        runtime.mover = stepMover(runtime.mover, runtime.lastIntent, this.assets.grid, TICK_MS);
      } else {
        runtime.mover = stepMover(runtime.mover, { kind: "none" }, this.assets.grid, TICK_MS);
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
        runtime.graceTicksRemaining = SERVER_TICK_GRACE_TICKS;
        runtime.lastIntent = { kind: "dir", dir: message.dir as Dir8 };
        break;
      case "path": {
        // Recompute from the current position every tick: with the same
        // target and grid the client predictor reproduces this exactly during
        // reconciliation, regardless of which input got acknowledged.
        runtime.graceTicksRemaining = 0;
        const target = { x: message.x, y: message.y };
        this.applyPathIntent(runtime, target);
        runtime.lastIntent = { kind: "path" };
        break;
      }
      case "none":
        runtime.mover.path = [];
        runtime.graceTicksRemaining = 0;
        runtime.lastIntent = { kind: "none" };
        break;
    }
    runtime.mover = stepMover(runtime.mover, runtime.lastIntent, this.assets.grid, TICK_MS);
  }

  /**
   * A* is bounded against hostile clients. A repeated unreachable goal is not
   * retried for a second, and a client that changes goal more than
   * PATH_RETARGET_MIN_MS apart keeps following its previous path. Legitimate
   * click-to-move repeats the same goal, so it still recomputes every tick and
   * stays bit-identical with the client predictor.
   */
  private applyPathIntent(runtime: PlayerRuntime, target: Vec2): void {
    const now = Date.now();
    const goalTx = Math.floor(target.x / TILE_SIZE);
    const goalTy = Math.floor(target.y / TILE_SIZE);
    const startTx = Math.floor(runtime.mover.pos.x / TILE_SIZE);
    const startTy = Math.floor(runtime.mover.pos.y / TILE_SIZE);
    const goalKey = `${goalTx},${goalTy}`;
    const failureKey = `${startTx},${startTy}->${goalKey}`;

    const failedUntil = runtime.failedPathUntilMs.get(failureKey);
    if (failedUntil !== undefined) {
      if (failedUntil > now) {
        return; // known unreachable; keep following the current path
      }
      runtime.failedPathUntilMs.delete(failureKey);
    }

    const retargeting = runtime.lastPathTargetKey !== goalKey;
    if (retargeting && now - runtime.lastPathRetargetAtMs < PATH_RETARGET_MIN_MS) {
      return; // retarget flood; keep the previous path
    }

    runtime.lastPathTargetKey = goalKey;
    runtime.lastPathRetargetAtMs = now;
    runtime.pathComputations++;
    const path = findPath(this.assets.grid, runtime.mover.pos, target);
    runtime.mover.path = path;

    const sameTile = startTx === goalTx && startTy === goalTy;
    if (path.length === 0 && !sameTile) {
      runtime.failedPathUntilMs.set(failureKey, now + PATH_FAILURE_CACHE_MS);
    }
    if (runtime.failedPathUntilMs.size > 32) {
      for (const [key, until] of runtime.failedPathUntilMs) {
        if (until <= now) {
          runtime.failedPathUntilMs.delete(key);
        }
      }
    }
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

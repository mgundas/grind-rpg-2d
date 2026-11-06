import { type Client, Room } from "@colyseus/core";
import { StateView } from "@colyseus/schema";
import { z } from "zod";
import {
  MAX_MESSAGES_PER_SECOND,
  MAX_PLAYERS_PER_CHANNEL,
  facing4Index,
  isWalkableAt,
  nearestWalkable,
  type MapId,
  type Vec2,
} from "@jadethrone/shared";
import { logger } from "../logger";
import { isMapId, loadMapAssets, type MapAssets } from "../maps/mapRegistry";
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

/**
 * One room instance per map (GAME_DESIGN.md §10.2). Phase 1 handles guest
 * join, movement (task 8), chat (task 9), interest management (task 10) and
 * warps (task 11).
 */
export class MapRoom extends Room {
  maxClients = MAX_PLAYERS_PER_CHANNEL;
  maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND;
  patchRate = 50;

  state = new WorldState();

  private mapId!: MapId;
  private assets!: MapAssets;

  onCreate(): void {
    if (!isMapId(this.roomName)) {
      throw new Error(`unknown map room "${this.roomName}"`);
    }
    this.mapId = this.roomName;
    this.assets = loadMapAssets(this.mapId);
    logger.info({ roomId: this.roomId, mapId: this.mapId }, "map room created");
  }

  onJoin(client: Client, options: unknown): void {
    const parsed = joinOptionsSchema.safeParse(options ?? {});
    const join = parsed.success ? parsed.data : {};
    const spawn = this.resolveSpawn(join.x, join.y);

    const player = new PlayerState();
    player.name = sanitizeDisplayName(join.name);
    player.kingdom = join.kingdom ?? "ember";
    player.x = spawn.x;
    player.y = spawn.y;
    player.facing = facing4Index("down");
    player.moving = false;
    player.lastSeq = 0;
    this.state.players.set(client.sessionId, player);

    client.view = new StateView();
    // Interim (task 10 narrows this to the interest radius): everyone sees
    // everyone. The new client sees all existing players, and existing
    // clients add the new player to their views.
    for (const other of this.state.players.values()) {
      client.view.add(other);
    }
    for (const otherClient of this.clients) {
      if (otherClient.sessionId !== client.sessionId) {
        otherClient.view?.add(player);
      }
    }

    logger.info(
      { roomId: this.roomId, mapId: this.mapId, session: client.sessionId, name: player.name },
      "player joined",
    );
  }

  onLeave(client: Client, code: number): void {
    this.state.players.delete(client.sessionId);
    logger.info({ roomId: this.roomId, session: client.sessionId, closeCode: code }, "player left");
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

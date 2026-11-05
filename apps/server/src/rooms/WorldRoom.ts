import { type Client, Room } from "@colyseus/core";
import {
  KINGDOMS,
  MAX_PLAYERS_PER_CHANNEL,
  MESSAGES_PER_SECOND_LIMIT,
  SPAWN_POINT,
} from "@jadethrone/shared";
import { logger } from "../logger";
import { PlayerState, WorldState } from "./state/WorldState";

/**
 * The Phase 0 placeholder world room. Movement, AI and combat arrive in
 * Phases 1 and 3 — for now it only demonstrates the schema state pipeline.
 */
export class WorldRoom extends Room {
  maxClients = MAX_PLAYERS_PER_CHANNEL;

  /** Per-client message rate limit (GAME_DESIGN.md §10.2). */
  messagesLimit = MESSAGES_PER_SECOND_LIMIT;

  state = new WorldState();

  onCreate(): void {
    logger.info({ roomId: this.roomId }, "world room created");
  }

  onJoin(client: Client, options: unknown): void {
    const joinOptions = (options ?? {}) as { name?: unknown; kingdom?: unknown };
    const player = new PlayerState();
    player.name = sanitizeDisplayName(joinOptions.name);
    player.x = SPAWN_POINT.x;
    player.y = SPAWN_POINT.y;
    player.kingdom = sanitizeKingdom(joinOptions.kingdom);
    this.state.players.set(client.sessionId, player);
    logger.info(
      { roomId: this.roomId, session: client.sessionId, name: player.name },
      "player joined",
    );
  }

  onLeave(client: Client, code: number): void {
    this.state.players.delete(client.sessionId);
    logger.info({ roomId: this.roomId, session: client.sessionId, closeCode: code }, "player left");
  }
}

/**
 * The server is authoritative from day one: names from clients are
 * sanitized before entering state. Character-creation rules (3-16 chars,
 * letters/numbers, uniqueness) are enforced in Phase 2.
 */
function sanitizeDisplayName(value: unknown): string {
  if (typeof value !== "string") {
    return "Guest";
  }
  const trimmed = value.trim().slice(0, 16);
  return trimmed.length >= 3 ? trimmed : "Guest";
}

function sanitizeKingdom(value: unknown): string {
  if (typeof value !== "string") {
    return "ember";
  }
  return KINGDOMS.some((kingdom) => kingdom.id === value) ? value : "ember";
}

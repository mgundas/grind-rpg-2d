import { type Client, Room } from "@colyseus/core";
import { z } from "zod";
import { MAX_MESSAGES_PER_SECOND, MAX_PLAYERS_PER_CHANNEL, SPAWN_POINT } from "@jadethrone/shared";
import { logger } from "../logger";
import { PlayerState, WorldState } from "./state/WorldState";

const KINGDOM_IDS = ["ember", "gale", "tide"] as const;

/** Client-controlled join options are validated with Zod, never trusted. */
const joinOptionsSchema = z.object({
  name: z.string().optional(),
  kingdom: z.enum(KINGDOM_IDS).optional(),
});

/**
 * The Phase 0 placeholder world room. Movement, AI and combat arrive in
 * Phases 1 and 3 — for now it only demonstrates the schema state pipeline.
 */
export class WorldRoom extends Room {
  maxClients = MAX_PLAYERS_PER_CHANNEL;

  /** Per-client message rate limit (GAME_DESIGN.md §10.2). */
  maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND;

  state = new WorldState();

  onCreate(): void {
    logger.info({ roomId: this.roomId }, "world room created");
  }

  onJoin(client: Client, options: unknown): void {
    const joinOptions = joinOptionsSchema.safeParse(options ?? {});
    const name = joinOptions.success ? joinOptions.data.name : undefined;
    const kingdom = joinOptions.success ? joinOptions.data.kingdom : undefined;
    const player = new PlayerState();
    player.name = sanitizeDisplayName(name);
    player.x = SPAWN_POINT.x;
    player.y = SPAWN_POINT.y;
    player.kingdom = sanitizeKingdom(kingdom);
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
  // Strip everything outside letters/numbers/space/_/- after Unicode
  // normalization, so control characters and newlines cannot enter state.
  const cleaned = value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .trim()
    .slice(0, 16);
  return cleaned.length >= 3 ? cleaned : "Guest";
}

function sanitizeKingdom(value: unknown): string {
  return KINGDOM_IDS.find((id) => id === value) ?? "ember";
}

import { CHAT_MAX_LEN, type MapId, type Stats } from "./constants";
import { z } from "zod";

/**
 * Wire protocol shared by server and client. Every client → server message is
 * validated with these schemas (AGENTS.md: Zod on all client input).
 */

export const MSG = {
  input: "input",
  chat: "chat",
  chatMsg: "chatMsg",
  warp: "warp",
  sessionKicked: "sessionKicked",
  attack: "attack",
  setTarget: "setTarget",
  respawn: "respawn",
  allocStat: "allocStat",
  requestStats: "requestStats",
  combat: "combat",
  monsterDied: "monsterDied",
  levelUp: "levelUp",
  death: "death",
  selfStats: "selfStats",
  autoWalk: "autoWalk",
  targetCleared: "targetCleared",
} as const;

/**
 * Application close code used when a session is replaced (Colyseus reserves
 * 4000–4010 for its own close reasons).
 */
export const SESSION_KICK_CODE = 4100;

export type SessionKickReason = "login" | "logout" | "duplicate";

/** Sent just before the socket closes with SESSION_KICK_CODE. */
export interface SessionKickedPayload {
  reason: SessionKickReason;
}

const seqSchema = z.number().int().min(1).max(4_294_967_295);
/** All maps fit in uint16 pixels (largest is 5120 px). */
const pxSchema = z.number().finite().min(0).max(65535);

/**
 * One fixed-tick intent. `dir` keeps moving while the client repeats it,
 * `path` is a click-to-move command the server follows to completion, and
 * `none` stops and clears the path. `seq` is acked back via state.lastSeq.
 */
export const inputMessageSchema = z.discriminatedUnion("kind", [
  z.object({ seq: seqSchema, kind: z.literal("dir"), dir: z.number().int().min(0).max(7) }),
  z.object({ seq: seqSchema, kind: z.literal("path"), x: pxSchema, y: pxSchema }),
  z.object({ seq: seqSchema, kind: z.literal("none") }),
]);

export type InputMessage = z.infer<typeof inputMessageSchema>;

export const chatMessageSchema = z.object({
  text: z.string().trim().min(1).max(CHAT_MAX_LEN),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** Server → client local chat line (also used for bubbles above heads). */
export interface ChatMsgPayload {
  from: string;
  name: string;
  kingdom: string;
  text: string;
}

/** Shape of a Colyseus seat reservation, as passed through the warp message. */
export interface SeatReservationPayload {
  name: string;
  sessionId: string;
  roomId: string;
  publicAddress?: string;
  processId?: string;
  reconnectionToken?: string;
  devMode?: boolean;
}

/** Server → client warp instruction: consume this reservation, then fade in. */
export interface WarpPayload {
  map: MapId;
  x: number;
  y: number;
  reservation: SeatReservationPayload;
}

/** Client → server: swing the basic attack in the current (or supplied) facing. */
export const attackMessageSchema = z.object({
  dir: z.number().int().min(0).max(7).optional(),
});
export type AttackMessage = z.infer<typeof attackMessageSchema>;

/** Client → server: walk to and auto-attack a monster. */
export const setTargetMessageSchema = z.object({
  monsterId: z.string().min(1).max(64),
});
export type SetTargetMessage = z.infer<typeof setTargetMessageSchema>;

/** Client → server: respawn after a PvE death. */
export const respawnMessageSchema = z.object({
  option: z.enum(["here", "town"]),
});
export type RespawnMessage = z.infer<typeof respawnMessageSchema>;
export type RespawnOption = RespawnMessage["option"];

export const STAT_KEYS = ["vit", "int", "str", "dex"] as const;
export type StatKey = (typeof STAT_KEYS)[number];

/** Client → server: spend one stat point. */
export const allocStatMessageSchema = z.object({
  stat: z.enum(STAT_KEYS),
});
export type AllocStatMessage = z.infer<typeof allocStatMessageSchema>;

/** Client → server: ask for a fresh owner-only progression snapshot. */
export const requestStatsMessageSchema = z.object({});
export type RequestStatsMessage = z.infer<typeof requestStatsMessageSchema>;

/** Identifies a combatant in a combat event. */
export type CombatEntityRef =
  { kind: "player"; sessionId: string } | { kind: "monster"; monsterId: string };

export interface CombatHit {
  target: CombatEntityRef;
  /** Authoritative target position at hit time (for damage numbers). */
  x: number;
  y: number;
  miss: boolean;
  crit: boolean;
  damage: number;
}

/** One message per swing; carries every target hit by the same attack. */
export interface CombatEventPayload {
  eventSeq: number;
  attacker: CombatEntityRef;
  hits: CombatHit[];
}

/** Sent when a monster dies; the state entity is removed in the same patch. */
export interface MonsterDiedPayload {
  monsterId: string;
  typeId: string;
  x: number;
  y: number;
  killerSessionId: string | null;
}

export interface LevelUpPayload {
  sessionId: string;
  name: string;
  level: number;
  x: number;
  y: number;
}

/** Owner-only death notice with the earliest allowed "restart here" time. */
export interface DeathPayload {
  respawnHereAtMs: number;
}

/** Owner-only progression snapshot (XP and stats stay off public state). */
export interface SelfStatsPayload {
  level: number;
  xp: number;
  xpToNext: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  statPoints: number;
  stats: Stats;
  attack: number;
  defense: number;
  critChance: number;
}

/** Owner-only switch between local prediction and server-driven auto-walk. */
export interface AutoWalkPayload {
  active: boolean;
  targetMonsterId?: string;
}

export type TargetClearedReason = "unreachable" | "target_lost" | "cancelled";

export interface TargetClearedPayload {
  reason: TargetClearedReason;
}

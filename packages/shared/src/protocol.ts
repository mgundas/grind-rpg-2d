import { CHAT_MAX_LEN, type MapId } from "./constants";
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
} as const;

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

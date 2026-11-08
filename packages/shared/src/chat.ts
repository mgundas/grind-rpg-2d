import { CHAT_RANGE_PX } from "./constants";
import { seededRandomSource } from "./rng";

/** Pure local-chat recipient selection (GAME_DESIGN.md §9). */

export interface ChatParticipant {
  sessionId: string;
  x: number;
  y: number;
}

/** Session ids inside `rangePx` of the sender, including the sender. */
export function chatRecipients(
  participants: readonly ChatParticipant[],
  from: ChatParticipant,
  rangePx: number = CHAT_RANGE_PX,
): string[] {
  const rangeSquared = rangePx * rangePx;
  const recipients: string[] = [];
  for (const participant of participants) {
    const dx = participant.x - from.x;
    const dy = participant.y - from.y;
    if (dx * dx + dy * dy <= rangeSquared) {
      recipients.push(participant.sessionId);
    }
  }
  return recipients;
}

/** Chat tabs/channels (GAME_DESIGN.md §9). */
export const CHAT_CHANNELS = [
  "local",
  "shout",
  "whisper",
  "party",
  "guild",
  "system",
] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];

export interface ParsedChatInput {
  channel: ChatChannel;
  targetName?: string;
  body: string;
}

/** Parse slash prefixes; malformed commands stay local text. */
export function parseChatInput(raw: string): ParsedChatInput {
  const text = raw.trim();
  const whisper = /^\/(?:w|whisper)\s+(\S+)\s+([\s\S]+)$/i.exec(text);
  if (whisper) {
    return { channel: "whisper", targetName: whisper[1]!, body: whisper[2]!.trim() };
  }
  const shout = /^\/(?:s|shout)\s+([\s\S]+)$/i.exec(text);
  if (shout) {
    return { channel: "shout", body: shout[1]!.trim() };
  }
  const party = /^\/(?:p|party)\s+([\s\S]+)$/i.exec(text);
  if (party) {
    return { channel: "party", body: party[1]!.trim() };
  }
  const guild = /^\/(?:g|guild)\s+([\s\S]+)$/i.exec(text);
  if (guild) {
    return { channel: "guild", body: guild[1]!.trim() };
  }
  const local = /^\/(?:l|local)\s+([\s\S]+)$/i.exec(text);
  if (local) {
    return { channel: "local", body: local[1]!.trim() };
  }
  return { channel: "local", body: text };
}

/**
 * Shuffle letters/digits while preserving whitespace and punctuation. The same
 * seed always produces the same scrambled message for a given original.
 */
export function scrambleChatText(text: string, seed: number): string {
  const mutableIndices: number[] = [];
  const letters: string[] = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (/[A-Za-z0-9]/.test(char)) {
      mutableIndices.push(index);
      letters.push(char);
    }
  }
  if (letters.length < 3) {
    return text;
  }
  const rng = seededRandomSource(seed);
  for (let index = letters.length - 1; index > 0; index--) {
    const swap = Math.floor(rng.next() * (index + 1));
    [letters[index], letters[swap]] = [letters[swap]!, letters[index]!];
  }
  const chars = [...text];
  mutableIndices.forEach((position, index) => {
    chars[position] = letters[index]!;
  });
  return chars.join("");
}

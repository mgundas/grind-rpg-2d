import { CHAT_RANGE_PX } from "./constants";

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

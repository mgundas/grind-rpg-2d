import { z } from "zod";
import raw from "../chat.json";

/** Chat safety list (GAME_DESIGN.md §9). Matched as whole words only. */
const fileSchema = z
  .object({
    version: z.literal(1),
    profanity: z.array(z.string().min(1).max(40)).min(1),
  })
  .strict();

export function buildProfanityList(rawJson: unknown): readonly string[] {
  return fileSchema.parse(rawJson).profanity;
}

export const PROFANITY_WORDS: readonly string[] = buildProfanityList(raw);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace whole-word profanity with asterisks, preserving message length. */
export function filterProfanity(
  text: string,
  words: readonly string[] = PROFANITY_WORDS,
): string {
  let filtered = text;
  for (const word of words) {
    const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b`, "gi");
    filtered = filtered.replace(pattern, (match) => "*".repeat(match.length));
  }
  return filtered;
}

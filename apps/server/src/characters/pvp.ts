import { eq } from "drizzle-orm";
import type { PvpMode } from "@jadethrone/shared";
import type { Db } from "../db/client";
import { characters } from "../db/schema";

/** Persist a PvP mode immediately; the room mirrors it into runtime/state. */
export async function setCharacterPvpMode(
  db: Db,
  characterId: string,
  mode: PvpMode,
): Promise<boolean> {
  const rows = await db
    .update(characters)
    .set({ pvpMode: mode, updatedAt: new Date() })
    .where(eq(characters.id, characterId))
    .returning({ id: characters.id });
  return rows.length > 0;
}

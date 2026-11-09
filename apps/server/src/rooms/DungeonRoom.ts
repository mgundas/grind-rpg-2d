import type { AuthContext } from "@colyseus/core";
import { getServerServices } from "../services";
import type { JoinIdentity } from "../auth/joinAuth";
import { MapRoom } from "./MapRoom";

/**
 * The Spider Cave instanced dungeon (GAME_DESIGN.md §3.1). It reuses the
 * map room tick and spawn systems, but matchmaking filters by `partyId`, so
 * every party gets its own Spider Cave room and the room disposes when empty.
 */
export class DungeonRoom extends MapRoom {
  /**
   * Same authentication as a normal map plus a hard party requirement. The
   * `partyId` option is written by the server-side warp reservation, never by
   * the client, and must match the party the character currently belongs to.
   */
  static override async onAuth(
    token: string | undefined,
    options: unknown,
    context: AuthContext,
  ): Promise<JoinIdentity | null> {
    const identity = await super.onAuth(token, options, context);
    if (!identity) {
      return null;
    }
    const party = getServerServices().parties.getByCharacter(identity.character.id);
    if (!party) {
      return null;
    }
    const requested = (options as { partyId?: unknown } | undefined)?.partyId;
    if (typeof requested === "string" && requested !== party.id) {
      return null;
    }
    return identity;
  }
}

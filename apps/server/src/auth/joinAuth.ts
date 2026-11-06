import { z } from "zod";
import { MAP_IDS, type MapId } from "@jadethrone/shared";
import { logger } from "../logger";
import { isBanned, type AccountAuthRecord } from "./accountService";
import { verifyAccessToken } from "./tokens";
import type { CharacterRecord } from "../characters/characterMappers";
import type { WarpTokenPayload } from "../rooms/warpTokens";

/**
 * Static room authentication. Colyseus calls this during matchmaking (before a
 * seat is reserved), so an invalid token/character/map fails cleanly and the
 * resulting auth object travels with the reservation into `onJoin`.
 *
 * A server-issued warp token authenticates the target-map reservation without
 * a JWT: access tokens expire after an hour, but a session may warp much later.
 */
export interface JoinOptions {
  characterId: string;
  map: MapId;
  warpToken?: string;
}

export interface JoinIdentity {
  account: AccountAuthRecord;
  character: CharacterRecord;
  /** Present only when the join presented a valid server-issued warp token. */
  warpSpawn: { mapId: MapId; x: number; y: number } | null;
}

export type JoinAuthenticator = (
  token: string | undefined,
  options: unknown,
  context: { ip?: string | string[] },
) => Promise<JoinIdentity | null>;

export interface JoinAuthDeps {
  accessSecret: string;
  getAccountById: (accountId: string) => Promise<AccountAuthRecord | null>;
  getCharacterForAccount: (
    accountId: string,
    characterId: string,
  ) => Promise<CharacterRecord | null>;
  checkWarpToken: (token: string, map: MapId) => WarpTokenPayload | null;
}

const joinOptionsSchema = z.object({
  characterId: z.uuid(),
  map: z.enum(MAP_IDS),
  warpToken: z.string().min(1).optional(),
});

export function parseJoinOptions(options: unknown): JoinOptions | null {
  const parsed = joinOptionsSchema.safeParse(options ?? {});
  return parsed.success ? parsed.data : null;
}

function reject(reason: string, ip?: string | string[]): null {
  logger.warn({ reason, ip }, "join authentication rejected");
  return null;
}

export async function authenticateJoin(
  deps: JoinAuthDeps,
  token: string | undefined,
  options: unknown,
  context: { ip?: string | string[] } = {},
): Promise<JoinIdentity | null> {
  const parsed = parseJoinOptions(options);
  if (!parsed) {
    return reject("invalid_options", context.ip);
  }

  if (parsed.warpToken) {
    const warp = deps.checkWarpToken(parsed.warpToken, parsed.map);
    if (!warp?.accountId || !warp.characterId || warp.characterId !== parsed.characterId) {
      return reject("bad_warp_token", context.ip);
    }
    const account = await deps.getAccountById(warp.accountId);
    if (!account) {
      return reject("warp_account_missing", context.ip);
    }
    if (isBanned(account.bannedUntil)) {
      return reject("account_banned", context.ip);
    }
    const character = await deps.getCharacterForAccount(account.id, parsed.characterId);
    if (!character || character.map !== parsed.map) {
      return reject("warp_character_mismatch", context.ip);
    }
    return {
      account,
      character,
      warpSpawn: { mapId: warp.map, x: warp.x, y: warp.y },
    };
  }

  if (!token) {
    return reject("missing_token", context.ip);
  }
  const verified = verifyAccessToken(token, deps.accessSecret);
  if (!verified.ok) {
    return reject(verified.reason === "expired" ? "token_expired" : "token_invalid", context.ip);
  }

  const account = await deps.getAccountById(verified.claims.sub);
  if (!account) {
    return reject("account_missing", context.ip);
  }
  if (verified.claims.tv !== account.tokenVersion) {
    return reject("token_version_stale", context.ip);
  }
  if (isBanned(account.bannedUntil)) {
    return reject("account_banned", context.ip);
  }

  const character = await deps.getCharacterForAccount(account.id, parsed.characterId);
  if (!character) {
    return reject("character_missing", context.ip);
  }
  if (character.map !== parsed.map) {
    return reject("character_map_mismatch", context.ip);
  }

  return { account, character, warpSpawn: null };
}

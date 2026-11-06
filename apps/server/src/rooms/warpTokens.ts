import { randomUUID } from "node:crypto";
import type { MapId } from "@jadethrone/shared";

/**
 * Short-lived, single-use warp tokens. The joining client cannot choose its
 * own spawn: the target room only accepts the token the server issued during
 * `startWarp`, which also proves the request came from our warp flow.
 *
 * Phase 2 binds the token to an account + character so the target room can
 * authenticate the warp without re-verifying a (possibly expired) access JWT.
 */

export interface WarpTokenBinding {
  accountId: string;
  characterId: string;
}

export interface WarpTokenPayload {
  map: MapId;
  x: number;
  y: number;
  accountId?: string;
  characterId?: string;
}

interface WarpTokenData extends WarpTokenPayload {
  expiresAt: number;
}

export const WARP_TOKEN_TTL_MS = 30_000;
const tokens = new Map<string, WarpTokenData>();

/** Drop expired tokens. Called on issue so ignored warps cannot leak memory. */
export function pruneExpiredWarpTokens(now = Date.now()): void {
  for (const [token, data] of tokens) {
    if (data.expiresAt <= now) {
      tokens.delete(token);
    }
  }
}

export function issueWarpToken(
  map: MapId,
  x: number,
  y: number,
  binding?: WarpTokenBinding,
): string {
  pruneExpiredWarpTokens();
  const token = randomUUID();
  tokens.set(token, {
    map,
    x,
    y,
    accountId: binding?.accountId,
    characterId: binding?.characterId,
    expiresAt: Date.now() + WARP_TOKEN_TTL_MS,
  });
  return token;
}

/**
 * Read a token without consuming it (static `onAuth` runs before `onJoin`).
 * Wrong-map/expired tokens are rejected; a wrong map is not burned.
 */
export function checkWarpToken(
  token: string,
  map: MapId,
  now = Date.now(),
): WarpTokenPayload | null {
  const data = tokens.get(token);
  if (!data) {
    return null;
  }
  if (data.expiresAt <= now) {
    tokens.delete(token);
    return null;
  }
  if (data.map !== map) {
    return null;
  }
  return {
    map: data.map,
    x: data.x,
    y: data.y,
    accountId: data.accountId,
    characterId: data.characterId,
  };
}

/**
 * Consume a token for the given map; returns null when invalid/expired. A
 * token presented to the wrong map is rejected but not burned, so the correct
 * room can still use it.
 */
export function consumeWarpToken(
  token: string,
  map: MapId,
  now = Date.now(),
): { x: number; y: number } | null {
  const checked = checkWarpToken(token, map, now);
  if (!checked) {
    return null;
  }
  tokens.delete(token);
  return { x: checked.x, y: checked.y };
}

/** Test-only visibility into the token store size. */
export function warpTokenCount(): number {
  return tokens.size;
}

export function clearWarpTokens(): void {
  tokens.clear();
}

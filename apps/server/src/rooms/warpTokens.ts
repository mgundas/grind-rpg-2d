import { randomUUID } from "node:crypto";
import type { MapId } from "@jadethrone/shared";

/**
 * Short-lived, single-use warp tokens. The joining client cannot choose its
 * own spawn: the target room only accepts the token the server issued during
 * `startWarp`, which also proves the request came from our warp flow.
 */

interface WarpTokenData {
  map: MapId;
  x: number;
  y: number;
  expiresAt: number;
}

const WARP_TOKEN_TTL_MS = 30_000;
const tokens = new Map<string, WarpTokenData>();

export function issueWarpToken(map: MapId, x: number, y: number): string {
  const token = randomUUID();
  tokens.set(token, { map, x, y, expiresAt: Date.now() + WARP_TOKEN_TTL_MS });
  return token;
}

/** Consume a token for the given map; returns null when invalid/expired. */
export function consumeWarpToken(token: string, map: MapId): { x: number; y: number } | null {
  const data = tokens.get(token);
  if (!data) {
    return null;
  }
  tokens.delete(token);
  if (data.map !== map || data.expiresAt < Date.now()) {
    return null;
  }
  return { x: data.x, y: data.y };
}

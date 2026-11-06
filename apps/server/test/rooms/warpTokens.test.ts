import { describe, expect, it } from "vitest";
import { ROOM_NAME_FIELDS, ROOM_NAME_VILLAGE } from "@jadethrone/shared";
import {
  WARP_TOKEN_TTL_MS,
  consumeWarpToken,
  issueWarpToken,
  pruneExpiredWarpTokens,
  warpTokenCount,
} from "../../src/rooms/warpTokens";

describe("warp tokens", () => {
  it("is single-use", () => {
    const token = issueWarpToken(ROOM_NAME_VILLAGE, 100, 200);
    expect(consumeWarpToken(token, ROOM_NAME_VILLAGE)).toEqual({ x: 100, y: 200 });
    expect(consumeWarpToken(token, ROOM_NAME_VILLAGE)).toBeNull();
  });

  it("rejects the wrong map without burning the token", () => {
    const token = issueWarpToken(ROOM_NAME_VILLAGE, 100, 200);
    expect(consumeWarpToken(token, ROOM_NAME_FIELDS)).toBeNull();
    expect(consumeWarpToken(token, ROOM_NAME_VILLAGE)).toEqual({ x: 100, y: 200 });
  });

  it("expires after the TTL", () => {
    const token = issueWarpToken(ROOM_NAME_VILLAGE, 10, 20);
    const later = Date.now() + WARP_TOKEN_TTL_MS + 1;
    expect(consumeWarpToken(token, ROOM_NAME_VILLAGE, later)).toBeNull();
    expect(consumeWarpToken(token, ROOM_NAME_VILLAGE)).toBeNull();
  });

  it("prunes expired tokens so ignored warps cannot leak memory", () => {
    issueWarpToken(ROOM_NAME_VILLAGE, 1, 1);
    issueWarpToken(ROOM_NAME_VILLAGE, 2, 2);
    const before = warpTokenCount();
    pruneExpiredWarpTokens(Date.now() + WARP_TOKEN_TTL_MS + 1);
    expect(warpTokenCount()).toBe(0);
    expect(before).toBeGreaterThanOrEqual(2);
  });
});

import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import {
  TOKEN_ISSUER,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from "../../src/auth/tokens";

const SECRET = "test-secret-at-least-32-characters-long";
const OTHER_SECRET = "another-test-secret-at-least-32-chars";
const ACCOUNT_ID = "3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b";
const SESSION_ID = "6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d";

function accessToken(overrides: { ttlSeconds?: number; tokenVersion?: number } = {}) {
  return signAccessToken({
    accountId: ACCOUNT_ID,
    tokenVersion: overrides.tokenVersion ?? 3,
    secret: SECRET,
    ttlSeconds: overrides.ttlSeconds ?? 3600,
  });
}

function refreshToken() {
  return signRefreshToken({
    accountId: ACCOUNT_ID,
    sessionId: SESSION_ID,
    secret: SECRET,
    ttlSeconds: 3600,
  });
}

describe("access tokens", () => {
  it("round-trips account id and token version", () => {
    const result = verifyAccessToken(accessToken(), SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.sub).toBe(ACCOUNT_ID);
      expect(result.claims.tv).toBe(3);
      expect(result.claims.typ).toBe("access");
      expect(result.claims.iss).toBe(TOKEN_ISSUER);
    }
  });

  it("rejects the wrong secret and a token of the wrong type", () => {
    expect(verifyAccessToken(accessToken(), OTHER_SECRET).ok).toBe(false);
    expect(verifyAccessToken(refreshToken(), SECRET).ok).toBe(false);
  });

  it("reports expired tokens", () => {
    const result = verifyAccessToken(accessToken({ ttlSeconds: -10 }), SECRET);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects malformed or unsigned payloads", () => {
    const malformed = jwt.sign({ typ: "access", tv: 1 }, SECRET, {
      algorithm: "HS256",
      issuer: TOKEN_ISSUER,
      subject: "not-a-uuid",
      expiresIn: 60,
    });
    expect(verifyAccessToken(malformed, SECRET)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyAccessToken("garbage", SECRET)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("refresh tokens", () => {
  it("round-trips the session id", () => {
    const result = verifyRefreshToken(refreshToken(), SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.sub).toBe(ACCOUNT_ID);
      expect(result.claims.sid).toBe(SESSION_ID);
      expect(result.claims.typ).toBe("refresh");
    }
  });

  it("cannot be used as an access token", () => {
    expect(verifyAccessToken(refreshToken(), SECRET).ok).toBe(false);
  });

  it("rejects expired refresh tokens", () => {
    const expired = signRefreshToken({
      accountId: ACCOUNT_ID,
      sessionId: SESSION_ID,
      secret: SECRET,
      ttlSeconds: -10,
    });
    expect(verifyRefreshToken(expired, SECRET)).toEqual({ ok: false, reason: "expired" });
  });
});

describe("token hashing", () => {
  it("is deterministic, one-way and distinguishes tokens", () => {
    const token = refreshToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(token);
    expect(hashToken(token)).not.toBe(hashToken(`${token}x`));
  });
});

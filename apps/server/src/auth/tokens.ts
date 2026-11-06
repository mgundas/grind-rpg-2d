import { createHash, randomUUID } from "node:crypto";
import jwt, { TokenExpiredError } from "jsonwebtoken";
import { z } from "zod";

/**
 * JWT helpers. Access tokens are short-lived and carry the account's current
 * `token_version`; refresh tokens are long-lived and carry a session id (`sid`)
 * whose SHA-256 hash is stored in the `sessions` table. See DECISIONS.md.
 */
export const TOKEN_ISSUER = "jade-throne";

export interface AccessTokenInput {
  accountId: string;
  tokenVersion: number;
  secret: string;
  ttlSeconds: number;
}

export interface RefreshTokenInput {
  accountId: string;
  sessionId: string;
  secret: string;
  ttlSeconds: number;
}

const baseClaimsSchema = z.object({
  sub: z.uuid(),
  iss: z.literal(TOKEN_ISSUER),
  iat: z.number(),
  exp: z.number(),
});

export const accessClaimsSchema = baseClaimsSchema.extend({
  typ: z.literal("access"),
  tv: z.number().int().nonnegative(),
});
export type AccessClaims = z.infer<typeof accessClaimsSchema>;

export const refreshClaimsSchema = baseClaimsSchema.extend({
  typ: z.literal("refresh"),
  sid: z.uuid(),
});
export type RefreshClaims = z.infer<typeof refreshClaimsSchema>;

export type VerifyResult<T> =
  { ok: true; claims: T } | { ok: false; reason: "expired" | "invalid" };

function verifyAndParse<T>(token: string, secret: string, schema: z.ZodType<T>): VerifyResult<T> {
  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ["HS256"],
      issuer: TOKEN_ISSUER,
    });
    const parsed = schema.safeParse(decoded);
    return parsed.success ? { ok: true, claims: parsed.data } : { ok: false, reason: "invalid" };
  } catch (error) {
    if (error instanceof TokenExpiredError) {
      return { ok: false, reason: "expired" };
    }
    return { ok: false, reason: "invalid" };
  }
}

export function signAccessToken(input: AccessTokenInput): string {
  return jwt.sign({ typ: "access", tv: input.tokenVersion }, input.secret, {
    algorithm: "HS256",
    issuer: TOKEN_ISSUER,
    subject: input.accountId,
    expiresIn: input.ttlSeconds,
  });
}

export function verifyAccessToken(token: string, secret: string): VerifyResult<AccessClaims> {
  return verifyAndParse(token, secret, accessClaimsSchema);
}

export function signRefreshToken(input: RefreshTokenInput): string {
  return jwt.sign({ typ: "refresh", sid: input.sessionId }, input.secret, {
    algorithm: "HS256",
    issuer: TOKEN_ISSUER,
    subject: input.accountId,
    expiresIn: input.ttlSeconds,
  });
}

export function verifyRefreshToken(token: string, secret: string): VerifyResult<RefreshClaims> {
  return verifyAndParse(token, secret, refreshClaimsSchema);
}

/** Refresh tokens are stored only as a SHA-256 digest. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newSessionId(): string {
  return randomUUID();
}

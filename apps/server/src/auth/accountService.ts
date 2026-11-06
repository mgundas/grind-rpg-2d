import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  KINGDOM_IDS,
  type AccountPublic,
  type AccountRole,
  type AuthTokens,
  type CharacterSummary,
  type KingdomId,
  type LoginRequest,
  type RegisterRequest,
} from "@jadethrone/shared";
import type { Db, Tx } from "../db/client";
import { ACCOUNT_UNIQUE, toServiceError } from "../db/errors";
import { accounts, characters, sessions } from "../db/schema";
import { ServiceError } from "../errors";
import { logger } from "../logger";
import { hashPassword, verifyPassword } from "./passwords";
import {
  hashToken,
  newSessionId,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "./tokens";
import { toCharacterSummary } from "../characters/characterMappers";

/**
 * Account/session lifecycle: register, login, refresh rotation and logout.
 *
 * Services take an injected `db` and secrets (no `getDb()`), so tests can use
 * `TEST_DATABASE_URL`. Transaction order is always accounts → sessions →
 * characters; login/refresh/logout lock the account row first so the
 * revoke-all-then-insert-new-session pair cannot race two logins into two live
 * sessions.
 */
export interface AuthDeps {
  db: Db;
  accessSecret: string;
  refreshSecret: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export interface AuthResult {
  account: AccountPublic;
  characters: CharacterSummary[];
  tokens: AuthTokens;
}

export interface AccountAuthRecord {
  id: string;
  email: string;
  username: string;
  kingdom: KingdomId;
  role: AccountRole;
  tokenVersion: number;
  bannedUntil: Date | null;
  banReason: string | null;
}

/**
 * A real Argon2id hash used when the login name does not exist, so an unknown
 * user costs the same as a wrong password (no account enumeration by timing).
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$143C2ErZktIOPDvkchiq2g$z1dig8DDkDTHj5XE5rv4yCE1EACK+DdtwCr/s7J0IJo";

const INVALID_CREDENTIALS = "Invalid login or password.";
const INVALID_SESSION = "Session expired. Log in again.";

function invalidCredentials(): ServiceError {
  return new ServiceError("invalid_credentials", INVALID_CREDENTIALS);
}

function invalidSession(): ServiceError {
  return new ServiceError("unauthorized", INVALID_SESSION);
}

export function isBanned(bannedUntil: Date | null, now: Date = new Date()): boolean {
  return bannedUntil !== null && bannedUntil.getTime() > now.getTime();
}

function bannedError(bannedUntil: Date | null, reason: string | null): ServiceError {
  const until = bannedUntil ? ` until ${bannedUntil.toISOString()}` : "";
  return new ServiceError(
    "account_banned",
    `This account is banned${until}${reason ? `: ${reason}` : "."}`,
  );
}

function toAccountPublic(row: {
  id: string;
  email: string;
  username: string;
  kingdom: string;
  role: string;
}): AccountPublic {
  if (!(KINGDOM_IDS as readonly string[]).includes(row.kingdom)) {
    throw new ServiceError("internal", "Account has an unknown kingdom.");
  }
  if (row.role !== "player" && row.role !== "gm" && row.role !== "admin") {
    throw new ServiceError("internal", "Account has an unknown role.");
  }
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    kingdom: row.kingdom as KingdomId,
    role: row.role,
  };
}

interface PreparedSession {
  sessionId: string;
  refreshToken: string;
  tokenHash: string;
  expiresAt: Date;
}

function prepareSession(deps: AuthDeps, accountId: string, now: Date): PreparedSession {
  const sessionId = newSessionId();
  const refreshToken = signRefreshToken({
    accountId,
    sessionId,
    secret: deps.refreshSecret,
    ttlSeconds: deps.refreshTtlSeconds,
  });
  return {
    sessionId,
    refreshToken,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(now.getTime() + deps.refreshTtlSeconds * 1000),
  };
}

function sessionValues(
  prepared: PreparedSession,
  accountId: string,
  meta: RequestMeta,
): typeof sessions.$inferInsert {
  return {
    id: prepared.sessionId,
    accountId,
    tokenHash: prepared.tokenHash,
    expiresAt: prepared.expiresAt,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 255) ?? null,
  };
}

async function listCharacterSummaries(tx: Tx, accountId: string): Promise<CharacterSummary[]> {
  const rows = await tx
    .select()
    .from(characters)
    .where(eq(characters.accountId, accountId))
    .orderBy(asc(characters.createdAt), asc(characters.id));
  return rows.map(toCharacterSummary);
}

function accessToken(deps: AuthDeps, accountId: string, tokenVersion: number): string {
  return signAccessToken({
    accountId,
    tokenVersion,
    secret: deps.accessSecret,
    ttlSeconds: deps.accessTtlSeconds,
  });
}

export async function registerAccount(
  deps: AuthDeps,
  input: RegisterRequest,
  meta: RequestMeta = {},
): Promise<AuthResult> {
  const now = new Date();
  const accountId = randomUUID();
  const passwordHash = await hashPassword(input.password);
  const prepared = prepareSession(deps, accountId, now);

  try {
    await deps.db.transaction(async (tx) => {
      await tx.insert(accounts).values({
        id: accountId,
        email: input.email.trim(),
        username: input.username.trim(),
        passwordHash,
        kingdom: input.kingdom,
        role: "player",
        tokenVersion: 0,
        lastLogin: now,
      });
      await tx.insert(sessions).values(sessionValues(prepared, accountId, meta));
    });
  } catch (error) {
    throw toServiceError(error, ACCOUNT_UNIQUE);
  }

  return {
    account: {
      id: accountId,
      email: input.email.trim(),
      username: input.username.trim(),
      kingdom: input.kingdom,
      role: "player",
    },
    characters: [],
    tokens: {
      accessToken: accessToken(deps, accountId, 0),
      refreshToken: prepared.refreshToken,
    },
  };
}

export async function loginAccount(
  deps: AuthDeps,
  input: LoginRequest,
  meta: RequestMeta = {},
): Promise<AuthResult> {
  const loginLower = input.login.trim().toLowerCase();

  let found: typeof accounts.$inferSelect | undefined;
  try {
    [found] = await deps.db
      .select()
      .from(accounts)
      .where(
        sql`lower(${accounts.email}) = ${loginLower} or lower(${accounts.username}) = ${loginLower}`,
      )
      .limit(1);
  } catch (error) {
    throw toServiceError(error);
  }

  if (!found) {
    // Spend the same Argon2 work as a real verification.
    await verifyPassword(DUMMY_HASH, input.password);
    throw invalidCredentials();
  }
  const passwordOk = await verifyPassword(found.passwordHash, input.password);
  if (!passwordOk) {
    throw invalidCredentials();
  }

  const now = new Date();
  const prepared = prepareSession(deps, found.id, now);
  try {
    const outcome = await deps.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(accounts)
        .where(eq(accounts.id, found.id))
        .for("update")
        .limit(1);
      if (!locked) {
        throw invalidCredentials();
      }
      if (isBanned(locked.bannedUntil, now)) {
        throw bannedError(locked.bannedUntil, locked.banReason);
      }

      const [updated] = await tx
        .update(accounts)
        .set({ tokenVersion: sql`${accounts.tokenVersion} + 1`, lastLogin: now })
        .where(eq(accounts.id, locked.id))
        .returning({ tokenVersion: accounts.tokenVersion });
      if (!updated) {
        throw invalidCredentials();
      }

      await tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.accountId, locked.id), isNull(sessions.revokedAt)));
      await tx.insert(sessions).values(sessionValues(prepared, locked.id, meta));

      return {
        account: locked,
        tokenVersion: updated.tokenVersion,
        characters: await listCharacterSummaries(tx, locked.id),
      };
    });

    return {
      account: toAccountPublic(outcome.account),
      characters: outcome.characters,
      tokens: {
        accessToken: accessToken(deps, outcome.account.id, outcome.tokenVersion),
        refreshToken: prepared.refreshToken,
      },
    };
  } catch (error) {
    throw toServiceError(error);
  }
}

export async function refreshSession(
  deps: AuthDeps,
  refreshToken: string,
  meta: RequestMeta = {},
): Promise<AuthResult> {
  const verified = verifyRefreshToken(refreshToken, deps.refreshSecret);
  if (!verified.ok) {
    throw invalidSession();
  }
  const claims = verified.claims;
  const now = new Date();
  const tokenHash = hashToken(refreshToken);
  const prepared = prepareSession(deps, claims.sub, now);

  try {
    const outcome = await deps.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(accounts)
        .where(eq(accounts.id, claims.sub))
        .for("update")
        .limit(1);
      if (!locked) {
        throw invalidSession();
      }

      const [row] = await tx
        .select()
        .from(sessions)
        .where(and(eq(sessions.tokenHash, tokenHash), eq(sessions.accountId, claims.sub)))
        .for("update")
        .limit(1);
      if (!row) {
        throw invalidSession();
      }
      if (row.revokedAt) {
        // Rotated-away or superseded by a newer login. Do not nuke the live
        // session: a stale tab could otherwise log the active user out.
        logger.warn(
          { accountId: claims.sub, sessionId: row.id, ip: meta.ip },
          "refresh token replay rejected",
        );
        throw invalidSession();
      }
      if (row.expiresAt.getTime() <= now.getTime()) {
        throw invalidSession();
      }
      if (isBanned(locked.bannedUntil, now)) {
        await tx.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, row.id));
        return { banned: true as const };
      }

      await tx.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, row.id));
      await tx.insert(sessions).values(sessionValues(prepared, locked.id, meta));

      return {
        banned: false as const,
        account: locked,
        characters: await listCharacterSummaries(tx, locked.id),
      };
    });

    if (outcome.banned) {
      throw new ServiceError("account_banned", "This account is banned.");
    }

    return {
      account: toAccountPublic(outcome.account),
      characters: outcome.characters,
      tokens: {
        accessToken: accessToken(deps, outcome.account.id, outcome.account.tokenVersion),
        refreshToken: prepared.refreshToken,
      },
    };
  } catch (error) {
    throw toServiceError(error);
  }
}

export async function logoutAccount(
  deps: AuthDeps,
  refreshToken: string,
): Promise<{ accountId: string } | null> {
  const verified = verifyRefreshToken(refreshToken, deps.refreshSecret);
  if (!verified.ok) {
    throw invalidSession();
  }
  const claims = verified.claims;
  const now = new Date();
  const tokenHash = hashToken(refreshToken);
  const result: { accountId: string | null } = { accountId: null };

  try {
    await deps.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.id, claims.sub))
        .for("update")
        .limit(1);
      if (!locked) {
        throw invalidSession();
      }

      const [row] = await tx
        .select()
        .from(sessions)
        .where(and(eq(sessions.tokenHash, tokenHash), eq(sessions.accountId, claims.sub)))
        .for("update")
        .limit(1);
      if (!row) {
        throw invalidSession();
      }
      if (row.revokedAt) {
        // Idempotent double-logout: never bump token_version again, or a stale
        // tab could invalidate the newer login's access token.
        return;
      }

      await tx.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, row.id));
      await tx
        .update(accounts)
        .set({ tokenVersion: sql`${accounts.tokenVersion} + 1` })
        .where(eq(accounts.id, locked.id));
      result.accountId = locked.id;
    });
  } catch (error) {
    throw toServiceError(error);
  }

  return result.accountId ? { accountId: result.accountId } : null;
}

/** Safe account read for static `onAuth` / `/api/auth/me`. */
export async function getAccountById(db: Db, accountId: string): Promise<AccountAuthRecord | null> {
  try {
    const [row] = await db
      .select({
        id: accounts.id,
        email: accounts.email,
        username: accounts.username,
        kingdom: accounts.kingdom,
        role: accounts.role,
        tokenVersion: accounts.tokenVersion,
        bannedUntil: accounts.bannedUntil,
        banReason: accounts.banReason,
      })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);
    if (!row) {
      return null;
    }
    const publicAccount = toAccountPublic(row);
    return {
      ...publicAccount,
      tokenVersion: row.tokenVersion,
      bannedUntil: row.bannedUntil,
      banReason: row.banReason,
    };
  } catch (error) {
    throw toServiceError(error);
  }
}

import type { RequestHandler, Response } from "express";
import type { AccountRole } from "@jadethrone/shared";
import {
  getAccountById,
  isBanned,
  type AccountAuthRecord,
  type AuthDeps,
} from "../auth/accountService";
import { verifyAccessToken } from "../auth/tokens";
import { ServiceError } from "../errors";

export const ADMIN_COOKIE_NAME = "jt_admin";

export function isAdminRole(role: AccountRole): boolean {
  return role === "gm" || role === "admin";
}

/** Parse one cookie without pulling in cookie-parser. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) {
      continue;
    }
    if (part.slice(0, separator).trim() !== name) {
      continue;
    }
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      // A malformed cookie is treated as absent rather than a 500.
      return null;
    }
  }
  return null;
}

/**
 * The monitor iframe cannot send an Authorization header, so an admin login
 * also sets an HttpOnly access-token cookie scoped to this origin.
 */
export function setAdminCookie(
  res: Response,
  accessToken: string,
  ttlSeconds: number,
  secure = process.env.NODE_ENV === "production",
): void {
  res.cookie(ADMIN_COOKIE_NAME, accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: ttlSeconds * 1000,
  });
}

export function clearAdminCookie(res: Response): void {
  res.clearCookie(ADMIN_COOKIE_NAME, { path: "/" });
}

/** Non-throwing check used by the admin UI before showing the monitor iframe. */
export function adminCookieStatus(
  req: { headers: { cookie?: string } },
  authDeps: AuthDeps,
  account: AccountAuthRecord,
): { ok: boolean; expiresAtMs: number | null } {
  const token = readCookie(req.headers.cookie, ADMIN_COOKIE_NAME);
  if (!token) {
    return { ok: false, expiresAtMs: null };
  }
  const verified = verifyAccessToken(token, authDeps.accessSecret);
  if (!verified.ok) {
    return { ok: false, expiresAtMs: null };
  }
  const claims = verified.claims;
  if (
    claims.sub !== account.id ||
    claims.tv !== account.tokenVersion ||
    !isAdminRole(account.role)
  ) {
    return { ok: false, expiresAtMs: null };
  }
  return { ok: true, expiresAtMs: claims.exp * 1000 };
}

export interface AdminCookieDeps {
  authDeps: AuthDeps;
  /** Test seam; production reads the account from the database. */
  getAccount?: (accountId: string) => Promise<AccountAuthRecord | null>;
}

/**
 * Verify the monitor cookie on every request: signature, token version, role
 * and ban state. The cookie carries the same access token as the REST client.
 */
export function requireAdminCookie(deps: AdminCookieDeps): RequestHandler {
  return async (req, res, next) => {
    try {
      const token = readCookie(req.headers.cookie, ADMIN_COOKIE_NAME);
      if (!token) {
        throw new ServiceError("unauthorized", "Admin monitor sign-in required.");
      }
      const verified = verifyAccessToken(token, deps.authDeps.accessSecret);
      if (!verified.ok) {
        throw new ServiceError("unauthorized", "Admin monitor session expired.");
      }
      const account = await (deps.getAccount
        ? deps.getAccount(verified.claims.sub)
        : getAccountById(deps.authDeps.db, verified.claims.sub));
      if (!account || account.tokenVersion !== verified.claims.tv) {
        throw new ServiceError("unauthorized", "Admin monitor session expired.");
      }
      if (isBanned(account.bannedUntil)) {
        throw new ServiceError("account_banned", "This account is banned.");
      }
      if (!isAdminRole(account.role)) {
        throw new ServiceError("forbidden", "Admin access required.");
      }
      res.locals.account = account;
      next();
    } catch (error) {
      next(error);
    }
  };
}

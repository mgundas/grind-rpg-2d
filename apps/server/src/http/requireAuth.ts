import type { RequestHandler, Response } from "express";
import { ServiceError } from "../errors";
import {
  getAccountById,
  isBanned,
  type AccountAuthRecord,
  type AuthDeps,
} from "../auth/accountService";
import { verifyAccessToken } from "../auth/tokens";

/**
 * Bearer access-token middleware. Verifies the signature, the account's current
 * token version (so a login/logout elsewhere invalidates older tokens) and the
 * ban state, then exposes the account through `res.locals`.
 */
export function requireAuth(deps: { authDeps: AuthDeps }): RequestHandler {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization;
      const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;
      if (!token) {
        throw new ServiceError("unauthorized", "Sign in required.");
      }

      const verified = verifyAccessToken(token, deps.authDeps.accessSecret);
      if (!verified.ok) {
        throw new ServiceError("unauthorized", "Session expired. Sign in again.");
      }

      const account = await getAccountById(deps.authDeps.db, verified.claims.sub);
      if (!account || account.tokenVersion !== verified.claims.tv) {
        throw new ServiceError("unauthorized", "Session expired. Sign in again.");
      }
      if (isBanned(account.bannedUntil)) {
        throw new ServiceError("account_banned", "This account is banned.");
      }

      res.locals.account = account;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function authedAccount(res: Response): AccountAuthRecord {
  const account = res.locals.account as AccountAuthRecord | undefined;
  if (!account) {
    throw new ServiceError("unauthorized", "Sign in required.");
  }
  return account;
}

import type { RequestHandler } from "express";
import type { AccountRole } from "@jadethrone/shared";
import { ServiceError } from "../errors";
import type { AccountAuthRecord } from "../auth/accountService";

/**
 * Role gate for admin routes. Must run after `requireAuth`, which puts the
 * loaded account in `res.locals.account`.
 */
export function requireRole(...roles: ReadonlyArray<AccountRole>): RequestHandler {
  return (_req, res, next) => {
    const account = res.locals.account as AccountAuthRecord | undefined;
    if (!account) {
      next(new ServiceError("unauthorized", "Sign in required."));
      return;
    }
    if (!roles.includes(account.role)) {
      next(new ServiceError("forbidden", "Admin access required."));
      return;
    }
    next();
  };
}

/** Convenience for the `/api/admin` router. */
export function requireAdmin(): RequestHandler {
  return requireRole("gm", "admin");
}

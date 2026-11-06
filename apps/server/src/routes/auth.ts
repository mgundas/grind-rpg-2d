import { Router } from "express";
import {
  loginRequestSchema,
  logoutRequestSchema,
  refreshRequestSchema,
  registerRequestSchema,
  type AccountPublic,
  type MeResponse,
} from "@jadethrone/shared";
import {
  loginAccount,
  logoutAccount,
  refreshSession,
  registerAccount,
  type AuthDeps,
} from "../auth/accountService";
import type { SessionRegistry } from "../auth/sessionRegistry";
import { listCharacters } from "../characters/characterService";
import type { Db } from "../db/client";
import { clearAdminCookie, isAdminRole, setAdminCookie } from "../http/adminCookie";
import { authedAccount, requireAuth } from "../http/requireAuth";
import {
  DEFAULT_RATE_LIMITS,
  createRateLimiter,
  rateLimit,
  type RateLimitSettings,
} from "../http/rateLimit";
import { parseBody } from "../http/validation";

export interface AuthRouteDeps {
  authDeps: AuthDeps;
  db: Db;
  sessionRegistry: SessionRegistry;
  rateLimits?: {
    register?: RateLimitSettings;
    login?: RateLimitSettings;
    refresh?: RateLimitSettings;
  };
}

export function createAuthRouter(deps: AuthRouteDeps): Router {
  const router = Router();
  const registerLimiter = createRateLimiter(
    deps.rateLimits?.register ?? DEFAULT_RATE_LIMITS.register,
  );
  const loginLimiter = createRateLimiter(deps.rateLimits?.login ?? DEFAULT_RATE_LIMITS.login);
  const refreshLimiter = createRateLimiter(deps.rateLimits?.refresh ?? DEFAULT_RATE_LIMITS.refresh);

  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  router.post("/register", rateLimit(registerLimiter), async (req, res) => {
    const input = parseBody(registerRequestSchema, req.body);
    const { tokenVersion, ...payload } = await registerAccount(deps.authDeps, input, {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    deps.sessionRegistry.noteAccount(payload.account.id, tokenVersion);
    res.status(201).json(payload);
  });

  router.post("/login", rateLimit(loginLimiter), async (req, res) => {
    const input = parseBody(loginRequestSchema, req.body);
    const { tokenVersion, ...payload } = await loginAccount(deps.authDeps, input, {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    // The token version is already bumped/committed; record the generation
    // before kicking so a stale in-flight reservation cannot win.
    deps.sessionRegistry.noteAccount(payload.account.id, tokenVersion);
    await deps.sessionRegistry.kickAccount(payload.account.id, "login");
    if (isAdminRole(payload.account.role)) {
      setAdminCookie(res, payload.tokens.accessToken, deps.authDeps.accessTtlSeconds);
    }
    res.json(payload);
  });

  router.post("/refresh", rateLimit(refreshLimiter), async (req, res) => {
    const input = parseBody(refreshRequestSchema, req.body);
    const { tokenVersion, ...payload } = await refreshSession(deps.authDeps, input.refreshToken, {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    deps.sessionRegistry.noteAccount(payload.account.id, tokenVersion);
    if (isAdminRole(payload.account.role)) {
      setAdminCookie(res, payload.tokens.accessToken, deps.authDeps.accessTtlSeconds);
    }
    res.json(payload);
  });

  router.post("/logout", async (req, res) => {
    const input = parseBody(logoutRequestSchema, req.body);
    const revoked = await logoutAccount(deps.authDeps, input.refreshToken);
    if (revoked) {
      deps.sessionRegistry.noteAccount(revoked.accountId, revoked.tokenVersion);
      await deps.sessionRegistry.kickAccount(revoked.accountId, "logout");
    }
    clearAdminCookie(res);
    res.status(204).end();
  });

  router.get("/me", requireAuth(deps), async (_req, res) => {
    const account = authedAccount(res);
    const publicAccount: AccountPublic = {
      id: account.id,
      email: account.email,
      username: account.username,
      kingdom: account.kingdom,
      role: account.role,
    };
    const characters = await listCharacters(deps.db, account.id);
    const payload: MeResponse = { account: publicAccount, characters };
    res.json(payload);
  });

  return router;
}

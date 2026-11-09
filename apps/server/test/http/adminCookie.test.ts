import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import type { AccountAuthRecord, AuthDeps } from "../../src/auth/accountService";
import { signAccessToken } from "../../src/auth/tokens";
import {
  ADMIN_COOKIE_NAME,
  clearAdminCookie,
  isAdminRole,
  readCookie,
  requireAdminCookie,
  setAdminCookie,
} from "../../src/http/adminCookie";
import { requireRole } from "../../src/http/requireRole";
import { ServiceError } from "../../src/errors";

const SECRET = "admin-cookie-test-secret-at-least-32-chars";
const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";

function account(overrides: Partial<AccountAuthRecord> = {}): AccountAuthRecord {
  return {
    id: ACCOUNT_ID,
    email: "admin@example.com",
    username: "Admin",
    kingdom: "ember",
    role: "admin",
    tokenVersion: 3,
    bannedUntil: null,
    banReason: null,
    ...overrides,
  };
}

function authDeps(): AuthDeps {
  return {
    db: {} as AuthDeps["db"],
    accessSecret: SECRET,
    refreshSecret: "refresh-secret-at-least-32-characters",
    accessTtlSeconds: 3600,
    refreshTtlSeconds: 3600,
  };
}

function token(tokenVersion = 3): string {
  return signAccessToken({
    accountId: ACCOUNT_ID,
    tokenVersion,
    secret: SECRET,
    ttlSeconds: 3600,
  });
}

function response(): Response {
  return { locals: {}, cookie: vi.fn(), clearCookie: vi.fn() } as unknown as Response;
}

describe("admin cookie helpers", () => {
  it("parses one cookie without cookie-parser", () => {
    expect(readCookie("a=1; jt_admin=abc; b=2", ADMIN_COOKIE_NAME)).toBe("abc");
    expect(readCookie("a=1", ADMIN_COOKIE_NAME)).toBeNull();
    expect(readCookie(undefined, ADMIN_COOKIE_NAME)).toBeNull();
  });

  it("sets an HttpOnly, same-site cookie", () => {
    const res = response();
    setAdminCookie(res, "token-value", 3600, false);
    expect(res.cookie).toHaveBeenCalledWith(
      ADMIN_COOKIE_NAME,
      "token-value",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        path: "/",
        maxAge: 3_600_000,
      }),
    );
  });

  it("clears the cookie with the same attributes it was set with", () => {
    const res = response();
    clearAdminCookie(res, false);
    expect(res.clearCookie).toHaveBeenCalledWith(ADMIN_COOKIE_NAME, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
    });
  });
});

describe("requireRole", () => {
  it("allows gm/admin and rejects players", () => {
    const allowed = vi.fn();
    requireRole("gm", "admin")(
      {} as Request,
      { locals: { account: account({ role: "admin" }) } } as unknown as Response,
      allowed,
    );
    expect(allowed).toHaveBeenCalledWith();

    const rejected = vi.fn();
    requireRole("gm", "admin")(
      {} as Request,
      { locals: { account: account({ role: "player" }) } } as unknown as Response,
      rejected,
    );
    expect((rejected.mock.calls[0]![0] as ServiceError).code).toBe("forbidden");
  });
});

describe("requireAdminCookie", () => {
  async function run(cookie: string | undefined, current: AccountAuthRecord | null = account()) {
    const next = vi.fn();
    const res = response();
    const handler = requireAdminCookie({
      authDeps: authDeps(),
      getAccount: async () => current,
    });
    await handler({ headers: cookie === undefined ? {} : { cookie } } as Request, res, next);
    return { next, res };
  }

  it("accepts a valid admin token and exposes the account", async () => {
    const { next, res } = await run(`${ADMIN_COOKIE_NAME}=${token()}`);
    expect(next).toHaveBeenCalledWith();
    expect(res.locals.account).toMatchObject({ role: "admin" });
  });

  it("rejects a missing, expired-generation and player token", async () => {
    expect((await run(undefined)).next.mock.calls[0]![0] as ServiceError).toMatchObject({
      code: "unauthorized",
    });
    expect(
      ((await run(`${ADMIN_COOKIE_NAME}=${token(2)}`)).next.mock.calls[0]![0] as ServiceError).code,
    ).toBe("unauthorized");
    expect(
      (
        (await run(`${ADMIN_COOKIE_NAME}=${token()}`, account({ role: "player" }))).next.mock
          .calls[0]![0] as ServiceError
      ).code,
    ).toBe("forbidden");
  });

  it("rejects a banned admin", async () => {
    const banned = account({ bannedUntil: new Date(Date.now() + 60_000) });
    const { next } = await run(`${ADMIN_COOKIE_NAME}=${token()}`, banned);
    expect((next.mock.calls[0]![0] as ServiceError).code).toBe("account_banned");
  });

  it("classifies roles correctly", () => {
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("gm")).toBe(true);
    expect(isAdminRole("player")).toBe(false);
  });
});

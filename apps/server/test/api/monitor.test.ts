import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { eq } from "drizzle-orm";
import { accounts } from "../../src/db/schema";
import { getDb, closeDb } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import { registerAccount } from "../../src/auth/accountService";
import { signAccessToken } from "../../src/auth/tokens";
import { createGameServer } from "../../src/server";
import { getServerServices } from "../../src/services";
import { hasTestDatabase } from "../db/testDb";

const describeDb = hasTestDatabase() ? describe : describe.skip;
const PORT = 2577;

function suffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

describeDb("colyseus monitor auth", () => {
  let colyseus: ColyseusTestServer;
  let adminCookie = "";
  let playerCookie = "";

  beforeAll(async () => {
    await runMigrations();
    const service = createGameServer({});
    await service.listen(PORT);
    colyseus = new ColyseusTestServer(service);

    const deps = getServerServices().authDeps;
    const adminCreds = {
      email: `mon${suffix()}@example.com`,
      username: `Mon${suffix()}`,
      password: "correct-horse-battery",
      kingdom: "ember" as const,
    };
    const admin = await registerAccount(deps, adminCreds);
    await getDb().update(accounts).set({ role: "admin" }).where(eq(accounts.id, admin.account.id));

    const login = await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: adminCreds.email, password: adminCreds.password }),
    });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get("set-cookie") ?? "";
    adminCookie = setCookie.split(";")[0] ?? "";

    const player = await registerAccount(deps, {
      email: `monp${suffix()}@example.com`,
      username: `Monp${suffix()}`,
      password: "correct-horse-battery",
      kingdom: "ember",
    });
    const playerAccess = signAccessToken({
      accountId: player.account.id,
      tokenVersion: 0,
      secret: deps.accessSecret,
      ttlSeconds: 3600,
    });
    playerCookie = `jt_admin=${playerAccess}`;
  }, 30_000);

  afterAll(async () => {
    await colyseus.shutdown();
    await closeDb();
  });

  async function getMonitor(cookie?: string): Promise<number> {
    const response = await fetch(`http://127.0.0.1:${PORT}/colyseus/`, {
      headers: cookie ? { cookie } : {},
      redirect: "manual",
    });
    return response.status;
  }

  it("rejects missing and player cookies", async () => {
    expect(await getMonitor()).toBe(401);
    expect(await getMonitor(playerCookie)).toBe(403);
  });

  it("accepts an admin login cookie", async () => {
    expect(await getMonitor(adminCookie)).toBe(200);
  });
});

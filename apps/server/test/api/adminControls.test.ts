import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { eq } from "drizzle-orm";
import type { CreateCharacterRequest } from "@jadethrone/shared";
import { accounts, adminLog } from "../../src/db/schema";
import { createCharacter } from "../../src/characters/characterService";
import { getDb, closeDb } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import { registerAccount } from "../../src/auth/accountService";
import { createGameServer } from "../../src/server";
import { getServerServices } from "../../src/services";
import { hasTestDatabase } from "../db/testDb";

const describeDb = hasTestDatabase() ? describe : describe.skip;
const PORT = 2576;

function suffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function input(name: string): CreateCharacterRequest {
  return { name, classId: "warrior", gender: "male", hairStyle: 0, hairColor: 0 };
}

describeDb("admin control routes", () => {
  let colyseus: ColyseusTestServer;
  let adminToken = "";
  let characterId = "";

  async function request(path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = {};
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (options.body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(`http://127.0.0.1:${PORT}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: response.status, body };
  }

  beforeAll(async () => {
    await runMigrations();
    const service = createGameServer({});
    await service.listen(PORT);
    colyseus = new ColyseusTestServer(service);

    const db = getDb();
    const admin = await registerAccount(getServerServices().authDeps, {
      email: `ctrl${suffix()}@example.com`,
      username: `Ctrl${suffix()}`,
      password: "correct-horse-battery",
      kingdom: "ember",
    });
    await db.update(accounts).set({ role: "admin" }).where(eq(accounts.id, admin.account.id));
    adminToken = admin.tokens.accessToken;
    const character = await createCharacter(db, admin.account.id, input(`Ctrl${suffix()}`));
    characterId = character.id;
  }, 30_000);

  afterAll(async () => {
    await colyseus.shutdown();
    await closeDb();
  });

  it("sends one-off announcements and lists/deletes recurring ones", async () => {
    const immediate = await request("/api/admin/announcements", {
      method: "POST",
      token: adminToken,
      body: { message: "Server event starts now" },
    });
    expect(immediate.status).toBe(201);

    const recurring = await request("/api/admin/announcements", {
      method: "POST",
      token: adminToken,
      body: { message: "Vote daily", intervalMinutes: 60, expiresInMinutes: 120 },
    });
    expect(recurring.status).toBe(201);
    const id = (recurring.body as { id: string }).id;

    const list = await request("/api/admin/announcements", { token: adminToken });
    expect(list.status).toBe(200);
    expect(
      (list.body as { announcements: Array<{ id: string }> }).announcements.some(
        (row) => row.id === id,
      ),
    ).toBe(true);

    const deleted = await request(`/api/admin/announcements/${id}`, {
      method: "DELETE",
      token: adminToken,
    });
    expect(deleted.status).toBe(204);
  });

  it("updates rates and exposes them in server status", async () => {
    const rates = await request("/api/admin/server/rates", {
      method: "POST",
      token: adminToken,
      body: { xpRate: 2, dropRate: 0.5 },
    });
    expect(rates.status).toBe(200);
    const status = await request("/api/admin/server", { token: adminToken });
    expect(status.body).toMatchObject({ xpRate: 2, dropRate: 0.5 });

    const logs = await getDb()
      .select()
      .from(adminLog)
      .where(eq(adminLog.action, "server_rates"));
    expect(
      logs.some((row) => (row.detail as { xpRate?: number } | null)?.xpRate === 2),
    ).toBe(true);
  });

  it("schedules and cancels a shutdown", async () => {
    const scheduled = await request("/api/admin/server/shutdown", {
      method: "POST",
      token: adminToken,
      body: { delayMinutes: 30, message: "Maintenance" },
    });
    expect(scheduled.status).toBe(200);
    expect((scheduled.body as { shutdownAtMs: number }).shutdownAtMs).toBeGreaterThan(Date.now());

    const cancelled = await request("/api/admin/server/shutdown/cancel", {
      method: "POST",
      token: adminToken,
    });
    expect(cancelled.status).toBe(200);
    expect((cancelled.body as { shutdownAtMs: null }).shutdownAtMs).toBeNull();
  });

  it("requires an online player to spawn a monster", async () => {
    const spawn = await request("/api/admin/server/spawn", {
      method: "POST",
      token: adminToken,
      body: { typeId: "wild_dog", count: 1 },
    });
    expect(spawn.status).toBe(409);
  });

  it("validates control bodies", async () => {
    const invalid = await request("/api/admin/server/rates", {
      method: "POST",
      token: adminToken,
      body: { xpRate: -1, dropRate: 1 },
    });
    expect(invalid.status).toBe(400);
    expect(characterId.length).toBeGreaterThan(0);
  });
});

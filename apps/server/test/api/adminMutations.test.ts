import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { eq } from "drizzle-orm";
import type { CreateCharacterRequest } from "@jadethrone/shared";
import { accounts, items } from "../../src/db/schema";
import { createCharacter } from "../../src/characters/characterService";
import { getDb, closeDb } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import { registerAccount } from "../../src/auth/accountService";
import { createGameServer } from "../../src/server";
import { getServerServices } from "../../src/services";
import { hasTestDatabase } from "../db/testDb";

const describeDb = hasTestDatabase() ? describe : describe.skip;
const PORT = 2575;

function suffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function credentials(prefix: string) {
  return {
    email: `${prefix}${suffix()}@example.com`,
    username: `${prefix}${suffix()}`,
    password: "correct-horse-battery",
    kingdom: "ember" as const,
  };
}

function input(name: string): CreateCharacterRequest {
  return { name, classId: "warrior", gender: "male", hairStyle: 0, hairColor: 0 };
}

describeDb("admin mutation routes", () => {
  let colyseus: ColyseusTestServer;
  let adminToken = "";
  let targetToken = "";
  let targetCharacterId = "";
  let targetAccountId = "";
  let targetCreds = credentials("Target");

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
    const deps = getServerServices().authDeps;
    const admin = await registerAccount(deps, credentials("Adm"));
    await db.update(accounts).set({ role: "admin" }).where(eq(accounts.id, admin.account.id));
    adminToken = admin.tokens.accessToken;

    const target = await registerAccount(deps, targetCreds);
    targetToken = target.tokens.accessToken;
    targetAccountId = target.account.id;
    const character = await createCharacter(db, target.account.id, input(`Target${suffix()}`));
    targetCharacterId = character.id;
  }, 30_000);

  afterAll(async () => {
    await colyseus.shutdown();
    await closeDb();
  });

  it("edits level and gold offline", async () => {
    const result = await request(`/api/admin/players/${targetCharacterId}`, {
      method: "PATCH",
      token: adminToken,
      body: { level: 10, gold: 1000, statVit: 20 },
    });
    expect(result.status).toBe(200);
    const db = getDb();
    const [row] = await db.select().from(accounts).where(eq(accounts.id, targetAccountId));
    expect(row).toBeDefined();
    const target = await getServerServices().loadCharacter(targetAccountId, targetCharacterId);
    expect(target).toMatchObject({ level: 10 });
  });

  it("gives and removes an item offline", async () => {
    const granted = await request(`/api/admin/players/${targetCharacterId}/items`, {
      method: "POST",
      token: adminToken,
      body: {
        definitionId: "sword_ember_t1",
        quantity: 1,
        upgradeLevel: 5,
        bonuses: [],
      },
    });
    expect(granted.status).toBe(201);
    const item = (granted.body as { item: { id: string; upgradeLevel: number } }).item;
    expect(item.upgradeLevel).toBe(5);

    const removed = await request(
      `/api/admin/players/${targetCharacterId}/items/${item.id}`,
      { method: "DELETE", token: adminToken },
    );
    expect(removed.status).toBe(204);
    const rows = await getDb().select().from(items).where(eq(items.id, item.id));
    expect(rows).toHaveLength(0);
  });

  it("bans, refuses login, then unbans", async () => {
    const banned = await request(`/api/admin/players/${targetCharacterId}/ban`, {
      method: "POST",
      token: adminToken,
      body: { durationMinutes: 60, reason: "test" },
    });
    expect(banned.status).toBe(200);

    const login = await request(`/api/auth/login`, {
      method: "POST",
      body: { login: targetCreds.email, password: targetCreds.password },
    });
    expect(login.status).toBe(403);

    const unbanned = await request(`/api/admin/accounts/${targetAccountId}/unban`, {
      method: "POST",
      token: adminToken,
    });
    expect(unbanned.status).toBe(200);
    const relogin = await request(`/api/auth/login`, {
      method: "POST",
      body: { login: targetCreds.email, password: targetCreds.password },
    });
    expect(relogin.status).toBe(200);
    targetToken = (relogin.body as { tokens: { accessToken: string } }).tokens.accessToken;
  });

  it("kicks offline and rejects offline teleport", async () => {
    const kick = await request(`/api/admin/players/${targetCharacterId}/kick`, {
      method: "POST",
      token: adminToken,
    });
    expect(kick.status).toBe(204);
    const teleport = await request(`/api/admin/players/${targetCharacterId}/teleport-town`, {
      method: "POST",
      token: adminToken,
    });
    expect(teleport.status).toBe(409);
    expect(targetToken.length).toBeGreaterThan(0);
  });

  it("rejects a player-role caller", async () => {
    const result = await request(`/api/admin/players/${targetCharacterId}`, {
      method: "PATCH",
      token: targetToken,
      body: { level: 2 },
    });
    expect(result.status).toBe(403);
  });
});

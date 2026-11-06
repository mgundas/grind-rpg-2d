import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import type { CreateCharacterRequest } from "@jadethrone/shared";
import { accounts } from "../../src/db/schema";
import { eq } from "drizzle-orm";
import { createCharacter } from "../../src/characters/characterService";
import { getDb, closeDb } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import { registerAccount } from "../../src/auth/accountService";
import { createGameServer } from "../../src/server";
import { getServerServices } from "../../src/services";
import { hasTestDatabase } from "../db/testDb";

const describeDb = hasTestDatabase() ? describe : describe.skip;
const PORT = 2574;

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
  return {
    name,
    classId: "warrior",
    gender: "male",
    hairStyle: 0,
    hairColor: 0,
  };
}

describeDb("admin read routes", () => {
  let colyseus: ColyseusTestServer;
  let adminToken = "";
  let playerToken = "";
  let characterId = "";

  async function request(path: string, token?: string) {
    const response = await fetch(`http://127.0.0.1:${PORT}${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: response.status, body, response };
  }

  beforeAll(async () => {
    await runMigrations();
    const service = createGameServer({});
    await service.listen(PORT);
    colyseus = new ColyseusTestServer(service);

    const db = getDb();
    const deps = getServerServices().authDeps;
    const creds = credentials("Admin");
    const admin = await registerAccount(deps, creds);
    await db.update(accounts).set({ role: "admin" }).where(eq(accounts.id, admin.account.id));
    const character = await createCharacter(db, admin.account.id, input(`Adm${suffix()}`));
    characterId = character.id;
    adminToken = admin.tokens.accessToken;
    const playerCreds = credentials("Player");
    const player = await registerAccount(deps, playerCreds);
    playerToken = player.tokens.accessToken;
  }, 30_000);

  afterAll(async () => {
    await colyseus.shutdown();
    await closeDb();
  });

  it("rejects missing and player tokens", async () => {
    const missing = await request("/api/admin/dashboard");
    expect(missing.status).toBe(401);
    const forbidden = await request("/api/admin/dashboard", playerToken);
    expect(forbidden.status).toBe(403);
  });

  it("returns the dashboard, online list and server status", async () => {
    const dashboard = await request("/api/admin/dashboard", adminToken);
    expect(dashboard.status).toBe(200);
    expect((dashboard.body as { online: { total: number } }).online.total).toBe(0);

    const online = await request("/api/admin/online", adminToken);
    expect(online.status).toBe(200);

    const server = await request("/api/admin/server", adminToken);
    expect(server.status).toBe(200);
    expect((server.body as { xpRate: number }).xpRate).toBe(1);
  });

  it("searches players and returns character detail", async () => {
    const search = await request("/api/admin/players?q=Adm", adminToken);
    expect(search.status).toBe(200);
    expect(
      (search.body as { characters: Array<{ id: string }> }).characters.some(
        (row) => row.id === characterId,
      ),
    ).toBe(true);

    const detail = await request(`/api/admin/players/${characterId}`, adminToken);
    expect(detail.status).toBe(200);
    expect((detail.body as { character: { id: string } }).character.id).toBe(characterId);
  });

  it("returns log pages and validates query parameters", async () => {
    const logs = await request("/api/admin/logs/item?limit=5", adminToken);
    expect(logs.status).toBe(200);
    expect(Array.isArray((logs.body as { entries: unknown[] }).entries)).toBe(true);

    const invalid = await request("/api/admin/logs/item?limit=0", adminToken);
    expect(invalid.status).toBe(400);
  });
});

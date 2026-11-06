import { afterAll, beforeAll, describe, expect, it, vi, type Mock } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { createGameServer } from "../../src/server";
import { SessionRegistry, type SessionHandle } from "../../src/auth/sessionRegistry";
import { closeDb } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import type { AuthResponse, CharacterSummary } from "@jadethrone/shared";

/**
 * Full HTTP stack against the real services + real Postgres. Skipped unless
 * TEST_DATABASE_URL is configured (same guard as the persistence suite).
 */
const hasDb = Boolean(process.env.TEST_DATABASE_URL);
const describeApi = hasDb ? describe : describe.skip;
const PORT = 2569;

function suffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function credentials() {
  return {
    email: `api${suffix()}@example.com`,
    username: `Api${suffix()}`,
    password: "correct-horse-battery",
    kingdom: "ember" as const,
  };
}

interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

describeApi("auth and character routes", () => {
  let colyseus: ColyseusTestServer;
  let registry: SessionRegistry;
  const base = `http://127.0.0.1:${PORT}`;

  async function api<T = unknown>(
    path: string,
    init: RequestInit & { token?: string } = {},
  ): Promise<ApiResponse<T>> {
    const { token, ...rest } = init;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...((rest.headers as Record<string, string> | undefined) ?? {}),
    };
    const response = await fetch(`${base}${path}`, { ...rest, headers });
    const text = await response.text();
    return {
      status: response.status,
      body: (text ? JSON.parse(text) : null) as T,
    };
  }

  async function register(): Promise<AuthResponse> {
    const response = await api<AuthResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(credentials()),
    });
    expect(response.status).toBe(201);
    return response.body;
  }

  beforeAll(async () => {
    await runMigrations();
    registry = new SessionRegistry();
    const server = createGameServer({
      sessionRegistry: registry,
      rateLimits: {
        register: { windowMs: 60_000, max: 100 },
        login: { windowMs: 60_000, max: 100 },
        refresh: { windowMs: 60_000, max: 100 },
      },
    });
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  }, 30_000);

  afterAll(async () => {
    await colyseus?.shutdown();
    await closeDb();
  });

  it("registers, logs in and restores the account via /me", async () => {
    const creds = credentials();
    const registered = await api<AuthResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(creds),
    });
    expect(registered.status).toBe(201);
    expect(registered.body.account.email).toBe(creds.email);
    expect(registered.body.characters).toEqual([]);
    expect(registered.body.tokens.accessToken).toBeTruthy();

    const me = await api<{ account: { username: string }; characters: [] }>("/api/auth/me", {
      token: registered.body.tokens.accessToken,
    });
    expect(me.status).toBe(200);
    expect(me.body.account.username).toBe(creds.username);

    const login = await api<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ login: creds.email, password: creds.password }),
    });
    expect(login.status).toBe(200);
    expect(login.body.account.id).toBe(registered.body.account.id);
  });

  it("returns 401 for missing or stale tokens", async () => {
    expect((await api("/api/characters")).status).toBe(401);
    expect((await api("/api/characters", { token: "garbage" })).status).toBe(401);
  });

  it("uses the same 401 for unknown users and wrong passwords", async () => {
    const creds = credentials();
    await api("/api/auth/register", { method: "POST", body: JSON.stringify(creds) });

    const unknown = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ login: `nobody${suffix()}@example.com`, password: "wrong-pass" }),
    });
    const wrong = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ login: creds.email, password: "wrong-pass" }),
    });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  it("kicks the previous session on login", async () => {
    const account = await register();
    const handle: SessionHandle & {
      saveForKick: Mock<() => Promise<void>>;
      send: Mock<(type: string, payload: unknown) => void>;
      leave: Mock<(code: number) => void>;
    } = {
      accountId: account.account.id,
      characterId: "11111111-1111-4111-8111-111111111111",
      sessionId: "old-session",
      tokenVersion: 0,
      saveForKick: vi.fn<() => Promise<void>>(async () => undefined),
      send: vi.fn<(type: string, payload: unknown) => void>(),
      leave: vi.fn<(code: number) => void>(),
    };
    await registry.register(handle);

    const login = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ login: account.account.email, password: "correct-horse-battery" }),
    });
    expect(login.status).toBe(200);
    expect(handle.saveForKick).toHaveBeenCalledOnce();
    expect(handle.leave).toHaveBeenCalledWith(4100);
    expect(registry.getActive(account.account.id)).toBeUndefined();
  });

  it("creates, lists and deletes a character", async () => {
    const account = await register();
    const token = account.tokens.accessToken;
    const name = `ApiHero${suffix()}`;

    const created = await api<{ character: CharacterSummary }>("/api/characters", {
      method: "POST",
      token,
      body: JSON.stringify({
        name,
        classId: "warrior",
        gender: "male",
        hairStyle: 0,
        hairColor: 1,
      }),
    });
    expect(created.status).toBe(201);
    expect(created.body.character).toMatchObject({ name, classId: "warrior", level: 1 });

    const listed = await api<{ characters: CharacterSummary[] }>("/api/characters", { token });
    expect(listed.status).toBe(200);
    expect(listed.body.characters.map((character) => character.id)).toContain(
      created.body.character.id,
    );

    const deleted = await api(`/api/characters/${created.body.character.id}`, {
      method: "DELETE",
      token,
    });
    expect(deleted.status).toBe(204);
  });

  it("rejects invalid creation bodies and duplicate names", async () => {
    const first = await register();
    const second = await register();
    const base = `ApiName${suffix()}`;

    const invalid = await api("/api/characters", {
      method: "POST",
      token: first.tokens.accessToken,
      body: JSON.stringify({
        name: "ab",
        classId: "warrior",
        gender: "male",
        hairStyle: 0,
        hairColor: 0,
      }),
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toMatchObject({ error: { code: "validation" } });

    const created = await api("/api/characters", {
      method: "POST",
      token: first.tokens.accessToken,
      body: JSON.stringify({
        name: base,
        classId: "assassin",
        gender: "female",
        hairStyle: 1,
        hairColor: 2,
      }),
    });
    expect(created.status).toBe(201);

    const duplicate = await api("/api/characters", {
      method: "POST",
      token: second.tokens.accessToken,
      body: JSON.stringify({
        name: base.toLowerCase(),
        classId: "mystic",
        gender: "female",
        hairStyle: 2,
        hairColor: 0,
      }),
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toMatchObject({ error: { code: "name_taken" } });
  });

  it("rejects malformed JSON with a validation error", async () => {
    const response = await api("/api/auth/login", {
      method: "POST",
      body: "{not json",
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: "validation" } });
  });
});

describe("register rate limiting", () => {
  let colyseus: ColyseusTestServer;
  const base = `http://127.0.0.1:2570`;

  beforeAll(async () => {
    const server = createGameServer({
      rateLimits: { register: { windowMs: 60_000, max: 2 } },
    });
    await server.listen(2570);
    colyseus = new ColyseusTestServer(server);
  }, 30_000);

  afterAll(async () => {
    await colyseus?.shutdown();
    await closeDb();
  });

  it("returns 429 after the register limit, before touching the database", async () => {
    const post = () =>
      fetch(`${base}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });

    expect((await post()).status).toBe(400);
    expect((await post()).status).toBe(400);
    const limited = await post();
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: { code: "rate_limited" } });
  });
});

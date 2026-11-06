import { describe, expect, it } from "vitest";
import type { AuthResponse } from "@jadethrone/shared";
import { ApiError, createApiClient, type FetchLike } from "../src/network/api";
import { createMemoryStorage, createTokenStore } from "../src/network/tokens";

const ACCOUNT = {
  id: "3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b",
  email: "player@example.com",
  username: "Player",
  kingdom: "ember" as const,
  role: "player" as const,
};

function authResponse(access: string, refresh: string): AuthResponse {
  return {
    tokens: { accessToken: access, refreshToken: refresh },
    account: ACCOUNT,
    characters: [],
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setup(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const store = createTokenStore(createMemoryStorage());
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  const client = createApiClient({ baseUrl: "http://test", fetchFn, tokens: store });
  return { client, store, calls, fetchFn };
}

function authorization(init?: RequestInit): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.authorization;
}

describe("api client", () => {
  it("registers, stores tokens and sends no bearer on the auth call", async () => {
    const { client, store, calls } = setup(() => json(201, authResponse("access-1", "refresh-1")));
    const response = await client.register({
      email: "player@example.com",
      username: "Player",
      password: "correct-horse",
      kingdom: "ember",
    });
    expect(response.account.id).toBe(ACCOUNT.id);
    expect(store.getAccess()).toBe("access-1");
    expect(store.getRefresh()).toBe("refresh-1");
    expect(calls[0]!.url).toBe("http://test/api/auth/register");
    expect(authorization(calls[0]!.init)).toBeUndefined();
    expect(JSON.parse(String(calls[0]!.init?.body))).toMatchObject({ kingdom: "ember" });
  });

  it("attaches the bearer token to authenticated requests", async () => {
    const { client, store, calls } = setup((url) => {
      if (url.endsWith("/api/auth/login")) return json(200, authResponse("access-1", "refresh-1"));
      return json(200, { account: ACCOUNT, characters: [] });
    });
    await client.login({ login: "player@example.com", password: "correct-horse" });
    const me = await client.me();
    expect(me.account.username).toBe("Player");
    expect(authorization(calls[1]!.init)).toBe("Bearer access-1");
    expect(store.getAccess()).toBe("access-1");
  });

  it("rotates the refresh token once on 401 and retries the request", async () => {
    let meCalls = 0;
    const { client, store, calls } = setup((url) => {
      if (url.endsWith("/api/auth/refresh")) {
        return json(200, authResponse("access-2", "refresh-2"));
      }
      meCalls += 1;
      if (meCalls === 1) {
        return json(401, { error: { code: "unauthorized", message: "expired" } });
      }
      return json(200, { account: ACCOUNT, characters: [] });
    });
    store.set({ accessToken: "access-1", refreshToken: "refresh-1" });

    const me = await client.me();
    expect(me.account.id).toBe(ACCOUNT.id);
    expect(calls.map((call) => call.url)).toEqual([
      "http://test/api/auth/me",
      "http://test/api/auth/refresh",
      "http://test/api/auth/me",
    ]);
    expect(authorization(calls[2]!.init)).toBe("Bearer access-2");
    expect(store.getRefresh()).toBe("refresh-2");
  });

  it("clears tokens and surfaces the original error when refresh fails", async () => {
    const { client, store, calls } = setup((url) => {
      if (url.endsWith("/api/auth/refresh")) {
        return json(401, { error: { code: "unauthorized", message: "nope" } });
      }
      return json(401, { error: { code: "unauthorized", message: "expired" } });
    });
    store.set({ accessToken: "access-1", refreshToken: "refresh-1" });

    await expect(client.me()).rejects.toMatchObject({ code: "unauthorized", status: 401 });
    expect(store.getAccess()).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it("does not try to refresh after a failed login", async () => {
    const { client, calls } = setup(() =>
      json(401, { error: { code: "invalid_credentials", message: "bad login" } }),
    );
    await expect(
      client.login({ login: "player@example.com", password: "wrong" }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(calls).toHaveLength(1);
  });

  it("parses validation fields from API errors", async () => {
    const { client, store } = setup(() =>
      json(409, {
        error: {
          code: "name_taken",
          message: "That character name is already taken.",
          fields: { name: "taken" },
        },
      }),
    );
    store.set({ accessToken: "access-1", refreshToken: "refresh-1" });
    await expect(
      client.createCharacter({
        name: "Grinder",
        classId: "warrior",
        gender: "male",
        hairStyle: 0,
        hairColor: 0,
      }),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      client.createCharacter({
        name: "Grinder",
        classId: "warrior",
        gender: "male",
        hairStyle: 0,
        hairColor: 0,
      }),
    ).rejects.toMatchObject({ code: "name_taken", fields: { name: "taken" } });
  });

  it("handles 204 responses and the list wrapper", async () => {
    const { client, store, calls } = setup((url, init) => {
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return json(200, { characters: [] });
    });
    store.set({ accessToken: "access-1", refreshToken: "refresh-1" });

    await expect(
      client.deleteCharacter("3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b"),
    ).resolves.toBeUndefined();
    await expect(client.listCharacters()).resolves.toEqual([]);
    expect(calls[0]!.url).toContain("/api/characters/3f1a2b3c");
  });

  it("restore requires a refresh token and rotates it", async () => {
    const { client, store } = setup(() => json(200, authResponse("access-2", "refresh-2")));
    await expect(client.restore()).rejects.toMatchObject({ code: "unauthorized" });
    store.set({ accessToken: "access-1", refreshToken: "refresh-1" });
    const me = await client.restore();
    expect(me.account.id).toBe(ACCOUNT.id);
    expect(store.getAccess()).toBe("access-2");
  });

  it("shares one refresh between concurrent 401s", async () => {
    let refreshCalls = 0;
    let meCalls = 0;
    const { client, store } = setup((url) => {
      if (url.endsWith("/api/auth/refresh")) {
        refreshCalls += 1;
        return json(200, authResponse("access-2", "refresh-2"));
      }
      meCalls += 1;
      if (meCalls <= 2) {
        return json(401, { error: { code: "unauthorized", message: "expired" } });
      }
      return json(200, { account: ACCOUNT, characters: [] });
    });
    store.set({ accessToken: "access-1", refreshToken: "refresh-1" });

    const [first, second] = await Promise.all([client.me(), client.me()]);
    expect(first.account.id).toBe(ACCOUNT.id);
    expect(second.account.id).toBe(ACCOUNT.id);
    expect(refreshCalls).toBe(1);
  });
});

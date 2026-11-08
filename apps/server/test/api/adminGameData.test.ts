import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { eq } from "drizzle-orm";
import type { CreateCharacterRequest } from "@jadethrone/shared";
import { accounts } from "../../src/db/schema";
import { closeDb, getDb } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import { registerAccount } from "../../src/auth/accountService";
import { createCharacter } from "../../src/characters/characterService";
import { createGameServer } from "../../src/server";
import { getServerServices } from "../../src/services";
import { hasTestDatabase } from "../db/testDb";

const describeDb = hasTestDatabase() ? describe : describe.skip;
const PORT = 2592;

function suffix(): string {
  return Math.random().toString(36).slice(2, 8);
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

describeDb("admin game data routes", () => {
  let colyseus: ColyseusTestServer;
  let adminToken = "";

  async function request(path: string, init: RequestInit = {}) {
    const response = await fetch(`http://127.0.0.1:${PORT}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
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
    const admin = await registerAccount(deps, {
      email: `gamedata${suffix()}@example.com`,
      username: `GameData${suffix()}`,
      password: "correct-horse-battery",
      kingdom: "ember",
    });
    await db.update(accounts).set({ role: "admin" }).where(eq(accounts.id, admin.account.id));
    await createCharacter(db, admin.account.id, input(`GD${suffix()}`));
    adminToken = admin.tokens.accessToken;
  }, 30_000);

  afterAll(async () => {
    await colyseus.shutdown();
    await closeDb();
  });

  it("rejects missing tokens", async () => {
    const response = await fetch(`http://127.0.0.1:${PORT}/api/admin/data/items`);
    expect(response.status).toBe(401);
  });

  it("serves, edits, rejects invalid data, reverts and reloads", async () => {
    const initial = await request("/api/admin/data/items");
    expect(initial.status).toBe(200);
    const initialBody = initial.body as {
      version: number;
      base: Array<Record<string, unknown>>;
      merged: Array<Record<string, unknown>>;
    };
    const baseItem = initialBody.base.find((entry) => entry.id === "potion_hp_s");
    expect(baseItem).toBeTruthy();

    const payload = { ...baseItem, buyPrice: 777 };
    const saved = await request("/api/admin/data/items/potion_hp_s", {
      method: "PUT",
      body: JSON.stringify({ payload }),
    });
    expect(saved.status).toBe(200);
    expect((saved.body as { version: number }).version).toBeGreaterThan(initialBody.version);

    const merged = await request("/api/admin/data/items");
    const mergedItem = (merged.body as { merged: Array<Record<string, unknown>> }).merged.find(
      (entry) => entry.id === "potion_hp_s",
    );
    expect(mergedItem?.buyPrice).toBe(777);

    const versionBeforeInvalid = (merged.body as { version: number }).version;
    const invalid = await request("/api/admin/data/items/potion_hp_s", {
      method: "PUT",
      body: JSON.stringify({ payload: { ...baseItem, buyPrice: -1 } }),
    });
    expect(invalid.status).toBe(400);
    const afterInvalid = await request("/api/admin/data/items");
    expect((afterInvalid.body as { version: number }).version).toBe(versionBeforeInvalid);

    const reverted = await request("/api/admin/data/items/potion_hp_s", { method: "DELETE" });
    expect(reverted.status).toBe(200);
    expect((reverted.body as { reverted?: boolean }).reverted).toBe(true);

    const afterRevert = await request("/api/admin/data/items");
    const restored = (afterRevert.body as { merged: Array<Record<string, unknown>> }).merged.find(
      (entry) => entry.id === "potion_hp_s",
    );
    expect(restored?.buyPrice).toBe(baseItem?.buyPrice);

    const reloaded = await request("/api/admin/data/reload", { method: "POST" });
    expect(reloaded.status).toBe(200);
    expect((reloaded.body as { version: number }).version).toBeGreaterThan(0);

    const publicCatalog = await fetch(`http://127.0.0.1:${PORT}/api/data/catalog`);
    expect(publicCatalog.status).toBe(200);
  });
});

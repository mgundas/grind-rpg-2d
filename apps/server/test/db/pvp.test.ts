import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { CreateCharacterRequest } from "@jadethrone/shared";
import { registerAccount, type AuthDeps } from "../../src/auth/accountService";
import { createCharacter, getCharacterForAccount } from "../../src/characters/characterService";
import { setCharacterPvpMode } from "../../src/characters/pvp";
import type { Db } from "../../src/db/client";
import { characters } from "../../src/db/schema";
import { createTestDb, hasTestDatabase, type TestDb } from "./testDb";

const ACCESS_SECRET = "test-access-secret-at-least-32-characters";
const REFRESH_SECRET = "test-refresh-secret-at-least-32-characters";
const describeDb = hasTestDatabase() ? describe : describe.skip;

function suffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function deps(db: Db): AuthDeps {
  return {
    db,
    accessSecret: ACCESS_SECRET,
    refreshSecret: REFRESH_SECRET,
    accessTtlSeconds: 3600,
    refreshTtlSeconds: 3600,
  };
}

function input(name: string): CreateCharacterRequest {
  return { name, classId: "warrior", gender: "male", hairStyle: 0, hairColor: 0 };
}

describeDb("pvp mode persistence", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("persists all stances and loads them on reconnect", async () => {
    const { db } = testDb;
    const account = await registerAccount(deps(db), {
      email: `pvp${suffix()}@example.com`,
      username: `Pvp${suffix()}`,
      password: "correct-horse-battery",
      kingdom: "ember",
    });
    const character = await createCharacter(db, account.account.id, input(`P${suffix()}`));

    for (const mode of ["kingdom", "free", "peaceful"] as const) {
      expect(await setCharacterPvpMode(db, character.id, mode)).toBe(true);
      const record = await getCharacterForAccount(db, account.account.id, character.id);
      expect(record?.pvpMode).toBe(mode);
    }
  });

  it("rejects unknown modes through the database check constraint", async () => {
    const { db } = testDb;
    const account = await registerAccount(deps(db), {
      email: `pvpbad${suffix()}@example.com`,
      username: `PvpBad${suffix()}`,
      password: "correct-horse-battery",
      kingdom: "ember",
    });
    const character = await createCharacter(db, account.account.id, input(`PB${suffix()}`));
    await expect(
      db.update(characters).set({ pvpMode: "chaos" }).where(eq(characters.id, character.id)),
    ).rejects.toThrow();
  });
});

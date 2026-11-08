import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateCharacterRequest } from "@jadethrone/shared";
import { registerAccount, type AuthDeps } from "../../src/auth/accountService";
import { createCharacter, getCharacterForAccount } from "../../src/characters/characterService";
import type { Db } from "../../src/db/client";
import { characterSkillMastery } from "../../src/db/schema";
import {
  effectiveRankFor,
  getSkillMastery,
  loadSkillMastery,
} from "../../src/characters/skillMastery";
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

describeDb("skill mastery persistence", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("loads mastery and computes effective ranks", async () => {
    const { db } = testDb;
    const account = await registerAccount(deps(db), {
      email: `mastery${suffix()}@example.com`,
      username: `Mastery${suffix()}`,
      password: "correct-horse-battery",
      kingdom: "ember",
    });
    const character = await createCharacter(
      db,
      account.account.id,
      input(`M${suffix()}`),
    );
    const lastReadAt = new Date("2026-01-01T12:00:00Z");
    await db.insert(characterSkillMastery).values({
      characterId: character.id,
      skillId: "warrior_blade_whirlwind",
      masterLevel: 4,
      lastReadAt,
    });

    const mastery = await loadSkillMastery(db, character.id);
    expect(mastery["warrior_blade_whirlwind"]).toEqual({
      level: 4,
      lastReadAtMs: lastReadAt.getTime(),
    });
    expect(await getSkillMastery(db, character.id, "warrior_blade_charge")).toBeNull();
    expect(effectiveRankFor(mastery, "warrior_blade_whirlwind", 20)).toBe(24);

    const record = await getCharacterForAccount(db, account.account.id, character.id);
    expect(record?.skillMastery?.["warrior_blade_whirlwind"]?.level).toBe(4);
  });
});

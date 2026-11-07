import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateCharacterRequest } from "@jadethrone/shared";
import { SKILLS } from "@jadethrone/data/skills";
import { registerAccount, type AuthDeps } from "../../src/auth/accountService";
import { createCharacter, deleteCharacter } from "../../src/characters/characterService";
import {
  loadSkillRanks,
  saveSkillRank,
  saveSkillState,
} from "../../src/characters/characterSkills";
import type { Db } from "../../src/db/client";
import { characterSkills, characters } from "../../src/db/schema";
import { ServiceError } from "../../src/errors";
import { createTestDb, hasTestDatabase, type TestDb } from "./testDb";

const ACCESS_SECRET = "test-access-secret-at-least-32-characters";
const REFRESH_SECRET = "test-refresh-secret-at-least-32-characters";
const describeDb = hasTestDatabase() ? describe : describe.skip;

const warriorSkills = SKILLS.filter((skill) => skill.classId === "warrior");
const SKILL_A = warriorSkills[0]!.id;
const SKILL_B = warriorSkills[1]!.id;

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

function characterInput(): CreateCharacterRequest {
  return {
    name: `Sk${suffix()}`,
    classId: "warrior",
    gender: "male",
    hairStyle: 0,
    hairColor: 0,
  };
}

describeDb("character skill persistence", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
  }, 30_000);

  afterAll(async () => {
    await testDb.close();
  });

  async function newCharacter(): Promise<{ accountId: string; characterId: string }> {
    const db = testDb.db;
    const account = await registerAccount(deps(db), {
      email: `sk${suffix()}@example.com`,
      username: `Sk${suffix()}`,
      password: "correct-horse-battery",
      kingdom: "ember",
    });
    const character = await createCharacter(db, account.account.id, characterInput());
    return { accountId: account.account.id, characterId: character.id };
  }

  it("creates and loads one rank", async () => {
    const { characterId } = await newCharacter();
    await expect(saveSkillRank(testDb.db, characterId, SKILL_A, 1)).resolves.toBe(true);
    await expect(loadSkillRanks(testDb.db, characterId)).resolves.toEqual({ [SKILL_A]: 1 });

    const rows = await testDb.db
      .select()
      .from(characterSkills)
      .where(eq(characterSkills.characterId, characterId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.updatedAt).toBeInstanceOf(Date);
  });

  it("upserts the same skill without duplicating it", async () => {
    const { characterId } = await newCharacter();
    await saveSkillRank(testDb.db, characterId, SKILL_A, 3);
    await saveSkillRank(testDb.db, characterId, SKILL_A, 7);
    await saveSkillRank(testDb.db, characterId, SKILL_A, 7);
    const rows = await testDb.db
      .select()
      .from(characterSkills)
      .where(eq(characterSkills.characterId, characterId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rank).toBe(7);
  });

  it("deletes the row when rank 0 is saved", async () => {
    const { characterId } = await newCharacter();
    await saveSkillRank(testDb.db, characterId, SKILL_A, 5);
    await expect(saveSkillRank(testDb.db, characterId, SKILL_A, 0)).resolves.toBe(true);
    const rows = await testDb.db
      .select()
      .from(characterSkills)
      .where(eq(characterSkills.characterId, characterId));
    expect(rows).toHaveLength(0);
    await expect(loadSkillRanks(testDb.db, characterId)).resolves.toEqual({});
  });

  it("rejects unknown skills and out-of-range ranks without writing", async () => {
    const { characterId } = await newCharacter();
    for (const [skillId, rank] of [
      ["missing_skill", 1],
      [SKILL_A, 21],
      [SKILL_A, -1],
      [SKILL_A, 1.5],
    ] as const) {
      await expect(saveSkillRank(testDb.db, characterId, skillId, rank)).rejects.toMatchObject({
        code: "validation",
      });
    }
    const rows = await testDb.db
      .select()
      .from(characterSkills)
      .where(eq(characterSkills.characterId, characterId));
    expect(rows).toHaveLength(0);
  });

  it("returns false for a missing or malformed character id", async () => {
    await expect(saveSkillRank(testDb.db, randomUUID(), SKILL_A, 1)).resolves.toBe(false);
    await expect(saveSkillRank(testDb.db, "not-a-uuid", SKILL_A, 1)).resolves.toBe(false);
  });

  it("cascades ranks when the character is deleted", async () => {
    const { accountId, characterId } = await newCharacter();
    await saveSkillRank(testDb.db, characterId, SKILL_A, 2);
    await saveSkillRank(testDb.db, characterId, SKILL_B, 4);
    await deleteCharacter(testDb.db, accountId, characterId);
    const rows = await testDb.db
      .select()
      .from(characterSkills)
      .where(eq(characterSkills.characterId, characterId));
    expect(rows).toHaveLength(0);
  });

  it("keeps ranks independent per character", async () => {
    const first = await newCharacter();
    const second = await newCharacter();
    await saveSkillRank(testDb.db, first.characterId, SKILL_A, 1);
    await saveSkillRank(testDb.db, second.characterId, SKILL_A, 6);
    await expect(loadSkillRanks(testDb.db, first.characterId)).resolves.toEqual({ [SKILL_A]: 1 });
    await expect(loadSkillRanks(testDb.db, second.characterId)).resolves.toEqual({
      [SKILL_A]: 6,
    });
  });

  it("persists doctrine, points and ranks atomically", async () => {
    const { characterId } = await newCharacter();
    await expect(
      saveSkillState(testDb.db, characterId, {
        doctrine: "blade",
        skillPoints: 3,
        ranks: { [SKILL_A]: 1, [SKILL_B]: 2 },
      }),
    ).resolves.toBe(true);

    const [character] = await testDb.db
      .select({ doctrine: characters.doctrine, skillPoints: characters.skillPoints })
      .from(characters)
      .where(eq(characters.id, characterId));
    expect(character).toEqual({ doctrine: "blade", skillPoints: 3 });
    await expect(loadSkillRanks(testDb.db, characterId)).resolves.toEqual({
      [SKILL_A]: 1,
      [SKILL_B]: 2,
    });
  });

  it("validates the whole change before touching the transaction", async () => {
    const { characterId } = await newCharacter();
    await saveSkillState(testDb.db, characterId, { doctrine: "blade", skillPoints: 1 });
    await expect(
      saveSkillState(testDb.db, characterId, {
        doctrine: "iron_body",
        skillPoints: 9,
        ranks: { missing_skill: 1 },
      }),
    ).rejects.toBeInstanceOf(ServiceError);

    const [character] = await testDb.db
      .select({ doctrine: characters.doctrine, skillPoints: characters.skillPoints })
      .from(characters)
      .where(eq(characters.id, characterId));
    expect(character).toEqual({ doctrine: "blade", skillPoints: 1 });
  });

  it("returns false for a missing character in a state change", async () => {
    await expect(
      saveSkillState(testDb.db, randomUUID(), { doctrine: "blade", ranks: { [SKILL_A]: 1 } }),
    ).resolves.toBe(false);
  });

  it("clamps skill points through the service", async () => {
    const { characterId } = await newCharacter();
    await saveSkillState(testDb.db, characterId, { skillPoints: -5 });
    await saveSkillState(testDb.db, characterId, { skillPoints: 1e9 });
    const [character] = await testDb.db
      .select({ skillPoints: characters.skillPoints })
      .from(characters)
      .where(eq(characters.id, characterId));
    expect(character?.skillPoints).toBe(10_000);
  });

  it("enforces the database rank check", async () => {
    const { characterId } = await newCharacter();
    await expect(
      testDb.db.insert(characterSkills).values({ characterId, skillId: SKILL_A, rank: 0 }),
    ).rejects.toThrow();
    const rows = await testDb.db
      .select()
      .from(characterSkills)
      .where(
        and(eq(characterSkills.characterId, characterId), eq(characterSkills.skillId, SKILL_A)),
      );
    expect(rows).toHaveLength(0);
  });
});

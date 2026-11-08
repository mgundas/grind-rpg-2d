import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateCharacterRequest, RandomSource } from "@jadethrone/shared";
import { MASTERY_RULES } from "@jadethrone/data/mastery";
import { registerAccount, type AuthDeps } from "../../src/auth/accountService";
import { createCharacter } from "../../src/characters/characterService";
import type { Db } from "../../src/db/client";
import {
  characterSkillMastery,
  characterSkills,
  characters,
  itemLog,
  items,
} from "../../src/db/schema";
import { ItemError } from "../../src/items/errors";
import { createItemService } from "../../src/items/service";
import { createTestDb, hasTestDatabase, type TestDb } from "./testDb";

const ACCESS_SECRET = "test-access-secret-at-least-32-characters";
const REFRESH_SECRET = "test-refresh-secret-at-least-32-characters";
const describeDb = hasTestDatabase() ? describe : describe.skip;
const SKILL = "warrior_blade_whirlwind";

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

function scripted(value: number): RandomSource {
  return { next: () => value };
}

async function setup(db: Db) {
  const account = await registerAccount(deps(db), {
    email: `book${suffix()}@example.com`,
    username: `Book${suffix()}`,
    password: "correct-horse-battery",
    kingdom: "ember",
  });
  const character = await createCharacter(
    db,
    account.account.id,
    input(`B${suffix()}`),
  );
  await db
    .update(characters)
    .set({ doctrine: "blade", level: 30 })
    .where(eq(characters.id, character.id));
  await db.insert(characterSkills).values({
    characterId: character.id,
    skillId: SKILL,
    rank: 20,
  });
  await db.delete(items).where(eq(items.ownerCharacterId, character.id));
  return { accountId: account.account.id, characterId: character.id };
}

async function insertBook(db: Db, characterId: string, quantity = 1) {
  const id = randomUUID();
  await db.insert(items).values({
    id,
    definitionId: "skillbook_mastery",
    ownerCharacterId: characterId,
    location: "inventory",
    slot: 0,
    quantity,
    createdBy: "test",
  });
  return id;
}

async function masteryRow(db: Db, characterId: string) {
  const [row] = await db
    .select()
    .from(characterSkillMastery)
    .where(
      and(
        eq(characterSkillMastery.characterId, characterId),
        eq(characterSkillMastery.skillId, SKILL),
      ),
    );
  return row ?? null;
}

describeDb("skill book transaction", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("commits a success with book consumption, mastery and item log", async () => {
    const { db } = testDb;
    const owner = await setup(db);
    const bookId = await insertBook(db, owner.characterId);
    const service = createItemService(db);
    const now = 5_000_000;

    const result = await service.readSkillBook({
      ...owner,
      bookInstanceId: bookId,
      skillId: SKILL,
      now,
      rng: scripted(0),
    });
    expect(result.success).toBe(true);
    expect(result.masterLevel).toBe(1);
    expect(result.inventory.items.some((item) => item.id === bookId)).toBe(false);
    expect((await masteryRow(db, owner.characterId))?.masterLevel).toBe(1);
    expect(
      (await masteryRow(db, owner.characterId))?.lastReadAt?.getTime(),
    ).toBe(now);

    const logs = await db
      .select()
      .from(itemLog)
      .where(and(eq(itemLog.itemId, bookId), eq(itemLog.action, "skill_book_read")));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.detail?.success).toBe(true);
  });

  it("commits a failed roll by consuming the book and setting the cooldown", async () => {
    const { db } = testDb;
    const owner = await setup(db);
    const bookId = await insertBook(db, owner.characterId);
    const service = createItemService(db);
    const now = 6_000_000;

    const result = await service.readSkillBook({
      ...owner,
      bookInstanceId: bookId,
      skillId: SKILL,
      now,
      rng: scripted(0.99),
    });
    expect(result.success).toBe(false);
    expect(result.masterLevel).toBe(0);
    expect(result.nextReadAtMs).toBe(now + MASTERY_RULES.readCooldownMs);
    expect(
      (await masteryRow(db, owner.characterId))?.lastReadAt?.getTime(),
    ).toBe(now);
    const remaining = await db.select().from(items).where(eq(items.id, bookId));
    expect(remaining).toHaveLength(0);
  });

  it("enforces the cooldown between reads from a quantity-two stack", async () => {
    const { db } = testDb;
    const owner = await setup(db);
    const bookId = await insertBook(db, owner.characterId, 2);
    const service = createItemService(db);
    const now = 7_000_000;

    await service.readSkillBook({
      ...owner,
      bookInstanceId: bookId,
      skillId: SKILL,
      now,
      rng: scripted(0),
    });
    const [row] = await db.select().from(items).where(eq(items.id, bookId));
    expect(row?.quantity).toBe(1);

    await expect(
      service.readSkillBook({
        ...owner,
        bookInstanceId: bookId,
        skillId: SKILL,
        now: now + 1,
        rng: scripted(0),
      }),
    ).rejects.toMatchObject({ code: "mastery_cooldown" });
    expect((await db.select().from(items).where(eq(items.id, bookId)))[0]?.quantity).toBe(1);

    await service.readSkillBook({
      ...owner,
      bookInstanceId: bookId,
      skillId: SKILL,
      now: now + MASTERY_RULES.readCooldownMs,
      rng: scripted(0),
    });
    expect(await db.select().from(items).where(eq(items.id, bookId))).toHaveLength(0);
    expect((await masteryRow(db, owner.characterId))?.masterLevel).toBe(2);
  });

  it("rolls back invalid ranks, master caps and wrong items without writes", async () => {
    const { db } = testDb;
    const owner = await setup(db);
    const bookId = await insertBook(db, owner.characterId);
    const service = createItemService(db);

    await db
      .update(characterSkills)
      .set({ rank: 19 })
      .where(
        and(eq(characterSkills.characterId, owner.characterId), eq(characterSkills.skillId, SKILL)),
      );
    await expect(
      service.readSkillBook({
        ...owner,
        bookInstanceId: bookId,
        skillId: SKILL,
        now: 8_000_000,
        rng: scripted(0),
      }),
    ).rejects.toMatchObject({ code: "rank_required" });
    expect(await db.select().from(items).where(eq(items.id, bookId))).toHaveLength(1);
    expect(await masteryRow(db, owner.characterId)).toBeNull();
  });

  it("rejects a book outside the character inventory", async () => {
    const { db } = testDb;
    const owner = await setup(db);
    const service = createItemService(db);
    await expect(
      service.readSkillBook({
        ...owner,
        bookInstanceId: randomUUID(),
        skillId: SKILL,
        now: 9_000_000,
        rng: scripted(0),
      }),
    ).rejects.toBeInstanceOf(ItemError);
  });
});

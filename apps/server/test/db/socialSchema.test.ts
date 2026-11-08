import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateCharacterRequest } from "@jadethrone/shared";
import { registerAccount, type AuthDeps } from "../../src/auth/accountService";
import { createCharacter } from "../../src/characters/characterService";
import type { Db } from "../../src/db/client";
import {
  characterSkillMastery,
  friends,
  guildMembers,
  guilds,
} from "../../src/db/schema";
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

async function character(db: Db, prefix: string) {
  const account = await registerAccount(deps(db), {
    email: `${prefix}${suffix()}@example.com`,
    username: `${prefix}${suffix()}`,
    password: "correct-horse-battery",
    kingdom: "ember",
  });
  return createCharacter(
    db,
    account.account.id,
    input(`${prefix}${suffix()}`.slice(0, 16)),
  );
}

describeDb("phase 8 social schema", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("enforces one guild per character and case-insensitive guild names", async () => {
    const { db } = testDb;
    const leader = await character(db, "GuildLead");
    const member = await character(db, "GuildMate");
    const guildId = randomUUID();
    const name = `Jade${suffix()}`;
    await db.insert(guilds).values({ id: guildId, name, leaderCharacterId: leader.id });
    await db.insert(guildMembers).values({
      guildId,
      characterId: leader.id,
      rank: "leader",
    });

    await expect(
      db.insert(guilds).values({
        id: randomUUID(),
        name: name.toUpperCase(),
        leaderCharacterId: member.id,
      }),
    ).rejects.toThrow();

    const secondGuild = randomUUID();
    await db.insert(guilds).values({
      id: secondGuild,
      name: `Other${suffix()}`,
      leaderCharacterId: member.id,
    });
    await expect(
      db.insert(guildMembers).values({
        guildId: secondGuild,
        characterId: leader.id,
        rank: "member",
      }),
    ).rejects.toThrow();
  });

  it("rejects self-friendship and mastery levels above ten", async () => {
    const { db } = testDb;
    const owner = await character(db, "FriendOwner");
    await expect(
      db.insert(friends).values({
        characterId: owner.id,
        friendCharacterId: owner.id,
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(characterSkillMastery).values({
        characterId: owner.id,
        skillId: "warrior_blade_whirlwind",
        masterLevel: 11,
      }),
    ).rejects.toThrow();
  });

  it("cascades guild membership when the guild is deleted", async () => {
    const { db } = testDb;
    const leader = await character(db, "CascadeLead");
    const guildId = randomUUID();
    await db.insert(guilds).values({
      id: guildId,
      name: `Cascade${suffix()}`,
      leaderCharacterId: leader.id,
    });
    await db.insert(guildMembers).values({
      guildId,
      characterId: leader.id,
      rank: "leader",
    });
    await db.delete(guilds).where(eq(guilds.id, guildId));
    expect(
      await db.select().from(guildMembers).where(eq(guildMembers.guildId, guildId)),
    ).toHaveLength(0);
  });
});

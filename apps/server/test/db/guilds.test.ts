import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { CreateCharacterRequest } from "@jadethrone/shared";
import { registerAccount, type AuthDeps } from "../../src/auth/accountService";
import { createCharacter } from "../../src/characters/characterService";
import type { Db } from "../../src/db/client";
import { characters, goldLog } from "../../src/db/schema";
import {
  createGuild,
  disbandGuild,
  joinGuild,
  kickGuildMember,
  leaveGuild,
  loadGuildByCharacter,
  setGuildRank,
} from "../../src/guilds/service";
import { GuildRuleError } from "../../src/guilds/rules";
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

async function newCharacter(db: Db, prefix: string, level = 30, gold = 500_000) {
  const account = await registerAccount(deps(db), {
    email: `${prefix}${suffix()}@example.com`,
    username: `${prefix}${suffix()}`,
    password: "correct-horse-battery",
    kingdom: "ember",
  });
  const character = await createCharacter(
    db,
    account.account.id,
    input(`${prefix}${suffix()}`.slice(0, 16)),
  );
  await db
    .update(characters)
    .set({ level, gold })
    .where(eq(characters.id, character.id));
  return character;
}

describeDb("guild service", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("creates a guild, debits gold and records the gold log", async () => {
    const { db } = testDb;
    const leader = await newCharacter(db, "Founder");
    const guildId = await createGuild(db, {
      characterId: leader.id,
      name: `Jade ${suffix()}`,
    });
    const guild = await loadGuildByCharacter(db, leader.id);
    expect(guild?.id).toBe(guildId);
    expect(guild?.members).toEqual([
      expect.objectContaining({ characterId: leader.id, rank: "leader" }),
    ]);

    const [character] = await db
      .select({ gold: characters.gold })
      .from(characters)
      .where(eq(characters.id, leader.id));
    expect(character?.gold).toBe(0);
    const logs = await db
      .select()
      .from(goldLog)
      .where(and(eq(goldLog.characterId, leader.id), eq(goldLog.reason, "guild_create")));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ reason: "guild_create", delta: -500_000 });
  });

  it("validates level, gold, duplicate names and membership", async () => {
    const { db } = testDb;
    const poor = await newCharacter(db, "Poor", 30, 0);
    await expect(
      createGuild(db, { characterId: poor.id, name: `Poor${suffix()}` }),
    ).rejects.toMatchObject({ code: "no_gold" });

    const low = await newCharacter(db, "Low", 10, 500_000);
    await expect(
      createGuild(db, { characterId: low.id, name: `Low${suffix()}` }),
    ).rejects.toMatchObject({ code: "level_too_low" });

    const leader = await newCharacter(db, "Dup");
    const name = `Dup${suffix()}`;
    await createGuild(db, { characterId: leader.id, name });
    await expect(createGuild(db, { characterId: leader.id, name })).rejects.toBeInstanceOf(
      GuildRuleError,
    );
    const other = await newCharacter(db, "Other");
    await expect(
      createGuild(db, { characterId: other.id, name: name.toUpperCase() }),
    ).rejects.toMatchObject({ code: "name_taken" });
  });

  it("joins, promotes, kicks, leaves and disbands with rank permissions", async () => {
    const { db } = testDb;
    const leader = await newCharacter(db, "Lead");
    const member = await newCharacter(db, "Member");
    const officer = await newCharacter(db, "Officer");
    const guildId = await createGuild(db, {
      characterId: leader.id,
      name: `Rank${suffix()}`,
    });
    await joinGuild(db, { guildId, characterId: member.id });
    await joinGuild(db, { guildId, characterId: officer.id });

    await setGuildRank(db, {
      actorCharacterId: leader.id,
      targetCharacterId: officer.id,
      rank: "officer",
    });
    const promoted = await loadGuildByCharacter(db, officer.id);
    expect(promoted?.members.find((entry) => entry.characterId === officer.id)?.rank).toBe(
      "officer",
    );

    await expect(
      setGuildRank(db, {
        actorCharacterId: officer.id,
        targetCharacterId: member.id,
        rank: "officer",
      }),
    ).rejects.toMatchObject({ code: "permission" });

    await kickGuildMember(db, {
      actorCharacterId: officer.id,
      targetCharacterId: member.id,
    });
    expect(await loadGuildByCharacter(db, member.id)).toBeNull();

    await expect(leaveGuild(db, leader.id)).rejects.toMatchObject({ code: "leader" });
    await leaveGuild(db, officer.id);
    await disbandGuild(db, leader.id);
    expect(await loadGuildByCharacter(db, leader.id)).toBeNull();
  });
});

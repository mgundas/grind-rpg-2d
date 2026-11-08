import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CreateCharacterRequest } from "@jadethrone/shared";
import { registerAccount, type AuthDeps } from "../../src/auth/accountService";
import { createCharacter } from "../../src/characters/characterService";
import type { Db } from "../../src/db/client";
import {
  addFriend,
  findCharacterByName,
  listFriends,
  FriendRuleError,
  removeFriend,
  toFriendsState,
} from "../../src/friends/service";
import { createSocialDirectory } from "../../src/social/bus";
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

async function newCharacter(db: Db, prefix: string, kingdom: "ember" | "gale" = "ember") {
  const account = await registerAccount(deps(db), {
    email: `${prefix}${suffix()}@example.com`,
    username: `${prefix}${suffix()}`,
    password: "correct-horse-battery",
    kingdom,
  });
  return createCharacter(
    db,
    account.account.id,
    input(`${prefix}${suffix()}`.slice(0, 16)),
  );
}

describeDb("friends service", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("adds, lists and removes friends idempotently", async () => {
    const { db } = testDb;
    const owner = await newCharacter(db, "Friend");
    const target = await newCharacter(db, "Buddy", "gale");

    await addFriend(db, owner.id, target.id);
    await addFriend(db, owner.id, target.id);

    const found = await findCharacterByName(db, target.name);
    expect(found?.id).toBe(target.id);

    const rows = await listFriends(db, owner.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      characterId: target.id,
      name: target.name,
      kingdom: "gale",
    });

    await removeFriend(db, owner.id, target.id);
    expect(await listFriends(db, owner.id)).toHaveLength(0);
  });

  it("rejects self and unknown targets", async () => {
    const { db } = testDb;
    const owner = await newCharacter(db, "Solo");
    await expect(addFriend(db, owner.id, owner.id)).rejects.toMatchObject({ code: "self" });
    await expect(
      addFriend(db, owner.id, "11111111-1111-4111-8111-111111111111"),
    ).rejects.toBeInstanceOf(FriendRuleError);
  });

  it("marks online friends from the social directory", async () => {
    const { db } = testDb;
    const owner = await newCharacter(db, "Online");
    const target = await newCharacter(db, "Visible");
    await addFriend(db, owner.id, target.id);
    const directory = createSocialDirectory();
    directory.register({
      accountId: "a",
      characterId: target.id,
      sessionId: "s",
      name: target.name,
      kingdom: "ember",
      mapId: "map_ember_village",
      roomId: "room",
      send: vi.fn(),
    });
    const state = toFriendsState(await listFriends(db, owner.id), directory);
    expect(state.friends[0]?.online).toBe(true);
  });
});

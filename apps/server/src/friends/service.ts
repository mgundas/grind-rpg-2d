import { and, eq, sql } from "drizzle-orm";
import type { FriendsStatePayload, FriendView } from "@jadethrone/shared";
import type { Db } from "../db/client";
import { accounts, characters, friends } from "../db/schema";
import type { SocialDirectory } from "../social/bus";

export class FriendRuleError extends Error {
  readonly code: "not_found" | "self";

  constructor(code: "not_found" | "self", message: string) {
    super(message);
    this.name = "FriendRuleError";
    this.code = code;
  }
}

export interface FriendRecord {
  characterId: string;
  name: string;
  level: number;
  mapId: string;
  kingdom: string;
}

export async function findCharacterByName(
  db: Db,
  name: string,
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: characters.id })
    .from(characters)
    .where(sql`lower(${characters.name}) = lower(${name.trim()})`)
    .limit(1);
  return row ?? null;
}

export async function listFriends(db: Db, characterId: string): Promise<FriendRecord[]> {
  const rows = await db
    .select({
      characterId: friends.friendCharacterId,
      name: characters.name,
      level: characters.level,
      mapId: characters.mapId,
      kingdom: accounts.kingdom,
    })
    .from(friends)
    .innerJoin(characters, eq(friends.friendCharacterId, characters.id))
    .innerJoin(accounts, eq(characters.accountId, accounts.id))
    .where(eq(friends.characterId, characterId))
    .orderBy(sql`lower(${characters.name})`);
  return rows;
}

export async function addFriend(
  db: Db,
  characterId: string,
  targetCharacterId: string,
): Promise<void> {
  if (characterId === targetCharacterId) {
    throw new FriendRuleError("self", "You cannot add yourself.");
  }
  const [target] = await db
    .select({ id: characters.id })
    .from(characters)
    .where(eq(characters.id, targetCharacterId))
    .limit(1);
  if (!target) {
    throw new FriendRuleError("not_found", "Character not found.");
  }
  await db
    .insert(friends)
    .values({ characterId, friendCharacterId: targetCharacterId })
    .onConflictDoNothing();
}

export async function removeFriend(
  db: Db,
  characterId: string,
  targetCharacterId: string,
): Promise<void> {
  await db
    .delete(friends)
    .where(
      and(
        eq(friends.characterId, characterId),
        eq(friends.friendCharacterId, targetCharacterId),
      ),
    );
}

export function toFriendsState(
  records: readonly FriendRecord[],
  directory: SocialDirectory,
): FriendsStatePayload {
  const friends: FriendView[] = records.map((record) => ({
    ...record,
    online: directory.isOnline(record.characterId),
  }));
  return { friends };
}

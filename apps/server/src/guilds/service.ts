import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  GUILD_CREATE_GOLD,
  GUILD_CREATE_LEVEL,
  GUILD_MAX_MEMBERS,
  type GuildRank,
  type GuildView,
} from "@jadethrone/shared";
import type { Db, Tx } from "../db/client";
import { characters, goldLog, guildMembers, guilds } from "../db/schema";
import type { SocialDirectory } from "../social/bus";
import {
  GuildRuleError,
  assertPermission,
  canDisband,
  canKick,
  canPromote,
  validateGuildName,
} from "./rules";

export interface GuildMemberRecord {
  characterId: string;
  name: string;
  level: number;
  mapId: string;
  rank: GuildRank;
}

export interface GuildRecord {
  id: string;
  name: string;
  leaderCharacterId: string;
  members: GuildMemberRecord[];
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  );
}

async function membership(
  tx: Db | Tx,
  characterId: string,
): Promise<{ guildId: string; rank: GuildRank } | null> {
  const [row] = await tx
    .select({ guildId: guildMembers.guildId, rank: guildMembers.rank })
    .from(guildMembers)
    .where(eq(guildMembers.characterId, characterId))
    .limit(1);
  return row ? { guildId: row.guildId, rank: row.rank as GuildRank } : null;
}

export async function loadGuild(db: Db, guildId: string): Promise<GuildRecord | null> {
  const [guild] = await db.select().from(guilds).where(eq(guilds.id, guildId)).limit(1);
  if (!guild) {
    return null;
  }
  const members = await db
    .select({
      characterId: guildMembers.characterId,
      name: characters.name,
      level: characters.level,
      mapId: characters.mapId,
      rank: guildMembers.rank,
    })
    .from(guildMembers)
    .innerJoin(characters, eq(guildMembers.characterId, characters.id))
    .where(eq(guildMembers.guildId, guildId))
    .orderBy(guildMembers.rank, sql`lower(${characters.name})`);
  return {
    id: guild.id,
    name: guild.name,
    leaderCharacterId: guild.leaderCharacterId,
    members: members.map((member) => ({
      ...member,
      rank: member.rank as GuildRank,
    })),
  };
}

export async function loadGuildByCharacter(
  db: Db,
  characterId: string,
): Promise<GuildRecord | null> {
  const [row] = await db
    .select({ guildId: guildMembers.guildId })
    .from(guildMembers)
    .where(eq(guildMembers.characterId, characterId))
    .limit(1);
  return row ? loadGuild(db, row.guildId) : null;
}

export async function createGuild(
  db: Db,
  input: { characterId: string; name: string },
): Promise<string> {
  const name = validateGuildName(input.name);
  try {
    return await db.transaction(async (tx) => {
      const [character] = await tx
        .select({
          accountId: characters.accountId,
          level: characters.level,
          gold: characters.gold,
        })
        .from(characters)
        .where(eq(characters.id, input.characterId))
        .for("update")
        .limit(1);
      if (!character) {
        throw new GuildRuleError("not_found", "Character not found.");
      }
      if (character.level < GUILD_CREATE_LEVEL) {
        throw new GuildRuleError(
          "level_too_low",
          `Guilds require level ${GUILD_CREATE_LEVEL}.`,
        );
      }
      if (character.gold < GUILD_CREATE_GOLD) {
        throw new GuildRuleError("no_gold", "Not enough gold to create a guild.");
      }
      if (await membership(tx, input.characterId)) {
        throw new GuildRuleError("already_member", "You are already in a guild.");
      }
      const [sameName] = await tx
        .select({ id: guilds.id })
        .from(guilds)
        .where(sql`lower(${guilds.name}) = lower(${name})`)
        .limit(1);
      if (sameName) {
        throw new GuildRuleError("name_taken", "That guild name is taken.");
      }

      const guildId = randomUUID();
      await tx.insert(guilds).values({
        id: guildId,
        name,
        leaderCharacterId: input.characterId,
      });
      await tx.insert(guildMembers).values({
        guildId,
        characterId: input.characterId,
        rank: "leader",
      });
      const gold = character.gold - GUILD_CREATE_GOLD;
      await tx
        .update(characters)
        .set({ gold, updatedAt: new Date() })
        .where(eq(characters.id, input.characterId));
      await tx.insert(goldLog).values({
        id: randomUUID(),
        characterId: input.characterId,
        accountId: character.accountId,
        delta: -GUILD_CREATE_GOLD,
        balanceAfter: gold,
        reason: "guild_create",
        detail: { guildId, guildName: name },
      });
      return guildId;
    });
  } catch (error) {
    if (error instanceof GuildRuleError) {
      throw error;
    }
    if (isUniqueViolation(error)) {
      throw new GuildRuleError("name_taken", "That guild name is taken.");
    }
    throw error;
  }
}

export async function joinGuild(
  db: Db,
  input: { guildId: string; characterId: string; rank?: Exclude<GuildRank, "leader"> },
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const [guild] = await tx
        .select({ id: guilds.id })
        .from(guilds)
        .where(eq(guilds.id, input.guildId))
        .for("update")
        .limit(1);
      if (!guild) {
        throw new GuildRuleError("not_found", "Guild not found.");
      }
      if (await membership(tx, input.characterId)) {
        throw new GuildRuleError("already_member", "You are already in a guild.");
      }
      const [count] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(guildMembers)
        .where(eq(guildMembers.guildId, input.guildId));
      if ((count?.value ?? 0) >= GUILD_MAX_MEMBERS) {
        throw new GuildRuleError("guild_full", "That guild is full.");
      }
      await tx.insert(guildMembers).values({
        guildId: input.guildId,
        characterId: input.characterId,
        rank: input.rank ?? "member",
      });
    });
  } catch (error) {
    if (error instanceof GuildRuleError) {
      throw error;
    }
    if (isUniqueViolation(error)) {
      throw new GuildRuleError("already_member", "You are already in a guild.");
    }
    throw error;
  }
}

export async function leaveGuild(db: Db, characterId: string): Promise<void> {
  const member = await membership(db, characterId);
  if (!member) {
    throw new GuildRuleError("not_member", "You are not in a guild.");
  }
  if (member.rank === "leader") {
    throw new GuildRuleError("leader", "Disband the guild or transfer leadership first.");
  }
  await db.delete(guildMembers).where(eq(guildMembers.characterId, characterId));
}

export async function kickGuildMember(
  db: Db,
  input: { actorCharacterId: string; targetCharacterId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const actor = await membership(tx, input.actorCharacterId);
    if (!actor) {
      throw new GuildRuleError("not_member", "You are not in a guild.");
    }
    const target = await membership(tx, input.targetCharacterId);
    if (!target || target.guildId !== actor.guildId) {
      throw new GuildRuleError("target_not_found", "That member is not in your guild.");
    }
    assertPermission(canKick(actor.rank, target.rank), "You cannot kick that member.");
    await tx
      .delete(guildMembers)
      .where(eq(guildMembers.characterId, input.targetCharacterId));
  });
}

export async function setGuildRank(
  db: Db,
  input: { actorCharacterId: string; targetCharacterId: string; rank: Exclude<GuildRank, "leader"> },
): Promise<void> {
  await db.transaction(async (tx) => {
    const actor = await membership(tx, input.actorCharacterId);
    if (!actor) {
      throw new GuildRuleError("not_member", "You are not in a guild.");
    }
    assertPermission(canPromote(actor.rank), "Only the leader can change ranks.");
    const target = await membership(tx, input.targetCharacterId);
    if (!target || target.guildId !== actor.guildId) {
      throw new GuildRuleError("target_not_found", "That member is not in your guild.");
    }
    if (target.rank === "leader") {
      throw new GuildRuleError("leader", "The leader's rank cannot be changed.");
    }
    await tx
      .update(guildMembers)
      .set({ rank: input.rank })
      .where(eq(guildMembers.characterId, input.targetCharacterId));
  });
}

export async function disbandGuild(db: Db, characterId: string): Promise<void> {
  const member = await membership(db, characterId);
  if (!member) {
    throw new GuildRuleError("not_member", "You are not in a guild.");
  }
  assertPermission(canDisband(member.rank), "Only the leader can disband the guild.");
  await db.delete(guilds).where(eq(guilds.id, member.guildId));
}

export function toGuildView(
  guild: GuildRecord,
  directory: SocialDirectory,
): GuildView {
  return {
    id: guild.id,
    name: guild.name,
    leaderCharacterId: guild.leaderCharacterId,
    members: guild.members.map((member) => ({
      ...member,
      online: directory.isOnline(member.characterId),
    })),
  };
}

export async function findGuildIdByName(db: Db, name: string): Promise<string | null> {
  const [row] = await db
    .select({ id: guilds.id })
    .from(guilds)
    .where(sql`lower(${guilds.name}) = lower(${name.trim()})`)
    .limit(1);
  return row?.id ?? null;
}


/** Room-facing seam; production is DB-backed, room tests can inject a fake. */
export interface GuildService {
  loadByCharacter(characterId: string): Promise<GuildRecord | null>;
  loadById(guildId: string): Promise<GuildRecord | null>;
  create(characterId: string, name: string): Promise<string>;
  join(guildId: string, characterId: string): Promise<void>;
  leave(characterId: string): Promise<void>;
  kick(actorCharacterId: string, targetCharacterId: string): Promise<void>;
  setRank(
    actorCharacterId: string,
    targetCharacterId: string,
    rank: Exclude<GuildRank, "leader">,
  ): Promise<void>;
  disband(characterId: string): Promise<void>;
}

export function createGuildService(db: Db): GuildService {
  return {
    loadByCharacter: (characterId) => loadGuildByCharacter(db, characterId),
    loadById: (guildId) => loadGuild(db, guildId),
    create: (characterId, name) => createGuild(db, { characterId, name }),
    join: (guildId, characterId) => joinGuild(db, { guildId, characterId }),
    leave: (characterId) => leaveGuild(db, characterId),
    kick: (actorCharacterId, targetCharacterId) =>
      kickGuildMember(db, { actorCharacterId, targetCharacterId }),
    setRank: (actorCharacterId, targetCharacterId, rank) =>
      setGuildRank(db, { actorCharacterId, targetCharacterId, rank }),
    disband: (characterId) => disbandGuild(db, characterId),
  };
}

import { randomUUID } from "node:crypto";
import type { GuildRank } from "@jadethrone/shared";

export const GUILD_INVITE_TTL_MS = 30_000;

export interface GuildInvite {
  id: string;
  guildId: string;
  guildName: string;
  fromCharacterId: string;
  fromName: string;
  targetCharacterId: string;
  inviterRank: GuildRank;
  expiresAtMs: number;
}

export interface GuildInviteRegistry {
  create(input: {
    guildId: string;
    guildName: string;
    fromCharacterId: string;
    fromName: string;
    targetCharacterId: string;
    inviterRank: GuildRank;
    now?: number;
  }): GuildInvite;
  get(inviteId: string): GuildInvite | undefined;
  forTarget(characterId: string): GuildInvite | undefined;
  take(inviteId: string, targetCharacterId: string, now?: number): GuildInvite;
  decline(inviteId: string, targetCharacterId: string): GuildInvite;
  cancelForCharacter(characterId: string): GuildInvite[];
  prune(now?: number): GuildInvite[];
  clear(): void;
}

export class GuildInviteError extends Error {
  readonly code: "not_found" | "expired";

  constructor(code: "not_found" | "expired", message: string) {
    super(message);
    this.name = "GuildInviteError";
    this.code = code;
  }
}

export function createGuildInviteRegistry(options: {
  idFactory?: () => string;
} = {}): GuildInviteRegistry {
  const idFactory = options.idFactory ?? randomUUID;
  const byId = new Map<string, GuildInvite>();
  const byTarget = new Map<string, string>();

  function remove(invite: GuildInvite): void {
    byId.delete(invite.id);
    if (byTarget.get(invite.targetCharacterId) === invite.id) {
      byTarget.delete(invite.targetCharacterId);
    }
  }

  function create(input: {
    guildId: string;
    guildName: string;
    fromCharacterId: string;
    fromName: string;
    targetCharacterId: string;
    inviterRank: GuildRank;
    now?: number;
  }): GuildInvite {
    const previousId = byTarget.get(input.targetCharacterId);
    if (previousId) {
      const previous = byId.get(previousId);
      if (previous) {
        remove(previous);
      }
    }
    const now = input.now ?? Date.now();
    const invite: GuildInvite = {
      id: idFactory(),
      guildId: input.guildId,
      guildName: input.guildName,
      fromCharacterId: input.fromCharacterId,
      fromName: input.fromName,
      targetCharacterId: input.targetCharacterId,
      inviterRank: input.inviterRank,
      expiresAtMs: now + GUILD_INVITE_TTL_MS,
    };
    byId.set(invite.id, invite);
    byTarget.set(invite.targetCharacterId, invite.id);
    return invite;
  }

  function requireInvite(inviteId: string, targetCharacterId: string): GuildInvite {
    const invite = byId.get(inviteId);
    if (!invite || invite.targetCharacterId !== targetCharacterId) {
      throw new GuildInviteError("not_found", "That guild invite is no longer available.");
    }
    return invite;
  }

  return {
    create,
    get: (inviteId) => byId.get(inviteId),
    forTarget: (characterId) => {
      const id = byTarget.get(characterId);
      return id ? byId.get(id) : undefined;
    },
    take(inviteId, targetCharacterId, now = Date.now()) {
      const invite = requireInvite(inviteId, targetCharacterId);
      if (now >= invite.expiresAtMs) {
        remove(invite);
        throw new GuildInviteError("expired", "That guild invite expired.");
      }
      remove(invite);
      return invite;
    },
    decline(inviteId, targetCharacterId) {
      const invite = requireInvite(inviteId, targetCharacterId);
      remove(invite);
      return invite;
    },
    cancelForCharacter(characterId) {
      const cancelled: GuildInvite[] = [];
      for (const invite of [...byId.values()]) {
        if (
          invite.targetCharacterId === characterId ||
          invite.fromCharacterId === characterId
        ) {
          remove(invite);
          cancelled.push(invite);
        }
      }
      return cancelled;
    },
    prune(now = Date.now()) {
      const expired: GuildInvite[] = [];
      for (const invite of [...byId.values()]) {
        if (now >= invite.expiresAtMs) {
          remove(invite);
          expired.push(invite);
        }
      }
      return expired;
    },
    clear() {
      byId.clear();
      byTarget.clear();
    },
  };
}

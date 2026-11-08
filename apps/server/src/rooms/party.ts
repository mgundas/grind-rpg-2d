import { randomUUID } from "node:crypto";
import {
  PARTY_INVITE_TTL_MS,
  PARTY_MAX_MEMBERS,
  type PartyErrorCode,
  type PartyInvitePayload,
  type PartyLootRule,
  type PartyMemberView,
  type PartyStatePayload,
} from "@jadethrone/shared";

/** Rule violation with a stable client-facing party error code. */
export class PartyRuleError extends Error {
  readonly code: PartyErrorCode;

  constructor(code: PartyErrorCode, message: string) {
    super(message);
    this.name = "PartyRuleError";
    this.code = code;
  }
}

export interface PartyMember {
  characterId: string;
  sessionId: string;
  name: string;
  level: number;
  classId: string;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  dead: boolean;
  /** Monotonic join order; used for leader promotion and stable snapshots. */
  joinOrder: number;
}

export interface Party {
  id: string;
  leaderCharacterId: string;
  lootRule: PartyLootRule;
  members: Map<string, PartyMember>;
  roundRobinIndex: number;
  createdAtMs: number;
}

export interface PartyInvite {
  inviteId: string;
  partyId: string;
  fromCharacterId: string;
  fromName: string;
  targetCharacterId: string;
  expiresAtMs: number;
}

export interface PartyMemberInput {
  characterId: string;
  sessionId: string;
  name: string;
  level: number;
  classId: string;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  dead?: boolean;
}

export interface PartyLeaveResult {
  party: Party | null;
  disbanded: boolean;
}

export interface LootAssignment {
  ownerPartyId: string;
  ownerCharacterId: string;
}

export interface PartyRegistry {
  create(leader: PartyMemberInput, now?: number): Party;
  /** Returns the invite to deliver; replaces any older invite for the same pair. */
  invite(
    inviterCharacterId: string,
    targetCharacterId: string,
    targetName: string,
    now?: number,
  ): PartyInvite;
  accept(inviteId: string, member: PartyMemberInput, now?: number): Party;
  decline(inviteId: string, characterId?: string): boolean;
  leave(characterId: string): PartyLeaveResult;
  get(partyId: string): Party | undefined;
  all(): Party[];
  getByCharacter(characterId: string): Party | undefined;
  getInvite(inviteId: string): PartyInvite | undefined;
  setLootRule(characterId: string, rule: PartyLootRule): Party;
  updateMember(characterId: string, update: Partial<PartyMemberInput>): void;
  nextLootOwner(partyId: string): string | null;
  allocateLootOwner(characterId: string): LootAssignment;
  snapshot(party: Party): PartyStatePayload;
  members(party: Party): PartyMember[];
  pruneInvites(now?: number): number;
  clear(): void;
}

function clampVital(value: number, max: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(Math.floor(value), Math.max(0, Math.floor(max))));
}

function toMember(input: PartyMemberInput, joinOrder: number): PartyMember {
  return {
    characterId: input.characterId,
    sessionId: input.sessionId,
    name: input.name,
    level: Math.max(1, Math.floor(input.level)),
    classId: input.classId,
    hp: clampVital(input.hp, input.maxHp),
    maxHp: Math.max(0, Math.floor(input.maxHp)),
    mp: clampVital(input.mp, input.maxMp),
    maxMp: Math.max(0, Math.floor(input.maxMp)),
    dead: input.dead ?? false,
    joinOrder,
  };
}

export function createPartyRegistry(
  idFactory: () => string = randomUUID,
): PartyRegistry {
  const parties = new Map<string, Party>();
  const byCharacter = new Map<string, string>();
  const invites = new Map<string, PartyInvite>();
  let nextJoinOrder = 1;

  function requireParty(characterId: string): Party {
    const partyId = byCharacter.get(characterId);
    const party = partyId ? parties.get(partyId) : undefined;
    if (!party) {
      throw new PartyRuleError("not_in_party", "You are not in a party.");
    }
    return party;
  }

  function removeInvitesForTarget(targetCharacterId: string): void {
    for (const [id, invite] of invites) {
      if (invite.targetCharacterId === targetCharacterId) {
        invites.delete(id);
      }
    }
  }

  function removeInvitesForParty(partyId: string): void {
    for (const [id, invite] of invites) {
      if (invite.partyId === partyId) {
        invites.delete(id);
      }
    }
  }

  function deleteParty(party: Party): void {
    removeInvitesForParty(party.id);
    for (const member of party.members.values()) {
      byCharacter.delete(member.characterId);
    }
    parties.delete(party.id);
  }

  function promoteLeader(party: Party): void {
    let next: PartyMember | null = null;
    for (const member of party.members.values()) {
      if (!next || member.joinOrder < next.joinOrder) {
        next = member;
      }
    }
    party.leaderCharacterId = next?.characterId ?? "";
  }

  function create(leader: PartyMemberInput, now = Date.now()): Party {
    if (byCharacter.has(leader.characterId)) {
      throw new PartyRuleError("already_in_party", "You are already in a party.");
    }
    const party: Party = {
      id: idFactory(),
      leaderCharacterId: leader.characterId,
      lootRule: "free_for_all",
      members: new Map(),
      roundRobinIndex: 0,
      createdAtMs: now,
    };
    party.members.set(leader.characterId, toMember(leader, nextJoinOrder++));
    parties.set(party.id, party);
    byCharacter.set(leader.characterId, party.id);
    return party;
  }

  function invite(
    inviterCharacterId: string,
    targetCharacterId: string,
    targetName: string,
    now = Date.now(),
  ): PartyInvite {
    const party = requireParty(inviterCharacterId);
    const inviter = party.members.get(inviterCharacterId);
    if (!inviter) {
      throw new PartyRuleError("not_in_party", "You are not in a party.");
    }
    if (targetCharacterId === inviterCharacterId) {
      throw new PartyRuleError("target_self", "You cannot invite yourself.");
    }
    if (party.members.has(targetCharacterId)) {
      throw new PartyRuleError("already_in_party", `${targetName} is already in your party.`);
    }
    if (party.members.size >= PARTY_MAX_MEMBERS) {
      throw new PartyRuleError("party_full", "The party is full.");
    }
    removeInvitesForTarget(targetCharacterId);
    const invite: PartyInvite = {
      inviteId: idFactory(),
      partyId: party.id,
      fromCharacterId: inviterCharacterId,
      fromName: inviter.name,
      targetCharacterId,
      expiresAtMs: now + PARTY_INVITE_TTL_MS,
    };
    invites.set(invite.inviteId, invite);
    return invite;
  }

  function accept(inviteId: string, member: PartyMemberInput, now = Date.now()): Party {
    const invite = invites.get(inviteId);
    if (!invite) {
      throw new PartyRuleError("invite_not_found", "That invitation is no longer available.");
    }
    if (invite.expiresAtMs <= now) {
      invites.delete(inviteId);
      throw new PartyRuleError("invite_expired", "That invitation has expired.");
    }
    if (invite.targetCharacterId !== member.characterId) {
      throw new PartyRuleError("invite_not_found", "That invitation is not for you.");
    }
    if (byCharacter.has(member.characterId)) {
      throw new PartyRuleError("already_in_party", "You are already in a party.");
    }
    const party = parties.get(invite.partyId);
    if (!party) {
      invites.delete(inviteId);
      throw new PartyRuleError("invite_not_found", "That party no longer exists.");
    }
    if (party.members.size >= PARTY_MAX_MEMBERS) {
      throw new PartyRuleError("party_full", "The party is full.");
    }
    party.members.set(member.characterId, toMember(member, nextJoinOrder++));
    byCharacter.set(member.characterId, party.id);
    removeInvitesForTarget(member.characterId);
    return party;
  }

  function decline(inviteId: string, characterId?: string): boolean {
    const invite = invites.get(inviteId);
    if (!invite || (characterId && invite.targetCharacterId !== characterId)) {
      return false;
    }
    return invites.delete(inviteId);
  }

  function leave(characterId: string): PartyLeaveResult {
    const party = requireParty(characterId);
    party.members.delete(characterId);
    byCharacter.delete(characterId);
    if (party.members.size === 0) {
      deleteParty(party);
      return { party: null, disbanded: true };
    }
    if (party.leaderCharacterId === characterId) {
      promoteLeader(party);
    }
    party.roundRobinIndex %= party.members.size;
    return { party, disbanded: false };
  }

  function setLootRule(characterId: string, rule: PartyLootRule): Party {
    const party = requireParty(characterId);
    if (party.leaderCharacterId !== characterId) {
      throw new PartyRuleError("not_leader", "Only the party leader can change loot rules.");
    }
    if (rule !== "free_for_all" && rule !== "round_robin") {
      throw new PartyRuleError("invalid_rule", "Unknown loot rule.");
    }
    party.lootRule = rule;
    return party;
  }

  function updateMember(characterId: string, update: Partial<PartyMemberInput>): void {
    const party = byCharacter.get(characterId);
    const member = party ? parties.get(party)?.members.get(characterId) : undefined;
    if (!member) {
      return;
    }
    if (update.level !== undefined) member.level = Math.max(1, Math.floor(update.level));
    if (update.maxHp !== undefined) member.maxHp = Math.max(0, Math.floor(update.maxHp));
    if (update.maxMp !== undefined) member.maxMp = Math.max(0, Math.floor(update.maxMp));
    if (update.hp !== undefined) member.hp = clampVital(update.hp, member.maxHp);
    if (update.mp !== undefined) member.mp = clampVital(update.mp, member.maxMp);
    if (update.dead !== undefined) member.dead = update.dead;
    member.hp = clampVital(member.hp, member.maxHp);
    member.mp = clampVital(member.mp, member.maxMp);
  }

  function nextLootOwner(partyId: string): string | null {
    const party = parties.get(partyId);
    if (!party || party.members.size === 0) {
      return null;
    }
    const ordered = [...party.members.values()].sort((a, b) => a.joinOrder - b.joinOrder);
    for (let offset = 0; offset < ordered.length; offset++) {
      const index = (party.roundRobinIndex + offset) % ordered.length;
      const member = ordered[index]!;
      if (!member.dead) {
        party.roundRobinIndex = (index + 1) % ordered.length;
        return member.characterId;
      }
    }
    return null;
  }

  function allocateLootOwner(characterId: string): LootAssignment {
    const party = byCharacter.get(characterId) ? parties.get(byCharacter.get(characterId)!) : undefined;
    if (!party) {
      return { ownerPartyId: "", ownerCharacterId: characterId };
    }
    if (party.lootRule === "free_for_all") {
      return { ownerPartyId: party.id, ownerCharacterId: "" };
    }
    return {
      ownerPartyId: party.id,
      ownerCharacterId: nextLootOwner(party.id) ?? "",
    };
  }

  function snapshot(party: Party): PartyStatePayload {
    const members: PartyMemberView[] = [...party.members.values()]
      .sort((a, b) => a.joinOrder - b.joinOrder)
      .map((member) => ({
        characterId: member.characterId,
        name: member.name,
        level: member.level,
        classId: member.classId,
        hp: member.hp,
        maxHp: member.maxHp,
        mp: member.mp,
        maxMp: member.maxMp,
        dead: member.dead,
        leader: member.characterId === party.leaderCharacterId,
      }));
    return {
      partyId: party.id,
      leaderCharacterId: party.leaderCharacterId,
      lootRule: party.lootRule,
      members,
    };
  }

  function pruneInvites(now = Date.now()): number {
    let removed = 0;
    for (const [id, invite] of invites) {
      if (invite.expiresAtMs <= now || !parties.has(invite.partyId)) {
        invites.delete(id);
        removed++;
      }
    }
    return removed;
  }

  return {
    create,
    invite,
    accept,
    decline,
    leave,
    get(partyId) {
      return parties.get(partyId);
    },
    all() {
      return [...parties.values()];
    },
    getByCharacter(characterId) {
      const partyId = byCharacter.get(characterId);
      return partyId ? parties.get(partyId) : undefined;
    },
    getInvite(inviteId) {
      return invites.get(inviteId);
    },
    setLootRule,
    updateMember,
    nextLootOwner,
    allocateLootOwner,
    snapshot,
    members(party) {
      return [...party.members.values()].sort((a, b) => a.joinOrder - b.joinOrder);
    },
    pruneInvites,
    clear() {
      parties.clear();
      byCharacter.clear();
      invites.clear();
      nextJoinOrder = 1;
    },
  };
}

export function toPartyInvitePayload(invite: PartyInvite): PartyInvitePayload {
  return {
    inviteId: invite.inviteId,
    partyId: invite.partyId,
    fromCharacterId: invite.fromCharacterId,
    fromName: invite.fromName,
    expiresAtMs: invite.expiresAtMs,
  };
}

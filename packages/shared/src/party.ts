/** Party limits and rules shared by the room, protocol and client frames. */
export const PARTY_MAX_MEMBERS = 8;
export const PARTY_INVITE_TTL_MS = 30_000;
export const PARTY_XP_RADIUS_PX = 1500;

export const PARTY_LOOT_RULES = ["free_for_all", "round_robin"] as const;
export type PartyLootRule = (typeof PARTY_LOOT_RULES)[number];

export interface PartyMemberView {
  characterId: string;
  name: string;
  level: number;
  classId: string;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  dead: boolean;
  leader: boolean;
}

export interface PartyStatePayload {
  partyId: string;
  leaderCharacterId: string;
  lootRule: PartyLootRule;
  members: PartyMemberView[];
}

export interface PartyInvitePayload {
  inviteId: string;
  partyId: string;
  fromCharacterId: string;
  fromName: string;
  expiresAtMs: number;
}

export const PARTY_ERROR_CODES = [
  "not_in_party",
  "already_in_party",
  "party_full",
  "invite_expired",
  "invite_not_found",
  "not_leader",
  "target_offline",
  "target_self",
  "invalid_rule",
  "internal",
] as const;
export type PartyErrorCode = (typeof PARTY_ERROR_CODES)[number];

export interface PartyErrorPayload {
  code: PartyErrorCode;
  message: string;
}

/** One member's contribution to a party XP award, before applying joined-at. */
export interface PartyXpAward {
  sessionId: string;
  characterId: string;
  eligible: boolean;
}

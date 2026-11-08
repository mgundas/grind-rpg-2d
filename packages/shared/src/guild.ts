/** Guild rules shared by server validation and client UI (GAME_DESIGN.md §9). */
export const GUILD_RANKS = ["leader", "officer", "member"] as const;
export type GuildRank = (typeof GUILD_RANKS)[number];

export const GUILD_MAX_MEMBERS = 32;
export const GUILD_CREATE_LEVEL = 30;
export const GUILD_CREATE_GOLD = 500_000;
export const GUILD_NAME_MIN = 3;
export const GUILD_NAME_MAX = 20;

export const GUILD_ERROR_CODES = [
  "not_found",
  "not_member",
  "already_member",
  "invalid_name",
  "name_taken",
  "level_too_low",
  "no_gold",
  "guild_full",
  "permission",
  "leader",
  "target_not_found",
  "internal",
] as const;
export type GuildErrorCode = (typeof GUILD_ERROR_CODES)[number];

export interface GuildMemberView {
  characterId: string;
  name: string;
  level: number;
  rank: GuildRank;
  online: boolean;
  mapId: string;
}

export interface GuildView {
  id: string;
  name: string;
  leaderCharacterId: string;
  members: GuildMemberView[];
}

export interface GuildStatePayload {
  guild: GuildView | null;
}

export interface GuildErrorPayload {
  code: GuildErrorCode;
  message?: string;
}

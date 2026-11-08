import {
  GUILD_NAME_MAX,
  GUILD_NAME_MIN,
  type GuildErrorCode,
  type GuildRank,
} from "@jadethrone/shared";

export class GuildRuleError extends Error {
  readonly code: GuildErrorCode;

  constructor(code: GuildErrorCode, message: string) {
    super(message);
    this.name = "GuildRuleError";
    this.code = code;
  }
}

const NAME_PATTERN = new RegExp(`^[A-Za-z0-9][A-Za-z0-9 ]{${GUILD_NAME_MIN - 1},${GUILD_NAME_MAX - 1}}$`);

/** Trimmed display name or a typed error. */
export function validateGuildName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!NAME_PATTERN.test(name) || name.length < GUILD_NAME_MIN || name.length > GUILD_NAME_MAX) {
    throw new GuildRuleError(
      "invalid_name",
      `Guild names are ${GUILD_NAME_MIN}–${GUILD_NAME_MAX} letters, numbers or spaces.`,
    );
  }
  return name;
}

export function canInvite(rank: GuildRank): boolean {
  return rank === "leader" || rank === "officer";
}

export function canKick(actor: GuildRank, target: GuildRank): boolean {
  if (actor === "leader") {
    return target !== "leader";
  }
  return actor === "officer" && target === "member";
}

export function canPromote(actor: GuildRank): boolean {
  return actor === "leader";
}

export function canDisband(actor: GuildRank): boolean {
  return actor === "leader";
}

export function assertPermission(allowed: boolean, message = "You cannot do that."): void {
  if (!allowed) {
    throw new GuildRuleError("permission", message);
  }
}

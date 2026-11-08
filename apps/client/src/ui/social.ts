import {
  MAP_LABELS,
  type FriendView,
  type GuildMemberView,
  type GuildRank,
} from "@jadethrone/shared";

export function guildRankLabel(rank: GuildRank): string {
  return rank === "leader" ? "Leader" : rank === "officer" ? "Officer" : "Member";
}

export function canInviteGuild(rank: GuildRank | null): boolean {
  return rank === "leader" || rank === "officer";
}

export function canKickGuild(actor: GuildRank | null, target: GuildRank): boolean {
  if (actor === "leader") {
    return target !== "leader";
  }
  return actor === "officer" && target === "member";
}

export function canChangeGuildRank(actor: GuildRank | null, target: GuildRank): boolean {
  return actor === "leader" && target !== "leader";
}

export function canDisbandGuild(rank: GuildRank | null): boolean {
  return rank === "leader";
}

export function sortGuildMembers(members: readonly GuildMemberView[]): GuildMemberView[] {
  const order: Record<GuildRank, number> = { leader: 0, officer: 1, member: 2 };
  return [...members].sort(
    (one, two) =>
      order[one.rank] - order[two.rank] ||
      Number(two.online) - Number(one.online) ||
      one.name.localeCompare(two.name),
  );
}

export function friendStatus(friend: FriendView): string {
  if (!friend.online) {
    return "Offline";
  }
  return `Online · ${MAP_LABELS[friend.mapId as keyof typeof MAP_LABELS] ?? friend.mapId}`;
}

export function friendLevel(friend: FriendView): string {
  return `Lv ${friend.level}`;
}

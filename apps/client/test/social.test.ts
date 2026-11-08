import { describe, expect, it } from "vitest";
import type { FriendView, GuildMemberView } from "@jadethrone/shared";
import {
  canChangeGuildRank,
  canDisbandGuild,
  canInviteGuild,
  canKickGuild,
  friendStatus,
  guildRankLabel,
  sortGuildMembers,
} from "../src/ui/social";

function member(overrides: Partial<GuildMemberView> = {}): GuildMemberView {
  return {
    characterId: "char-1",
    name: "Alice",
    level: 30,
    rank: "member",
    online: true,
    mapId: "map_ember_village",
    ...overrides,
  };
}

function friend(overrides: Partial<FriendView> = {}): FriendView {
  return {
    characterId: "friend-1",
    name: "Bob",
    level: 12,
    mapId: "map_ember_fields",
    kingdom: "ember",
    online: true,
    ...overrides,
  };
}

describe("social helpers", () => {
  it("labels ranks and applies management permissions", () => {
    expect(guildRankLabel("leader")).toBe("Leader");
    expect(guildRankLabel("officer")).toBe("Officer");
    expect(guildRankLabel("member")).toBe("Member");

    expect(canInviteGuild("leader")).toBe(true);
    expect(canInviteGuild("officer")).toBe(true);
    expect(canInviteGuild("member")).toBe(false);
    expect(canKickGuild("leader", "officer")).toBe(true);
    expect(canKickGuild("officer", "officer")).toBe(false);
    expect(canChangeGuildRank("leader", "member")).toBe(true);
    expect(canChangeGuildRank("officer", "member")).toBe(false);
    expect(canDisbandGuild("leader")).toBe(true);
    expect(canDisbandGuild("officer")).toBe(false);
  });

  it("sorts online leaders first and formats friends", () => {
    const sorted = sortGuildMembers([
      member({ characterId: "m", name: "Member", rank: "member", online: true }),
      member({ characterId: "l", name: "Leader", rank: "leader", online: false }),
      member({ characterId: "o", name: "Officer", rank: "officer", online: true }),
    ]);
    expect(sorted.map((entry) => entry.rank)).toEqual(["leader", "officer", "member"]);
    expect(friendStatus(friend())).toContain("Online");
    expect(friendStatus(friend({ online: false }))).toBe("Offline");
  });
});

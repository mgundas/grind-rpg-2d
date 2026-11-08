import { describe, expect, it } from "vitest";
import {
  GUILD_INVITE_TTL_MS,
  GuildInviteError,
  createGuildInviteRegistry,
} from "../../src/social/guildInvites";

function registry() {
  let index = 0;
  return createGuildInviteRegistry({ idFactory: () => `invite-${++index}` });
}

function input(target = "target") {
  return {
    guildId: "guild-1",
    guildName: "Jade",
    fromCharacterId: "inviter",
    fromName: "Alice",
    targetCharacterId: target,
    inviterRank: "leader" as const,
    now: 1_000,
  };
}

describe("guild invite registry", () => {
  it("creates one pending invite per target and replaces older ones", () => {
    const invites = registry();
    const first = invites.create(input());
    const second = invites.create(input());
    expect(invites.get(first.id)).toBeUndefined();
    expect(invites.forTarget("target")?.id).toBe(second.id);
    expect(second.expiresAtMs).toBe(1_000 + GUILD_INVITE_TTL_MS);
  });

  it("takes and expires invites for the right target", () => {
    const invites = registry();
    const invite = invites.create(input());
    expect(() => invites.take(invite.id, "other")).toThrow(GuildInviteError);
    expect(() => invites.take(invite.id, "target", invite.expiresAtMs)).toThrow(
      /expired/,
    );
    expect(invites.forTarget("target")).toBeUndefined();

    const next = invites.create(input());
    expect(invites.take(next.id, "target", 2_000).id).toBe(next.id);
    expect(invites.forTarget("target")).toBeUndefined();
  });

  it("declines, cancels by character and prunes", () => {
    const invites = registry();
    const one = invites.create(input("target-a"));
    expect(invites.decline(one.id, "target-a").id).toBe(one.id);

    const two = invites.create(input("target-b"));
    expect(invites.cancelForCharacter("inviter").map((invite) => invite.id)).toEqual([
      two.id,
    ]);

    const three = invites.create(input("target-c"));
    expect(invites.prune(100_000).map((invite) => invite.id)).toEqual([three.id]);
  });
});

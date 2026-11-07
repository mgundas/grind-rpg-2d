import { describe, expect, it } from "vitest";
import { PARTY_MAX_MEMBERS } from "@jadethrone/shared";
import {
  createPartyRegistry,
  PartyRuleError,
  toPartyInvitePayload,
  type PartyMemberInput,
} from "../../src/rooms/party";

function ids(): () => string {
  let next = 0;
  return () => `id-${++next}`;
}

function member(index: number, overrides: Partial<PartyMemberInput> = {}): PartyMemberInput {
  return {
    characterId: `char-${index}`,
    sessionId: `session-${index}`,
    name: `Member${index}`,
    level: 10,
    classId: "warrior",
    hp: 100,
    maxHp: 100,
    mp: 20,
    maxMp: 50,
    ...overrides,
  };
}

function ruleError(run: () => unknown): PartyRuleError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(PartyRuleError);
    return error as PartyRuleError;
  }
  throw new Error("expected a party rule error");
}

describe("party registry", () => {
  it("creates a party and accepts an invite", () => {
    const registry = createPartyRegistry(ids());
    const leader = member(1);
    const party = registry.create(leader);
    expect(party.leaderCharacterId).toBe("char-1");

    const invite = registry.invite("char-1", "char-2", "Member2");
    expect(toPartyInvitePayload(invite)).toMatchObject({
      fromCharacterId: "char-1",
      fromName: "Member1",
    });
    const joined = registry.accept(invite.inviteId, member(2));
    expect(joined.id).toBe(party.id);
    expect(registry.snapshot(joined).members.map((entry) => entry.name)).toEqual([
      "Member1",
      "Member2",
    ]);
  });

  it("enforces the member cap, self-invite and duplicate membership", () => {
    const registry = createPartyRegistry(ids());
    registry.create(member(0));
    expect(ruleError(() => registry.invite("char-0", "char-0", "Self")).code).toBe("target_self");

    for (let index = 1; index < PARTY_MAX_MEMBERS; index++) {
      const invite = registry.invite("char-0", `char-${index}`, `Member${index}`);
      registry.accept(invite.inviteId, member(index));
    }
    expect(ruleError(() => registry.invite("char-0", "char-extra", "Extra")).code).toBe(
      "party_full",
    );
    expect(ruleError(() => registry.invite("char-0", "char-1", "Member1")).code).toBe(
      "already_in_party",
    );
    expect(
      ruleError(() => registry.create(member(0))).code,
    ).toBe("already_in_party");
  });

  it("expires and declines invitations", () => {
    const registry = createPartyRegistry(ids());
    registry.create(member(1));
    const invite = registry.invite("char-1", "char-2", "Member2", 1000);
    expect(ruleError(() => registry.accept(invite.inviteId, member(2), 1000 + 30_001)).code).toBe(
      "invite_expired",
    );

    const second = registry.invite("char-1", "char-2", "Member2", 2000);
    expect(registry.decline(second.inviteId)).toBe(true);
    expect(ruleError(() => registry.accept(second.inviteId, member(2), 2000)).code).toBe(
      "invite_not_found",
    );
  });

  it("replaces an older invite for the same target", () => {
    const registry = createPartyRegistry(ids());
    registry.create(member(1));
    const first = registry.invite("char-1", "char-2", "Member2");
    const second = registry.invite("char-1", "char-2", "Member2");
    expect(registry.getInvite(first.inviteId)).toBeUndefined();
    expect(registry.getInvite(second.inviteId)).toBeDefined();
  });

  it("promotes the longest-standing member when the leader leaves", () => {
    const registry = createPartyRegistry(ids());
    registry.create(member(1));
    for (const index of [2, 3]) {
      const invite = registry.invite("char-1", `char-${index}`, `Member${index}`);
      registry.accept(invite.inviteId, member(index));
    }
    const result = registry.leave("char-1");
    expect(result.disbanded).toBe(false);
    expect(result.party?.leaderCharacterId).toBe("char-2");
    expect(registry.leave("char-2").party?.leaderCharacterId).toBe("char-3");
    expect(registry.leave("char-3")).toEqual({ party: null, disbanded: true });
    expect(registry.getByCharacter("char-3")).toBeUndefined();
  });

  it("only the leader changes the loot rule", () => {
    const registry = createPartyRegistry(ids());
    registry.create(member(1));
    const invite = registry.invite("char-1", "char-2", "Member2");
    registry.accept(invite.inviteId, member(2));

    expect(ruleError(() => registry.setLootRule("char-2", "round_robin")).code).toBe("not_leader");
    const party = registry.setLootRule("char-1", "round_robin");
    expect(party.lootRule).toBe("round_robin");
  });

  it("assigns solo, free-for-all and round-robin loot owners", () => {
    const registry = createPartyRegistry(ids());
    expect(registry.allocateLootOwner("solo")).toEqual({
      ownerPartyId: "",
      ownerCharacterId: "solo",
    });

    const party = registry.create(member(1));
    registry.accept(registry.invite("char-1", "char-2", "Member2").inviteId, member(2));
    expect(registry.allocateLootOwner("char-1")).toEqual({
      ownerPartyId: party.id,
      ownerCharacterId: "",
    });

    registry.setLootRule("char-1", "round_robin");
    expect(registry.allocateLootOwner("char-1")).toEqual({
      ownerPartyId: party.id,
      ownerCharacterId: "char-1",
    });
    expect(registry.allocateLootOwner("char-1")).toEqual({
      ownerPartyId: party.id,
      ownerCharacterId: "char-2",
    });
    registry.updateMember("char-1", { dead: true });
    registry.updateMember("char-2", { dead: true });
    expect(registry.allocateLootOwner("char-1")).toEqual({
      ownerPartyId: party.id,
      ownerCharacterId: "",
    });
  });

  it("rotates loot and skips dead members", () => {
    const registry = createPartyRegistry(ids());
    const party = registry.create(member(1));
    registry.accept(registry.invite("char-1", "char-2", "Member2").inviteId, member(2));
    registry.accept(registry.invite("char-1", "char-3", "Member3").inviteId, member(3));

    expect(registry.nextLootOwner(party.id)).toBe("char-1");
    expect(registry.nextLootOwner(party.id)).toBe("char-2");
    registry.updateMember("char-2", { dead: true });
    expect(registry.nextLootOwner(party.id)).toBe("char-3");
    registry.updateMember("char-3", { dead: true });
    expect(registry.nextLootOwner(party.id)).toBe("char-1");
  });

  it("updates vitals with clamps for the party frames", () => {
    const registry = createPartyRegistry(ids());
    const party = registry.create(member(1));
    registry.updateMember("char-1", { hp: 999, maxHp: 200, mp: -5, level: 12 });
    const view = registry.snapshot(party).members[0]!;
    expect(view.hp).toBe(200);
    expect(view.maxHp).toBe(200);
    expect(view.mp).toBe(0);
    expect(view.level).toBe(12);
  });

  it("prunes invitations for expired entries and missing parties", () => {
    const registry = createPartyRegistry(ids());
    registry.create(member(1));
    registry.invite("char-1", "char-2", "Member2", 1000);
    expect(registry.pruneInvites(1000 + 30_001)).toBe(1);
  });
});

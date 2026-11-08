import { describe, expect, it } from "vitest";
import { MAX_GOLD, TRADE_MAX_OFFER_ITEMS } from "@jadethrone/shared";
import {
  TRADE_CLOSED_RETENTION_MS,
  TRADE_IDLE_TTL_MS,
  TRADE_INVITE_TTL_MS,
  TradeRuleError,
  createTradeRegistry,
  sortedCharacterPairKey,
  toTradeInvitePayload,
  type TradePeer,
} from "../../src/rooms/trade";

const ALICE: TradePeer = { characterId: "a-alice", accountId: "acc-1", name: "Alice" };
const BOB: TradePeer = { characterId: "b-bob", accountId: "acc-2", name: "Bob" };
const CAROL: TradePeer = { characterId: "c-carol", accountId: "acc-3", name: "Carol" };
const SAME_ACCOUNT: TradePeer = {
  characterId: "a-alt",
  accountId: "acc-1",
  name: "Alt",
};

function ids(): () => string {
  let value = 0;
  return () => `trade-${++value}`;
}

function openTrade(registry = createTradeRegistry({ idFactory: ids() })) {
  const invite = registry.invite(ALICE, BOB);
  const trade = registry.acceptInvite(invite.id, BOB.characterId);
  return { registry, trade };
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
    return "none";
  } catch (error) {
    if (error instanceof TradeRuleError) {
      return error.code;
    }
    throw error;
  }
}

describe("trade registry invites", () => {
  it("opens a trade after the target accepts", () => {
    const registry = createTradeRegistry({ idFactory: ids() });
    const now = 1_000;
    const invite = registry.invite(ALICE, BOB, now);
    expect(invite.phase).toBe("invited");
    expect(invite.revision).toBe(0);
    expect(invite.expiresAtMs).toBe(now + TRADE_INVITE_TTL_MS);
    expect(invite.a.characterId < invite.b.characterId).toBe(true);
    expect(invite.pairKey).toBe(sortedCharacterPairKey(ALICE.characterId, BOB.characterId));
    expect(toTradeInvitePayload(invite)).toEqual({
      tradeId: invite.id,
      fromCharacterId: ALICE.characterId,
      fromName: ALICE.name,
      expiresAtMs: now + TRADE_INVITE_TTL_MS,
    });

    const trade = registry.acceptInvite(invite.id, BOB.characterId, now + 1);
    expect(trade.phase).toBe("open");
    expect(trade.invitedCharacterId).toBeNull();
    expect(registry.getByCharacter(ALICE.characterId)?.id).toBe(trade.id);
    expect(registry.getByCharacter(BOB.characterId)?.id).toBe(trade.id);
  });

  it("rejects self trades, same accounts, offline targets and busy players", () => {
    const offline = createTradeRegistry({
      idFactory: ids(),
      isOnline: (characterId) => characterId !== BOB.characterId,
    });
    expect(codeOf(() => offline.invite(ALICE, { ...ALICE }))).toBe("self_trade");
    expect(codeOf(() => offline.invite(ALICE, SAME_ACCOUNT))).toBe("same_account");
    expect(codeOf(() => offline.invite(ALICE, BOB))).toBe("offline");

    const registry = createTradeRegistry({ idFactory: ids() });
    const invite = registry.invite(ALICE, BOB);
    registry.acceptInvite(invite.id, BOB.characterId);
    expect(codeOf(() => registry.invite(ALICE, CAROL))).toBe("busy");
    expect(codeOf(() => registry.invite(CAROL, BOB))).toBe("busy");
  });

  it("replaces a pending invite in the same pair", () => {
    const registry = createTradeRegistry({ idFactory: ids() });
    const first = registry.invite(ALICE, BOB);
    const second = registry.invite(ALICE, BOB);
    expect(second.id).not.toBe(first.id);
    expect(registry.get(first.id)?.phase).toBe("cancelled");
    expect(codeOf(() => registry.acceptInvite(first.id, BOB.characterId))).toBe("not_found");
    expect(registry.acceptInvite(second.id, BOB.characterId).phase).toBe("open");
  });

  it("expires invites at exactly the TTL", () => {
    const registry = createTradeRegistry({ idFactory: ids() });
    const now = 1_000;
    const invite = registry.invite(ALICE, BOB, now);
    expect(
      codeOf(() => registry.acceptInvite(invite.id, BOB.characterId, now + TRADE_INVITE_TTL_MS)),
    ).toBe("expired");
    expect(registry.get(invite.id)?.phase).toBe("cancelled");
    expect(registry.get(invite.id)?.closeReason).toBe("timeout");
  });

  it("declines only for the invited character", () => {
    const registry = createTradeRegistry({ idFactory: ids() });
    const invite = registry.invite(ALICE, BOB);
    expect(codeOf(() => registry.declineInvite(invite.id, ALICE.characterId))).toBe("not_found");
    expect(registry.declineInvite(invite.id, BOB.characterId).closeReason).toBe("declined");
  });
});

describe("trade registry offers", () => {
  it("bumps the revision and clears locks and accepts on every change", () => {
    const { registry, trade } = openTrade();
    registry.setOffer(trade.id, ALICE.characterId, 0, { instanceIds: ["item-1"], gold: 100 });
    registry.setOffer(trade.id, BOB.characterId, 1, { instanceIds: ["item-2"], gold: 0 });
    registry.setLocked(trade.id, ALICE.characterId, 2, true);
    registry.setLocked(trade.id, BOB.characterId, 2, true);
    expect(registry.get(trade.id)?.phase).toBe("locked");

    const changed = registry.setOffer(trade.id, ALICE.characterId, 2, {
      instanceIds: ["item-1", "item-3"],
      gold: 50,
    });
    expect(changed.revision).toBe(3);
    expect(changed.phase).toBe("open");
    expect(changed.a.locked).toBe(false);
    expect(changed.b.locked).toBe(false);
    expect(changed.a.accepted).toBe(false);
    expect(changed.b.accepted).toBe(false);
  });

  it("treats an identical resubmitted offer as a no-op", () => {
    const { registry, trade } = openTrade();
    const first = registry.setOffer(trade.id, ALICE.characterId, 0, {
      instanceIds: ["item-2", "item-1"],
      gold: 10,
    });
    const second = registry.setOffer(trade.id, ALICE.characterId, first.revision, {
      instanceIds: ["item-1", "item-2"],
      gold: 10,
    });
    expect(second.revision).toBe(first.revision);
  });

  it("rejects stale revisions, duplicate ids and cross-side duplicates", () => {
    const { registry, trade } = openTrade();
    registry.setOffer(trade.id, ALICE.characterId, 0, { instanceIds: ["item-1"], gold: 0 });
    expect(
      codeOf(() =>
        registry.setOffer(trade.id, ALICE.characterId, 0, { instanceIds: [], gold: 0 }),
      ),
    ).toBe("revision");
    expect(
      codeOf(() =>
        registry.setOffer(trade.id, ALICE.characterId, 1, {
          instanceIds: ["item-1", "item-1"],
          gold: 0,
        }),
      ),
    ).toBe("invalid_offer");
    expect(
      codeOf(() =>
        registry.setOffer(trade.id, BOB.characterId, 1, {
          instanceIds: ["item-1"],
          gold: 0,
        }),
      ),
    ).toBe("invalid_offer");
    registry.setOffer(trade.id, BOB.characterId, 1, { instanceIds: ["item-2"], gold: 0 });
  });

  it("bounds gold and the number of offered items", () => {
    const { registry, trade } = openTrade();
    for (const gold of [-1, 1.5, MAX_GOLD + 1]) {
      expect(
        codeOf(() =>
          registry.setOffer(trade.id, ALICE.characterId, 0, { instanceIds: [], gold }),
        ),
      ).toBe("invalid_offer");
    }
    const tooMany = Array.from({ length: TRADE_MAX_OFFER_ITEMS + 1 }, (_, index) => `i-${index}`);
    expect(
      codeOf(() =>
        registry.setOffer(trade.id, ALICE.characterId, 0, {
          instanceIds: tooMany,
          gold: 0,
        }),
      ),
    ).toBe("invalid_offer");
  });
});

describe("trade registry locks and accepts", () => {
  it("locks only when both sides submit offers, then accepts in order", () => {
    const { registry, trade } = openTrade();
    expect(codeOf(() => registry.setLocked(trade.id, ALICE.characterId, 0, true))).toBe(
      "invalid_offer",
    );
    registry.setOffer(trade.id, ALICE.characterId, 0, { instanceIds: [], gold: 0 });
    registry.setOffer(trade.id, BOB.characterId, 1, { instanceIds: [], gold: 0 });
    registry.setLocked(trade.id, ALICE.characterId, 2, true);
    expect(registry.get(trade.id)?.phase).toBe("open");
    registry.setLocked(trade.id, BOB.characterId, 2, true);
    expect(registry.get(trade.id)?.phase).toBe("locked");

    const first = registry.accept(trade.id, ALICE.characterId, 2);
    expect(first.readyToCommit).toBe(false);
    expect(registry.accept(trade.id, ALICE.characterId, 2).readyToCommit).toBe(false);
    const second = registry.accept(trade.id, BOB.characterId, 2);
    expect(second.readyToCommit).toBe(true);
  });

  it("rejects accepting before both sides lock", () => {
    const { registry, trade } = openTrade();
    expect(codeOf(() => registry.accept(trade.id, ALICE.characterId, 0))).toBe("not_locked");
  });

  it("unlocking clears both accepts and returns to open", () => {
    const { registry, trade } = openTrade();
    registry.setOffer(trade.id, ALICE.characterId, 0, { instanceIds: [], gold: 0 });
    registry.setOffer(trade.id, BOB.characterId, 1, { instanceIds: [], gold: 0 });
    registry.setLocked(trade.id, ALICE.characterId, 2, true);
    registry.setLocked(trade.id, BOB.characterId, 2, true);
    registry.accept(trade.id, ALICE.characterId, 2);
    const unlocked = registry.setLocked(trade.id, ALICE.characterId, 2, false);
    expect(unlocked.phase).toBe("open");
    expect(unlocked.a.accepted).toBe(false);
    expect(unlocked.b.accepted).toBe(false);
  });

  it("completes only after both accepts and frees both characters", () => {
    const { registry, trade } = openTrade();
    registry.setOffer(trade.id, ALICE.characterId, 0, { instanceIds: [], gold: 0 });
    registry.setOffer(trade.id, BOB.characterId, 1, { instanceIds: [], gold: 0 });
    registry.setLocked(trade.id, ALICE.characterId, 2, true);
    registry.setLocked(trade.id, BOB.characterId, 2, true);
    expect(codeOf(() => registry.complete(trade.id))).toBe("not_locked");
    registry.accept(trade.id, ALICE.characterId, 2);
    registry.accept(trade.id, BOB.characterId, 2);
    const done = registry.complete(trade.id);
    expect(done.phase).toBe("completed");
    expect(registry.getByCharacter(ALICE.characterId)).toBeUndefined();
    expect(registry.getByCharacter(BOB.characterId)).toBeUndefined();

    const next = registry.invite(ALICE, CAROL);
    expect(registry.acceptInvite(next.id, CAROL.characterId).phase).toBe("open");
  });
});

describe("trade registry cancellation and expiry", () => {
  it("cancels active trades and pending invites for a character", () => {
    const registry = createTradeRegistry({ idFactory: ids() });
    expect(registry.cancelForCharacter(ALICE.characterId, "warp")).toBeNull();

    const invite = registry.invite(ALICE, BOB);
    expect(registry.cancelForCharacter(BOB.characterId, "death")?.id).toBe(invite.id);
    expect(registry.get(invite.id)?.closeReason).toBe("death");

    const opened = openTrade();
    opened.registry.setOffer(opened.trade.id, ALICE.characterId, 0, {
      instanceIds: [],
      gold: 0,
    });
    const cancelled = opened.registry.cancel(opened.trade.id, "inventory");
    expect(cancelled.phase).toBe("cancelled");
    expect(opened.registry.getByCharacter(ALICE.characterId)).toBeUndefined();
    expect(opened.registry.cancel(opened.trade.id, "error").phase).toBe("cancelled");
  });

  it("expires idle open trades and prunes terminal records", () => {
    const now = 5_000_000;
    const registry = createTradeRegistry({ idFactory: ids() });
    const invite = registry.invite(ALICE, BOB, now);
    const trade = registry.acceptInvite(invite.id, BOB.characterId, now + 1);
    registry.setOffer(trade.id, ALICE.characterId, 0, { instanceIds: [], gold: 0 }, now + 2);

    const at = now + 2 + TRADE_IDLE_TTL_MS;
    const pruned = registry.prune(at);
    expect(pruned.expiredTrades.map((entry) => entry.id)).toContain(trade.id);
    expect(registry.get(trade.id)?.closeReason).toBe("timeout");

    registry.prune(at + TRADE_CLOSED_RETENTION_MS);
    expect(registry.get(trade.id)).toBeUndefined();
  });

  it("prunes expired invites", () => {
    const registry = createTradeRegistry({ idFactory: ids() });
    const invite = registry.invite(ALICE, BOB, 0);
    const pruned = registry.prune(TRADE_INVITE_TTL_MS);
    expect(pruned.expiredInvites.map((entry) => entry.id)).toContain(invite.id);
  });

  it("times out an idle trade on the next mutation", () => {
    const now = 5_000_000;
    const registry = createTradeRegistry({ idFactory: ids() });
    const pending = registry.invite(ALICE, BOB, now);
    const trade = registry.acceptInvite(pending.id, BOB.characterId, now + 1);
    expect(
      codeOf(() =>
        registry.setOffer(
          trade.id,
          ALICE.characterId,
          0,
          { instanceIds: [], gold: 0 },
          now + 1 + TRADE_IDLE_TTL_MS,
        ),
      ),
    ).toBe("expired");
  });
});

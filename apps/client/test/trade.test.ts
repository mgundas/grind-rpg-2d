import { describe, expect, it } from "vitest";
import type { TradeStatePayload } from "@jadethrone/shared";
import {
  canAccept,
  canLock,
  goldOfferFromDraft,
  initialTradeUiState,
  tradeSideTotal,
  tradeStatusText,
  tradeUiReducer,
} from "../src/ui/trade";

function state(overrides: Partial<TradeStatePayload> = {}): TradeStatePayload {
  return {
    tradeId: "trade-1",
    revision: 2,
    phase: "open",
    you: {
      characterId: "char-1",
      name: "You",
      gold: 1_000,
      offeredGold: 100,
      items: [],
      locked: false,
      accepted: false,
    },
    other: {
      characterId: "char-2",
      name: "Them",
      gold: 500,
      offeredGold: 50,
      items: [],
      locked: false,
      accepted: false,
    },
    ...overrides,
  };
}

describe("tradeUiReducer", () => {
  it("stores invites and ignores them while a trade is open", () => {
    const invite = {
      tradeId: "trade-1",
      fromCharacterId: "char-2",
      fromName: "Them",
      expiresAtMs: 1,
    };
    let ui = tradeUiReducer(initialTradeUiState, { type: "invite", invite });
    expect(ui.invite).toEqual(invite);

    ui = tradeUiReducer(ui, { type: "state", state: state() });
    expect(ui.invite).toBeNull();
    const second = tradeUiReducer(ui, {
      type: "invite",
      invite: { ...invite, tradeId: "trade-2" },
    });
    expect(second.invite).toBeNull();
    expect(second.trade?.tradeId).toBe("trade-1");
  });

  it("ignores stale revisions and accepts equal-revision updates", () => {
    const current = tradeUiReducer(initialTradeUiState, { type: "state", state: state() });
    const stale = tradeUiReducer(current, {
      type: "state",
      state: state({ revision: 1, phase: "completed" }),
    });
    expect(stale.trade?.phase).toBe("open");

    const updated = tradeUiReducer(current, {
      type: "state",
      state: state({ phase: "locked", you: { ...state().you, locked: true } }),
    });
    expect(updated.trade?.phase).toBe("locked");
    expect(updated.goldDraft).toBe("100");
  });

  it("tracks errors, gold drafts and close", () => {
    let ui = tradeUiReducer(initialTradeUiState, {
      type: "error",
      error: { code: "revision", message: "Changed" },
    });
    expect(ui.error?.code).toBe("revision");
    ui = tradeUiReducer(ui, { type: "goldDraft", value: "12a3x" });
    expect(ui.goldDraft).toBe("123");
    expect(tradeUiReducer(ui, { type: "close" })).toEqual(initialTradeUiState);
  });
});

describe("trade helpers", () => {
  it("allows locking only while open and not already locked", () => {
    expect(canLock(state())).toBe(true);
    expect(canLock(state({ you: { ...state().you, locked: true } }))).toBe(false);
    expect(
      canLock(
        state({ phase: "locked", you: { ...state().you, locked: true } }),
      ),
    ).toBe(false);
    expect(canLock(null)).toBe(false);
  });

  it("allows accepting only after the lock phase", () => {
    expect(canAccept(state({ phase: "open" }))).toBe(false);
    expect(canAccept(state({ phase: "locked" }))).toBe(true);
    expect(
      canAccept(
        state({ phase: "locked", you: { ...state().you, accepted: true } }),
      ),
    ).toBe(false);
  });

  it("sums stack quantities and describes the phase", () => {
    expect(tradeSideTotal(state().you)).toBe(0);
    expect(tradeStatusText(state())).toBe("Build your offer");
    expect(tradeStatusText(state({ phase: "locked" }))).toBe(
      "Both offers locked — review and accept",
    );
    expect(tradeStatusText(state({ phase: "completed" }))).toBe("Trade complete");
  });

  it("clamps the gold draft to the balance", () => {
    expect(goldOfferFromDraft("250", 1_000)).toBe(250);
    expect(goldOfferFromDraft("5000", 1_000)).toBe(1_000);
    expect(goldOfferFromDraft("", 1_000)).toBe(0);
  });
});

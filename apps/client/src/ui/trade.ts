import type {
  TradeInvitePayload,
  TradeSidePayload,
  TradeStatePayload,
} from "@jadethrone/shared";

export interface TradeUiError {
  tradeId?: string;
  code: string;
  message?: string;
}

export interface TradeUiState {
  invite: TradeInvitePayload | null;
  trade: TradeStatePayload | null;
  error: TradeUiError | null;
  goldDraft: string;
}

export const initialTradeUiState: TradeUiState = {
  invite: null,
  trade: null,
  error: null,
  goldDraft: "0",
};

export type TradeUiAction =
  | { type: "invite"; invite: TradeInvitePayload }
  | { type: "state"; state: TradeStatePayload }
  | { type: "error"; error: TradeUiError }
  | { type: "clearError" }
  | { type: "goldDraft"; value: string }
  | { type: "close" };

export function tradeUiReducer(state: TradeUiState, action: TradeUiAction): TradeUiState {
  switch (action.type) {
    case "invite":
      if (state.trade) {
        return state;
      }
      return { ...initialTradeUiState, invite: action.invite };
    case "state": {
      if (state.trade && action.state.revision < state.trade.revision) {
        return state;
      }
      return {
        ...state,
        trade: action.state,
        invite: null,
        error: null,
        goldDraft: String(action.state.you.offeredGold),
      };
    }
    case "error":
      return { ...state, error: action.error };
    case "clearError":
      return { ...state, error: null };
    case "goldDraft":
      return { ...state, goldDraft: action.value.replace(/[^0-9]/g, "").slice(0, 10) };
    case "close":
      return initialTradeUiState;
    default:
      return state;
  }
}

export function canLock(trade: TradeStatePayload | null): boolean {
  return (
    trade !== null &&
    (trade.phase === "open" || trade.phase === "locked") &&
    trade.you.locked === false
  );
}

export function canAccept(trade: TradeStatePayload | null): boolean {
  return (
    trade !== null && trade.phase === "locked" && trade.you.accepted === false
  );
}

export function tradeSideTotal(side: TradeSidePayload): number {
  return side.items.reduce((total, item) => total + item.quantity, 0);
}

export function tradeStatusText(trade: TradeStatePayload): string {
  if (trade.phase === "completed") {
    return "Trade complete";
  }
  if (trade.phase === "cancelled") {
    return "Trade cancelled";
  }
  if (trade.phase === "locked") {
    if (trade.you.accepted) {
      return "Waiting for the other side to accept";
    }
    return "Both offers locked — review and accept";
  }
  return trade.you.locked ? "Waiting for the other side to lock" : "Build your offer";
}

/** Parse the gold draft, clamped to the character's current balance. */
export function goldOfferFromDraft(draft: string, balance: number): number {
  const parsed = Number.parseInt(draft, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.min(balance, parsed);
}

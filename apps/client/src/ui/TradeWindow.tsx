import { useEffect } from "react";
import type { ItemInstanceDto, TradeSidePayload, TradeStatePayload } from "@jadethrone/shared";
import { getItem, hasItem } from "@jadethrone/data/items";
import {
  sendTradeAccept,
  sendTradeCancel,
  sendTradeLock,
  sendTradeOffer,
  sendTradeRespond,
} from "../network/session";
import {
  canAccept,
  canLock,
  goldOfferFromDraft,
  tradeSideTotal,
  tradeStatusText,
} from "./trade";
import { useUiStore } from "./store";
import { theme } from "./theme";
import { Window } from "./Window";

function itemName(itemId: string): string {
  return hasItem(itemId) ? getItem(itemId).name : itemId;
}

function OfferList({
  side,
  onRemove,
}: {
  side: TradeSidePayload;
  onRemove?: (instanceId: string) => void;
}) {
  if (side.items.length === 0) {
    return (
      <div style={{ color: theme.muted, fontSize: 10, padding: "8px 0", textAlign: "center" }}>
        Nothing offered
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {side.items.map((item: ItemInstanceDto) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onRemove?.(item.id)}
          disabled={!onRemove}
          title={onRemove ? "Click to remove from the offer" : undefined}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 6,
            padding: "4px 6px",
            borderRadius: 4,
            border: "1px solid rgba(201,162,39,0.25)",
            background: "rgba(255,255,255,0.03)",
            color: theme.text,
            fontSize: 10,
            cursor: onRemove ? "pointer" : "default",
            textAlign: "left",
          }}
        >
          <span>
            {itemName(item.itemId)}
            {item.upgradeLevel > 0 ? ` +${item.upgradeLevel}` : ""}
          </span>
          <span style={{ color: theme.muted }}>
            {item.quantity > 1 ? `×${item.quantity}` : ""}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Trade invite prompt and the two-sided offer/lock/accept window. */
export function TradeWindow() {
  const trade = useUiStore((state) => state.trade);
  const dispatch = useUiStore((state) => state.tradeDispatch);
  const inventory = useUiStore((state) => state.inventory);

  useEffect(() => {
    if (!trade.error) {
      return;
    }
    const timer = setTimeout(() => dispatch({ type: "clearError" }), 3000);
    return () => clearTimeout(timer);
  }, [trade.error, dispatch]);

  if (trade.invite && !trade.trade) {
    const invite = trade.invite;
    return (
      <Window
        id="trade-invite"
        title="Trade invitation"
        width={300}
        onClose={() => {
          sendTradeRespond(invite.tradeId, false);
          dispatch({ type: "close" });
        }}
      >
        <p style={{ margin: "0 0 10px", fontSize: 12, color: theme.text }}>
          <strong style={{ color: theme.gold }}>{invite.fromName}</strong> wants to trade.
        </p>
        {trade.error ? (
          <div style={{ marginBottom: 8, color: theme.danger, fontSize: 10 }}>
            {trade.error.message ?? trade.error.code.replaceAll("_", " ")}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            style={{ flex: 1 }}
            onClick={() => {
              sendTradeRespond(invite.tradeId, true);
            }}
          >
            Accept
          </button>
          <button
            type="button"
            style={{ flex: 1 }}
            onClick={() => {
              sendTradeRespond(invite.tradeId, false);
              dispatch({ type: "close" });
            }}
          >
            Decline
          </button>
        </div>
      </Window>
    );
  }

  const state: TradeStatePayload | null = trade.trade;
  if (!state) {
    return null;
  }

  const finished = state.phase === "completed" || state.phase === "cancelled";
  if (finished) {
    return (
      <Window
        id="trade"
        title="Trade"
        width={320}
        onClose={() => dispatch({ type: "close" })}
      >
        <div
          style={{
            textAlign: "center",
            padding: "8px 0 12px",
            color: state.phase === "completed" ? theme.jade : theme.danger,
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          {tradeStatusText(state)}
        </div>
        <button type="button" style={{ width: "100%" }} onClick={() => dispatch({ type: "close" })}>
          Close
        </button>
      </Window>
    );
  }

  const offer = (instanceIds: string[]) => {
    sendTradeOffer(
      state.tradeId,
      state.revision,
      instanceIds,
      goldOfferFromDraft(trade.goldDraft, state.you.gold),
    );
  };

  const addOfferedItem = () => {
    const dragged = useUiStore.getState().draggedInstanceId;
    if (!dragged || state.you.items.some((item) => item.id === dragged)) {
      return;
    }
    if (!inventory?.items.some((item) => item.id === dragged)) {
      return;
    }
    offer([...state.you.items.map((item) => item.id), dragged]);
  };

  const close = () => {
    sendTradeCancel(state.tradeId);
    dispatch({ type: "close" });
  };

  return (
    <Window id="trade" title="Trade" width={460} onClose={close}>
      <div style={{ display: "flex", gap: 10 }}>
        {[
          {
            key: "you" as const,
            side: state.you,
            title: `You · ${state.you.gold.toLocaleString()} gold`,
            removable: true,
          },
          {
            key: "other" as const,
            side: state.other,
            title: `${state.other.name} · ${state.other.gold.toLocaleString()} gold`,
            removable: false,
          },
        ].map((panel) => (
          <div
            key={panel.key}
            onPointerUp={panel.key === "you" ? addOfferedItem : undefined}
            style={{
              flex: 1,
              minHeight: 150,
              padding: 7,
              borderRadius: 6,
              border:
                panel.key === "you"
                  ? "1px dashed rgba(93,168,143,0.5)"
                  : "1px solid rgba(255,255,255,0.08)",
              background:
                panel.key === "you" ? "rgba(93,168,143,0.06)" : "rgba(255,255,255,0.02)",
            }}
          >
            <div
              style={{
                color: panel.key === "you" ? theme.jade : theme.text,
                fontSize: 11,
                fontWeight: 700,
                marginBottom: 5,
              }}
            >
              {panel.title}
            </div>
            <OfferList
              side={panel.side}
              onRemove={
                panel.removable
                  ? (instanceId) =>
                      offer(
                        state.you.items
                          .map((item) => item.id)
                          .filter((id) => id !== instanceId),
                      )
                  : undefined
              }
            />
            {panel.key === "you" ? (
              <div style={{ color: theme.muted, fontSize: 9, marginTop: 6 }}>
                Drag inventory stacks here · click an item to remove
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginTop: 9,
          fontSize: 11,
        }}
      >
        <span style={{ color: theme.muted }}>Offer gold</span>
        <input
          value={trade.goldDraft}
          onChange={(event) => dispatch({ type: "goldDraft", value: event.target.value })}
          inputMode="numeric"
          style={{
            width: 90,
            padding: "3px 6px",
            borderRadius: 4,
            border: "1px solid rgba(201,162,39,0.35)",
            background: "#0e1311",
            color: theme.text,
            fontSize: 11,
          }}
        />
        <button
          type="button"
          style={{ padding: "3px 8px", fontSize: 10 }}
          onClick={() =>
            offer(
              state.you.items.map((item) => item.id),
            )
          }
        >
          Set gold
        </button>
        <span style={{ color: theme.muted }}>
          of {state.you.gold.toLocaleString()} · stacks: {tradeSideTotal(state.you)}
        </span>
      </div>

      <div style={{ marginTop: 8, color: theme.muted, fontSize: 10 }}>
        {tradeStatusText(state)} · revision {state.revision}
      </div>

      {trade.error ? (
        <div style={{ marginTop: 6, color: theme.danger, fontSize: 10 }}>
          {trade.error.message ?? trade.error.code.replaceAll("_", " ")}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
        <button
          type="button"
          disabled={state.phase === "completed" || state.phase === "cancelled"}
          style={{ flex: 1, fontSize: 11, padding: "5px 8px" }}
          onClick={() => sendTradeLock(state.tradeId, state.revision, !state.you.locked)}
        >
          {state.you.locked ? "Unlock" : "Lock offer"}
        </button>
        <button
          type="button"
          disabled={!canAccept(state)}
          style={{ flex: 1, fontSize: 11, padding: "5px 8px" }}
          onClick={() => sendTradeAccept(state.tradeId, state.revision)}
        >
          {state.you.accepted ? "Accepted" : "Accept trade"}
        </button>
        <button
          type="button"
          style={{ flex: 1, fontSize: 11, padding: "5px 8px" }}
          onClick={close}
        >
          Cancel
        </button>
      </div>
      <div style={{ marginTop: 5, fontSize: 9, color: theme.muted }}>
        {canLock(state) ? "Lock when both offers are ready." : "Waiting on locks or offers."}
      </div>
    </Window>
  );
}

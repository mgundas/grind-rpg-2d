import { useEffect, useReducer, useRef } from "react";
import type { ItemInstanceDto } from "@jadethrone/shared";
import { getItem, hasItem } from "@jadethrone/data/items";
import { sendRequestUpgradePreview, sendUpgradeItem } from "../network/session";
import { useUiStore } from "./store";
import { theme } from "./theme";
import { Window } from "./Window";
import {
  blacksmithReducer,
  formatUpgradePreview,
  initialBlacksmithState,
  resultSummary,
} from "./blacksmith";

const ROLL_ANIMATION_MS = 1_500;

function findItem(
  items: ItemInstanceDto[],
  equipment: (ItemInstanceDto | null)[],
  instanceId: string | null,
): ItemInstanceDto | null {
  if (!instanceId) {
    return null;
  }
  return (
    items.find((item) => item.id === instanceId) ??
    equipment.find((item) => item?.id === instanceId) ??
    null
  );
}

/** Blacksmith forge: drop an item, inspect odds, roll and watch the hammer. */
export function BlacksmithWindow() {
  const open = useUiStore((state) => state.blacksmithOpen);
  const setOpen = useUiStore((state) => state.setBlacksmithOpen);
  const inventory = useUiStore((state) => state.inventory);
  const serverPreview = useUiStore((state) => state.blacksmithPreview);
  const serverResult = useUiStore((state) => state.blacksmithResult);
  const serverError = useUiStore((state) => state.blacksmithError);
  const setBlacksmithPreview = useUiStore((state) => state.setBlacksmithPreview);
  const setBlacksmithResult = useUiStore((state) => state.setBlacksmithResult);
  const setBlacksmithError = useUiStore((state) => state.setBlacksmithError);

  const [state, dispatch] = useReducer(blacksmithReducer, initialBlacksmithState);
  const rollStartedAt = useRef(0);

  useEffect(() => {
    if (serverPreview) {
      dispatch({ type: "preview", preview: serverPreview });
    }
  }, [serverPreview]);

  useEffect(() => {
    if (!serverResult) {
      return;
    }
    const remaining = Math.max(0, ROLL_ANIMATION_MS - (Date.now() - rollStartedAt.current));
    const timer = setTimeout(() => dispatch({ type: "result", result: serverResult }), remaining);
    return () => clearTimeout(timer);
  }, [serverResult]);

  useEffect(() => {
    if (serverError) {
      dispatch({ type: "error", message: serverError.message ?? serverError.code });
    }
  }, [serverError]);

  if (!open) {
    return null;
  }

  const items = inventory?.items ?? [];
  const equipment = inventory?.equipment ?? [];
  const selected = findItem(items, equipment, state.instanceId);
  const definition = selected && hasItem(selected.itemId) ? getItem(selected.itemId) : null;
  const view = state.preview ? formatUpgradePreview(state.preview, state.useBlessing) : null;
  const rolling = state.phase === "rolling";

  const selectItem = (instanceId: string) => {
    setBlacksmithPreview(null);
    setBlacksmithResult(null);
    setBlacksmithError(null);
    dispatch({ type: "select", instanceId });
    sendRequestUpgradePreview(instanceId);
  };

  const roll = () => {
    if (!state.instanceId || !view?.canRoll || rolling) {
      return;
    }
    setBlacksmithResult(null);
    setBlacksmithError(null);
    rollStartedAt.current = Date.now();
    dispatch({ type: "roll" });
    sendUpgradeItem(state.instanceId, state.useBlessing);
  };

  const close = () => {
    dispatch({ type: "reset" });
    setOpen(false);
  };

  return (
    <Window id="blacksmith" title="Blacksmith" width={350} onClose={close}>
      <style>{`
        @keyframes jt-hammer {
          0% { transform: rotate(-38deg); }
          50% { transform: rotate(16deg); }
          100% { transform: rotate(-38deg); }
        }
        @keyframes jt-flash {
          from { opacity: 0; transform: scale(0.82); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes jt-shatter {
          0% { opacity: 1; transform: scale(1) rotate(0deg); }
          60% { opacity: 0.8; transform: scale(0.7) rotate(9deg); }
          100% { opacity: 0; transform: scale(0.2) rotate(24deg); }
        }
      `}</style>

      <div
        onPointerUp={() => {
          const dragged = useUiStore.getState().draggedInstanceId;
          if (dragged) {
            selectItem(dragged);
          }
        }}
        style={{
          minHeight: 74,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          marginBottom: 10,
          border: "1px dashed rgba(201,162,39,0.55)",
          borderRadius: 7,
          background: selected ? "rgba(201,162,39,0.08)" : "rgba(255,255,255,0.02)",
          color: selected ? theme.textStrong : theme.muted,
          fontSize: 11,
          textAlign: "center",
          padding: 8,
          boxSizing: "border-box",
        }}
      >
        {selected && definition ? (
          <>
            <span style={{ color: theme.gold, fontWeight: 700, fontSize: 13 }}>
              {definition.name}
              {selected.upgradeLevel > 0 ? ` +${selected.upgradeLevel}` : ""}
            </span>
            <span style={{ color: theme.muted }}>
              Drop another item here to switch
            </span>
          </>
        ) : (
          <>
            <span style={{ fontSize: 22, lineHeight: 1 }}>⚒</span>
            <span>Drag a weapon or armor piece here</span>
          </>
        )}
      </div>

      {state.error ? (
        <div style={{ color: theme.danger, fontSize: 11, marginBottom: 8 }}>
          {state.error.replaceAll("_", " ")}
        </div>
      ) : null}

      {rolling ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            padding: "14px 0",
          }}
        >
          <span
            style={{
              display: "inline-block",
              fontSize: 38,
              lineHeight: 1,
              animation: "jt-hammer 420ms ease-in-out infinite",
              transformOrigin: "70% 70%",
            }}
          >
            ⚒
          </span>
          <span style={{ color: theme.gold, fontSize: 12, fontWeight: 700 }}>
            The hammer falls…
          </span>
        </div>
      ) : null}

      {state.phase === "result" && state.result ? (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 7,
            border: `1px solid ${state.result.success ? theme.jade : theme.danger}`,
            background: state.result.success
              ? "rgba(93,168,143,0.14)"
              : "rgba(255,122,110,0.12)",
            textAlign: "center",
          }}
        >
          <span
            style={{
              display: "inline-block",
              fontSize: 26,
              lineHeight: 1,
              marginBottom: 4,
              animation: state.result.success
                ? "jt-flash 260ms ease-out"
                : "jt-shatter 520ms ease-in forwards",
            }}
          >
            {state.result.success ? "✦" : "✶"}
          </span>
          <div
            style={{
              color: state.result.success ? theme.jade : theme.danger,
              fontSize: 13,
              fontWeight: 800,
              marginBottom: 4,
            }}
          >
            {resultSummary(state.result)}
          </div>
          <div style={{ color: theme.muted, fontSize: 10 }}>
            {state.result.success
              ? `+${state.result.previousLevel} → +${state.result.level ?? "?"}`
              : state.result.destroyed
                ? "The forge consumed the item."
                : "The Blessing Scroll crumbled, but the item survived."}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
            <button
              type="button"
              style={{ flex: 1 }}
              onClick={() => {
                if (state.result?.instanceId) {
                  selectItem(state.result.instanceId);
                }
              }}
            >
              Forge again
            </button>
            <button type="button" style={{ flex: 1 }} onClick={close}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      {view && state.phase !== "rolling" && state.phase !== "result" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: "4px 10px",
              fontSize: 11,
            }}
          >
            <span style={{ color: theme.muted }}>Success chance</span>
            <span style={{ color: theme.textStrong, fontWeight: 700 }}>{view.chanceText}</span>
            <span style={{ color: theme.muted }}>Gold cost</span>
            <span style={{ color: theme.gold, fontWeight: 700 }}>{view.goldText}</span>
            <span style={{ color: theme.muted }}>Materials</span>
            <span style={{ color: theme.text }}>
              {view.materials.length === 0
                ? "None"
                : view.materials
                    .map((material) => {
                      const name = hasItem(material.itemId)
                        ? getItem(material.itemId).name
                        : material.itemId;
                      return `${name} ${material.owned}/${material.required}`;
                    })
                    .join(", ")}
            </span>
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontSize: 11,
              color: state.preview?.blessingAvailable ? theme.text : theme.muted,
            }}
          >
            <input
              type="checkbox"
              checked={state.useBlessing}
              disabled={!state.preview?.blessingAvailable}
              onChange={(event) =>
                dispatch({ type: "toggleBlessing", value: event.target.checked })
              }
            />
            Use Blessing Scroll (fail → −1 level, scroll consumed)
          </label>

          {view.blockReason ? (
            <div style={{ color: theme.danger, fontSize: 11 }}>{view.blockReason}</div>
          ) : null}

          <button
            type="button"
            disabled={!view.canRoll || rolling}
            onClick={roll}
            style={{
              padding: "9px 12px",
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 0.5,
              background: view.canRoll ? "rgba(201,162,39,0.22)" : "rgba(255,255,255,0.05)",
              border: `1px solid ${view.canRoll ? theme.gold : "rgba(255,255,255,0.12)"}`,
              color: view.canRoll ? theme.gold : theme.muted,
              borderRadius: 6,
              cursor: view.canRoll ? "pointer" : "not-allowed",
            }}
          >
            Forge +{state.preview?.nextLevel ?? "?"}
          </button>
        </div>
      ) : null}

      {!view && !rolling && state.phase !== "result" ? (
        <div style={{ color: theme.muted, fontSize: 11, textAlign: "center" }}>
          The smith waits. Only equipment can be reforged.
        </div>
      ) : null}
    </Window>
  );
}

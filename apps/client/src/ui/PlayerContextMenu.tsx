import { sendPartyInvite, sendTradeInvite } from "../network/session";
import { useUiStore } from "./store";
import { theme } from "./theme";

/** Right-click menu for a remote player; opens on the Phaser canvas pointer. */
export function PlayerContextMenu() {
  const context = useUiStore((state) => state.playerContext);
  const setContext = useUiStore((state) => state.setPlayerContext);

  if (!context) {
    return null;
  }

  const close = () => setContext(null);
  const x = Math.min(context.x, window.innerWidth - 170);
  const y = Math.min(context.y, window.innerHeight - 120);

  return (
    <div
      style={{
        position: "fixed",
        left: Math.max(8, x),
        top: Math.max(8, y),
        width: 158,
        padding: 5,
        borderRadius: 7,
        border: theme.panelBorder,
        background: theme.bg,
        boxShadow: "0 12px 32px rgba(0,0,0,0.6)",
        zIndex: 70,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ color: theme.gold, fontSize: 11, fontWeight: 700, padding: "2px 5px" }}>
        {context.name}
      </div>
      <button
        type="button"
        style={{ fontSize: 11, padding: "5px 7px" }}
        onClick={() => {
          sendTradeInvite(context.characterId);
          close();
        }}
      >
        Trade
      </button>
      <button
        type="button"
        style={{ fontSize: 11, padding: "5px 7px" }}
        onClick={() => {
          sendPartyInvite({ characterId: context.characterId });
          close();
        }}
      >
        Invite to party
      </button>
      <button
        type="button"
        style={{ fontSize: 11, padding: "5px 7px" }}
        onClick={close}
      >
        Cancel
      </button>
    </div>
  );
}

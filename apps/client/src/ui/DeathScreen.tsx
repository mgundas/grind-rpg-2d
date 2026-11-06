import { useEffect, useState } from "react";
import { sendRespawn } from "../network/session";
import { theme, styles } from "./theme";
import { useUiStore } from "./store";

/** PvE death overlay: grayscale backdrop + the two respawn choices. */
export function DeathScreen() {
  const dead = useUiStore((state) => state.dead);
  const respawnHereAtMs = useUiStore((state) => state.respawnHereAtMs);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!dead) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [dead, respawnHereAtMs]);

  if (!dead) {
    return null;
  }

  const seconds = Math.max(0, Math.ceil((respawnHereAtMs - now) / 1000));
  const canRestartHere = seconds === 0;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        background: "rgba(4, 6, 5, 0.62)",
        backdropFilter: "grayscale(1)",
        WebkitBackdropFilter: "grayscale(1)",
        fontFamily: "system-ui, sans-serif",
        pointerEvents: "auto",
      }}
    >
      <h1
        style={{
          margin: 0,
          color: "#d8b4a0",
          fontSize: 34,
          letterSpacing: 6,
          textShadow: "0 4px 24px rgba(0,0,0,0.8)",
        }}
      >
        YOU DIED
      </h1>
      <p style={{ margin: 0, color: theme.muted, fontSize: 12 }}>
        Choose where to return. A small amount of level XP was lost.
      </p>
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button
          type="button"
          onClick={() => sendRespawn("here")}
          disabled={!canRestartHere}
          style={{
            ...styles.button,
            background: canRestartHere ? theme.jade : "rgba(93,168,143,0.25)",
            color: canRestartHere ? "#0f1210" : theme.muted,
            cursor: canRestartHere ? "pointer" : "default",
            minWidth: 150,
          }}
        >
          {canRestartHere ? "Restart here" : `Restart here (${seconds}s)`}
        </button>
        <button
          type="button"
          onClick={() => sendRespawn("town")}
          style={{ ...styles.ghostButton, minWidth: 150, padding: "9px 14px", fontSize: 13 }}
        >
          Restart in town
        </button>
      </div>
    </div>
  );
}

import { useEffect } from "react";
import { GAME_NAME } from "@jadethrone/shared";
import { getHealth } from "../network/http";
import { useUiStore } from "./store";

const POLL_MS = 5000;

const STATUS_COLOR = {
  online: "#7ee08a",
  offline: "#ff7a6e",
  checking: "#9aa5a0",
} as const;

/**
 * Status badge (docs/plans/phase-0.md task 11). Polls /api/health every
 * 5 s and shows online / offline / checking. The #overlay wrapper keeps
 * pointer-events off the canvas, so nothing here can steal mouse input.
 */
export function App() {
  const serverOnline = useUiStore((state) => state.serverOnline);

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      const health = await getHealth();
      if (!cancelled) {
        useUiStore.getState().setServerOnline(health !== null);
      }
    };
    void probe();
    const timer = setInterval(() => void probe(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const label = serverOnline === null ? "checking" : serverOnline ? "online" : "offline";
  const statusColor =
    serverOnline === null
      ? STATUS_COLOR.checking
      : serverOnline
        ? STATUS_COLOR.online
        : STATUS_COLOR.offline;

  return (
    <div style={{ position: "absolute", top: 12, left: 12 }}>
      <span
        style={{
          display: "inline-block",
          padding: "4px 10px",
          background: "rgba(16, 20, 19, 0.85)",
          border: "1px solid rgba(93, 168, 143, 0.4)",
          borderRadius: 6,
          fontFamily: "system-ui, sans-serif",
          fontSize: 12,
          color: "#cfd8d3",
          textShadow: "0 1px 2px rgba(0,0,0,0.5)",
        }}
      >
        {GAME_NAME} — server: <span style={{ color: statusColor }}>{label}</span>
      </span>
    </div>
  );
}

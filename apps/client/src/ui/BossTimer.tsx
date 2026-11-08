import { useEffect, useState } from "react";
import { useUiStore } from "./store";
import { theme } from "./theme";

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Small field-boss clock fed by `MSG.bossTimer`. */
export function BossTimer() {
  const timers = useUiStore((state) => state.bossTimers);
  const mapId = useUiStore((state) => state.mapId);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const visible = timers.filter((timer) => !mapId || timer.mapId === mapId);
  if (visible.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        top: 12,
        transform: "translateX(-50%)",
        padding: "5px 12px",
        borderRadius: 6,
        border: theme.panelBorder,
        background: "rgba(13,18,16,0.9)",
        color: theme.text,
        fontFamily: "system-ui, sans-serif",
        fontSize: 11,
        zIndex: 12,
        pointerEvents: "none",
      }}
    >
      {visible.map((timer) => {
        const remaining = timer.respawnAtMs ? timer.respawnAtMs - now : 0;
        return (
          <div key={timer.bossTypeId} style={{ color: timer.alive ? "#ffd34a" : theme.muted }}>
            {timer.name}:{" "}
            {timer.alive ? "alive" : `respawns in ${formatRemaining(remaining)}`}
          </div>
        );
      })}
    </div>
  );
}

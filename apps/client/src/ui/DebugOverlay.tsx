import { useUiStore } from "./store";

/** F9 debug panel: FPS, ping, position, ack, prediction and interest stats. */
export function DebugOverlay() {
  const visible = useUiStore((state) => state.debugVisible);
  const stats = useUiStore((state) => state.debugStats);
  if (!visible) {
    return null;
  }

  const rows: Array<[string, string]> = [
    ["fps", stats.fps.toFixed(0)],
    ["ping", `${stats.pingMs} ms`],
    ["map", stats.mapId ?? "-"],
    ["pos", `${stats.x.toFixed(1)}, ${stats.y.toFixed(1)}`],
    ["ack seq", String(stats.lastSeq)],
    ["history", String(stats.historyLength)],
    ["snaps", String(stats.snapCount)],
    ["visible players", String(stats.visiblePlayers)],
  ];

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        minWidth: 190,
        padding: "8px 10px",
        borderRadius: 6,
        border: "1px solid rgba(93, 168, 143, 0.4)",
        background: "rgba(10, 14, 12, 0.9)",
        fontFamily: "monospace",
        fontSize: 11,
        lineHeight: 1.5,
        color: "#cfd8d3",
        pointerEvents: "none",
        whiteSpace: "pre",
      }}
    >
      <div style={{ color: "#5da88f", marginBottom: 4 }}>debug (F9)</div>
      {rows.map(([label, value]) => (
        <div key={label}>
          <span style={{ color: "#7d8a84" }}>{label.padEnd(15, " ")}</span>
          <span>{value}</span>
        </div>
      ))}
    </div>
  );
}

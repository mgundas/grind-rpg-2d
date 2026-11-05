/** Minimal overlay for the phase-0 shell; HUD widgets arrive phase by phase. */
export function App() {
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
        color: "#cfd8d3",
        textShadow: "0 1px 2px rgba(0,0,0,0.5)",
      }}
    >
      Jade Throne — Phase 0
    </div>
  );
}

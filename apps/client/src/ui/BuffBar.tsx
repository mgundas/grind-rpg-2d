import { useEffect, useState } from "react";
import { useUiStore } from "./store";
import { theme } from "./theme";

function secondsLeft(expiresAtMs: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAtMs - now) / 1000));
}

/** Buff/debuff icons with countdowns, fed by `buffState`. */
export function BuffBar() {
  const buffs = useUiStore((state) => state.buffs);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const active = buffs.filter((buff) => buff.expiresAtMs > (now || buff.expiresAtMs));
  if (active.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        left: 12,
        top: 52,
        display: "flex",
        flexWrap: "wrap",
        gap: 4,
        maxWidth: 260,
        zIndex: 12,
        pointerEvents: "none",
      }}
    >
      {active.map((buff) => (
        <div
          key={buff.id}
          title={`${buff.name} · ${secondsLeft(buff.expiresAtMs, now)}s`}
          style={{
            position: "relative",
            minWidth: 38,
            height: 38,
            padding: "3px 4px",
            borderRadius: 5,
            border: `1px solid ${buff.kind === "debuff" ? "#8b3c34" : theme.jade}`,
            background:
              buff.kind === "debuff"
                ? "rgba(52,18,16,0.92)"
                : "rgba(13,28,22,0.92)",
            color: buff.kind === "debuff" ? "#ff9a8f" : theme.text,
            fontFamily: "system-ui, sans-serif",
            fontSize: 9,
            textAlign: "center",
            overflow: "hidden",
          }}
        >
          <div style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
            {buff.name.slice(0, 6)}
          </div>
          <div style={{ color: theme.muted }}>{secondsLeft(buff.expiresAtMs, now)}s</div>
          {buff.stacks > 1 ? (
            <span
              style={{
                position: "absolute",
                right: 2,
                top: 1,
                color: theme.gold,
                fontWeight: 700,
              }}
            >
              {buff.stacks}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

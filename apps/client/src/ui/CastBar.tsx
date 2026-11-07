import { useEffect, useState } from "react";
import { useUiStore } from "./store";
import { theme } from "./theme";

/** Cast-time bar driven by `skillCastStart` and cleared by the cast result. */
export function CastBar() {
  const cast = useUiStore((state) => state.castState);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);

  if (!cast) {
    return null;
  }
  const total = Math.max(1, cast.completesAtMs - (cast.completesAtMs - cast.castTimeMs));
  const remaining = Math.max(0, cast.completesAtMs - (now || cast.completesAtMs - total));
  const progress = Math.max(0, Math.min(1, 1 - remaining / total));

  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        bottom: 164,
        transform: "translateX(-50%)",
        width: 240,
        padding: "5px 8px",
        borderRadius: 6,
        border: theme.panelBorder,
        background: "rgba(13,18,16,0.94)",
        color: theme.text,
        fontFamily: "system-ui, sans-serif",
        fontSize: 11,
        zIndex: 16,
        pointerEvents: "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ color: theme.gold }}>{cast.name}</span>
        <span style={{ color: theme.muted }}>{Math.ceil(remaining / 1000)}s</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "rgba(0,0,0,0.6)", overflow: "hidden" }}>
        <div
          style={{
            width: `${progress * 100}%`,
            height: "100%",
            background: theme.jade,
            transition: "width 100ms linear",
          }}
        />
      </div>
    </div>
  );
}

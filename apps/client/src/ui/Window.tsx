import { useEffect, useRef, useState, type ReactNode } from "react";
import { theme } from "./theme";

interface WindowProps {
  id: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}

function loadPosition(id: string, width: number): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(`jt.window.${id}`);
    if (raw) {
      const parsed = JSON.parse(raw) as { x?: number; y?: number };
      if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
        return { x: parsed.x!, y: parsed.y! };
      }
    }
  } catch {
    // Corrupt storage falls back to the default position.
  }
  return {
    x: Math.max(12, window.innerWidth / 2 - width / 2),
    y: Math.max(60, window.innerHeight / 2 - 190),
  };
}

/** Draggable, position-remembering panel (GAME_DESIGN.md §2). */
export function Window({ id, title, onClose, children, width = 300 }: WindowProps) {
  const [position, setPosition] = useState(() => loadPosition(id, width));
  const drag = useRef<{ offsetX: number; offsetY: number } | null>(null);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!drag.current) {
        return;
      }
      setPosition({
        x: Math.max(4, event.clientX - drag.current.offsetX),
        y: Math.max(4, event.clientY - drag.current.offsetY),
      });
    };
    const up = () => {
      if (drag.current) {
        drag.current = null;
        setPosition((current) => {
          try {
            localStorage.setItem(`jt.window.${id}`, JSON.stringify(current));
          } catch {
            // Storage may be unavailable; position simply does not persist.
          }
          return current;
        });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [id]);

  return (
    <div
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        width,
        maxHeight: "calc(100vh - 24px)",
        overflowY: "auto",
        borderRadius: 9,
        border: theme.panelBorder,
        background: theme.bg,
        boxShadow: "0 14px 40px rgba(0,0,0,0.65)",
        color: theme.text,
        fontFamily: "system-ui, sans-serif",
        pointerEvents: "auto",
        zIndex: 20,
      }}
    >
      <div
        onPointerDown={(event) => {
          drag.current = {
            offsetX: event.clientX - position.x,
            offsetY: event.clientY - position.y,
          };
        }}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 10px",
          cursor: "grab",
          borderBottom: "1px solid rgba(201,162,39,0.35)",
          color: theme.gold,
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 1,
          userSelect: "none",
        }}
      >
        <span>{title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title}`}
          style={{
            border: "none",
            background: "transparent",
            color: theme.muted,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          ×
        </button>
      </div>
      <div style={{ padding: 12 }}>{children}</div>
    </div>
  );
}

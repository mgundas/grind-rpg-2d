import { useEffect, useRef } from "react";
import { projectToMinimap } from "@jadethrone/shared";
import { getMapPolicy } from "@jadethrone/data/mapPolicies";
import { useUiStore, type MinimapDot } from "./store";
import { theme } from "./theme";

const WIDTH = 170;

function dotColor(kind: MinimapDot["kind"]): string {
  switch (kind) {
    case "self":
      return "#f0d36a";
    case "party":
      return "#5da88f";
    case "player":
      return "#8fa8c0";
    case "monster":
      return "#cf5f52";
    case "npc":
      return "#c9a227";
  }
}

/** Collision-layer minimap with live entity dots (top-right HUD). */
export function Minimap() {
  const map = useUiStore((state) => state.minimapMap);
  const dots = useUiStore((state) => state.minimapDots);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !map) {
      return;
    }
    const ratio = map.heightPx / map.widthPx;
    const height = Math.max(48, Math.round(WIDTH * ratio));
    canvas.width = WIDTH;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, WIDTH, height);
    ctx.fillStyle = "rgba(8, 12, 10, 0.92)";
    ctx.fillRect(0, 0, WIDTH, height);

    const cellW = WIDTH / map.widthTiles;
    const cellH = height / map.heightTiles;
    ctx.fillStyle = "rgba(70, 92, 82, 0.75)";
    for (let y = 0; y < map.heightTiles; y++) {
      for (let x = 0; x < map.widthTiles; x++) {
        if (map.solid[y * map.widthTiles + x]) {
          ctx.fillRect(x * cellW, y * cellH, Math.ceil(cellW), Math.ceil(cellH));
        }
      }
    }

    const transform = {
      mapWidthPx: map.widthPx,
      mapHeightPx: map.heightPx,
      width: WIDTH,
      height,
    };
    for (const dot of dots) {
      const point = projectToMinimap(dot.x, dot.y, transform);
      ctx.beginPath();
      ctx.arc(point.x, point.y, dot.kind === "self" ? 3 : 2, 0, Math.PI * 2);
      ctx.fillStyle = dotColor(dot.kind);
      ctx.fill();
    }
  }, [map, dots]);

  if (!map) {
    return null;
  }
  const label = getMapPolicy(map.mapId as Parameters<typeof getMapPolicy>[0]).label;
  return (
    <div
      style={{
        position: "fixed",
        top: 52,
        right: 12,
        width: WIDTH,
        padding: 4,
        borderRadius: 7,
        border: theme.panelBorder,
        background: "rgba(12,16,14,0.9)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
        pointerEvents: "none",
        zIndex: 15,
      }}
    >
      <div
        style={{
          color: theme.gold,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: 0.5,
          marginBottom: 3,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <canvas ref={canvasRef} style={{ display: "block", width: WIDTH, borderRadius: 4 }} />
    </div>
  );
}

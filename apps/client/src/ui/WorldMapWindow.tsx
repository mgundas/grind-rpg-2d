import { useEffect } from "react";
import { MAP_POLICIES, getMapPolicy } from "@jadethrone/data/mapPolicies";
import { useUiStore } from "./store";
import { theme } from "./theme";
import { Window } from "./Window";
import { worldMapNodes } from "./worldMap";

function labelFor(mapId: string): string {
  return getMapPolicy(mapId as Parameters<typeof getMapPolicy>[0]).label;
}

/** Simple Phase 8 world map: current map, neighbours and travel hints. */
export function WorldMapWindow() {
  const open = useUiStore((state) => state.worldMapOpen);
  const setOpen = useUiStore((state) => state.setWorldMapOpen);
  const mapId = useUiStore((state) => state.mapId);
  const dots = useUiStore((state) => state.minimapDots);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const store = useUiStore.getState();
      if (store.chatFocused) {
        return;
      }
      if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        store.setWorldMapOpen(!store.worldMapOpen);
      } else if (event.key === "Escape" && store.worldMapOpen) {
        store.setWorldMapOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) {
    return null;
  }

  const nodes = worldMapNodes(MAP_POLICIES, mapId);
  const self = dots.find((dot) => dot.kind === "self");
  return (
    <Window id="world-map" title="World Map" width={500} onClose={() => setOpen(false)}>
      <div
        style={{
          position: "relative",
          height: 240,
          borderRadius: 7,
          border: "1px solid rgba(93,168,143,0.25)",
          background: "radial-gradient(circle at 30% 20%, #1b2a24, #0b100e 70%)",
          overflow: "hidden",
        }}
      >
        {nodes.map((node) => {
          const connections = node.connections.map(labelFor).join(", ");
          return (
            <div
              key={node.mapId}
              style={{
                position: "absolute",
                left: 30 + node.x,
                top: 35 + node.y,
                width: 150,
                padding: "8px 10px",
                borderRadius: 8,
                border: `1px solid ${node.current ? theme.gold : "rgba(93,168,143,0.4)"}`,
                background: node.current ? "rgba(201,162,39,0.12)" : "rgba(10,14,12,0.85)",
                boxShadow: node.current ? "0 0 18px rgba(201,162,39,0.2)" : "none",
              }}
            >
              <div style={{ color: node.current ? theme.gold : theme.textStrong, fontWeight: 700 }}>
                {node.label}
              </div>
              <div style={{ color: theme.muted, fontSize: 9, marginTop: 3 }}>
                {node.current ? "You are here" : `Warp near: ${connections || "—"}`}
              </div>
              {node.current && self ? (
                <div style={{ color: theme.jade, fontSize: 9, marginTop: 3 }}>
                  Position {Math.round(self.x)}, {Math.round(self.y)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 10, color: theme.muted }}>
        Walk onto a warp portal to travel. Press M to close.
      </p>
    </Window>
  );
}

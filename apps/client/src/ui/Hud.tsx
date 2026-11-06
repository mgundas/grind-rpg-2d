import { theme } from "./theme";
import { useUiStore } from "./store";

function Bar({
  value,
  max,
  color,
  height = 10,
}: {
  value: number;
  max: number;
  color: string;
  height?: number;
}) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div
      style={{
        height,
        borderRadius: height,
        background: "rgba(0, 0, 0, 0.55)",
        border: "1px solid rgba(0, 0, 0, 0.5)",
        overflow: "hidden",
      }}
    >
      <div style={{ width: `${ratio * 100}%`, height: "100%", background: color }} />
    </div>
  );
}

/** Bottom-centre HP/MP/XP bars and level (GAME_DESIGN.md §10.4). */
export function Hud() {
  const self = useUiStore((state) => state.selfStats);
  const account = useUiStore((state) => state.account);
  const characters = useUiStore((state) => state.characters);
  const selectedId = useUiStore((state) => state.selectedCharacterId);
  if (!self) {
    return null;
  }
  const character = characters.find((candidate) => candidate.id === selectedId);

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: 18,
        transform: "translateX(-50%)",
        width: 320,
        maxWidth: "calc(100vw - 24px)",
        padding: "10px 12px",
        borderRadius: 9,
        border: theme.panelBorder,
        background: theme.bg,
        boxShadow: "0 8px 24px rgba(0,0,0,0.55)",
        fontFamily: "system-ui, sans-serif",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          color: theme.text,
          marginBottom: 6,
        }}
      >
        <span style={{ color: theme.gold, fontWeight: 700 }}>
          Lv {self.level} {character?.name ?? account?.username ?? ""}
        </span>
        <span style={{ color: theme.muted }}>
          {self.hp}/{self.maxHp} HP
        </span>
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        <Bar value={self.hp} max={self.maxHp} color="#b83b35" height={10} />
        <Bar value={self.mp} max={self.maxMp} color="#3f79b8" height={7} />
        <Bar value={self.xp} max={self.xpToNext} color={theme.jade} height={5} />
      </div>
    </div>
  );
}

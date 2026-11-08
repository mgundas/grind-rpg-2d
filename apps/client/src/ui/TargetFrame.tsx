import { playerNameColor, pvpModeLabel } from "./pvp";
import { theme } from "./theme";
import { useUiStore } from "./store";
import { monsterNameColor } from "../world/levelColors";

/** Target frame: name, level and HP bar for the selected monster. */
export function TargetFrame() {
  const target = useUiStore((state) => state.targetInfo);
  const playerLevel = useUiStore((state) => state.selfStats?.level ?? 1);
  if (!target) {
    return null;
  }
  const ratio = target.maxHp > 0 ? Math.max(0, Math.min(1, target.hp / target.maxHp)) : 0;
  const nameColor =
    target.kind === "player"
      ? playerNameColor(target.pvpMode, target.kingdom)
      : monsterNameColor(target.level, playerLevel);

  return (
    <div
      style={{
        position: "absolute",
        top: 52,
        left: "50%",
        transform: "translateX(-50%)",
        width: 260,
        padding: "8px 10px",
        borderRadius: 7,
        border: theme.panelBorder,
        background: theme.bg,
        boxShadow: "0 6px 20px rgba(0,0,0,0.5)",
        fontFamily: "system-ui, sans-serif",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          marginBottom: 5,
        }}
      >
        <span style={{ color: nameColor, fontWeight: 700 }}>
          {target.name}
          {target.isBoss ? " · BOSS" : ""}
          {target.kind === "stone" ? " · SPIRIT STONE" : ""}
          {target.kind === "player" && target.guildName
            ? ` · [${target.guildName}]`
            : ""}
          {target.kind === "player" && target.pvpMode
            ? ` · ${pvpModeLabel(target.pvpMode).toUpperCase()}`
            : ""}
        </span>
        <span style={{ color: theme.muted }}>Lv {target.level}</span>
      </div>
      <div
        style={{
          height: 8,
          borderRadius: 4,
          background: "rgba(0,0,0,0.55)",
          overflow: "hidden",
        }}
      >
        <div style={{ width: `${ratio * 100}%`, height: "100%", background: "#b83b35" }} />
      </div>
      <div style={{ marginTop: 3, fontSize: 9, color: theme.muted, textAlign: "right" }}>
        {target.hp} / {target.maxHp}
      </div>
    </div>
  );
}

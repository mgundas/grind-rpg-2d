import { CHANNEL_IDS, type ChannelId } from "@jadethrone/shared";
import { sendChannelSwitch } from "../network/session";
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
  const vitals = useUiStore((state) => state.vitals);
  const account = useUiStore((state) => state.account);
  const characters = useUiStore((state) => state.characters);
  const selectedId = useUiStore((state) => state.selectedCharacterId);
  const gold = useUiStore((state) => state.inventory?.gold ?? 0);
  const channel = useUiStore((state) => state.channel);
  const channelSwitchError = useUiStore((state) => state.channelSwitchError);
  if (!self) {
    return null;
  }
  const hp = vitals?.hp ?? self.hp;
  const maxHp = vitals?.maxHp ?? self.maxHp;
  const mp = vitals?.mp ?? self.mp;
  const maxMp = vitals?.maxMp ?? self.maxMp;
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
        <span style={{ color: theme.muted, display: "flex", alignItems: "center", gap: 6 }}>
          <select
            aria-label="Channel"
            value={channel}
            onChange={(event) => sendChannelSwitch(Number(event.target.value) as ChannelId)}
            style={{
              pointerEvents: "auto",
              background: "rgba(10,14,12,0.9)",
              color: theme.text,
              border: "1px solid rgba(93,168,143,0.35)",
              borderRadius: 5,
              fontSize: 10,
              padding: "1px 2px",
            }}
          >
            {CHANNEL_IDS.map((id) => (
              <option key={id} value={id}>
                CH{id}
              </option>
            ))}
          </select>
          {gold.toLocaleString()}g · {hp}/{maxHp} HP
        </span>
      </div>
      {channelSwitchError ? (
        <div style={{ fontSize: 10, color: theme.danger, marginBottom: 4 }}>
          {channelSwitchMessage(channelSwitchError.code)}
        </div>
      ) : null}
      <div style={{ display: "grid", gap: 4 }}>
        <Bar value={hp} max={maxHp} color="#b83b35" height={10} />
        <Bar value={mp} max={maxMp} color="#3f79b8" height={7} />
        <Bar value={self.xp} max={self.xpToNext} color={theme.jade} height={5} />
      </div>
    </div>
  );
}

function channelSwitchMessage(code: string): string {
  switch (code) {
    case "channel_full":
      return "That channel is full.";
    case "cooldown":
      return "Wait a moment before switching channels.";
    case "dead":
      return "The dead cannot travel.";
    case "same_channel":
      return "You are already on that channel.";
    default:
      return "Could not switch channels.";
  }
}

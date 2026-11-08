import { useEffect } from "react";
import { sendAllocStat, sendSetPvpMode } from "../network/session";
import { theme } from "./theme";
import { useUiStore } from "./store";
import { Window } from "./Window";

const STAT_LABELS = [
  { key: "vit", label: "VIT", hint: "+40 HP, +0.5 DEF" },
  { key: "int", label: "INT", hint: "+20 MP" },
  { key: "str", label: "STR", hint: "physical attack" },
  { key: "dex", label: "DEX", hint: "hit, crit, assassin attack" },
] as const;

export function CharacterWindow() {
  const open = useUiStore((state) => state.characterOpen);
  const self = useUiStore((state) => state.selfStats);
  const vitals = useUiStore((state) => state.vitals);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const store = useUiStore.getState();
      if (event.key === "Escape") {
        store.setCharacterOpen(false);
        return;
      }
      if (!store.chatFocused && event.key.toLowerCase() === "c") {
        store.toggleCharacter();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open || !self) {
    return null;
  }

  return (
    <Window
      id="character"
      title="Character"
      width={300}
      onClose={() => useUiStore.getState().setCharacterOpen(false)}
    >
      <div style={{ fontSize: 11, color: theme.muted, marginBottom: 8 }}>
        Level {self.level} · {self.xp}/{self.xpToNext} XP
      </div>
      <div style={{ display: "grid", gap: 5, marginBottom: 12 }}>
        <Row label="HP" value={`${vitals?.hp ?? self.hp} / ${vitals?.maxHp ?? self.maxHp}`} />
        <Row label="MP" value={`${vitals?.mp ?? self.mp} / ${vitals?.maxMp ?? self.maxMp}`} />
        <Row label="Attack" value={String(self.attack)} />
        <Row label="Defense" value={self.defense.toFixed(1)} />
        <Row label="Crit" value={`${(self.critChance * 100).toFixed(1)}%`} />
      </div>

      <label
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 10,
          fontSize: 11,
          color: theme.muted,
        }}
      >
        PvP mode
        <select
          value={self.pvpMode ?? "peaceful"}
          onChange={(event) =>
            sendSetPvpMode(event.target.value as "peaceful" | "kingdom" | "free")
          }
          style={{
            padding: "3px 6px",
            borderRadius: 4,
            border: "1px solid rgba(93,168,143,0.4)",
            background: "#0e1311",
            color: theme.text,
            fontSize: 11,
          }}
        >
          <option value="peaceful">Peaceful</option>
          <option value="kingdom">Kingdom</option>
          <option value="free">Free (red name)</option>
        </select>
      </label>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          color: theme.gold,
          marginBottom: 5,
        }}
      >
        <span>Stats</span>
        <span>Points: {self.statPoints}</span>
      </div>
      <div style={{ display: "grid", gap: 5 }}>
        {STAT_LABELS.map((stat) => (
          <div
            key={stat.key}
            style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}
          >
            <span style={{ width: 34, color: theme.textStrong }}>{stat.label}</span>
            <span style={{ width: 30, textAlign: "right" }}>{self.stats[stat.key]}</span>
            <span style={{ flex: 1, fontSize: 9, color: theme.muted }}>{stat.hint}</span>
            <button
              type="button"
              disabled={self.statPoints <= 0 || self.stats[stat.key] >= 90}
              onClick={() => sendAllocStat(stat.key)}
              style={{
                width: 24,
                height: 22,
                borderRadius: 4,
                border: `1px solid ${theme.jade}`,
                background: self.statPoints > 0 ? theme.jade : "transparent",
                color: self.statPoints > 0 ? "#0f1210" : theme.muted,
                fontWeight: 700,
                cursor: self.statPoints > 0 ? "pointer" : "default",
              }}
            >
              +
            </button>
          </div>
        ))}
      </div>
    </Window>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
      <span style={{ color: theme.muted }}>{label}</span>
      <span style={{ color: theme.textStrong }}>{value}</span>
    </div>
  );
}

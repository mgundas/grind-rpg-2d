import { useUiStore } from "./store";
import { theme } from "./theme";

/** Live party HP/MP frames; clicking one selects the ally heal target. */
export function PartyFrames() {
  const party = useUiStore((state) => state.party);
  const selected = useUiStore((state) => state.healTargetCharacterId);
  const setSelected = useUiStore((state) => state.setHealTargetCharacterId);

  if (!party || party.members.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        right: 12,
        top: 64,
        width: 178,
        display: "grid",
        gap: 4,
        zIndex: 12,
      }}
    >
      {party.members.map((member) => {
        const hpRatio =
          member.maxHp > 0 ? Math.max(0, Math.min(1, member.hp / member.maxHp)) : 0;
        const mpRatio =
          member.maxMp > 0 ? Math.max(0, Math.min(1, member.mp / member.maxMp)) : 0;
        const active = selected === member.characterId;
        return (
          <button
            key={member.characterId}
            type="button"
            onClick={() => setSelected(active ? null : member.characterId)}
            style={{
              textAlign: "left",
              padding: "4px 6px",
              borderRadius: 5,
              border: `1px solid ${active ? theme.gold : theme.jadeDark}`,
              background: member.dead ? "rgba(45,20,18,0.8)" : "rgba(13,18,16,0.9)",
              color: theme.text,
              fontFamily: "system-ui, sans-serif",
              fontSize: 10,
              cursor: "pointer",
              opacity: member.dead ? 0.7 : 1,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 4 }}>
              <span style={{ fontWeight: 700 }}>
                {member.leader ? "★" : ""}
                {member.name}
              </span>
              <span style={{ color: theme.muted }}>Lv {member.level}</span>
            </div>
            <div style={{ height: 4, background: "#241311", borderRadius: 2, marginTop: 3 }}>
              <div
                style={{
                  width: `${hpRatio * 100}%`,
                  height: "100%",
                  borderRadius: 2,
                  background: "#b83b35",
                }}
              />
            </div>
            <div style={{ height: 3, background: "#101a2a", borderRadius: 2, marginTop: 2 }}>
              <div
                style={{
                  width: `${mpRatio * 100}%`,
                  height: "100%",
                  borderRadius: 2,
                  background: "#3c78b8",
                }}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}

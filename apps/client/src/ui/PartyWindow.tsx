import { useEffect, useState } from "react";
import { sendPartyInvite, sendPartyLeave, sendPartyRespond, sendPartySetLoot } from "../network/session";
import { useUiStore } from "./store";
import { theme } from "./theme";
import { Window } from "./Window";

export function PartyWindow() {
  const open = useUiStore((state) => state.partyWindowOpen);
  const party = useUiStore((state) => state.party);
  const invite = useUiStore((state) => state.partyInvite);
  const selectedCharacterId = useUiStore((state) => state.selectedCharacterId);
  const [name, setName] = useState("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) {
        return;
      }
      const store = useUiStore.getState();
      if (event.key === "Escape" && store.partyWindowOpen) {
        store.setPartyWindowOpen(false);
        return;
      }
      if (!store.chatFocused && event.key.toLowerCase() === "p") {
        store.togglePartyWindow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) {
    return null;
  }
  const ownCharacterId = selectedCharacterId;
  const isLeader = Boolean(party && ownCharacterId && party.leaderCharacterId === ownCharacterId);

  return (
    <Window
      id="party"
      title="Party"
      width={340}
      onClose={() => useUiStore.getState().setPartyWindowOpen(false)}
    >
      {invite ? (
        <div
          style={{
            marginBottom: 10,
            padding: 8,
            borderRadius: 6,
            border: `1px solid ${theme.gold}`,
            fontSize: 11,
          }}
        >
          <div>
            <strong style={{ color: theme.gold }}>{invite.fromName}</strong> invites you to a party.
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <button
              type="button"
              onClick={() => sendPartyRespond(invite.inviteId, true)}
              style={{
                padding: "4px 10px",
                borderRadius: 4,
                border: "none",
                background: theme.jade,
                color: "#0f1210",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Accept
            </button>
            <button
              type="button"
              onClick={() => sendPartyRespond(invite.inviteId, false)}
              style={{
                padding: "4px 10px",
                borderRadius: 4,
                border: `1px solid ${theme.jade}`,
                background: "transparent",
                color: theme.text,
                cursor: "pointer",
              }}
            >
              Decline
            </button>
          </div>
        </div>
      ) : null}

      {!party ? (
        <div style={{ display: "grid", gap: 6 }}>
          <p style={{ margin: 0, fontSize: 11, color: theme.muted }}>
            Invite a player in this room by name (or right-click them in the world).
          </p>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Character name"
              style={{
                flex: 1,
                padding: "6px 8px",
                borderRadius: 5,
                border: `1px solid ${theme.jade}`,
                background: "#0e1311",
                color: theme.text,
                fontSize: 12,
              }}
            />
            <button
              type="button"
              disabled={name.trim().length === 0}
              onClick={() => {
                sendPartyInvite({ name: name.trim() });
                setName("");
              }}
              style={{
                padding: "6px 10px",
                borderRadius: 5,
                border: "none",
                background: theme.jade,
                color: "#0f1210",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Invite
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
            <span style={{ color: theme.muted }}>{party.members.length}/8 members</span>
            <span style={{ color: theme.gold }}>
              Loot: {party.lootRule === "round_robin" ? "Round robin" : "Free for all"}
            </span>
          </div>
          {isLeader ? (
            <select
              value={party.lootRule}
              onChange={(event) =>
                sendPartySetLoot(event.target.value as "free_for_all" | "round_robin")
              }
              style={{
                padding: 4,
                borderRadius: 5,
                border: `1px solid ${theme.jade}`,
                background: "#0e1311",
                color: theme.text,
                fontSize: 11,
              }}
            >
              <option value="free_for_all">Free for all</option>
              <option value="round_robin">Round robin</option>
            </select>
          ) : null}
          <div style={{ display: "grid", gap: 4 }}>
            {party.members.map((member) => (
              <div
                key={member.characterId}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 6,
                  padding: "5px 7px",
                  borderRadius: 5,
                  border: "1px solid #29312e",
                  background: member.dead ? "rgba(45,20,18,0.55)" : "rgba(18,26,23,0.7)",
                  fontSize: 11,
                  opacity: member.dead ? 0.7 : 1,
                }}
              >
                <span>
                  {member.leader ? "★ " : ""}
                  {member.name}
                  {member.characterId === ownCharacterId ? " (you)" : ""}
                </span>
                <span style={{ color: theme.muted }}>
                  Lv {member.level} · {member.hp}/{member.maxHp}
                  {member.dead ? " · dead" : ""}
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => sendPartyLeave()}
            style={{
              marginTop: 4,
              padding: "5px 10px",
              borderRadius: 5,
              border: `1px solid ${theme.danger}`,
              background: "transparent",
              color: theme.danger,
              cursor: "pointer",
              fontSize: 11,
              justifySelf: "start",
            }}
          >
            Leave party
          </button>
        </div>
      )}
    </Window>
  );
}

import { useEffect, useState } from "react";
import type { GuildMemberView } from "@jadethrone/shared";
import {
  sendGuildCreate,
  sendGuildDisband,
  sendGuildInvite,
  sendGuildKick,
  sendGuildLeave,
  sendGuildRespond,
  sendGuildSetRank,
} from "../network/session";
import { useUiStore } from "./store";
import { isTypingTarget, matchesKeybind } from "./keybinds";
import { theme } from "./theme";
import { Window } from "./Window";
import {
  canChangeGuildRank,
  canDisbandGuild,
  canInviteGuild,
  canKickGuild,
  guildRankLabel,
  sortGuildMembers,
} from "./social";

function RosterRow({
  member,
  ownCharacterId,
  ownRank,
}: {
  member: GuildMemberView;
  ownCharacterId: string | null;
  ownRank: GuildMemberView["rank"] | null;
}) {
  const isSelf = member.characterId === ownCharacterId;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 6px",
        borderRadius: 4,
        background: isSelf ? "rgba(201,162,39,0.09)" : "rgba(255,255,255,0.025)",
        fontSize: 10,
      }}
    >
      <span style={{ color: member.online ? theme.jade : theme.muted, width: 8 }}>●</span>
      <span style={{ color: theme.textStrong, fontWeight: isSelf ? 700 : 500, flex: 1 }}>
        {member.name}
      </span>
      <span style={{ color: theme.muted, width: 48 }}>{guildRankLabel(member.rank)}</span>
      <span style={{ color: theme.muted, width: 34 }}>Lv {member.level}</span>
      {canChangeGuildRank(ownRank, member.rank) ? (
        <button
          type="button"
          style={{ padding: "1px 5px", fontSize: 9 }}
          onClick={() =>
            sendGuildSetRank(member.characterId, member.rank === "officer" ? "member" : "officer")
          }
        >
          {member.rank === "officer" ? "Demote" : "Promote"}
        </button>
      ) : null}
      {!isSelf && canKickGuild(ownRank, member.rank) ? (
        <button
          type="button"
          style={{ padding: "1px 5px", fontSize: 9 }}
          onClick={() => sendGuildKick(member.characterId)}
        >
          Kick
        </button>
      ) : null}
    </div>
  );
}

/** Guild roster, creation form and management actions. */
export function GuildWindow() {
  const open = useUiStore((state) => state.guildOpen);
  const setOpen = useUiStore((state) => state.setGuildOpen);
  const guild = useUiStore((state) => state.guild);
  const error = useUiStore((state) => state.guildError);
  const setError = useUiStore((state) => state.setGuildError);
  const characterId = useUiStore((state) => state.selectedCharacterId);
  const chatDispatch = useUiStore((state) => state.chatDispatch);
  const requestChatFocus = useUiStore((state) => state.requestChatFocus);
  const [name, setName] = useState("");
  const [inviteName, setInviteName] = useState("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const store = useUiStore.getState();
      if (store.chatFocused || isTypingTarget(event.target)) {
        return;
      }
      if (matchesKeybind(store.settings.keybinds, event, "guild")) {
        event.preventDefault();
        store.setGuildOpen(!store.guildOpen);
      } else if (event.key === "Escape" && store.guildOpen) {
        store.setGuildOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!error) {
      return;
    }
    const timer = setTimeout(() => setError(null), 3000);
    return () => clearTimeout(timer);
  }, [error, setError]);

  if (!open) {
    return null;
  }

  const ownRank = guild?.members.find((member) => member.characterId === characterId)?.rank ?? null;
  const members = guild ? sortGuildMembers(guild.members) : [];

  return (
    <Window id="guild" title="Guild" width={440} onClose={() => setOpen(false)}>
      {error ? (
        <div style={{ color: theme.danger, fontSize: 10, marginBottom: 8 }}>
          {error.message ?? error.code.replaceAll("_", " ")}
        </div>
      ) : null}

      {!guild ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ margin: 0, fontSize: 11, color: theme.text }}>
            Create a guild at level 30 for 500,000 gold.
          </p>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Guild name"
            maxLength={20}
            style={{
              padding: "6px 8px",
              borderRadius: 5,
              border: "1px solid rgba(93,168,143,0.4)",
              background: "#0e1311",
              color: theme.text,
              fontSize: 12,
            }}
          />
          <button
            type="button"
            disabled={name.trim().length < 3}
            onClick={() => {
              sendGuildCreate(name.trim());
              setName("");
            }}
          >
            Found guild
          </button>
          <p style={{ margin: 0, fontSize: 10, color: theme.muted }}>
            Guild invites appear automatically when another player invites you.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ color: theme.gold, fontSize: 15, fontWeight: 800 }}>{guild.name}</div>
              <div style={{ color: theme.muted, fontSize: 10 }}>
                {guild.members.length} / 32 members
              </div>
            </div>
            <button
              type="button"
              style={{ fontSize: 10, padding: "3px 7px" }}
              onClick={() => {
                chatDispatch({ type: "select", tab: "guild" });
                requestChatFocus();
              }}
            >
              Guild chat
            </button>
          </div>

          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={inviteName}
              onChange={(event) => setInviteName(event.target.value)}
              placeholder="Invite by name"
              maxLength={16}
              disabled={!canInviteGuild(ownRank)}
              style={{
                flex: 1,
                padding: "5px 7px",
                borderRadius: 4,
                border: "1px solid rgba(93,168,143,0.35)",
                background: "#0e1311",
                color: theme.text,
                fontSize: 11,
              }}
            />
            <button
              type="button"
              disabled={!canInviteGuild(ownRank) || inviteName.trim() === ""}
              style={{ fontSize: 10, padding: "3px 8px" }}
              onClick={() => {
                sendGuildInvite({ name: inviteName.trim() });
                setInviteName("");
              }}
            >
              Invite
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {members.map((member) => (
              <RosterRow
                key={member.characterId}
                member={member}
                ownCharacterId={characterId}
                ownRank={ownRank}
              />
            ))}
          </div>

          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button
              type="button"
              style={{ flex: 1, fontSize: 10 }}
              onClick={() => sendGuildLeave()}
            >
              Leave guild
            </button>
            {canDisbandGuild(ownRank) ? (
              <button
                type="button"
                style={{ flex: 1, fontSize: 10, color: theme.danger }}
                onClick={() => sendGuildDisband()}
              >
                Disband guild
              </button>
            ) : null}
          </div>
        </div>
      )}
    </Window>
  );
}

/** Invite prompt shown regardless of whether the guild window is open. */
export function GuildInvitePrompt() {
  const invite = useUiStore((state) => state.guildInvite);
  const setInvite = useUiStore((state) => state.setGuildInvite);
  if (!invite) {
    return null;
  }
  return (
    <Window
      id="guild-invite"
      title="Guild invitation"
      width={300}
      onClose={() => {
        sendGuildRespond(invite.inviteId, false);
        setInvite(null);
      }}
    >
      <p style={{ margin: "0 0 10px", fontSize: 12, color: theme.text }}>
        <strong style={{ color: theme.gold }}>{invite.fromName}</strong> invites you to{" "}
        <strong>{invite.guildName}</strong>.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          style={{ flex: 1 }}
          onClick={() => {
            sendGuildRespond(invite.inviteId, true);
            setInvite(null);
          }}
        >
          Accept
        </button>
        <button
          type="button"
          style={{ flex: 1 }}
          onClick={() => {
            sendGuildRespond(invite.inviteId, false);
            setInvite(null);
          }}
        >
          Decline
        </button>
      </div>
    </Window>
  );
}

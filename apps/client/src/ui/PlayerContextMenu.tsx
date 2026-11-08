import {
  sendFriendAdd,
  sendGuildInvite,
  sendPartyInvite,
  sendTradeInvite,
} from "../network/session";
import { canInviteGuild } from "./social";
import { useUiStore } from "./store";
import { theme } from "./theme";

/** Right-click menu for a remote player; opens on the Phaser canvas pointer. */
export function PlayerContextMenu() {
  const context = useUiStore((state) => state.playerContext);
  const setContext = useUiStore((state) => state.setPlayerContext);
  const guild = useUiStore((state) => state.guild);
  const characterId = useUiStore((state) => state.selectedCharacterId);
  const chatDispatch = useUiStore((state) => state.chatDispatch);
  const requestChatFocus = useUiStore((state) => state.requestChatFocus);

  if (!context) {
    return null;
  }

  const close = () => setContext(null);
  const x = Math.min(context.x, window.innerWidth - 180);
  const y = Math.min(context.y, window.innerHeight - 250);
  const ownRank = guild?.members.find((member) => member.characterId === characterId)?.rank ?? null;

  return (
    <div
      style={{
        position: "fixed",
        left: Math.max(8, x),
        top: Math.max(8, y),
        width: 168,
        padding: 5,
        borderRadius: 7,
        border: theme.panelBorder,
        background: theme.bg,
        boxShadow: "0 12px 32px rgba(0,0,0,0.6)",
        zIndex: 70,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ color: theme.gold, fontSize: 11, fontWeight: 700, padding: "2px 5px" }}>
        {context.name}
      </div>
      <button
        type="button"
        style={{ fontSize: 11, padding: "5px 7px" }}
        onClick={() => {
          sendTradeInvite(context.characterId);
          close();
        }}
      >
        Trade
      </button>
      <button
        type="button"
        style={{ fontSize: 11, padding: "5px 7px" }}
        onClick={() => {
          sendPartyInvite({ characterId: context.characterId });
          close();
        }}
      >
        Invite to party
      </button>
      <button
        type="button"
        style={{ fontSize: 11, padding: "5px 7px" }}
        onClick={() => {
          sendFriendAdd({ characterId: context.characterId });
          close();
        }}
      >
        Add friend
      </button>
      <button
        type="button"
        style={{ fontSize: 11, padding: "5px 7px" }}
        onClick={() => {
          chatDispatch({ type: "setWhisperTarget", name: context.name });
          chatDispatch({ type: "select", tab: "whisper" });
          requestChatFocus();
          close();
        }}
      >
        Whisper
      </button>
      {canInviteGuild(ownRank) ? (
        <button
          type="button"
          style={{ fontSize: 11, padding: "5px 7px" }}
          onClick={() => {
            sendGuildInvite({ characterId: context.characterId });
            close();
          }}
        >
          Invite to guild
        </button>
      ) : null}
      <button
        type="button"
        style={{ fontSize: 11, padding: "5px 7px" }}
        onClick={close}
      >
        Cancel
      </button>
    </div>
  );
}

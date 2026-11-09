import { useEffect, useState } from "react";
import type { FriendView } from "@jadethrone/shared";
import { sendFriendAdd, sendFriendRemove } from "../network/session";
import { useUiStore } from "./store";
import { isTypingTarget, matchesKeybind } from "./keybinds";
import { theme } from "./theme";
import { Window } from "./Window";
import { friendLevel, friendStatus } from "./social";

function FriendRow({ friend }: { friend: FriendView }) {
  const chatDispatch = useUiStore((state) => state.chatDispatch);
  const requestChatFocus = useUiStore((state) => state.requestChatFocus);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 6px",
        borderRadius: 4,
        background: "rgba(255,255,255,0.025)",
        fontSize: 10,
      }}
    >
      <span style={{ color: friend.online ? theme.jade : theme.muted, width: 8 }}>●</span>
      <span style={{ color: theme.textStrong, fontWeight: 600, flex: 1 }}>{friend.name}</span>
      <span style={{ color: theme.muted, width: 38 }}>{friendLevel(friend)}</span>
      <span style={{ color: friend.online ? theme.jade : theme.muted, width: 110 }}>
        {friendStatus(friend)}
      </span>
      <button
        type="button"
        disabled={!friend.online}
        style={{ padding: "1px 5px", fontSize: 9 }}
        onClick={() => {
          chatDispatch({ type: "setWhisperTarget", name: friend.name });
          chatDispatch({ type: "select", tab: "whisper" });
          requestChatFocus();
        }}
      >
        Whisper
      </button>
      <button
        type="button"
        style={{ padding: "1px 5px", fontSize: 9 }}
        onClick={() => sendFriendRemove(friend.characterId)}
      >
        Remove
      </button>
    </div>
  );
}

/** Friends list with online status, add/remove and whisper shortcuts. */
export function FriendsWindow() {
  const open = useUiStore((state) => state.friendsOpen);
  const setOpen = useUiStore((state) => state.setFriendsOpen);
  const friends = useUiStore((state) => state.friends);
  const error = useUiStore((state) => state.friendError);
  const setError = useUiStore((state) => state.setFriendError);
  const [name, setName] = useState("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const store = useUiStore.getState();
      if (store.chatFocused || isTypingTarget(event.target)) {
        return;
      }
      if (matchesKeybind(store.settings.keybinds, event, "friends")) {
        event.preventDefault();
        store.setFriendsOpen(!store.friendsOpen);
      } else if (event.key === "Escape" && store.friendsOpen) {
        store.setFriendsOpen(false);
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

  const sorted = [...friends].sort(
    (one, two) =>
      Number(two.online) - Number(one.online) || one.name.localeCompare(two.name),
  );

  return (
    <Window id="friends" title="Friends" width={500} onClose={() => setOpen(false)}>
      {error ? (
        <div style={{ color: theme.danger, fontSize: 10, marginBottom: 8 }}>
          {error.message ?? error.code.replaceAll("_", " ")}
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Add friend by character name"
          maxLength={16}
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
          disabled={name.trim() === ""}
          style={{ fontSize: 10, padding: "3px 8px" }}
          onClick={() => {
            sendFriendAdd({ name: name.trim() });
            setName("");
          }}
        >
          Add friend
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {sorted.length === 0 ? (
          <p style={{ margin: 0, color: theme.muted, fontSize: 10 }}>
            No friends yet. Add someone by name.
          </p>
        ) : (
          sorted.map((friend) => <FriendRow key={friend.characterId} friend={friend} />)
        )}
      </div>
    </Window>
  );
}

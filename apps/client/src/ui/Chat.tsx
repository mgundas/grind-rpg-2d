import { useEffect, useRef, useState, type FormEvent } from "react";
import { KINGDOMS, parseChatInput, type ChatMsgPayload } from "@jadethrone/shared";
import { sendChat } from "../network/session";
import {
  CHAT_TABS,
  composeChatInput,
  type ChatTab,
} from "./chatTabs";
import { useUiStore } from "./store";
import { isTypingTarget, matchesKeybind } from "./keybinds";

function kingdomColor(kingdom: string): string {
  return KINGDOMS.find((candidate) => candidate.id === kingdom)?.color ?? "#cfd8d3";
}

const TAB_LABELS: Record<ChatTab, string> = {
  all: "All",
  local: "Local",
  shout: "Shout",
  party: "Party",
  guild: "Guild",
  whisper: "Whisper",
};

const EMPTY_TEXT: Record<ChatTab, string> = {
  all: "Chat — Enter to type",
  local: "Local chat — 900 px",
  shout: "Shout — level 15+, whole map",
  party: "Party chat",
  guild: "Guild chat",
  whisper: "Whisper from the Friends window or /w Name",
};

function channelPrefix(message: ChatMsgPayload): string {
  if (message.channel === "shout") {
    return "[Shout] ";
  }
  if (message.channel === "party") {
    return "[Party] ";
  }
  if (message.channel === "guild") {
    return "[Guild] ";
  }
  if (message.channel === "whisper") {
    return "[Whisper] ";
  }
  if (message.channel === "system") {
    return "[System] ";
  }
  return "";
}

/**
 * Tabbed chat log + input. Enter focuses from anywhere, Escape blurs; while
 * focused the Phaser scene stops reading movement keys (`chatFocused`).
 */
export function Chat() {
  const phase = useUiStore((state) => state.connectionPhase);
  const chat = useUiStore((state) => state.chat);
  const chatDispatch = useUiStore((state) => state.chatDispatch);
  const chatFocusRequest = useUiStore((state) => state.chatFocusRequest);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (useUiStore.getState().connectionPhase !== "connected") {
        return;
      }
      if (
        !isTypingTarget(event.target) &&
        matchesKeybind(useUiStore.getState().settings.keybinds, event, "chat") &&
        !useUiStore.getState().chatFocused
      ) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (phase !== "connected") {
      useUiStore.getState().setChatFocused(false);
    }
  }, [phase]);

  useEffect(() => {
    if (chatFocusRequest > 0) {
      inputRef.current?.focus();
    }
  }, [chatFocusRequest]);
  useEffect(
    () => () => {
      useUiStore.getState().setChatFocused(false);
    },
    [],
  );

  if (phase !== "connected") {
    return null;
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = text.trim();
    if (message === "") {
      return;
    }
    const parsed = parseChatInput(message);
    if (parsed.channel === "whisper" && parsed.targetName) {
      chatDispatch({ type: "setWhisperTarget", name: parsed.targetName });
      chatDispatch({ type: "select", tab: "whisper" });
    }
    if (chat.active === "whisper" && !chat.whisperTarget && parsed.channel !== "whisper") {
      return;
    }
    sendChat(composeChatInput(chat.active, message, chat.whisperTarget));
    setText("");
    inputRef.current?.blur();
  };

  const focus = () => useUiStore.getState().setChatFocused(true);
  const blur = () => useUiStore.getState().setChatFocused(false);
  const messages = chat.buffers[chat.active];

  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        bottom: 12,
        width: 360,
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 2,
          marginBottom: 4,
          pointerEvents: "auto",
          flexWrap: "wrap",
        }}
      >
        {CHAT_TABS.map((tab) => {
          const unread = chat.unread[tab];
          return (
            <button
              key={tab}
              type="button"
              onClick={() => chatDispatch({ type: "select", tab })}
              style={{
                padding: "2px 6px",
                fontSize: 9,
                borderRadius: 4,
                border:
                  chat.active === tab
                    ? "1px solid rgba(201,162,39,0.75)"
                    : "1px solid rgba(255,255,255,0.1)",
                background:
                  chat.active === tab ? "rgba(201,162,39,0.18)" : "rgba(12,16,14,0.72)",
                color: chat.active === tab ? "#e0b64a" : "#8d9a94",
                cursor: "pointer",
              }}
            >
              {TAB_LABELS[tab]}
              {unread > 0 ? ` ${unread > 99 ? "99+" : unread}` : ""}
            </button>
          );
        })}
      </div>
      <div
        style={{
          maxHeight: 150,
          overflowY: "auto",
          marginBottom: 6,
          padding: "4px 8px",
          borderRadius: 6,
          background: "rgba(12, 16, 14, 0.72)",
          color: "#cfd8d3",
          lineHeight: 1.45,
        }}
      >
        {messages.length === 0 ? (
          <div style={{ color: "#68756f" }}>{EMPTY_TEXT[chat.active]}</div>
        ) : (
          messages.map((message, index) => (
            <div key={`${message.sentAt}-${message.from}-${index}`}>
              {message.channel === "system" ? (
                <span style={{ color: "#c9a227" }}>{message.text}</span>
              ) : (
                <>
                  <span style={{ color: "#68756f" }}>{channelPrefix(message)}</span>
                  <span style={{ color: kingdomColor(message.kingdom), fontWeight: 600 }}>
                    {message.name}
                  </span>
                  <span style={{ color: "#8d9a94" }}>: </span>
                  <span>{message.text}</span>
                </>
              )}
            </div>
          ))
        )}
      </div>
      <form onSubmit={submit} style={{ pointerEvents: "auto" }}>
        <input
          ref={inputRef}
          value={text}
          maxLength={120}
          onFocus={focus}
          onBlur={blur}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setText("");
              inputRef.current?.blur();
            }
          }}
          placeholder={
            chat.active === "whisper" && chat.whisperTarget
              ? `Whisper ${chat.whisperTarget}…`
              : chat.active === "whisper"
                ? "/w Name message"
                : `Message ${TAB_LABELS[chat.active]}…`
          }
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "7px 9px",
            borderRadius: 6,
            border: "1px solid rgba(93, 168, 143, 0.4)",
            background: "rgba(12, 16, 14, 0.85)",
            color: "#e8eeea",
            fontSize: 12,
            outline: "none",
          }}
        />
      </form>
    </div>
  );
}

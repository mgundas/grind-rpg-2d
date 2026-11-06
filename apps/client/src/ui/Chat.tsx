import { useEffect, useRef, useState, type FormEvent } from "react";
import { KINGDOMS, type ChatMsgPayload } from "@jadethrone/shared";
import { sendChat } from "../network/session";
import { useUiStore } from "./store";

function kingdomColor(kingdom: string): string {
  return KINGDOMS.find((candidate) => candidate.id === kingdom)?.color ?? "#cfd8d3";
}

/**
 * Local chat log + input. Enter focuses from anywhere, Escape blurs; while
 * focused the Phaser scene stops reading movement keys (`chatFocused`).
 */
export function Chat() {
  const phase = useUiStore((state) => state.connectionPhase);
  const chatLog = useUiStore((state) => state.chatLog);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (useUiStore.getState().connectionPhase !== "connected") {
        return;
      }
      if (event.key === "Enter" && !useUiStore.getState().chatFocused) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Never leave movement disabled if this input unmounts or the connection
  // drops while it has focus.
  useEffect(() => {
    if (phase !== "connected") {
      useUiStore.getState().setChatFocused(false);
    }
  }, [phase]);
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
    if (message.length > 0) {
      sendChat(message);
    }
    setText("");
    inputRef.current?.blur();
  };

  const focus = () => useUiStore.getState().setChatFocused(true);
  const blur = () => useUiStore.getState().setChatFocused(false);

  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        bottom: 12,
        width: 320,
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
        pointerEvents: "none",
      }}
    >
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
        {chatLog.length === 0 ? (
          <div style={{ color: "#68756f" }}>Local chat — Enter to type</div>
        ) : (
          chatLog.map((message: ChatMsgPayload, index) => (
            <div key={`${index}-${message.from}`}>
              <span style={{ color: kingdomColor(message.kingdom), fontWeight: 600 }}>
                {message.name}
              </span>
              <span style={{ color: "#8d9a94" }}>: </span>
              <span>{message.text}</span>
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
          placeholder="Say something…"
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

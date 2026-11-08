import { describe, expect, it } from "vitest";
import type { ChatMsgPayload } from "@jadethrone/shared";
import {
  CHAT_HISTORY_LIMIT,
  chatTabsReducer,
  composeChatInput,
  initialChatTabsState,
} from "../src/ui/chatTabs";

function message(overrides: Partial<ChatMsgPayload> = {}): ChatMsgPayload {
  return {
    from: "session-1",
    fromCharacterId: "char-1",
    name: "Alice",
    kingdom: "ember",
    channel: "local",
    text: "hello",
    sentAt: 1,
    ...overrides,
  };
}

describe("chat tabs reducer", () => {
  it("routes messages to All and their channel tab", () => {
    let state = initialChatTabsState();
    state = chatTabsReducer(state, { type: "push", message: message() });
    state = chatTabsReducer(state, {
      type: "push",
      message: message({ channel: "guild", text: "guild line", sentAt: 2 }),
    });
    expect(state.buffers.all).toHaveLength(2);
    expect(state.buffers.local).toHaveLength(1);
    expect(state.buffers.guild).toHaveLength(1);
    expect(state.buffers.party).toHaveLength(0);
  });

  it("keeps system messages in All only", () => {
    let state = initialChatTabsState();
    state = chatTabsReducer(state, {
      type: "push",
      message: message({ channel: "system", name: "System", text: "notice" }),
    });
    expect(state.buffers.all).toHaveLength(1);
    expect(state.buffers.local).toHaveLength(0);
  });

  it("caps each buffer and tracks unread counts", () => {
    let state = initialChatTabsState();
    for (let index = 0; index < CHAT_HISTORY_LIMIT + 5; index++) {
      state = chatTabsReducer(state, {
        type: "push",
        message: message({ text: `${index}`, sentAt: index }),
      });
    }
    expect(state.buffers.all).toHaveLength(CHAT_HISTORY_LIMIT);
    expect(state.buffers.local).toHaveLength(CHAT_HISTORY_LIMIT);
    expect(state.unread.local).toBe(CHAT_HISTORY_LIMIT + 5);

    state = chatTabsReducer(state, { type: "select", tab: "local" });
    expect(state.active).toBe("local");
    expect(state.unread.local).toBe(0);
  });

  it("tracks and resets a whisper target", () => {
    let state = chatTabsReducer(initialChatTabsState(), {
      type: "setWhisperTarget",
      name: "Bob",
    });
    expect(state.whisperTarget).toBe("Bob");
    state = chatTabsReducer(state, { type: "reset" });
    expect(state).toEqual(initialChatTabsState());
  });
});

describe("composeChatInput", () => {
  it("prefixes the selected channel and leaves slash commands alone", () => {
    expect(composeChatInput("local", "hi")).toBe("hi");
    expect(composeChatInput("shout", "hi")).toBe("/s hi");
    expect(composeChatInput("party", "hi")).toBe("/p hi");
    expect(composeChatInput("guild", "hi")).toBe("/g hi");
    expect(composeChatInput("whisper", "hi", "Bob")).toBe("/w Bob hi");
    expect(composeChatInput("whisper", "hi")).toBe("hi");
    expect(composeChatInput("guild", "/s hi")).toBe("/s hi");
  });
});

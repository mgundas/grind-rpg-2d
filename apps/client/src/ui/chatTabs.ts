import type { ChatMsgPayload } from "@jadethrone/shared";

export const CHAT_TABS = [
  "all",
  "local",
  "shout",
  "party",
  "guild",
  "whisper",
] as const;
export type ChatTab = (typeof CHAT_TABS)[number];

export const CHAT_HISTORY_LIMIT = 100;

export interface ChatTabsState {
  active: ChatTab;
  buffers: Record<ChatTab, ChatMsgPayload[]>;
  unread: Record<ChatTab, number>;
  whisperTarget: string | null;
}

export type ChatTabsAction =
  | { type: "push"; message: ChatMsgPayload }
  | { type: "select"; tab: ChatTab }
  | { type: "clearUnread" }
  | { type: "setWhisperTarget"; name: string | null }
  | { type: "reset" };

function emptyBuffers(): Record<ChatTab, ChatMsgPayload[]> {
  return {
    all: [],
    local: [],
    shout: [],
    party: [],
    guild: [],
    whisper: [],
  };
}

function emptyUnread(): Record<ChatTab, number> {
  return { all: 0, local: 0, shout: 0, party: 0, guild: 0, whisper: 0 };
}

export function initialChatTabsState(): ChatTabsState {
  return {
    active: "all",
    buffers: emptyBuffers(),
    unread: emptyUnread(),
    whisperTarget: null,
  };
}

function tabsFor(message: ChatMsgPayload): ChatTab[] {
  if (message.channel === "system") {
    return ["all"];
  }
  if (message.channel === "local") {
    return ["all", "local"];
  }
  return ["all", message.channel];
}

export function chatTabsReducer(state: ChatTabsState, action: ChatTabsAction): ChatTabsState {
  switch (action.type) {
    case "push": {
      const tabs = tabsFor(action.message);
      const buffers = { ...state.buffers };
      const unread = { ...state.unread };
      for (const tab of tabs) {
        buffers[tab] = [...buffers[tab], action.message].slice(-CHAT_HISTORY_LIMIT);
        if (tab !== state.active) {
          unread[tab] += 1;
        }
      }
      return { ...state, buffers, unread };
    }
    case "select":
      return {
        ...state,
        active: action.tab,
        unread: { ...state.unread, [action.tab]: 0 },
      };
    case "clearUnread":
      return { ...state, unread: emptyUnread() };
    case "setWhisperTarget":
      return { ...state, whisperTarget: action.name };
    case "reset":
      return initialChatTabsState();
    default:
      return state;
  }
}

/** Prefix a chat input from the currently selected tab. */
export function composeChatInput(tab: ChatTab, text: string, whisperTarget?: string | null): string {
  const message = text.trim();
  if (message === "") {
    return "";
  }
  if (message.startsWith("/")) {
    return message;
  }
  switch (tab) {
    case "shout":
      return `/s ${message}`;
    case "party":
      return `/p ${message}`;
    case "guild":
      return `/g ${message}`;
    case "whisper":
      return whisperTarget ? `/w ${whisperTarget} ${message}` : message;
    default:
      return message;
  }
}

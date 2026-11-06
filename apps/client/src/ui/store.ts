import { create } from "zustand";
import type { ChatMsgPayload, MapId } from "@jadethrone/shared";

export type ConnectionPhase = "idle" | "connecting" | "connected" | "error" | "left";

export interface DebugStats {
  fps: number;
  pingMs: number;
  mapId: MapId | null;
  x: number;
  y: number;
  lastSeq: number;
  snapCount: number;
  visiblePlayers: number;
  historyLength: number;
}

interface UiState {
  /** null = still probing the HTTP health endpoint. */
  serverOnline: boolean | null;
  setServerOnline: (online: boolean | null) => void;

  connectionPhase: ConnectionPhase;
  connectionError: string | null;
  setConnectionPhase: (phase: ConnectionPhase) => void;
  setConnectionError: (error: string | null) => void;

  sessionId: string | null;
  mapId: MapId | null;
  setSessionId: (id: string | null) => void;
  setMapId: (map: MapId | null) => void;

  /** True while the React chat input has keyboard focus; scenes stop reading WASD. */
  chatFocused: boolean;
  setChatFocused: (focused: boolean) => void;

  chatLog: ChatMsgPayload[];
  pushChat: (message: ChatMsgPayload) => void;

  debugVisible: boolean;
  toggleDebug: () => void;
  debugStats: DebugStats;
  setDebugStats: (stats: DebugStats) => void;
}

/**
 * Overlay UI store — the bridge between Phaser (writes game state) and React
 * (renders HUD). React never touches Phaser objects directly.
 */
export const useUiStore = create<UiState>((set) => ({
  serverOnline: null,
  setServerOnline: (serverOnline) => set({ serverOnline }),

  connectionPhase: "idle",
  connectionError: null,
  setConnectionPhase: (connectionPhase) => set({ connectionPhase }),
  setConnectionError: (connectionError) => set({ connectionError }),

  sessionId: null,
  mapId: null,
  setSessionId: (sessionId) => set({ sessionId }),
  setMapId: (mapId) => set({ mapId }),

  chatFocused: false,
  setChatFocused: (chatFocused) => set({ chatFocused }),

  chatLog: [],
  pushChat: (message) => set((state) => ({ chatLog: [...state.chatLog, message].slice(-100) })),

  debugVisible: false,
  toggleDebug: () => set((state) => ({ debugVisible: !state.debugVisible })),
  debugStats: {
    fps: 0,
    pingMs: 0,
    mapId: null,
    x: 0,
    y: 0,
    lastSeq: 0,
    snapCount: 0,
    visiblePlayers: 0,
    historyLength: 0,
  },
  setDebugStats: (debugStats) => set({ debugStats }),
}));

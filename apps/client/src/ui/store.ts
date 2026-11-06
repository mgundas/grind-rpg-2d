import { create } from "zustand";

interface UiState {
  /** null = still probing the server. */
  serverOnline: boolean | null;
  setServerOnline: (online: boolean | null) => void;
}

/**
 * Overlay UI store. Scene code can flip values here too (e.g. connection
 * state once the game joins a room in Phase 1).
 */
export const useUiStore = create<UiState>((set) => ({
  serverOnline: null,
  setServerOnline: (serverOnline) => set({ serverOnline }),
}));

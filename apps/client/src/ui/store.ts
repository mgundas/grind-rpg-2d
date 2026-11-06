import { create } from "zustand";
import type {
  AccountPublic,
  AnnouncementPayload,
  CharacterSummary,
  ChatMsgPayload,
  InventorySnapshotPayload,
  MapId,
  NpcDialogPayload,
  SelfStatsPayload,
  SessionKickReason,
  WarehouseSnapshotPayload,
} from "@jadethrone/shared";

export type ConnectionPhase = "idle" | "connecting" | "connected" | "error" | "left";

/** Auth/screen phase: checking tokens at boot, signed out, or signed in. */
export type AuthPhase = "checking" | "anonymous" | "authenticated";

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

  authPhase: AuthPhase;
  account: AccountPublic | null;
  characters: CharacterSummary[];
  selectedCharacterId: string | null;
  authError: string | null;
  sessionKickedReason: SessionKickReason | null;
  setAuthChecking: () => void;
  setAnonymous: (error?: string | null) => void;
  setAuthenticated: (account: AccountPublic, characters: CharacterSummary[]) => void;
  setCharacters: (characters: CharacterSummary[]) => void;
  setSelectedCharacter: (id: string | null) => void;
  setAuthError: (error: string | null) => void;
  setSessionKicked: (reason: SessionKickReason | null) => void;

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

  /** Latest server-wide banner (admin / scheduled / shutdown). */
  announcement: AnnouncementPayload | null;
  setAnnouncement: (announcement: AnnouncementPayload | null) => void;

  /** Owner-only progression snapshot from the server. */
  selfStats: SelfStatsPayload | null;
  setSelfStats: (stats: SelfStatsPayload | null) => void;

  /** Public HP/MP from state patches (combat and regen update these at 20 Hz). */
  vitals: { hp: number; maxHp: number; mp: number; maxMp: number } | null;
  setVitals: (vitals: UiState["vitals"]) => void;

  /** Selected monster (click/Tab) and server-driven walk mode. */
  targetMonsterId: string | null;
  setTargetMonster: (monsterId: string | null) => void;
  targetInfo: {
    id: string;
    name: string;
    level: number;
    hp: number;
    maxHp: number;
    isBoss: boolean;
  } | null;
  setTargetInfo: (target: UiState["targetInfo"]) => void;
  autoWalk: boolean;
  setAutoWalk: (active: boolean) => void;

  characterOpen: boolean;
  toggleCharacter: () => void;
  setCharacterOpen: (open: boolean) => void;

  /** Owner-only item/gold snapshot (Phase 4). */
  inventory: InventorySnapshotPayload | null;
  setInventory: (inventory: InventorySnapshotPayload | null) => void;
  inventoryOpen: boolean;
  toggleInventory: () => void;
  setInventoryOpen: (open: boolean) => void;
  inventoryError: { code: string; message?: string } | null;
  setInventoryError: (error: UiState["inventoryError"]) => void;
  autoLoot: boolean;
  setAutoLoot: (enabled: boolean) => void;
  /** Item definition currently being dragged (inventory → hotbar). */
  draggedItemId: string | null;
  setDraggedItemId: (itemId: string | null) => void;

  npcDialog: NpcDialogPayload | null;
  setNpcDialog: (dialog: NpcDialogPayload | null) => void;
  shopId: string | null;
  setShopId: (shopId: string | null) => void;
  warehouse: WarehouseSnapshotPayload | null;
  setWarehouse: (warehouse: WarehouseSnapshotPayload | null) => void;
  warehouseOpen: boolean;
  setWarehouseOpen: (open: boolean) => void;

  dead: boolean;
  respawnHereAtMs: number;
  setDeath: (dead: boolean, respawnHereAtMs?: number) => void;

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

  authPhase: "checking",
  account: null,
  characters: [],
  selectedCharacterId: null,
  authError: null,
  sessionKickedReason: null,
  setAuthChecking: () => set({ authPhase: "checking", authError: null }),
  setAnonymous: (authError = null) =>
    set({
      authPhase: "anonymous",
      account: null,
      characters: [],
      selectedCharacterId: null,
      authError,
      connectionPhase: "idle",
      connectionError: null,
      sessionKickedReason: null,
    }),
  setAuthenticated: (account, characters) =>
    set({
      authPhase: "authenticated",
      account,
      characters,
      selectedCharacterId: characters[0]?.id ?? null,
      authError: null,
      sessionKickedReason: null,
    }),
  setCharacters: (characters) =>
    set((state) => ({
      characters,
      selectedCharacterId:
        state.selectedCharacterId && characters.some((c) => c.id === state.selectedCharacterId)
          ? state.selectedCharacterId
          : (characters[0]?.id ?? null),
    })),
  setSelectedCharacter: (selectedCharacterId) => set({ selectedCharacterId }),
  setAuthError: (authError) => set({ authError }),
  setSessionKicked: (sessionKickedReason) => set({ sessionKickedReason }),

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

  announcement: null,
  setAnnouncement: (announcement) => set({ announcement }),

  selfStats: null,
  setSelfStats: (selfStats) => set({ selfStats }),

  vitals: null,
  setVitals: (vitals) => set({ vitals }),

  targetMonsterId: null,
  setTargetMonster: (targetMonsterId) =>
    set((state) => ({
      targetMonsterId,
      targetInfo: targetMonsterId ? state.targetInfo : null,
    })),
  targetInfo: null,
  setTargetInfo: (targetInfo) => set({ targetInfo }),
  autoWalk: false,
  setAutoWalk: (autoWalk) => set({ autoWalk }),

  characterOpen: false,
  toggleCharacter: () => set((state) => ({ characterOpen: !state.characterOpen })),
  setCharacterOpen: (characterOpen) => set({ characterOpen }),

  inventory: null,
  setInventory: (inventory) =>
    set((state) =>
      inventory && state.inventory && inventory.revision < state.inventory.revision
        ? {}
        : { inventory },
    ),
  inventoryOpen: false,
  toggleInventory: () => set((state) => ({ inventoryOpen: !state.inventoryOpen })),
  setInventoryOpen: (inventoryOpen) => set({ inventoryOpen }),
  inventoryError: null,
  setInventoryError: (inventoryError) => set({ inventoryError }),
  autoLoot: true,
  setAutoLoot: (autoLoot) => set({ autoLoot }),
  draggedItemId: null,
  setDraggedItemId: (draggedItemId) => set({ draggedItemId }),

  npcDialog: null,
  setNpcDialog: (npcDialog) => set({ npcDialog }),
  shopId: null,
  setShopId: (shopId) => set({ shopId }),
  warehouse: null,
  setWarehouse: (warehouse) =>
    set((state) =>
      warehouse && state.warehouse && warehouse.revision < state.warehouse.revision
        ? {}
        : { warehouse },
    ),
  warehouseOpen: false,
  setWarehouseOpen: (warehouseOpen) => set({ warehouseOpen }),

  dead: false,
  respawnHereAtMs: 0,
  setDeath: (dead, respawnHereAtMs = 0) => set({ dead, respawnHereAtMs }),

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

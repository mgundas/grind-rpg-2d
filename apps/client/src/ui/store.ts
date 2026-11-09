import { create } from "zustand";
import type {
  AccountPublic,
  AnnouncementPayload,
  BonusScrollAppliedPayload,
  BossTimerPayload,
  FriendErrorPayload,
  FriendView,
  FriendsStatePayload,
  GuildErrorPayload,
  GuildInvitePayload,
  GuildStatePayload,
  BuffStatePayload,
  BuffView,
  CharacterSummary,
  InventorySnapshotPayload,
  MapId,
  NpcDialogPayload,
  PartyInvitePayload,
  PartyStatePayload,
  SelfStatsPayload,
  SessionKickReason,
  SkillCastStartPayload,
  SkillBookResultPayload,
  SkillStatePayload,
  UpgradePreview,
  UpgradeResultPayload,
  WarehouseSnapshotPayload,
} from "@jadethrone/shared";
import {
  IDLE_SCROLL_TARGET,
  scrollTargetReducer,
  type ScrollTargetMode,
} from "./scrollTarget";
import {
  initialTradeUiState,
  tradeUiReducer,
  type TradeUiState,
  type TradeUiAction,
} from "./trade";
import {
  chatTabsReducer,
  initialChatTabsState,
  type ChatTabsAction,
  type ChatTabsState,
} from "./chatTabs";
import {
  IDLE_SKILL_BOOK_TARGET,
  skillBookTargetReducer,
  type SkillBookTarget,
} from "./skillBook";

export type ConnectionPhase = "idle" | "connecting" | "connected" | "error" | "left";

export interface MinimapMapData {
  mapId: string;
  widthPx: number;
  heightPx: number;
  widthTiles: number;
  heightTiles: number;
  tileSize: number;
  solid: Uint8Array;
}

export interface MinimapDot {
  kind: "self" | "party" | "player" | "monster" | "npc";
  x: number;
  y: number;
}

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

  chat: ChatTabsState;
  chatDispatch: (action: ChatTabsAction) => void;

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
  /** Selected spirit stone (click/Tab). Stones are not auto-attack targets yet. */
  targetStoneId: string | null;
  setTargetStone: (stoneId: string | null) => void;
  targetCharacterId: string | null;
  setTargetPlayer: (characterId: string | null) => void;
  targetKind: "monster" | "stone" | "player" | null;
  targetInfo: {
    id: string;
    name: string;
    level: number;
    hp: number;
    maxHp: number;
    isBoss: boolean;
    kind?: "monster" | "stone" | "player";
    kingdom?: string;
    guildName?: string;
    pvpMode?: string;
  } | null;
  setTargetInfo: (target: UiState["targetInfo"]) => void;
  autoWalk: boolean;
  setAutoWalk: (active: boolean) => void;

  /** Latest boss clocks received from the server. */
  bossTimers: BossTimerPayload[];
  setBossTimer: (timer: BossTimerPayload) => void;

  /** Owner-only skill/doctrine snapshot. */
  skillState: SkillStatePayload | null;
  setSkillState: (state: SkillStatePayload | null) => void;
  skillWindowOpen: boolean;
  toggleSkillWindow: () => void;
  setSkillWindowOpen: (open: boolean) => void;
  /** Skill definition currently being dragged to the hotbar. */
  draggedSkillId: string | null;
  setDraggedSkillId: (skillId: string | null) => void;
  /** World cursor in scene coordinates, used by ground-targeted skills. */
  cursorWorld: { x: number; y: number } | null;
  setCursorWorld: (point: { x: number; y: number } | null) => void;
  /** Authoritative own position, used to derive skill direction. */
  selfPosition: { x: number; y: number } | null;
  setSelfPosition: (point: { x: number; y: number } | null) => void;
  /** Party member selected in the frames for ally heals/buffs. */
  healTargetCharacterId: string | null;
  setHealTargetCharacterId: (characterId: string | null) => void;
  /** Active cast bar, or null when idle. */
  castState: SkillCastStartPayload | null;
  setCastState: (state: SkillCastStartPayload | null) => void;
  /** Player buffs/debuffs with absolute expiry. */
  buffs: BuffView[];
  setBuffState: (state: BuffStatePayload) => void;

  /** Runtime party snapshot and pending invite. */
  party: PartyStatePayload | null;
  setParty: (party: PartyStatePayload | null) => void;
  partyInvite: PartyInvitePayload | null;
  setPartyInvite: (invite: PartyInvitePayload | null) => void;
  partyWindowOpen: boolean;
  togglePartyWindow: () => void;
  setPartyWindowOpen: (open: boolean) => void;

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
  /** Item instance currently being dragged (inventory → blacksmith). */
  draggedInstanceId: string | null;
  setDraggedInstanceId: (instanceId: string | null) => void;

  friendError: FriendErrorPayload | null;
  setFriendError: (error: UiState["friendError"]) => void;
  friends: FriendView[];
  setFriends: (state: FriendsStatePayload) => void;
  friendsOpen: boolean;
  setFriendsOpen: (open: boolean) => void;

  guild: GuildStatePayload["guild"];
  setGuild: (state: GuildStatePayload) => void;
  guildInvite: GuildInvitePayload | null;
  setGuildInvite: (invite: GuildInvitePayload | null) => void;
  guildError: GuildErrorPayload | null;
  setGuildError: (error: UiState["guildError"]) => void;
  guildOpen: boolean;
  setGuildOpen: (open: boolean) => void;

  /** Increment to ask the chat input to focus itself. */
  chatFocusRequest: number;
  requestChatFocus: () => void;

  minimapMap: MinimapMapData | null;
  setMinimapMap: (map: MinimapMapData | null) => void;
  minimapDots: MinimapDot[];
  setMinimapDots: (dots: MinimapDot[]) => void;
  worldMapOpen: boolean;
  setWorldMapOpen: (open: boolean) => void;

  dayNightEnabled: boolean;
  setDayNightEnabled: (enabled: boolean) => void;
  weatherEnabled: boolean;
  setWeatherEnabled: (enabled: boolean) => void;

  skillBookTarget: SkillBookTarget;
  beginSkillBook: (bookInstanceId: string) => void;
  cancelSkillBook: () => void;
  skillBookResult: SkillBookResultPayload | null;
  setSkillBookResult: (result: SkillBookResultPayload | null) => void;

  blacksmithOpen: boolean;
  setBlacksmithOpen: (open: boolean) => void;
  blacksmithPreview: UpgradePreview | null;
  setBlacksmithPreview: (preview: UpgradePreview | null) => void;
  blacksmithResult: UpgradeResultPayload | null;
  setBlacksmithResult: (result: UpgradeResultPayload | null) => void;
  blacksmithError: { code: string; message?: string } | null;
  setBlacksmithError: (error: UiState["blacksmithError"]) => void;

  /** Right-clicked enchant/reinforce scroll waiting for a target item. */
  scrollTarget: ScrollTargetMode;
  beginScrollTarget: (scrollInstanceId: string, scrollItemId: string) => void;
  cancelScrollTarget: () => void;
  bonusScrollResult: BonusScrollAppliedPayload | null;
  setBonusScrollResult: (result: BonusScrollAppliedPayload | null) => void;

  /** Trade invites, state and transient errors share one reducer. */
  trade: TradeUiState;
  tradeDispatch: (action: TradeUiAction) => void;

  /** Right-clicked remote player menu position and identity. */
  playerContext: { characterId: string; name: string; x: number; y: number } | null;
  setPlayerContext: (context: UiState["playerContext"]) => void;

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

  chat: initialChatTabsState(),
  chatDispatch: (action) =>
    set((state) => ({ chat: chatTabsReducer(state.chat, action) })),

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
      targetStoneId: targetMonsterId ? null : state.targetStoneId,
      targetCharacterId: targetMonsterId ? null : state.targetCharacterId,
      targetKind:
        targetMonsterId ? "monster" : state.targetKind === "monster" ? null : state.targetKind,
      targetInfo:
        targetMonsterId || state.targetKind !== "monster" ? state.targetInfo : null,
    })),
  targetStoneId: null,
  setTargetStone: (targetStoneId) =>
    set((state) => ({
      targetStoneId,
      targetMonsterId: targetStoneId ? null : state.targetMonsterId,
      targetCharacterId: targetStoneId ? null : state.targetCharacterId,
      targetKind: targetStoneId ? "stone" : state.targetKind === "stone" ? null : state.targetKind,
      targetInfo:
        targetStoneId || state.targetKind === "monster" || state.targetKind === "player"
          ? state.targetInfo
          : null,
    })),
  targetCharacterId: null,
  setTargetPlayer: (targetCharacterId) =>
    set((state) => ({
      targetCharacterId,
      targetMonsterId: targetCharacterId ? null : state.targetMonsterId,
      targetStoneId: targetCharacterId ? null : state.targetStoneId,
      targetKind: targetCharacterId ? "player" : state.targetKind === "player" ? null : state.targetKind,
      targetInfo:
        targetCharacterId || state.targetKind === "monster" || state.targetKind === "stone"
          ? state.targetInfo
          : null,
    })),
  targetKind: null,
  targetInfo: null,
  setTargetInfo: (targetInfo) => set({ targetInfo }),
  autoWalk: false,
  setAutoWalk: (autoWalk) => set({ autoWalk }),
  bossTimers: [],
  setBossTimer: (timer) =>
    set((state) => ({
      bossTimers: [
        ...state.bossTimers.filter((entry) => entry.bossTypeId !== timer.bossTypeId),
        timer,
      ],
    })),
  skillState: null,
  setSkillState: (skillState) => set({ skillState }),
  skillWindowOpen: false,
  toggleSkillWindow: () => set((state) => ({ skillWindowOpen: !state.skillWindowOpen })),
  setSkillWindowOpen: (skillWindowOpen) => set({ skillWindowOpen }),
  draggedSkillId: null,
  setDraggedSkillId: (draggedSkillId) => set({ draggedSkillId }),
  cursorWorld: null,
  setCursorWorld: (cursorWorld) => set({ cursorWorld }),
  selfPosition: null,
  setSelfPosition: (selfPosition) => set({ selfPosition }),
  healTargetCharacterId: null,
  setHealTargetCharacterId: (healTargetCharacterId) => set({ healTargetCharacterId }),
  castState: null,
  setCastState: (castState) => set({ castState }),
  buffs: [],
  setBuffState: (state) => set({ buffs: state.buffs }),
  party: null,
  setParty: (party) =>
    set({ party: party && party.partyId ? party : null, partyInvite: null }),
  partyInvite: null,
  setPartyInvite: (partyInvite) => set({ partyInvite }),
  partyWindowOpen: false,
  togglePartyWindow: () => set((state) => ({ partyWindowOpen: !state.partyWindowOpen })),
  setPartyWindowOpen: (partyWindowOpen) => set({ partyWindowOpen }),

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
  draggedInstanceId: null,
  setDraggedInstanceId: (draggedInstanceId) => set({ draggedInstanceId }),

  friendError: null,
  setFriendError: (friendError) => set({ friendError }),
  friends: [],
  setFriends: (state) => set({ friends: state.friends, friendError: null }),
  friendsOpen: false,
  setFriendsOpen: (friendsOpen) => set({ friendsOpen }),

  guild: null,
  setGuild: (state) => set({ guild: state.guild, guildError: null }),
  guildInvite: null,
  setGuildInvite: (guildInvite) => set({ guildInvite }),
  guildError: null,
  setGuildError: (guildError) => set({ guildError }),
  guildOpen: false,
  setGuildOpen: (guildOpen) => set({ guildOpen }),

  chatFocusRequest: 0,
  requestChatFocus: () => set((state) => ({ chatFocusRequest: state.chatFocusRequest + 1 })),
  minimapMap: null,
  setMinimapMap: (minimapMap) => set({ minimapMap }),
  minimapDots: [],
  setMinimapDots: (minimapDots) => set({ minimapDots }),
  worldMapOpen: false,
  setWorldMapOpen: (worldMapOpen) => set({ worldMapOpen }),

  dayNightEnabled: true,
  setDayNightEnabled: (dayNightEnabled) => set({ dayNightEnabled }),
  weatherEnabled: true,
  setWeatherEnabled: (weatherEnabled) => set({ weatherEnabled }),

  skillBookTarget: IDLE_SKILL_BOOK_TARGET,
  beginSkillBook: (bookInstanceId) =>
    set((state) => ({
      skillBookTarget: skillBookTargetReducer(state.skillBookTarget, {
        type: "begin",
        bookInstanceId,
      }),
    })),
  cancelSkillBook: () =>
    set((state) => ({
      skillBookTarget: skillBookTargetReducer(state.skillBookTarget, { type: "cancel" }),
    })),
  skillBookResult: null,
  setSkillBookResult: (skillBookResult) => set({ skillBookResult }),

  blacksmithOpen: false,
  setBlacksmithOpen: (blacksmithOpen) =>
    set({
      blacksmithOpen,
      blacksmithPreview: null,
      blacksmithResult: null,
      blacksmithError: null,
    }),
  blacksmithPreview: null,
  setBlacksmithPreview: (blacksmithPreview) =>
    set({ blacksmithPreview, blacksmithError: null }),
  blacksmithResult: null,
  setBlacksmithResult: (blacksmithResult) => set({ blacksmithResult }),
  blacksmithError: null,
  setBlacksmithError: (blacksmithError) => set({ blacksmithError }),

  scrollTarget: IDLE_SCROLL_TARGET,
  beginScrollTarget: (scrollInstanceId, scrollItemId) =>
    set((state) => ({
      scrollTarget: scrollTargetReducer(state.scrollTarget, {
        type: "begin",
        scrollInstanceId,
        scrollItemId,
      }),
    })),
  cancelScrollTarget: () =>
    set((state) => ({
      scrollTarget: scrollTargetReducer(state.scrollTarget, { type: "cancel" }),
    })),
  bonusScrollResult: null,
  setBonusScrollResult: (bonusScrollResult) => set({ bonusScrollResult }),

  trade: initialTradeUiState,
  tradeDispatch: (action) =>
    set((state) => ({ trade: tradeUiReducer(state.trade, action) })),

  playerContext: null,
  setPlayerContext: (playerContext) => set({ playerContext }),

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

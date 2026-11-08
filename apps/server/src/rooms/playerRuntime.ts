import {
  createMover,
  emptyInventory,
  type AccountRole,
  type Dir8,
  type InputMessage,
  type InventoryState,
  type MoveIntent,
  type MoverState,
  type PvpMode,
  type Vec2,
  type WarehouseState,
} from "@jadethrone/shared";
import type { PlayerProgression } from "../characters/progression";
import type { SkillMasteryMap } from "../characters/skillMastery";
import type { PlayerBuff } from "../skills/effects";
import type { SkillHotIntent } from "../skills/skillCombat";
import type { PendingSkillCast } from "../skills/skillRuntime";

/**
 * Server-private per-player state. Never synchronized; the schema state is
 * derived from `mover.pos` and `progression` after each tick.
 */
export interface PlayerRuntime {
  /** Authenticated account/character this session belongs to. */
  accountId: string;
  characterId: string;
  /** Account role captured at authentication (GM commands/admin bus). */
  role: AccountRole;
  /** Character channel (always 1 until Phase 9 channels). */
  channel: number;
  /** GM invisibility: excluded from monster targeting and other clients' views. */
  invisible: boolean;
  /** Account token generation captured at authentication. */
  tokenVersion: number;
  mover: MoverState;
  /**
   * Authoritative HP/MP/XP/stats. Public HP/MP are mirrored into PlayerState;
   * XP and stat points are sent only to the owner.
   */
  progression: PlayerProgression;
  /** Master levels and read cooldowns keyed by skill id. */
  skillMastery: SkillMasteryMap;
  /** Persisted PvP stance mirrored into public state. */
  pvpMode: PvpMode;
  /** Inputs received since the last tick, applied in seq order. */
  pending: InputMessage[];
  /** Highest applied input sequence. */
  lastSeq: number;
  /** Intent used to keep following a click-to-move path between inputs. */
  lastIntent: MoveIntent;
  /** Epoch ms before which chat is rate-limited. */
  chatReadyAtMs: number;
  /** Shout has a separate 15 s cooldown. */
  shoutReadyAtMs: number;
  /** A warp is in flight; skip movement/warp checks. */
  warping: boolean;
  /** Arrival guard so a warp cannot immediately bounce back. */
  warpCooldownUntilMs: number;
  /** Ticks left to keep applying the last direction after input stops. */
  graceTicksRemaining: number;
  /** Last click-to-move target tile, used to reject rapid retargets. */
  lastPathTargetKey: string | null;
  /** Last time a new path target was accepted (rate limit). */
  lastPathRetargetAtMs: number;
  /** Recent A* failures keyed by goal tile, so hostile spam cannot repeat them. */
  failedPathUntilMs: Map<string, number>;
  /** Number of A* runs performed (debug/test counter). */
  pathComputations: number;
  /** Inputs dropped because the pending queue was full (debug/test counter). */
  droppedInputs: number;
  /** True when authoritative state has changed since the last save. */
  dirty: boolean;
  /** Serialized save chain so autosave/kick/leave/warp writes cannot reorder. */
  saveChain: Promise<unknown> | null;

  /** Authoritative in-memory inventory/equipment and gold (Phase 4). */
  inventory: InventoryState;
  gold: number;
  /** Lazily loaded account warehouse snapshot. */
  warehouse: WarehouseState | null;
  /** Monotonic snapshot revision used by the client to ignore stale messages. */
  inventoryRevision: number;
  warehouseRevision: number;
  /** Serialized item/economy commands; kick/warp/leave await this chain. */
  inventoryChain: Promise<unknown> | null;
  /** Set synchronously by kick/warp/leave so late commands are dropped. */
  inventoryClosed: boolean;
  /** Epoch ms before another consumable can be used. */
  itemUseReadyAtMs: number;

  /** Basic-attack cooldown gate. */
  attackReadyAtMs: number;
  /** Per-skill absolute cooldown timestamps keyed by skill id. */
  skillCooldowns: Map<string, number>;
  /** A validated cast waiting for its cast time to complete. */
  pendingCast: PendingSkillCast | null;
  /** Active player buffs keyed by source skill. */
  buffs: Map<string, PlayerBuff>;
  /** Heal-over-time effects applied by support skills. */
  healOverTime: SkillHotIntent[];
  /** Attack requested by the client, resolved once on the next tick. */
  pendingAttack: { dir: Dir8 | null } | null;
  /** Last damage dealt or taken; drives in-combat regen. */
  lastCombatAtMs: number;
  /** Accumulator for the 3 s regen interval. */
  regenAccumMs: number;
  /** PvE death state: no movement, no attacks, ignored by monsters. */
  dead: boolean;
  diedAtMs: number;
  /** Respawn choice queued by the client, resolved on the next tick. */
  pendingRespawn: "here" | "town" | null;
  /** Monster this player clicked and is walking to / auto-attacking. */
  targetMonsterId: string | null;
  /** Epoch ms before the next auto-walk repath. */
  nextChaseRepathAtMs: number;
  /** Best squared distance to the current chase target. */
  bestTargetDistSq: number;
  /** Epoch ms when the current best distance was recorded (give-up timer). */
  noProgressSinceMs: number;
  /** Consecutive empty auto-walk paths. */
  emptyChasePaths: number;
}

export interface PlayerIdentity {
  accountId: string;
  characterId: string;
  tokenVersion: number;
  role?: AccountRole;
  channel?: number;
  progression?: PlayerProgression;
  skillMastery?: SkillMasteryMap;
  pvpMode?: PvpMode;
  inventory?: InventoryState;
  gold?: number;
}

const FALLBACK_PROGRESSION: PlayerProgression = {
  hp: 1,
  maxHp: 1,
  mp: 0,
  maxMp: 0,
  level: 1,
  xp: 0,
  stats: { vit: 0, int: 0, str: 0, dex: 0 },
  statPoints: 0,
  doctrine: null,
  skillPoints: 0,
  skills: {},
};

export function createPlayerRuntime(spawn: Vec2, identity: PlayerIdentity): PlayerRuntime {
  const now = Date.now();
  return {
    accountId: identity.accountId,
    characterId: identity.characterId,
    role: identity.role ?? "player",
    channel: identity.channel ?? 1,
    invisible: false,
    tokenVersion: identity.tokenVersion,
    mover: createMover(spawn),
    progression: identity.progression ?? {
      ...FALLBACK_PROGRESSION,
      stats: { ...FALLBACK_PROGRESSION.stats },
    },
    skillMastery: identity.skillMastery ?? {},
    pvpMode: identity.pvpMode ?? "peaceful",
    pending: [],
    lastSeq: 0,
    lastIntent: { kind: "none" },
    chatReadyAtMs: 0,
    shoutReadyAtMs: 0,
    warping: false,
    warpCooldownUntilMs: 0,
    graceTicksRemaining: 0,
    lastPathTargetKey: null,
    lastPathRetargetAtMs: 0,
    failedPathUntilMs: new Map(),
    pathComputations: 0,
    droppedInputs: 0,
    dirty: false,
    saveChain: null,
    inventory: identity.inventory ?? emptyInventory(),
    gold: identity.gold ?? 0,
    warehouse: null,
    inventoryRevision: 0,
    warehouseRevision: 0,
    inventoryChain: null,
    inventoryClosed: false,
    itemUseReadyAtMs: 0,
    attackReadyAtMs: 0,
    skillCooldowns: new Map(),
    pendingCast: null,
    buffs: new Map(),
    healOverTime: [],
    pendingAttack: null,
    lastCombatAtMs: 0,
    regenAccumMs: 0,
    dead: false,
    diedAtMs: 0,
    pendingRespawn: null,
    targetMonsterId: null,
    nextChaseRepathAtMs: now,
    bestTargetDistSq: Number.POSITIVE_INFINITY,
    noProgressSinceMs: 0,
    emptyChasePaths: 0,
  };
}

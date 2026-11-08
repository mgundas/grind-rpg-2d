import { CHAT_MAX_LEN, MAX_GOLD, type MapId, type Stats } from "./constants";
import { EQUIP_SLOT_COUNT, INVENTORY_CELLS, type InventoryErrorCode } from "./inventory";
import type { ItemBonus } from "./items";
import { PARTY_LOOT_RULES } from "./party";
import type { CastCancelReason, SkillType } from "./skills";
import { z } from "zod";

/**
 * Wire protocol shared by server and client. Every client → server message is
 * validated with these schemas (AGENTS.md: Zod on all client input).
 */

export const MSG = {
  input: "input",
  chat: "chat",
  chatMsg: "chatMsg",
  warp: "warp",
  sessionKicked: "sessionKicked",
  attack: "attack",
  setTarget: "setTarget",
  respawn: "respawn",
  allocStat: "allocStat",
  requestStats: "requestStats",
  combat: "combat",
  monsterDied: "monsterDied",
  levelUp: "levelUp",
  death: "death",
  selfStats: "selfStats",
  autoWalk: "autoWalk",
  targetCleared: "targetCleared",
  requestInventory: "requestInventory",
  inventory: "inventory",
  inventoryError: "inventoryError",
  moveItem: "moveItem",
  splitStack: "splitStack",
  equipItem: "equipItem",
  unequipItem: "unequipItem",
  useItem: "useItem",
  pickup: "pickup",
  pickupResult: "pickupResult",
  interactNpc: "interactNpc",
  npcDialog: "npcDialog",
  shopBuy: "shopBuy",
  shopSell: "shopSell",
  warehouseOpen: "warehouseOpen",
  warehouse: "warehouse",
  warehouseDeposit: "warehouseDeposit",
  warehouseWithdraw: "warehouseWithdraw",
  requestUpgradePreview: "requestUpgradePreview",
  upgradePreview: "upgradePreview",
  upgradeItem: "upgradeItem",
  upgradeResult: "upgradeResult",
  blacksmithError: "blacksmithError",
  applyBonusScroll: "applyBonusScroll",
  bonusScrollApplied: "bonusScrollApplied",
  tradeInvite: "tradeInvite",
  tradeRespond: "tradeRespond",
  tradeOffer: "tradeOffer",
  tradeLock: "tradeLock",
  tradeAccept: "tradeAccept",
  tradeCancel: "tradeCancel",
  tradeState: "tradeState",
  tradeError: "tradeError",
  announcement: "announcement",
  castSkill: "castSkill",
  skillCastStart: "skillCastStart",
  skillCast: "skillCast",
  skillCastCancel: "skillCastCancel",
  skillState: "skillState",
  requestSkillState: "requestSkillState",
  chooseDoctrine: "chooseDoctrine",
  upgradeSkill: "upgradeSkill",
  buffState: "buffState",
  partyState: "partyState",
  partyInvite: "partyInvite",
  partyRespond: "partyRespond",
  partyLeave: "partyLeave",
  partySetLoot: "partySetLoot",
  partyError: "partyError",
  skillError: "skillError",
  requestBossTimer: "requestBossTimer",
  bossTimer: "bossTimer",
  stoneDestroyed: "stoneDestroyed",
} as const;

/**
 * Application close code used when a session is replaced (Colyseus reserves
 * 4000–4010 for its own close reasons).
 */
export const SESSION_KICK_CODE = 4100;

export type SessionKickReason = "login" | "logout" | "duplicate" | "admin" | "ban";

/** Sent just before the socket closes with SESSION_KICK_CODE. */
export interface SessionKickedPayload {
  reason: SessionKickReason;
}

const seqSchema = z.number().int().min(1).max(4_294_967_295);
/** All maps fit in uint16 pixels (largest is 5120 px). */
const pxSchema = z.number().finite().min(0).max(65535);

/**
 * One fixed-tick intent. `dir` keeps moving while the client repeats it,
 * `path` is a click-to-move command the server follows to completion, and
 * `none` stops and clears the path. `seq` is acked back via state.lastSeq.
 */
export const inputMessageSchema = z.discriminatedUnion("kind", [
  z.object({ seq: seqSchema, kind: z.literal("dir"), dir: z.number().int().min(0).max(7) }),
  z.object({ seq: seqSchema, kind: z.literal("path"), x: pxSchema, y: pxSchema }),
  z.object({ seq: seqSchema, kind: z.literal("none") }),
]);

export type InputMessage = z.infer<typeof inputMessageSchema>;

export const chatMessageSchema = z.object({
  text: z.string().trim().min(1).max(CHAT_MAX_LEN),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** Server → client local chat line (also used for bubbles above heads). */
export interface ChatMsgPayload {
  from: string;
  name: string;
  kingdom: string;
  text: string;
}

/** Shape of a Colyseus seat reservation, as passed through the warp message. */
export interface SeatReservationPayload {
  name: string;
  sessionId: string;
  roomId: string;
  publicAddress?: string;
  processId?: string;
  reconnectionToken?: string;
  devMode?: boolean;
}

/** Server → client warp instruction: consume this reservation, then fade in. */
export interface WarpPayload {
  map: MapId;
  x: number;
  y: number;
  reservation: SeatReservationPayload;
}

/** Client → server: swing the basic attack in the current (or supplied) facing. */
export const attackMessageSchema = z.object({
  dir: z.number().int().min(0).max(7).optional(),
});
export type AttackMessage = z.infer<typeof attackMessageSchema>;

/** Client → server: walk to and auto-attack a monster. */
export const setTargetMessageSchema = z.object({
  monsterId: z.string().min(1).max(64),
});
export type SetTargetMessage = z.infer<typeof setTargetMessageSchema>;

/** Client → server: respawn after a PvE death. */
export const respawnMessageSchema = z.object({
  option: z.enum(["here", "town"]),
});
export type RespawnMessage = z.infer<typeof respawnMessageSchema>;
export type RespawnOption = RespawnMessage["option"];

export const STAT_KEYS = ["vit", "int", "str", "dex"] as const;
export type StatKey = (typeof STAT_KEYS)[number];

/** Client → server: spend one stat point. */
export const allocStatMessageSchema = z.object({
  stat: z.enum(STAT_KEYS),
});
export type AllocStatMessage = z.infer<typeof allocStatMessageSchema>;

/** Client → server: ask for a fresh owner-only progression snapshot. */
export const requestStatsMessageSchema = z.object({});
export type RequestStatsMessage = z.infer<typeof requestStatsMessageSchema>;

// ---------------------------------------------------------------------------
// Phase 6: skills, buffs, parties and spirit stones
// ---------------------------------------------------------------------------

const skillIdSchema = z.string().min(1).max(64);

export const requestSkillStateMessageSchema = z.object({}).strict();
export type RequestSkillStateMessage = z.infer<typeof requestSkillStateMessageSchema>;

export const chooseDoctrineMessageSchema = z
  .object({ doctrineId: z.string().min(1).max(64) })
  .strict();
export type ChooseDoctrineMessage = z.infer<typeof chooseDoctrineMessageSchema>;

export const upgradeSkillMessageSchema = z.object({ skillId: skillIdSchema }).strict();
export type UpgradeSkillMessage = z.infer<typeof upgradeSkillMessageSchema>;

/**
 * Skill intent. Self/ground/ally skills use different optional fields; the
 * server validates the combination against the skill's type.
 */
export const castSkillMessageSchema = z
  .object({
    skillId: skillIdSchema,
    dir: z.number().int().min(0).max(7).optional(),
    targetMonsterId: z.string().min(1).max(64).optional(),
    targetStoneId: z.string().min(1).max(64).optional(),
    targetCharacterId: z.string().uuid().optional(),
    x: pxSchema.optional(),
    y: pxSchema.optional(),
  })
  .strict()
  .refine((value) => (value.x === undefined) === (value.y === undefined), {
    message: "x and y must be supplied together",
  });
export type CastSkillMessage = z.infer<typeof castSkillMessageSchema>;

export const partyInviteMessageSchema = z
  .object({
    characterId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(16).optional(),
  })
  .strict()
  .refine((value) => value.characterId !== undefined || value.name !== undefined, {
    message: "characterId or name is required",
  });
export type PartyInviteMessage = z.infer<typeof partyInviteMessageSchema>;

export const partyRespondMessageSchema = z
  .object({ inviteId: z.string().uuid(), accept: z.boolean() })
  .strict();
export type PartyRespondMessage = z.infer<typeof partyRespondMessageSchema>;

export const partyLeaveMessageSchema = z.object({}).strict();
export type PartyLeaveMessage = z.infer<typeof partyLeaveMessageSchema>;

export const partySetLootMessageSchema = z.object({ rule: z.enum(PARTY_LOOT_RULES) }).strict();
export type PartySetLootMessage = z.infer<typeof partySetLootMessageSchema>;

export const requestBossTimerMessageSchema = z.object({}).strict();
export type RequestBossTimerMessage = z.infer<typeof requestBossTimerMessageSchema>;

// ---------------------------------------------------------------------------
// Phase 4: items, inventory, NPCs and economy
// ---------------------------------------------------------------------------

/** Client → server: ask for a fresh owner-only inventory/gold snapshot. */
export const requestInventoryMessageSchema = z.object({});
export type RequestInventoryMessage = z.infer<typeof requestInventoryMessageSchema>;

const instanceIdSchema = z.string().uuid();
const inventorySlotSchema = z.number().int().min(0).max(INVENTORY_CELLS - 1);
const equipmentSlotSchema = z.number().int().min(0).max(EQUIP_SLOT_COUNT - 1);
const quantitySchema = z.number().int().min(1).max(9999);
const npcIdSchema = z.string().min(1).max(64);
const shopIdSchema = z.string().min(1).max(64);

/** Move an inventory item to a target top-left cell. */
export const moveItemMessageSchema = z
  .object({ instanceId: instanceIdSchema, toSlot: inventorySlotSchema })
  .strict();
export type MoveItemMessage = z.infer<typeof moveItemMessageSchema>;

/** Split `quantity` off a stack, optionally into a specific cell. */
export const splitStackMessageSchema = z
  .object({
    instanceId: instanceIdSchema,
    quantity: quantitySchema,
    toSlot: inventorySlotSchema.nullable().optional(),
  })
  .strict();
export type SplitStackMessage = z.infer<typeof splitStackMessageSchema>;

export const equipItemMessageSchema = z.object({ instanceId: instanceIdSchema }).strict();
export type EquipItemMessage = z.infer<typeof equipItemMessageSchema>;

export const unequipItemMessageSchema = z.object({ slot: equipmentSlotSchema }).strict();
export type UnequipItemMessage = z.infer<typeof unequipItemMessageSchema>;

export const useItemMessageSchema = z.object({ instanceId: instanceIdSchema }).strict();
export type UseItemMessage = z.infer<typeof useItemMessageSchema>;

export const pickupMessageSchema = z.object({ dropId: instanceIdSchema }).strict();
export type PickupMessage = z.infer<typeof pickupMessageSchema>;

export const interactNpcMessageSchema = z.object({ npcId: npcIdSchema }).strict();
export type InteractNpcMessage = z.infer<typeof interactNpcMessageSchema>;

export const shopBuyMessageSchema = z
  .object({ shopId: shopIdSchema, itemId: z.string().min(1).max(64), quantity: quantitySchema })
  .strict();
export type ShopBuyMessage = z.infer<typeof shopBuyMessageSchema>;

export const shopSellMessageSchema = z
  .object({ instanceId: instanceIdSchema, quantity: quantitySchema })
  .strict();
export type ShopSellMessage = z.infer<typeof shopSellMessageSchema>;

export const warehouseOpenMessageSchema = z.object({ npcId: npcIdSchema }).strict();
export type WarehouseOpenMessage = z.infer<typeof warehouseOpenMessageSchema>;

export const warehouseDepositMessageSchema = z.object({ instanceId: instanceIdSchema }).strict();
export type WarehouseDepositMessage = z.infer<typeof warehouseDepositMessageSchema>;

export const warehouseWithdrawMessageSchema = z
  .object({ instanceId: instanceIdSchema, toSlot: inventorySlotSchema.nullable().optional() })
  .strict();
export type WarehouseWithdrawMessage = z.infer<typeof warehouseWithdrawMessageSchema>;

/** Client → server: preview an upgrade at the blacksmith, including costs. */
export const requestUpgradePreviewMessageSchema = z
  .object({ instanceId: instanceIdSchema })
  .strict();
export type RequestUpgradePreviewMessage = z.infer<typeof requestUpgradePreviewMessageSchema>;

/** Client → server: execute one upgrade roll at the blacksmith. */
export const upgradeItemMessageSchema = z
  .object({ instanceId: instanceIdSchema, useBlessing: z.boolean() })
  .strict();
export type UpgradeItemMessage = z.infer<typeof upgradeItemMessageSchema>;

/** Client → server: apply an enchant or reinforce scroll to one equipment item. */
export const applyBonusScrollMessageSchema = z
  .object({ scrollInstanceId: instanceIdSchema, itemInstanceId: instanceIdSchema })
  .strict();
export type ApplyBonusScrollMessage = z.infer<typeof applyBonusScrollMessageSchema>;

export type BonusScrollKindWire = "enchant" | "reinforce";

export interface BonusScrollAppliedPayload {
  scrollInstanceId: string;
  itemInstanceId: string;
  kind: BonusScrollKindWire;
  bonuses: ItemBonus[];
}

// ---------------------------------------------------------------------------
// Phase 7: trading
// ---------------------------------------------------------------------------

export const TRADE_PHASES = [
  "invited",
  "open",
  "locked",
  "completed",
  "cancelled",
] as const;
export type TradePhase = (typeof TRADE_PHASES)[number];

const tradeIdSchema = z.string().uuid();
const tradeRevisionSchema = z.number().int().min(0).max(2_147_483_647);

/**
 * Client → server: invite one character in the same room. Offers, locks and
 * accepts all carry the last revision the client saw so stale clicks are dropped.
 */
export const tradeInviteMessageSchema = z
  .object({ characterId: z.string().uuid() })
  .strict();
export type TradeInviteMessage = z.infer<typeof tradeInviteMessageSchema>;

export const tradeRespondMessageSchema = z
  .object({ tradeId: tradeIdSchema, accept: z.boolean() })
  .strict();
export type TradeRespondMessage = z.infer<typeof tradeRespondMessageSchema>;

export const tradeOfferMessageSchema = z
  .object({
    tradeId: tradeIdSchema,
    revision: tradeRevisionSchema,
    instanceIds: z.array(z.string().uuid()).max(90),
    gold: z.number().int().min(0).max(MAX_GOLD),
  })
  .strict()
  .refine((value) => new Set(value.instanceIds).size === value.instanceIds.length, {
    message: "duplicate offered instance",
  });
export type TradeOfferMessage = z.infer<typeof tradeOfferMessageSchema>;

export const tradeLockMessageSchema = z
  .object({ tradeId: tradeIdSchema, revision: tradeRevisionSchema, locked: z.boolean() })
  .strict();
export type TradeLockMessage = z.infer<typeof tradeLockMessageSchema>;

export const tradeAcceptMessageSchema = z
  .object({ tradeId: tradeIdSchema, revision: tradeRevisionSchema })
  .strict();
export type TradeAcceptMessage = z.infer<typeof tradeAcceptMessageSchema>;

export const tradeCancelMessageSchema = z.object({ tradeId: tradeIdSchema }).strict();
export type TradeCancelMessage = z.infer<typeof tradeCancelMessageSchema>;

export type TradeErrorCode =
  | "self_trade"
  | "same_account"
  | "not_found"
  | "offline"
  | "out_of_range"
  | "busy"
  | "revision"
  | "invalid_offer"
  | "not_owner"
  | "inventory_full"
  | "no_gold"
  | "stale"
  | "not_locked"
  | "expired"
  | "cancelled"
  | "dead"
  | "warping"
  | "inventory_closed"
  | "internal";

export interface TradeErrorPayload {
  tradeId?: string;
  code: TradeErrorCode;
  message?: string;
}

/** One participant's visible side of an open trade. */
export interface TradeSidePayload {
  characterId: string;
  name: string;
  /** Total gold the character owns, so the UI can cap the offer. */
  gold: number;
  offeredGold: number;
  items: ItemInstanceDto[];
  locked: boolean;
  accepted: boolean;
}

export interface TradeStatePayload {
  tradeId: string;
  revision: number;
  phase: TradePhase;
  you: TradeSidePayload;
  other: TradeSidePayload;
}

export interface TradeInvitePayload {
  tradeId: string;
  fromCharacterId: string;
  fromName: string;
  expiresAtMs: number;
}

export interface BlacksmithErrorPayload {
  code: ItemActionErrorCode;
  message?: string;
}

/** One owner-visible item instance (inventory, equipment or warehouse). */
export interface ItemInstanceDto {
  id: string;
  itemId: string;
  /** Inventory/warehouse top-left cell, or equipment slot index. */
  slot: number;
  quantity: number;
  upgradeLevel: number;
  bonuses: ItemBonus[];
}

/** Owner-only inventory snapshot. Sent on join and after every mutation. */
export interface InventorySnapshotPayload {
  revision: number;
  gold: number;
  items: ItemInstanceDto[];
  /** Exactly `EQUIP_SLOT_COUNT` entries; null means the slot is empty. */
  equipment: (ItemInstanceDto | null)[];
}

/** Owner-only account warehouse snapshot (three pages). */
export interface WarehouseSnapshotPayload {
  revision: number;
  items: ItemInstanceDto[];
}

/**
 * Wire-level failure reasons. The shared inventory codes are reused and
 * extended with server-side validation outcomes.
 */
export type ItemActionErrorCode =
  | InventoryErrorCode
  | "not_owner"
  | "out_of_range"
  | "already_taken"
  | "no_gold"
  | "not_for_sale"
  | "unknown_shop"
  | "unknown_item"
  | "unknown_npc"
  | "not_consumable"
  | "at_full_health"
  | "at_full_mana"
  | "cooldown"
  | "dead"
  | "warping"
  | "warehouse_full"
  | "not_usable"
  /** The DB no longer matches the runtime snapshot; reload and resnapshot. */
  | "stale"
  /** Unexpected persistence failure; logged, never rethrown into the room tick. */
  | "internal";

export interface InventoryErrorPayload {
  code: ItemActionErrorCode;
  message?: string;
}

/** Pickup acknowledgement used for loot FX (a snapshot follows separately). */
export interface PickupResultPayload {
  dropId: string;
  ok: boolean;
  code?: ItemActionErrorCode;
  gold?: number;
  itemId?: string;
  quantity?: number;
}

export type NpcDialogKind = "shop" | "warehouse" | "blacksmith";

export interface NpcDialogPayload {
  npcId: string;
  name: string;
  kind: NpcDialogKind;
  greeting: string;
  shopId?: string;
}

export interface ShopStockEntry {
  itemId: string;
  price: number;
}

export interface ShopViewPayload {
  shopId: string;
  name: string;
  items: ShopStockEntry[];
}

export type AnnouncementKind = "admin" | "scheduled" | "shutdown" | "upgrade";

/** Server-wide banner (admin panel / scheduled announcement / shutdown countdown). */
export interface AnnouncementPayload {
  id?: string;
  message: string;
  kind: AnnouncementKind;
  sentAtMs?: number;
}

/** Identifies a combatant in a combat event. */
export type CombatEntityRef =
  | { kind: "player"; sessionId: string }
  | { kind: "monster"; monsterId: string }
  | { kind: "stone"; stoneId: string };

export interface CombatHit {
  target: CombatEntityRef;
  /** Authoritative target position at hit time (for damage numbers). */
  x: number;
  y: number;
  miss: boolean;
  crit: boolean;
  damage: number;
}

/** One message per swing; carries every target hit by the same attack. */
export interface CombatEventPayload {
  eventSeq: number;
  attacker: CombatEntityRef;
  hits: CombatHit[];
  /** Present when the swing came from a skill cast. */
  skillId?: string;
}

/** Sent when a monster dies; the state entity is removed in the same patch. */
export interface MonsterDiedPayload {
  monsterId: string;
  typeId: string;
  x: number;
  y: number;
  killerSessionId: string | null;
}

export interface LevelUpPayload {
  sessionId: string;
  name: string;
  level: number;
  x: number;
  y: number;
}

/** Owner-only death notice with the earliest allowed "restart here" time. */
export interface DeathPayload {
  respawnHereAtMs: number;
}

/** Owner-only progression snapshot (XP and stats stay off public state). */
export interface SelfStatsPayload {
  level: number;
  xp: number;
  xpToNext: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  statPoints: number;
  stats: Stats;
  attack: number;
  defense: number;
  critChance: number;
  /** Filled from Phase 6 onward; optional during the increment. */
  doctrine?: string | null;
  skillPoints?: number;
}

/** One learned skill and its absolute cooldown timestamp. */
export interface SkillRankView {
  skillId: string;
  /** 0 means visible but not learned. */
  rank: number;
  /** Epoch ms before which a new cast is rejected; 0 = ready. */
  readyAtMs: number;
}

/** Owner-only skill/doctrine snapshot, sent on join and after every change. */
export interface SkillStatePayload {
  doctrine: string | null;
  skillPoints: number;
  totalSkillPoints: number;
  skills: SkillRankView[];
}

export interface BuffView {
  id: string;
  sourceSkillId: string;
  name: string;
  iconKey: string;
  kind: "buff" | "debuff";
  expiresAtMs: number;
  stacks: number;
}

export interface BuffStatePayload {
  buffs: BuffView[];
}

export interface SkillCastStartPayload {
  skillId: string;
  name: string;
  completesAtMs: number;
  castTimeMs: number;
}

export interface SkillCastCancelPayload {
  skillId: string;
  reason: CastCancelReason;
}

export interface SkillHealResult {
  targetSessionId: string;
  targetCharacterId: string;
  amount: number;
  x: number;
  y: number;
}

export interface SkillBuffResult {
  targetSessionId: string;
  buff: BuffView;
}

/** Broadcast skill feedback for FX and floating numbers. */
export interface SkillCastPayload {
  eventSeq: number;
  caster: { kind: "player"; sessionId: string };
  skillId: string;
  name: string;
  type: SkillType;
  /** Client FX preset key from skills.json. */
  fx: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  hits: CombatHit[];
  heals: SkillHealResult[];
  buffs: SkillBuffResult[];
}

/** Owner-only switch between local prediction and server-driven auto-walk. */
export interface AutoWalkPayload {
  active: boolean;
  targetMonsterId?: string;
}

export type TargetClearedReason = "unreachable" | "target_lost" | "cancelled";

export interface TargetClearedPayload {
  reason: TargetClearedReason;
}

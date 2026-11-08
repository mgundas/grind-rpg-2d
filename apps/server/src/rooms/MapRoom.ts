import { randomUUID } from "node:crypto";
import { matchMaker, type AuthContext, type Client, Room } from "@colyseus/core";
import { StateView } from "@colyseus/schema";
import {
  CHAT_COOLDOWN_MS,
  COMBAT_EVENT_RADIUS_PX,
  DIR8_VECTORS,
  AUTO_WALK_GIVE_UP_MS,
  AUTO_WALK_MAX_EMPTY_PATHS,
  AUTO_WALK_TARGET_RANGE_PX,
  DROP_OWNERSHIP_MS,
  DROP_SCATTER_MAX_PX,
  DROP_SCATTER_MIN_PX,
  GROUND_ITEM_DESPAWN_MS,
  INTEREST_ADD_RADIUS_PX,
  INTEREST_INTERVAL_MS,
  INTEREST_RADIUS_PX,
  ITEM_USE_COOLDOWN_MS,
  MAX_ASTAR_PER_TICK,
  MAX_ADMIN_SPAWN,
  MAX_GOLD,
  MAX_MESSAGES_PER_SECOND,
  MAX_PLAYERS_PER_CHANNEL,
  MSG,
  NPC_INTERACT_RADIUS_PX,
  PICKUP_RADIUS_PX,
  PATH_RETARGET_MIN_MS,
  RESPAWN_HERE_DELAY_MS,
  RESPAWN_HERE_HP_FRACTION,
  SERVER_TICK_GRACE_TICKS,
  STAT_POINT_CAP,
  TICK_MS,
  TILE_SIZE,
  WALK_SPEED,
  WARP_COOLDOWN_MS,
  PARTY_XP_RADIUS_PX,
  allocStatMessageSchema,
  applyXpGain,
  attackMessageSchema,
  castSkillMessageSchema,
  chatMessageSchema,
  chatRecipients,
  canPickupDrop,
  chooseDoctrineMessageSchema,
  deathXpLoss,
  dir8Towards,
  equipItemMessageSchema,
  facing4FromDelta,
  facing4FromIndex,
  facing4Index,
  findPath,
  inputMessageSchema,
  interactNpcMessageSchema,
  isClassId,
  isWalkableAt,
  moveItemMessageSchema,
  nearestWalkable,
  partyMemberXpGain,
  partyInviteMessageSchema,
  partyLeaveMessageSchema,
  partyRespondMessageSchema,
  partySetLootMessageSchema,
  pickupMessageSchema,
  randomInt,
  rollDrops,
  shopBuyMessageSchema,
  shopSellMessageSchema,
  warehouseDepositMessageSchema,
  warehouseOpenMessageSchema,
  warehouseWithdrawMessageSchema,
  requestInventoryMessageSchema,
  requestBossTimerMessageSchema,
  requestSkillStateMessageSchema,
  requestStatsMessageSchema,
  requestUpgradePreviewMessageSchema,
  respawnMessageSchema,
  seededRandomSource,
  seedFromString,
  setTargetMessageSchema,
  splitStackMessageSchema,
  stepMover,
  unequipItemMessageSchema,
  upgradeItemMessageSchema,
  upgradeSkillMessageSchema,
  useItemMessageSchema,
  type AdminGiveItemRequest,
  type AdminUpdateCharacterRequest,
  type BossTimerPayload,
  type BuffStatePayload,
  type BuffView,
  type ChatMsgPayload,
  type CombatEventPayload,
  type CombatHit,
  type DeathPayload,
  type Dir8,
  type InputMessage,
  type InventoryState,
  type ItemActionErrorCode,
  type ItemInstanceDto,
  type LevelUpPayload,
  type MapId,
  type MonsterDiedPayload,
  type NpcDialogPayload,
  type PartyStatePayload,
  type PickupResultPayload,
  type RandomSource,
  type SkillBuffResult,
  type SkillCastCancelPayload,
  type SkillCastPayload,
  type SkillCastStartPayload,
  type StatKey,
  type StoneDestroyedPayload,
  type TargetClearedReason,
  type Vec2,
  type WarpPayload,
  type WarpZone,
} from "@jadethrone/shared";
import { getClass } from "@jadethrone/data/classes";
import { getDropTable } from "@jadethrone/data/dropTables";
import { getItem, hasItem } from "@jadethrone/data/items";
import { getMonster, hasMonster } from "@jadethrone/data/monsters";
import { getSkill, hasSkill } from "@jadethrone/data/skills";
import { getNpc } from "@jadethrone/data/npcs";
import { getShop } from "@jadethrone/data/shops";
import { getStone, getStoneForZone } from "@jadethrone/data/stones";
import { logger } from "../logger";
import { isMapId, loadMapAssets, type MapAssets } from "../maps/mapRegistry";
import { isGmRole, parseGmCommand } from "../admin/gmCommands";
import type { AdminLiveActions, AdminRoomHandle } from "../admin/liveBus";
import { equipmentBonusStats, equipmentBonusValue, equipmentVisualKeys } from "../items/equipment";
import { toItemDto } from "../items/itemMappers";
import { ItemError } from "../items/errors";
import type { ItemPlan } from "../items/itemChanges";
import { describeChanges } from "../items/itemChanges";
import { buildUpgradePreview, planUpgrade } from "../items/upgrade";
import {
  diffInventory,
  planAdminGive,
  planAdminRemove,
  planBuy,
  planConsume,
  planDeposit,
  planEquip,
  planGoldPickup,
  planMove,
  planPickup,
  planSell,
  planSplit,
  planUnequip,
  planWithdraw,
} from "../items/planning";
import { buildInventorySnapshot, buildWarehouseSnapshot } from "./items";
import { createPlayerRuntime, type PlayerRuntime } from "./playerRuntime";
import type { GroundItemRuntime } from "./groundItems";
import { GroundItemState, PlayerState, SpiritStoneState, WorldState } from "./state/WorldState";
import { issueWarpToken } from "./warpTokens";
import { getServerServices } from "../services";
import { buildAdminPresence, findGrantedStack, toAdminError } from "./adminActions";
import { ServiceError } from "../errors";
import { buildSelfStats } from "../characters/selfStats";
import {
  createPartyRegistry,
  PartyRuleError,
  toPartyInvitePayload,
  type Party,
  type PartyMemberInput,
} from "./party";
import {
  progressionFromCharacter,
  recomputeMaxima,
  recomputeSkillPoints,
} from "../characters/progression";
import { defaultSpawn, type CharacterSave } from "../characters/spawn";
import { createStoneManager, zoneIdOf, type StoneManager, type StoneRuntime } from "./stoneManager";
import {
  buildSkillState,
  chooseDoctrine as validateDoctrineChoice,
  SkillRuleError,
  toSkillErrorPayload,
  upgradeSkill as validateSkillUpgrade,
} from "../skills/skillState";
import {
  applyPlayerBuff,
  applyPoison,
  applySlow,
  applyStunAt,
  buffViews,
  hasStealth,
  playerBuffModifiers,
  pruneExpiredBuffs,
  removeDebuffs,
  removeStealth,
  tickPoison,
  type PlayerBuff,
} from "../skills/effects";
import { resolveSkillCast, type SkillOutcome } from "../skills/skillCombat";
import {
  createPendingCast,
  startSkillCooldown,
  validateSkillCast,
} from "../skills/skillRuntime";
import {
  applyDamageToMonster,
  resolveMonsterAttack,
  resolvePlayerSwing,
  topDamageOwner,
  type KilledMonster,
  type StoneHit,
  type SwingOutcome,
} from "./combat";
import { applyRegenTick } from "./regen";
import { stepMonsterAi, aggroMonster, type AiPlayerSnapshot } from "./monsterAi";
import type { MonsterRuntime } from "./monsterRuntime";
import {
  aggroGroup,
  bossStatuses,
  createSpawnManager,
  notifyMonsterDeath,
  spawnAdminMonsters,
  spawnAllGroups,
  tickSpawns,
  type SpawnManager,
} from "./spawnManager";
import type { JoinIdentity } from "../auth/joinAuth";

/** Converts a runtime buff to the wire shape used by skill/buff messages. */
function toBuffView(buff: PlayerBuff): BuffView {
  return {
    id: buff.id,
    sourceSkillId: buff.sourceSkillId,
    name: buff.name,
    iconKey: buff.iconKey,
    kind: buff.kind,
    expiresAtMs: buff.expiresAtMs,
    stacks: buff.stacks,
  };
}

/** Max queued input messages per player; older inputs are dropped. */
const MAX_PENDING_INPUTS = 8;

/** Unreachable path targets are not retried before this delay. */
const PATH_FAILURE_CACHE_MS = 1000;

/** A client that never leaves after a warp is disconnected after this delay. */
const WARP_CLIENT_LEAVE_TIMEOUT_MS = 2000;

/** Dirty position autosave cadence (GAME_DESIGN.md §10.2). */
const AUTOSAVE_INTERVAL_MS = 60_000;

/**
 * One room instance per map (GAME_DESIGN.md §10.2). Authentication happens at
 * matchmaking (`static onAuth`); the room only trusts `client.auth`, the
 * server-issued spawn and the DB-backed persistence services.
 */
export class MapRoom extends Room {
  maxClients = MAX_PLAYERS_PER_CHANNEL;
  maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND;
  patchRate = 50;

  state = new WorldState();

  private mapId!: MapId;
  private assets!: MapAssets;
  private runtimes = new Map<string, PlayerRuntime>();
  private monsterRuntimes = new Map<string, MonsterRuntime>();
  private groundItems = new Map<string, GroundItemRuntime>();
  private adminActions = new Map<string, AdminLiveActions>();
  private adminRoom: AdminRoomHandle | null = null;
  private readonly parties = createPartyRegistry();
  private partyBroadcastAtMs = 0;
  private shuttingDown = false;
  private spawns!: SpawnManager;
  private stones!: StoneManager;
  private stoneRng!: RandomSource;
  private rng!: RandomSource;
  /** Monotonic id for combat events, so clients can ignore stale arrivals. */
  private eventSeq = 0;
  /** Reused intent buffer: no per-tick allocation in the steady state. */
  private attackIntents: Array<{ monsterId: string; targetSessionId: string }> = [];
  private attackIntentCount = 0;

  /**
   * Colyseus 0.17 calls the STATIC method during matchmaking, before a seat is
   * reserved; its return value becomes `client.auth` in `onJoin`.
   */
  static async onAuth(
    token: string | undefined,
    options: unknown,
    context: AuthContext,
  ): Promise<JoinIdentity | null> {
    return getServerServices().joinAuthenticator(token, options, { ip: context.ip });
  }

  onCreate(): void {
    if (!isMapId(this.roomName)) {
      throw new Error(`unknown map room "${this.roomName}"`);
    }
    this.mapId = this.roomName;
    this.assets = loadMapAssets(this.mapId);
    this.rng = getServerServices().createRandomSource();
    this.spawns = createSpawnManager({
      mapId: this.mapId,
      grid: this.assets.grid,
      state: this.state,
      runtimes: this.monsterRuntimes,
      mobZones: this.assets.mobZones,
      // Deterministic per room: the room id is random, so two rooms never
      // share a layout, but a single room always reproduces its own packs.
      rngForGroup: (seed) => seededRandomSource(seedFromString(`${this.roomId}:${seed}`)),
    });
    spawnAllGroups(this.spawns, Date.now());

    this.stoneRng = seededRandomSource(seedFromString(`${this.roomId}:stones`));
    const stoneZones = this.assets.stoneZones.flatMap((zone) => {
      const info = getStoneForZone(zoneIdOf(zone));
      return info && info.mapId === this.mapId ? [{ info, zone }] : [];
    });
    this.stones = createStoneManager({
      zones: stoneZones,
      grid: this.assets.grid,
      rng: this.stoneRng,
      idFactory: randomUUID,
    });
    this.syncStoneSpawns(this.stones.spawnInitial(Date.now()));

    // Expired rows from a previous process are unreachable. Only `despawn_at`
    // rows are removed, so a concurrent room's live drops are never touched.
    void getServerServices()
      .items.deleteExpiredGroundItems(this.mapId)
      .then((count) => {
        if (count > 0) {
          logger.info({ roomId: this.roomId, mapId: this.mapId, count }, "purged expired ground items");
        }
      })
      .catch((error: unknown) => {
        logger.error({ roomId: this.roomId, mapId: this.mapId, error }, "ground purge failed");
      });

    this.onMessage(MSG.input, (client, raw) => {
      const parsed = inputMessageSchema.safeParse(raw);
      if (!parsed.success) {
        // A malformed message from a buggy/hostile client is dropped, not a
        // reason to disconnect a legitimate session.
        logger.warn(
          { session: client.sessionId, issues: parsed.error.issues.map((issue) => issue.message) },
          "dropped invalid input message",
        );
        return;
      }
      const runtime = this.runtimes.get(client.sessionId);
      if (!runtime) {
        return;
      }
      if (runtime.pending.length >= MAX_PENDING_INPUTS) {
        runtime.pending.shift();
        runtime.droppedInputs++;
      }
      runtime.pending.push(parsed.data);
    });

    this.onMessage(MSG.chat, (client, raw) => {
      const parsed = chatMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid chat message");
        return;
      }
      const runtime = this.runtimes.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      if (!runtime || !player) {
        return;
      }
      const text = parsed.data.text.trim();
      if (text === "/leave") {
        this.leavePartyCommand(client);
        return;
      }
      if (/^\/invite\s+/i.test(text)) {
        this.handlePartyInvite(client, undefined, text.replace(/^\/invite\s+/i, ""));
        return;
      }
      if (text.startsWith("/") && isGmRole(runtime.role)) {
        this.handleGmCommand(client, runtime, parsed.data.text);
        return;
      }
      const now = Date.now();
      if (now < runtime.chatReadyAtMs) {
        return;
      }
      runtime.chatReadyAtMs = now + CHAT_COOLDOWN_MS;

      const participants = [...this.state.players.entries()].map(([sessionId, other]) => ({
        sessionId,
        x: other.x,
        y: other.y,
      }));
      const recipients = chatRecipients(participants, {
        sessionId: client.sessionId,
        x: player.x,
        y: player.y,
      });
      const payload: ChatMsgPayload = {
        from: client.sessionId,
        name: player.name,
        kingdom: player.kingdom,
        text: parsed.data.text,
      };
      for (const otherClient of this.clients) {
        if (recipients.includes(otherClient.sessionId)) {
          otherClient.send(MSG.chatMsg, payload);
        }
      }
      void getServerServices()
        .logChat({
          characterId: runtime.characterId,
          name: player.name,
          kingdom: player.kingdom,
          mapId: this.mapId,
          text: parsed.data.text,
        })
        .catch(() => undefined);
    });

    this.onMessage(MSG.castSkill, (client, raw) => {
      const parsed = castSkillMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid castSkill message");
        return;
      }
      this.castSkill(client, parsed.data);
    });

    this.onMessage(MSG.attack, (client, raw) => {
      const parsed = attackMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid attack message");
        return;
      }
      const runtime = this.runtimes.get(client.sessionId);
      if (!runtime) {
        return;
      }
      if (runtime.pendingCast) {
        this.cancelPendingCast(runtime, client.sessionId, "attacked");
      }
      // One pending swing per tick: spamming collapses into a single attack.
      runtime.pendingAttack = {
        dir: parsed.data.dir === undefined ? null : (parsed.data.dir as Dir8),
      };
    });

    this.onMessage(MSG.setTarget, (client, raw) => {
      const parsed = setTargetMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid target message");
        return;
      }
      this.setAutoWalkTarget(client, parsed.data.monsterId);
    });

    this.onMessage(MSG.respawn, (client, raw) => {
      const parsed = respawnMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid respawn message");
        return;
      }
      const runtime = this.runtimes.get(client.sessionId);
      if (runtime) {
        runtime.pendingRespawn = parsed.data.option;
      }
    });

    this.onMessage(MSG.allocStat, (client, raw) => {
      const parsed = allocStatMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid stat allocation");
        return;
      }
      this.allocateStat(client.sessionId, parsed.data.stat);
    });

    this.onMessage(MSG.chooseDoctrine, (client, raw) => {
      const parsed = chooseDoctrineMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid doctrine choice");
        return;
      }
      this.chooseDoctrine(client, parsed.data.doctrineId);
    });

    this.onMessage(MSG.upgradeSkill, (client, raw) => {
      const parsed = upgradeSkillMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid skill upgrade");
        return;
      }
      this.upgradeSkill(client, parsed.data.skillId);
    });

    this.onMessage(MSG.requestSkillState, (client, raw) => {
      if (!requestSkillStateMessageSchema.safeParse(raw).success) {
        return;
      }
      this.sendSkillState(client.sessionId);
    });

    this.onMessage(MSG.requestBossTimer, (client, raw) => {
      if (!requestBossTimerMessageSchema.safeParse(raw).success) {
        return;
      }
      this.sendBossTimersTo(client);
    });

    this.onMessage(MSG.partyInvite, (client, raw) => {
      const parsed = partyInviteMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid party invite");
        return;
      }
      this.handlePartyInvite(client, parsed.data.characterId, parsed.data.name);
    });

    this.onMessage(MSG.partyRespond, (client, raw) => {
      const parsed = partyRespondMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid party response");
        return;
      }
      this.handlePartyRespond(client, parsed.data.inviteId, parsed.data.accept);
    });

    this.onMessage(MSG.partyLeave, (client, raw) => {
      if (!partyLeaveMessageSchema.safeParse(raw).success) {
        return;
      }
      this.leavePartyCommand(client);
    });

    this.onMessage(MSG.partySetLoot, (client, raw) => {
      const parsed = partySetLootMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid party loot rule");
        return;
      }
      this.setPartyLoot(client, parsed.data.rule);
    });

    this.onMessage(MSG.requestStats, (client, raw) => {
      if (!requestStatsMessageSchema.safeParse(raw).success) {
        return;
      }
      this.sendSelfStats(client.sessionId);
    });

    this.onMessage(MSG.requestInventory, (client, raw) => {
      if (!requestInventoryMessageSchema.safeParse(raw).success) {
        return;
      }
      this.sendInventory(client.sessionId);
    });

    this.onMessage(MSG.moveItem, (client, raw) => {
      const parsed = moveItemMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid moveItem message");
        return;
      }
      this.runItemCommand(client, async (runtime) => {
        const result = planMove(
          runtime.inventory,
          runtime.characterId,
          parsed.data.instanceId,
          parsed.data.toSlot,
        );
        await this.applyItemPlan(runtime, result.state, result.plan);
      });
    });

    this.onMessage(MSG.splitStack, (client, raw) => {
      const parsed = splitStackMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid splitStack message");
        return;
      }
      this.runItemCommand(client, async (runtime) => {
        const result = planSplit(
          runtime.inventory,
          runtime.characterId,
          parsed.data.instanceId,
          parsed.data.quantity,
          parsed.data.toSlot ?? null,
          randomUUID,
        );
        await this.applyItemPlan(runtime, result.state, result.plan);
      });
    });

    this.onMessage(MSG.equipItem, (client, raw) => {
      const parsed = equipItemMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid equipItem message");
        return;
      }
      this.runItemCommand(client, async (runtime) => {
        const player = this.state.players.get(client.sessionId);
        if (!player || !isClassId(player.classId)) {
          throw new ItemError("internal", "Player class is invalid.");
        }
        const result = planEquip(
          runtime.inventory,
          runtime.characterId,
          player.classId,
          runtime.progression.level,
          parsed.data.instanceId,
        );
        await this.applyItemPlan(runtime, result.state, result.plan);
      });
    });

    this.onMessage(MSG.unequipItem, (client, raw) => {
      const parsed = unequipItemMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid unequipItem message");
        return;
      }
      this.runItemCommand(client, async (runtime) => {
        const result = planUnequip(
          runtime.inventory,
          runtime.characterId,
          parsed.data.slot,
          null,
        );
        await this.applyItemPlan(runtime, result.state, result.plan);
      });
    });

    this.onMessage(MSG.pickup, (client, raw) => {
      const parsed = pickupMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn(
          {
            session: client.sessionId,
            issues: parsed.error.issues.map((issue) => issue.message),
            payload: raw,
          },
          "dropped invalid pickup message",
        );
        return;
      }
      this.runItemCommand(client, async (runtime) => {
        try {
          await this.pickupDrop(client, runtime, parsed.data.dropId);
        } catch (error) {
          await this.handlePickupFailure(client, runtime, parsed.data.dropId, error);
        }
      });
    });

    this.onMessage(MSG.useItem, (client, raw) => {
      const parsed = useItemMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid useItem message");
        return;
      }
      this.runItemCommand(client, async (runtime) => {
        await this.useItem(client, runtime, parsed.data.instanceId);
      });
    });

    this.onMessage(MSG.interactNpc, (client, raw) => {
      const parsed = interactNpcMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid interactNpc message");
        return;
      }
      this.interactNpc(client, parsed.data.npcId);
    });

    this.onMessage(MSG.shopBuy, (client, raw) => {
      const parsed = shopBuyMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid shopBuy message");
        return;
      }
      this.runItemCommand(client, async (runtime) => {
        this.requireShopRange(runtime, parsed.data.shopId);
        const result = planBuy(
          runtime.inventory,
          runtime.characterId,
          runtime.gold,
          parsed.data.shopId,
          parsed.data.itemId,
          parsed.data.quantity,
          randomUUID,
        );
        await this.applyItemPlan(runtime, result.state, result.plan);
      });
    });

    this.onMessage(MSG.shopSell, (client, raw) => {
      const parsed = shopSellMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid shopSell message");
        return;
      }
      this.runItemCommand(client, async (runtime) => {
        this.requireAnyShopRange(runtime);
        const result = planSell(
          runtime.inventory,
          runtime.characterId,
          parsed.data.instanceId,
          parsed.data.quantity,
        );
        await this.applyItemPlan(runtime, result.state, result.plan);
      });
    });

    this.onMessage(MSG.warehouseOpen, (client, raw) => {
      const parsed = warehouseOpenMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid warehouseOpen message");
        return;
      }
      this.runItemCommand(client, async (runtime) => {
        this.requireWarehouseRange(runtime, parsed.data.npcId);
        await this.openWarehouse(client, runtime);
      });
    });

    this.onMessage(MSG.warehouseDeposit, (client, raw) => {
      const parsed = warehouseDepositMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid warehouseDeposit message");
        return;
      }
      this.runItemCommand(client, async (runtime) => {
        this.requireWarehouseRange(runtime);
        await this.ensureWarehouse(runtime);
        const result = planDeposit(
          runtime.inventory,
          runtime.warehouse!,
          runtime.characterId,
          runtime.accountId,
          parsed.data.instanceId,
        );
        await this.applyItemPlan(runtime, result.state.inventory, result.plan);
        runtime.warehouse = result.state.warehouse;
        runtime.warehouseRevision++;
        this.sendWarehouse(client);
      });
    });

    this.onMessage(MSG.warehouseWithdraw, (client, raw) => {
      const parsed = warehouseWithdrawMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid warehouseWithdraw message");
        return;
      }
      this.runItemCommand(client, async (runtime) => {
        this.requireWarehouseRange(runtime);
        await this.ensureWarehouse(runtime);
        const result = planWithdraw(
          runtime.inventory,
          runtime.warehouse!,
          runtime.characterId,
          runtime.accountId,
          parsed.data.instanceId,
          parsed.data.toSlot ?? null,
        );
        await this.applyItemPlan(runtime, result.state.inventory, result.plan);
        runtime.warehouse = result.state.warehouse;
        runtime.warehouseRevision++;
        this.sendWarehouse(client);
      });
    });

    this.onMessage(MSG.requestUpgradePreview, (client, raw) => {
      const parsed = requestUpgradePreviewMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn(
          { session: client.sessionId },
          "dropped invalid requestUpgradePreview message",
        );
        return;
      }
      this.runItemCommand(
        client,
        async (runtime) => {
          this.requireBlacksmithRange(runtime);
          if (runtime.warping) {
            throw new ItemError("warping", "You cannot upgrade while warping.");
          }
          const preview = buildUpgradePreview(
            runtime.inventory,
            runtime.gold,
            parsed.data.instanceId,
          );
          this.safeSend(client, MSG.upgradePreview, preview);
        },
        "blacksmith",
      );
    });

    this.onMessage(MSG.upgradeItem, (client, raw) => {
      const parsed = upgradeItemMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid upgradeItem message");
        return;
      }
      this.runItemCommand(
        client,
        async (runtime) => {
          this.requireBlacksmithRange(runtime);
          if (runtime.warping) {
            throw new ItemError("warping", "You cannot upgrade while warping.");
          }
          const result = planUpgrade(
            runtime.inventory,
            runtime.gold,
            runtime.characterId,
            parsed.data.instanceId,
            { useBlessing: parsed.data.useBlessing, rng: this.rng },
          );
          await this.applyItemPlan(runtime, result.state, result.plan);
          this.safeSend(client, MSG.upgradeResult, {
            instanceId: parsed.data.instanceId,
            success: result.success,
            previousLevel: result.previousLevel,
            level: result.level,
            destroyed: result.destroyed,
            usedBlessing: result.usedBlessing,
          });
          if (result.success && result.level !== null && result.level >= 7) {
            this.announceUpgrade(client.sessionId, parsed.data.instanceId, result.level);
          }
        },
        "blacksmith",
      );
    });

    this.setSimulationInterval(() => this.tick(), TICK_MS);
    // Interest management runs at 4 Hz, not every tick (GAME_DESIGN.md §5.1).
    this.clock.setInterval(() => this.updateInterest(), INTEREST_INTERVAL_MS);
    this.clock.setInterval(() => void this.autosave(), AUTOSAVE_INTERVAL_MS);

    this.adminRoom = {
      roomId: this.roomId,
      mapId: this.mapId,
      startedAtMs: Date.now(),
      maxClients: this.maxClients,
      playerCount: () => this.runtimes.size,
      announce: (payload) => {
        let sent = 0;
        for (const client of this.clients) {
          this.safeSend(client, MSG.announcement, payload);
          sent++;
        }
        return sent;
      },
      saveAllForShutdown: () => this.saveAllForShutdown(),
    };
    getServerServices().adminBus.registerRoom(this.adminRoom);
    logger.info({ roomId: this.roomId, mapId: this.mapId }, "map room created");
  }

  async onJoin(client: Client): Promise<void> {
    const auth = client.auth as JoinIdentity | undefined;
    if (!auth) {
      throw new Error("authenticated join without client.auth");
    }

    // The warp token was consumed and validated during matchmaking. Fall back
    // to the character's saved position for a normal join.
    const requested = auth.warpSpawn ?? { x: auth.character.x, y: auth.character.y };
    const spawn = this.resolveSpawn(requested.x, requested.y);
    // Inventory is loaded before the player exists: a broken character row must
    // fail the join rather than appear with an empty (and overwritable) bag.
    const loaded = await getServerServices().items.loadInventory(
      auth.account.id,
      auth.character.id,
    );
    const progression = progressionFromCharacter(
      auth.character,
      equipmentBonusStats(loaded.inventory),
    );
    const runtime = createPlayerRuntime(spawn, {
      accountId: auth.account.id,
      characterId: auth.character.id,
      tokenVersion: auth.account.tokenVersion,
      role: auth.account.role,
      channel: auth.character.channel,
      progression,
      inventory: loaded.inventory,
      gold: loaded.gold,
    });
    runtime.dirty =
      Math.abs(spawn.x - auth.character.x) > 0.01 ||
      Math.abs(spawn.y - auth.character.y) > 0.01 ||
      progression.level !== auth.character.level ||
      progression.xp !== auth.character.xp ||
      progression.hp !== auth.character.hp ||
      progression.mp !== auth.character.mp ||
      progression.statPoints !== auth.character.statPoints ||
      progression.doctrine !== auth.character.doctrine ||
      progression.skillPoints !== auth.character.skillPoints;
    if (auth.warpSpawn) {
      runtime.warpCooldownUntilMs = Date.now() + WARP_COOLDOWN_MS;
    }

    const player = new PlayerState();
    player.characterId = auth.character.id;
    player.name = auth.character.name;
    player.kingdom = auth.account.kingdom;
    player.classId = auth.character.classId;
    player.gender = auth.character.gender;
    player.hairStyle = auth.character.hairStyle;
    player.hairColor = auth.character.hairColor;
    player.level = progression.level;
    player.x = runtime.mover.pos.x;
    player.y = runtime.mover.pos.y;
    player.facing = facing4Index("down");
    player.moving = false;
    player.lastSeq = 0;
    player.hp = progression.hp;
    player.maxHp = progression.maxHp;
    player.mp = progression.mp;
    player.maxMp = progression.maxMp;
    player.dead = false;
    const layers = equipmentVisualKeys(loaded.inventory);
    player.weaponLayer = layers.weaponLayer;
    player.armorLayer = layers.armorLayer;
    player.helmetLayer = layers.helmetLayer;
    player.shieldLayer = layers.shieldLayer;

    // The view must exist before the player is added, so the very first
    // encoded state is already filtered for this client.
    client.view = new StateView();
    this.state.players.set(client.sessionId, player);
    this.runtimes.set(client.sessionId, runtime);
    this.updateInterest();

    // Replacing a session saves and closes the previous one first (duplicate
    // join or a login that did not go through the HTTP kick path). A stale
    // reservation (older token version than the account's current generation)
    // is rejected instead of kicking the newer session.
    const accepted = await getServerServices().sessionRegistry.register({
      accountId: auth.account.id,
      characterId: auth.character.id,
      sessionId: client.sessionId,
      tokenVersion: auth.account.tokenVersion,
      saveForKick: () => this.savePlayerNow(client.sessionId),
      send: (type, payload) => client.send(type, payload),
      leave: (code) => client.leave(code),
    });
    if (!accepted) {
      this.state.players.delete(client.sessionId);
      this.runtimes.delete(client.sessionId);
      this.updateInterest();
      return;
    }

    this.sendSelfStats(client.sessionId);
    this.sendInventory(client.sessionId);
    this.sendSkillState(client.sessionId);
    this.sendBossTimersTo(client);
    this.sendBuffState(client.sessionId);
    this.sendEmptyParty(client);

    // A duplicate join replaced and saved the previous session. Its save is
    // newer than the matchmaking snapshot, so refresh before the first tick
    // can overwrite it with stale HP/XP/position.
    const fresh = await getServerServices().loadCharacter(auth.account.id, auth.character.id);
    const activeRuntime = this.runtimes.get(client.sessionId);
    const activePlayer = this.state.players.get(client.sessionId);
    if (fresh && activeRuntime && activePlayer) {
      const refreshed = progressionFromCharacter(
        fresh,
        equipmentBonusStats(activeRuntime.inventory),
      );
      activeRuntime.progression = refreshed;
      activePlayer.level = refreshed.level;
      activePlayer.hp = refreshed.hp;
      activePlayer.maxHp = refreshed.maxHp;
      activePlayer.mp = refreshed.mp;
      activePlayer.maxMp = refreshed.maxMp;
      if (fresh.map === this.mapId) {
        const position = this.resolveSpawn(fresh.x, fresh.y);
        if (
          Math.abs(position.x - activeRuntime.mover.pos.x) > 0.5 ||
          Math.abs(position.y - activeRuntime.mover.pos.y) > 0.5
        ) {
          activeRuntime.mover.pos.x = position.x;
          activeRuntime.mover.pos.y = position.y;
          activeRuntime.mover.path = [];
          activePlayer.x = position.x;
          activePlayer.y = position.y;
        }
      }
      // The kicked session's item commands are committed before its save
      // completes, so refresh both progression and inventory here.
      await this.reloadRuntimeInventory(activeRuntime);
      this.sendSelfStats(client.sessionId);
      this.sendInventory(client.sessionId);
      this.sendSkillState(client.sessionId);
      this.updateInterest();
    }

    // Register only after the post-kick fresh reload, so an admin action can
    // never observe a runtime that is about to be overwritten.
    const actions = this.createAdminActions(client.sessionId, runtime);
    this.adminActions.set(client.sessionId, actions);
    getServerServices().adminBus.register(actions);

    logger.info(
      {
        roomId: this.roomId,
        mapId: this.mapId,
        session: client.sessionId,
        characterId: player.characterId,
        name: player.name,
      },
      "player joined",
    );
  }

  async onLeave(client: Client, code: number): Promise<void> {
    const adminEntry = this.adminActions.get(client.sessionId);
    this.adminActions.delete(client.sessionId);
    if (adminEntry) {
      getServerServices().adminBus.unregister(adminEntry.characterId, client.sessionId);
    }
    const runtime = this.runtimes.get(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.runtimes.delete(client.sessionId);
    this.clearPlayerFromMonsters(client.sessionId);
    if (runtime) {
      this.leavePartyInternal(runtime.characterId);
      this.releaseOwnershipFor(runtime.characterId);
    }

    if (runtime) {
      runtime.inventoryClosed = true;
      await runtime.inventoryChain?.catch(() => undefined);
      getServerServices().sessionRegistry.unregister(runtime.accountId, client.sessionId);
      // A kick already saved and cleared `dirty`; a warp already persisted
      // the destination and removed the runtime.
      if (runtime.dirty) {
        await this.enqueueSave(runtime, this.deathAwareDestination(runtime));
      }
    }

    logger.info({ roomId: this.roomId, session: client.sessionId, closeCode: code }, "player left");
  }

  onDispose(): void {
    try {
      getServerServices().adminBus.unregisterRoom(this.roomId);
    } catch {
      // Services may already be reset by a test teardown.
    }
    this.adminActions.clear();
    this.adminRoom = null;
    this.parties.clear();
  }

  /**
   * Colyseus calls this during graceful shutdown without awaiting it; always
   * disconnect the room afterwards. AdminRuntime also calls the idempotent
   * `saveAllForShutdown` before triggering that shutdown.
   */
  onBeforeShutdown(): void {
    void this.saveAllForShutdown().finally(() => {
      super.onBeforeShutdown();
    });
  }

  /** Drain inventories and save every dirty player once. */
  async saveAllForShutdown(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;
    const tasks: Array<Promise<unknown>> = [];
    for (const runtime of this.runtimes.values()) {
      runtime.inventoryClosed = true;
      tasks.push(
        (async () => {
          await runtime.inventoryChain?.catch(() => undefined);
          if (runtime.dirty) {
            await this.enqueueSave(runtime, this.deathAwareDestination(runtime));
          }
        })(),
      );
    }
    await Promise.allSettled(tasks);
  }

  /**
   * A dead player who disconnects or is kicked restarts in town: save the
   * village spawn at full HP/MP so the next login is not a death screen.
   */
  private deathAwareDestination(runtime: PlayerRuntime): {
    mapId: MapId;
    x: number;
    y: number;
  } {
    if (!runtime.dead) {
      return {
        mapId: this.mapId,
        x: runtime.mover.pos.x,
        y: runtime.mover.pos.y,
      };
    }
    runtime.progression.hp = runtime.progression.maxHp;
    runtime.progression.mp = runtime.progression.maxMp;
    return defaultSpawn();
  }

  /** Save one player before a session is replaced (kick path). */
  private sendSystemMessage(client: Client, text: string): void {
    const payload: ChatMsgPayload = {
      from: "system",
      name: "System",
      kingdom: "system",
      text,
    };
    this.safeSend(client, MSG.chatMsg, payload);
  }

  private auditGmCommand(runtime: PlayerRuntime, raw: string): void {
    void getServerServices()
      .logAdminAction({
        actorAccountId: runtime.accountId,
        action: "gm_command",
        targetCharacterId: runtime.characterId,
        detail: { command: raw },
      })
      .catch((error: unknown) => {
        logger.error({ accountId: runtime.accountId, error }, "GM command audit failed");
      });
  }

  private handleGmCommand(client: Client, runtime: PlayerRuntime, text: string): void {
    const command = parseGmCommand(text);
    if (!command) {
      return;
    }
    this.auditGmCommand(runtime, text);
    const fail = (error: unknown): void => {
      this.sendSystemMessage(
        client,
        error instanceof ServiceError ? error.message : "Command failed.",
      );
    };

    switch (command.kind) {
      case "goto":
        this.runAdminCommand(
          client.sessionId,
          async (current) => {
            const player = this.state.players.get(client.sessionId);
            if (!player) {
              throw new ServiceError("conflict", "Player is no longer connected.");
            }
            if (!isWalkableAt(this.assets.grid, command.x, command.y)) {
              throw new ServiceError("validation", "That position is not walkable.");
            }
            this.moveRuntimeTo(current, player, command.x, command.y);
            current.dirty = true;
            this.updateInterest();
            this.sendSelfStats(client.sessionId);
            const saved = await this.enqueueSave(current, {
              mapId: this.mapId,
              x: command.x,
              y: command.y,
            });
            if (!saved) {
              throw new ServiceError("internal", "Character save failed.");
            }
          },
          { allowDead: true },
        )
          .then(() => this.sendSystemMessage(client, `Moved to ${command.x},${command.y}.`))
          .catch(fail);
        return;
      case "level":
        this.adminUpdateCharacter(client.sessionId, { level: command.level })
          .then(() => this.sendSystemMessage(client, `Level set to ${command.level}.`))
          .catch(fail);
        return;
      case "item":
        this.adminGrantItem(client.sessionId, {
          definitionId: command.itemId,
          quantity: command.count,
          upgradeLevel: 0,
          bonuses: [],
        })
          .then((item) =>
            this.sendSystemMessage(client, `Granted ${item.quantity} ${command.itemId}.`),
          )
          .catch(fail);
        return;
      case "spawn":
        this.adminSpawnMonster(client.sessionId, command.typeId, command.count)
          .then((count) => this.sendSystemMessage(client, `Spawned ${count} ${command.typeId}.`))
          .catch(fail);
        return;
      case "invisible":
        runtime.invisible = !runtime.invisible;
        this.updateInterest();
        this.sendSystemMessage(
          client,
          runtime.invisible ? "You are now invisible." : "You are visible again.",
        );
        return;
      case "kick": {
        const target = getServerServices().adminBus.findByName(command.name);
        if (!target) {
          this.sendSystemMessage(client, `No online player named ${command.name}.`);
          return;
        }
        void getServerServices()
          .sessionRegistry.kickCharacter(target.characterId, "admin")
          .then(() => this.sendSystemMessage(client, `Kicked ${command.name}.`))
          .catch(fail);
        return;
      }
      case "warp": {
        const target = getServerServices().adminBus.findByName(command.name);
        if (!target) {
          this.sendSystemMessage(client, `No online player named ${command.name}.`);
          return;
        }
        const presence = target.presence();
        if (!presence) {
          this.sendSystemMessage(client, "That player just left.");
          return;
        }
        if (presence.mapId === this.mapId) {
          this.runAdminCommand(
            client.sessionId,
            async (current) => {
              const player = this.state.players.get(client.sessionId);
              if (!player) {
                throw new ServiceError("conflict", "Player is no longer connected.");
              }
              this.moveRuntimeTo(current, player, presence.x, presence.y);
              current.dirty = true;
              this.updateInterest();
              await this.enqueueSave(current, {
                mapId: this.mapId,
                x: presence.x,
                y: presence.y,
              });
            },
            { allowDead: true },
          )
            .then(() => this.sendSystemMessage(client, `Moved to ${command.name}.`))
            .catch(fail);
          return;
        }
        if (!isMapId(presence.mapId)) {
          this.sendSystemMessage(client, "That player is on an unknown map.");
          return;
        }
        void this.beginWarp(client, {
          mapId: presence.mapId,
          x: presence.x,
          y: presence.y,
        })
          .then((accepted) => {
            if (!accepted) {
              this.sendSystemMessage(client, "Warp failed.");
            }
          })
          .catch(fail);
        return;
      }
      case "summon": {
        const target = getServerServices().adminBus.findByName(command.name);
        if (!target) {
          this.sendSystemMessage(client, `No online player named ${command.name}.`);
          return;
        }
        const presence = target.presence();
        if (!presence || presence.mapId !== this.mapId) {
          this.sendSystemMessage(client, "Summon only works on the same map.");
          return;
        }
        const player = this.state.players.get(client.sessionId);
        if (!player) {
          return;
        }
        void target
          .updateCharacter({ x: player.x, y: player.y })
          .then(() => this.sendSystemMessage(client, `Summoned ${command.name}.`))
          .catch(fail);
        return;
      }
      default:
        this.sendSystemMessage(client, `Unknown command: ${command.raw}`);
    }
  }

  private createAdminActions(
    sessionId: string,
    runtime: PlayerRuntime,
  ): AdminLiveActions {
    return {
      characterId: runtime.characterId,
      sessionId,
      roomId: this.roomId,
      presence: () => {
        const player = this.state.players.get(sessionId);
        return player ? buildAdminPresence(sessionId, runtime, player, this.mapId) : null;
      },
      grantItem: (request) => this.adminGrantItem(sessionId, request),
      removeItem: (instanceId) => this.adminRemoveItem(sessionId, instanceId),
      setGold: (gold) => this.adminSetGold(sessionId, gold),
      updateCharacter: (update) => this.adminUpdateCharacter(sessionId, update),
      teleportTown: () => this.adminTeleportTown(sessionId),
      spawnMonster: (typeId, count, x, y) =>
        this.adminSpawnMonster(sessionId, typeId, count, x, y),
    };
  }

  private adminGrantItem(
    sessionId: string,
    request: AdminGiveItemRequest,
  ): Promise<ItemInstanceDto> {
    return this.runAdminCommand(
      sessionId,
      async (runtime) => {
        if (!hasItem(request.definitionId)) {
          throw new ServiceError("validation", "Unknown item definition.");
        }
        const definition = getItem(request.definitionId);
        const before = runtime.inventory;
        let generatedId: string | null = null;
        const newId = (): string => {
          const id = randomUUID();
          generatedId ??= id;
          return id;
        };
        const result = planAdminGive(
          runtime.inventory,
          runtime.characterId,
          definition,
          request.quantity,
          request.upgradeLevel,
          request.bonuses,
          newId,
        );
        await this.applyItemPlan(runtime, result.state, result.plan);
        const created = findGrantedStack(before, result.state, generatedId, definition.id);
        if (!created) {
          throw new ServiceError("internal", "Item grant did not produce a stack.");
        }
        return toItemDto(created);
      },
      { allowDead: true },
    );
  }

  private adminRemoveItem(sessionId: string, instanceId: string): Promise<void> {
    return this.runAdminCommand(
      sessionId,
      async (runtime) => {
        const result = planAdminRemove(runtime.inventory, runtime.characterId, instanceId);
        await this.applyItemPlan(runtime, result.state, result.plan);
      },
      { allowDead: true },
    );
  }

  private adminSetGold(sessionId: string, gold: number): Promise<number> {
    return this.runAdminCommand(
      sessionId,
      async (runtime) => {
        if (!Number.isInteger(gold) || gold < 0 || gold > MAX_GOLD) {
          throw new ServiceError("validation", "Invalid gold amount.");
        }
        if (gold === runtime.gold) {
          return runtime.gold;
        }
        const plan: ItemPlan = {
          changes: [],
          logs: [],
          gold: {
            delta: gold - runtime.gold,
            reason: "admin",
            detail: { source: "admin_live", target: gold },
          },
        };
        const result = await this.applyItemPlan(runtime, runtime.inventory, plan);
        return result.gold;
      },
      { allowDead: true },
    );
  }

  private adminUpdateCharacter(
    sessionId: string,
    update: AdminUpdateCharacterRequest,
  ): Promise<void> {
    return this.runAdminCommand(
      sessionId,
      async (runtime) => {
        const player = this.state.players.get(sessionId);
        if (!player || !isClassId(player.classId)) {
          throw new ServiceError("internal", "Player class is invalid.");
        }
        const progression = runtime.progression;
        let changed = false;
        let positionChanged = false;

        if (update.x !== undefined || update.y !== undefined) {
          if (runtime.dead) {
            throw new ServiceError("conflict", "A dead player cannot be repositioned.");
          }
          const x = update.x ?? player.x;
          const y = update.y ?? player.y;
          if (!isWalkableAt(this.assets.grid, x, y)) {
            throw new ServiceError("validation", "That position is not walkable.", {
              position: "blocked",
            });
          }
          this.moveRuntimeTo(runtime, player, x, y);
          positionChanged = true;
          changed = true;
        }

        if (update.level !== undefined) {
          if (update.level !== progression.level) {
            progression.level = update.level;
            progression.xp = 0;
            changed = true;
          }
        }
        const statUpdates: Array<["vit" | "int" | "str" | "dex", number | undefined]> = [
          ["vit", update.statVit],
          ["int", update.statInt],
          ["str", update.statStr],
          ["dex", update.statDex],
        ];
        for (const [stat, value] of statUpdates) {
          if (value === undefined) {
            continue;
          }
          if (value < 0 || value > STAT_POINT_CAP) {
            throw new ServiceError("validation", `Stat ${stat} is out of range.`);
          }
          if (progression.stats[stat] !== value) {
            progression.stats[stat] = value;
            changed = true;
          }
        }
        if (changed) {
          recomputeMaxima(
            progression,
            player.classId,
            equipmentBonusStats(runtime.inventory),
          );
          player.level = progression.level;
          player.maxHp = progression.maxHp;
          player.hp = progression.hp;
          player.maxMp = progression.maxMp;
          player.mp = progression.mp;
          runtime.dirty = true;
        }

        if (update.gold !== undefined && update.gold !== runtime.gold) {
          const result = await this.applyItemPlan(runtime, runtime.inventory, {
            changes: [],
            logs: [],
            gold: {
              delta: update.gold - runtime.gold,
              reason: "admin",
              detail: { source: "admin_live", target: update.gold },
            },
          });
          runtime.gold = result.gold;
        }

        if (changed) {
          this.sendSelfStats(sessionId);
          const saved = await this.enqueueSave(runtime, {
            mapId: this.mapId,
            x: runtime.mover.pos.x,
            y: runtime.mover.pos.y,
          });
          if (!saved) {
            throw new ServiceError("internal", "Character save failed; retry.");
          }
        }
        if (positionChanged) {
          this.updateInterest();
        }
      },
      { allowDead: true },
    );
  }

  private moveRuntimeTo(runtime: PlayerRuntime, player: PlayerState, x: number, y: number): void {
    runtime.mover.pos.x = x;
    runtime.mover.pos.y = y;
    runtime.mover.path = [];
    runtime.pending.length = 0;
    runtime.lastIntent = { kind: "none" };
    runtime.lastPathTargetKey = null;
    runtime.targetMonsterId = null;
    runtime.pendingAttack = null;
    player.x = x;
    player.y = y;
    player.moving = false;
  }

  private adminTeleportTown(sessionId: string): Promise<void> {
    return this.runAdminCommand(
      sessionId,
      async (runtime) => {
        const player = this.state.players.get(sessionId);
        if (!player) {
          throw new ServiceError("conflict", "Player is no longer connected.");
        }
        const village = defaultSpawn();
        if (this.mapId === village.mapId) {
          const spot = this.resolveSpawn(village.x, village.y);
          this.moveRuntimeTo(runtime, player, spot.x, spot.y);
          runtime.dirty = true;
          this.updateInterest();
          this.sendSelfStats(sessionId);
          const saved = await this.enqueueSave(runtime, {
            mapId: this.mapId,
            x: spot.x,
            y: spot.y,
          });
          if (!saved) {
            throw new ServiceError("internal", "Character save failed; retry.");
          }
          return;
        }
        const client = this.clientFor(sessionId);
        if (!client) {
          throw new ServiceError("conflict", "Player is no longer connected.");
        }
        const accepted = await this.beginWarp(client, village, {
          awaitInventory: false,
        });
        if (!accepted) {
          throw new ServiceError("conflict", "Teleport failed; try again.");
        }
      },
      { allowDead: false },
    );
  }

  private adminSpawnMonster(
    sessionId: string,
    typeId: string,
    count: number,
    x?: number,
    y?: number,
  ): Promise<number> {
    return this.runAdminCommand(
      sessionId,
      async (runtime) => {
        if (!hasMonster(typeId)) {
          throw new ServiceError("validation", "Unknown monster type.");
        }
        if (!Number.isInteger(count) || count < 1 || count > MAX_ADMIN_SPAWN) {
          throw new ServiceError("validation", `Spawn count must be 1-${MAX_ADMIN_SPAWN}.`);
        }
        const anchor =
          x !== undefined || y !== undefined
            ? { x: x ?? runtime.mover.pos.x, y: y ?? runtime.mover.pos.y }
            : { x: runtime.mover.pos.x, y: runtime.mover.pos.y };
        if (!isWalkableAt(this.assets.grid, anchor.x, anchor.y)) {
          throw new ServiceError("validation", "Spawn position is not walkable.");
        }
        const spawned = spawnAdminMonsters(this.spawns, {
          typeId,
          count,
          position: anchor,
          now: Date.now(),
          rng: this.rng,
        });
        this.updateInterest();
        return spawned.length;
      },
      { allowDead: true },
    );
  }

  private unregisterAdminSession(sessionId: string): void {
    const actions = this.adminActions.get(sessionId);
    if (actions) {
      getServerServices().adminBus.unregister(actions.characterId, sessionId);
    }
  }

  private registerAdminSession(sessionId: string): void {
    const actions = this.adminActions.get(sessionId);
    if (actions) {
      getServerServices().adminBus.register(actions);
    }
  }

  private async savePlayerNow(sessionId: string): Promise<void> {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) {
      return;
    }
    // Close synchronously before awaiting so no new command can enter the
    // chain while this save is in flight.
    runtime.inventoryClosed = true;
    await runtime.inventoryChain?.catch(() => undefined);
    if (!runtime.dirty) {
      return;
    }
    await this.enqueueSave(runtime, this.deathAwareDestination(runtime));
  }

  /**
   * All writes for one runtime go through a promise chain, so an autosave
   * snapshot can never land after a newer kick/leave/warp write. `dirty` is
   * cleared only when the runtime still matches every saved field.
   */
  private enqueueSave(
    runtime: PlayerRuntime,
    destination: { mapId: MapId; x: number; y: number },
  ): Promise<boolean> {
    const snapshot = this.characterSave(runtime, destination);
    const run = async (): Promise<boolean> => {
      try {
        const saved = await getServerServices().saveCharacter(runtime.characterId, snapshot);
        if (saved && this.saveSnapshotMatches(runtime, snapshot)) {
          runtime.dirty = false;
        }
        return saved;
      } catch (error) {
        logger.error(
          { roomId: this.roomId, characterId: runtime.characterId, error },
          "character save failed",
        );
        return false;
      }
    };
    const next = (runtime.saveChain ?? Promise.resolve()).then(run, run);
    runtime.saveChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private characterSave(
    runtime: PlayerRuntime,
    destination: { mapId: MapId; x: number; y: number },
  ): CharacterSave {
    const progression = runtime.progression;
    return {
      mapId: destination.mapId,
      x: destination.x,
      y: destination.y,
      hp: progression.hp,
      mp: progression.mp,
      xp: progression.xp,
      level: progression.level,
      statVit: progression.stats.vit,
      statInt: progression.stats.int,
      statStr: progression.stats.str,
      statDex: progression.stats.dex,
      statPoints: progression.statPoints,
    };
  }

  private saveSnapshotMatches(runtime: PlayerRuntime, snapshot: CharacterSave): boolean {
    const progression = runtime.progression;
    return (
      runtime.mover.pos.x === snapshot.x &&
      runtime.mover.pos.y === snapshot.y &&
      progression.hp === snapshot.hp &&
      progression.mp === snapshot.mp &&
      progression.xp === snapshot.xp &&
      progression.level === snapshot.level &&
      progression.stats.vit === snapshot.statVit &&
      progression.stats.int === snapshot.statInt &&
      progression.stats.str === snapshot.statStr &&
      progression.stats.dex === snapshot.statDex &&
      progression.statPoints === snapshot.statPoints
    );
  }

  /** Periodic dirty-character flush (ordered per player by `enqueueSave`). */
  private async autosave(): Promise<void> {
    const pending: Array<Promise<boolean>> = [];
    for (const [sessionId, runtime] of this.runtimes) {
      if (!runtime.dirty || runtime.warping || runtime.dead) {
        continue;
      }
      const player = this.state.players.get(sessionId);
      if (!player) {
        continue;
      }
      pending.push(
        this.enqueueSave(runtime, {
          mapId: this.mapId,
          x: player.x,
          y: player.y,
        }),
      );
    }
    if (pending.length > 0) {
      await Promise.allSettled(pending);
    }
  }

  /**
   * StateView interest management: a player is added to a client's view inside
   * INTEREST_ADD_RADIUS_PX and removed beyond INTEREST_RADIUS_PX. The gap is
   * hysteresis; the own player is always visible.
   */
  private updateInterest(): void {
    const addSquared = INTEREST_ADD_RADIUS_PX * INTEREST_ADD_RADIUS_PX;
    const removeSquared = INTEREST_RADIUS_PX * INTEREST_RADIUS_PX;

    for (const client of this.clients) {
      const view = client.view;
      const own = this.state.players.get(client.sessionId);
      if (!view || !own) {
        continue;
      }
      for (const [sessionId, player] of this.state.players) {
        if (sessionId === client.sessionId) {
          if (!view.has(player)) {
            view.add(player);
          }
          continue;
        }
        const otherRuntime = this.runtimes.get(sessionId);
        if (otherRuntime?.invisible) {
          if (view.has(player)) {
            view.remove(player);
          }
          continue;
        }
        const dx = player.x - own.x;
        const dy = player.y - own.y;
        const distanceSquared = dx * dx + dy * dy;
        const visible = view.has(player);
        if (!visible && distanceSquared <= addSquared) {
          view.add(player);
        } else if (visible && distanceSquared > removeSquared) {
          view.remove(player);
        }
      }

      for (const monster of this.state.monsters.values()) {
        const dx = monster.x - own.x;
        const dy = monster.y - own.y;
        const distanceSquared = dx * dx + dy * dy;
        const visible = view.has(monster);
        if (!visible && distanceSquared <= addSquared) {
          view.add(monster);
        } else if (visible && distanceSquared > removeSquared) {
          view.remove(monster);
        }
      }

      for (const drop of this.state.groundItems.values()) {
        const dx = drop.x - own.x;
        const dy = drop.y - own.y;
        const distanceSquared = dx * dx + dy * dy;
        const visible = view.has(drop);
        if (!visible && distanceSquared <= addSquared) {
          view.add(drop);
        } else if (visible && distanceSquared > removeSquared) {
          view.remove(drop);
        }
      }
    }
  }

  /**
   * Fixed 20 Hz step in the GAME_DESIGN order
   * `input -> movement -> ai -> (combat) -> (regen) -> spawns -> warps`.
   * Combat and regen are added in later tasks; the stage boundaries are kept so
   * each system observes the positions produced by the previous one.
   */
  private tick(): void {
    const now = Date.now();
    const players = this.playerSnapshots();
    for (const client of this.clients) {
      const runtime = this.runtimes.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      if (!runtime || !player || runtime.dead) {
        if (player && runtime?.dead) {
          player.moving = false;
        }
        continue;
      }
      this.stepPlayer(runtime, player, client.sessionId, now);
    }
    this.processSkillCasts(now);
    this.stepMonsters(now, players);
    this.runCombatPhase(now);
    this.tickSkillEffects(now);
    this.applyRegen(now);
    this.processRespawns(now);
    const spawned = tickSpawns(
      this.spawns,
      now,
      players.filter((player) => !player.dead).map((player) => player.pos),
    );
    if (spawned > 0) {
      this.updateInterest();
      this.broadcastBossTimers();
    }
    const stonesSpawned = this.stones.tick(now);
    if (stonesSpawned.length > 0) {
      this.syncStoneSpawns(stonesSpawned);
    }
    this.tickGroundItems(now);
    if (now >= this.partyBroadcastAtMs) {
      this.parties.pruneInvites(now);
      this.refreshPartyVitals();
      this.partyBroadcastAtMs = now + 500;
    }
    this.checkWarps();
  }

  /** Resolve queued player swings, then monster intents from the AI phase. */
  private runCombatPhase(now: number): void {
    const context = {
      now,
      rng: this.rng,
      state: this.state,
      runtimes: this.runtimes,
      monsterRuntimes: this.monsterRuntimes,
      stoneRuntimes: this.stones.stones,
    };

    for (const [sessionId, runtime] of this.runtimes) {
      const pending = runtime.pendingAttack;
      if (!pending) {
        continue;
      }
      runtime.pendingAttack = null;
      const outcome = resolvePlayerSwing(context, sessionId, pending.dir);
      if (outcome) {
        this.emitSwing(sessionId, outcome, now);
      }
    }

    for (let index = 0; index < this.attackIntentCount; index++) {
      const intent = this.attackIntents[index]!;
      const outcome = resolveMonsterAttack(context, intent.monsterId, intent.targetSessionId);
      if (!outcome) {
        continue;
      }
      this.emitMonsterAttack(intent.monsterId, outcome.hit);
      if (outcome.victimDead) {
        this.handlePlayerDeath(intent.targetSessionId, now);
      }
    }
    this.attackIntentCount = 0;
  }

  private emitSwing(sessionId: string, outcome: SwingOutcome, now: number): void {
    const attacker = this.runtimes.get(sessionId);
    if (!attacker) {
      return;
    }
    const origin = attacker.mover.pos;
    const radiusSquared = COMBAT_EVENT_RADIUS_PX * COMBAT_EVENT_RADIUS_PX;
    const recipients = this.clients.filter((client) => {
      const runtime = this.runtimes.get(client.sessionId);
      if (!runtime) {
        return false;
      }
      const dx = runtime.mover.pos.x - origin.x;
      const dy = runtime.mover.pos.y - origin.y;
      return dx * dx + dy * dy <= radiusSquared;
    });

    const payload: CombatEventPayload = {
      eventSeq: ++this.eventSeq,
      attacker: { kind: "player", sessionId },
      hits: outcome.hits,
    };
    for (const client of recipients) {
      this.safeSend(client, MSG.combat, payload);
    }

    if (outcome.stoneHits.length > 0) {
      this.applyStoneHits(sessionId, outcome.stoneHits, now);
    }
    if (outcome.damagedMonsterIds.length > 0 || outcome.stoneHits.length > 0) {
      const attacker = this.runtimes.get(sessionId);
      if (attacker && removeStealth(attacker.buffs)) {
        this.sendBuffState(sessionId);
        this.sendSelfStats(sessionId);
      }
    }

    // Aggro before cleanup: killing a monster must still wake the rest of its
    // pack (notifyMonsterDeath removes the group lookup).
    for (const monsterId of outcome.damagedMonsterIds) {
      aggroGroup(this.spawns, monsterId, sessionId);
    }

    for (const killed of outcome.killed) {
      this.state.monsters.delete(killed.monsterId);
      this.monsterRuntimes.delete(killed.monsterId);
      notifyMonsterDeath(this.spawns, killed.monsterId, now);
      this.broadcastBossTimers();
      const died: MonsterDiedPayload = { ...killed, killerSessionId: sessionId };
      for (const client of recipients) {
        this.safeSend(client, MSG.monsterDied, died);
      }
      if (attacker.targetMonsterId === killed.monsterId) {
        this.clearAutoWalk(attacker, sessionId, "target_lost");
      }
      this.awardXpForKill(killed, sessionId);
      void this.spawnDrops(killed, sessionId, now).catch((error: unknown) => {
        logger.error(
          { roomId: this.roomId, monsterId: killed.monsterId, error },
          "drop spawn failed",
        );
      });
    }
  }

  private syncStoneSpawns(stones: readonly StoneRuntime[]): void {
    for (const runtime of stones) {
      if (this.state.stones.has(runtime.stoneId)) {
        continue;
      }
      const info = getStone(runtime.infoId);
      const stone = new SpiritStoneState();
      stone.stoneId = runtime.stoneId;
      stone.infoId = runtime.infoId;
      stone.name = info.name;
      stone.level = info.level;
      stone.x = runtime.x;
      stone.y = runtime.y;
      stone.hp = runtime.hp;
      stone.maxHp = runtime.maxHp;
      stone.spriteKey = info.spriteKey;
      stone.color = info.color;
      this.state.stones.set(runtime.stoneId, stone);
    }
  }

  private applyStoneHits(sessionId: string, hits: readonly StoneHit[], now: number): void {
    for (const hit of hits) {
      const runtime = this.stones.get(hit.target.stoneId);
      if (!runtime) {
        continue;
      }
      const info = getStone(runtime.infoId);
      const result = this.stones.damage(hit.target.stoneId, sessionId, hit.damage, now);
      if (!result) {
        continue;
      }
      const state = this.state.stones.get(hit.target.stoneId);
      if (state) {
        state.hp = result.hp;
      }
      if (result.waves > 0) {
        this.spawnStoneWaves(runtime, info, result.waves, sessionId, now);
      }
      if (!result.destroyed) {
        continue;
      }
      this.state.stones.delete(hit.target.stoneId);
      this.handleStoneDestroyed(runtime, info, sessionId, now);
    }
  }

  private spawnStoneWaves(
    runtime: StoneRuntime,
    info: ReturnType<typeof getStone>,
    waves: number,
    attackerSessionId: string,
    now: number,
  ): void {
    for (let wave = 0; wave < waves; wave++) {
      const count = randomInt(this.stoneRng, info.waveMin, info.waveMax + 1);
      const index = randomInt(this.stoneRng, 0, info.waveMonsters.length);
      const typeId = info.waveMonsters[index]!;
      const spawned = spawnAdminMonsters(this.spawns, {
        typeId,
        count,
        position: { x: runtime.x, y: runtime.y },
        now,
        rng: this.stoneRng,
      });
      for (const entry of spawned) {
        const monster = this.monsterRuntimes.get(entry.monsterId);
        if (monster) {
          aggroMonster(monster, attackerSessionId);
        }
      }
    }
    this.updateInterest();
  }

  private handleStoneDestroyed(
    runtime: StoneRuntime,
    info: ReturnType<typeof getStone>,
    killerSessionId: string,
    now: number,
  ): void {
    const contributors = [...runtime.damageBy.keys()].filter((sessionId) =>
      this.runtimes.has(sessionId),
    );
    const ownerSessionId = topDamageOwner(runtime.damageBy, this.runtimes, killerSessionId);
    const groups = new Map<string, Set<string>>();
    const radiusSquared = PARTY_XP_RADIUS_PX * PARTY_XP_RADIUS_PX;
    for (const contributor of contributors) {
      const contributorRuntime = this.runtimes.get(contributor);
      const party = contributorRuntime
        ? this.parties.getByCharacter(contributorRuntime.characterId)
        : undefined;
      const key = party ? party.id : `solo:${contributor}`;
      const group = groups.get(key) ?? new Set<string>();
      group.add(contributor);
      if (party && contributorRuntime) {
        for (const member of this.parties.members(party)) {
          const memberRuntime = this.runtimes.get(member.sessionId);
          if (!memberRuntime || memberRuntime.dead) {
            continue;
          }
          const dx = memberRuntime.mover.pos.x - runtime.x;
          const dy = memberRuntime.mover.pos.y - runtime.y;
          if (dx * dx + dy * dy <= radiusSquared) {
            group.add(member.sessionId);
          }
        }
      }
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      this.awardXpToGroup([...group], info.xp, info.level);
    }

    void this.spawnLoot({
      dropTableId: info.dropTableId,
      goldMin: info.goldMin,
      goldMax: info.goldMax,
      x: runtime.x,
      y: runtime.y,
      ownerSessionId,
      killerSessionId,
      now,
    }).catch((error: unknown) => {
      logger.error({ roomId: this.roomId, stoneId: runtime.stoneId, error }, "stone drops failed");
    });

    const payload: StoneDestroyedPayload = {
      stoneId: runtime.stoneId,
      typeId: info.id,
      name: info.name,
      x: runtime.x,
      y: runtime.y,
      killerSessionId,
    };
    const radius = COMBAT_EVENT_RADIUS_PX * COMBAT_EVENT_RADIUS_PX;
    for (const client of this.clients) {
      const clientRuntime = this.runtimes.get(client.sessionId);
      if (!clientRuntime) {
        continue;
      }
      const dx = clientRuntime.mover.pos.x - runtime.x;
      const dy = clientRuntime.mover.pos.y - runtime.y;
      if (dx * dx + dy * dy <= radius) {
        this.safeSend(client, MSG.stoneDestroyed, payload);
      }
    }
  }

  private sendBossTimersTo(client: Client): void {
    for (const payload of this.bossTimerPayloads()) {
      this.safeSend(client, MSG.bossTimer, payload);
    }
  }

  private broadcastBossTimers(): void {
    const payloads = this.bossTimerPayloads();
    if (payloads.length === 0) {
      return;
    }
    for (const client of this.clients) {
      for (const payload of payloads) {
        this.safeSend(client, MSG.bossTimer, payload);
      }
    }
  }

  private bossTimerPayloads(): BossTimerPayload[] {
    return bossStatuses(this.spawns).map((status) => ({
      bossTypeId: status.typeId,
      name: status.name,
      mapId: this.mapId,
      alive: status.alive,
      respawnAtMs: status.respawnAtMs,
    }));
  }

  private tickGroundItems(now: number): void {
    for (const [dropId, item] of this.groundItems) {
      if (now < item.despawnAtMs) {
        continue;
      }
      this.groundItems.delete(dropId);
      this.state.groundItems.delete(dropId);
      if (item.kind === "item") {
        void getServerServices().items.deleteGroundItem(dropId);
      }
    }
  }

  private addGroundItem(item: GroundItemRuntime): void {
    this.groundItems.set(item.dropId, item);
    const state = new GroundItemState();
    state.dropId = item.dropId;
    state.kind = item.kind;
    state.itemId = item.itemId;
    state.quantity = item.quantity;
    state.rarity = item.rarity;
    state.x = item.x;
    state.y = item.y;
    state.ownerCharacterId = item.ownerCharacterId;
    state.ownerPartyId = item.ownerPartyId;
    state.ownerUntilMs = item.ownerUntilMs;
    state.despawnAtMs = item.despawnAtMs;
    this.state.groundItems.set(item.dropId, state);
  }

  private dropPosition(origin: Vec2): Vec2 {
    const angle = this.rng.next() * Math.PI * 2;
    const radius =
      DROP_SCATTER_MIN_PX + this.rng.next() * (DROP_SCATTER_MAX_PX - DROP_SCATTER_MIN_PX);
    const candidate = {
      x: origin.x + Math.cos(angle) * radius,
      y: origin.y + Math.sin(angle) * radius,
    };
    return (
      nearestWalkable(this.assets.grid, candidate.x, candidate.y) ?? {
        x: origin.x,
        y: origin.y,
      }
    );
  }

  /**
   * Roll the monster's table, persist item drops before exposing them, and add
   * gold as an ephemeral ground pile. DB failures skip that item (retry once).
   */
  private async spawnDrops(
    killed: KilledMonster,
    killerSessionId: string,
    now: number,
  ): Promise<void> {
    const spec = getMonster(killed.typeId);
    if (!spec.dropTableId) {
      return;
    }
    await this.spawnLoot({
      dropTableId: spec.dropTableId,
      goldMin: spec.goldMin,
      goldMax: spec.goldMax,
      x: killed.x,
      y: killed.y,
      ownerSessionId: killed.ownerSessionId,
      killerSessionId,
      now,
    });
  }

  private async spawnLoot(input: {
    dropTableId: string;
    goldMin: number;
    goldMax: number;
    x: number;
    y: number;
    ownerSessionId: string;
    killerSessionId: string;
    now: number;
  }): Promise<void> {
    const ownerRuntime =
      this.runtimes.get(input.ownerSessionId) ?? this.runtimes.get(input.killerSessionId);
    const lootSourceCharacterId = ownerRuntime?.characterId ?? "";
    const dropRate = getServerServices().adminRuntime.settings.dropRate;
    const entries =
      dropRate <= 0
        ? []
        : getDropTable(input.dropTableId).drops.map((drop) => ({
            ...drop,
            chance: Math.min(1, drop.chance * dropRate),
          }));
    const rolled = rollDrops(this.rng, entries, input.goldMin, input.goldMax);
    const despawnAtMs = input.now + GROUND_ITEM_DESPAWN_MS;
    const goldAssignment =
      rolled.gold > 0 ? this.parties.allocateLootOwner(lootSourceCharacterId) : null;
    const itemAssignments = rolled.items.map(() =>
      this.parties.allocateLootOwner(lootSourceCharacterId),
    );

    if (rolled.gold > 0 && goldAssignment) {
      const position = this.dropPosition({ x: input.x, y: input.y });
      const ownerUntilMs =
        goldAssignment.ownerPartyId || goldAssignment.ownerCharacterId
          ? input.now + DROP_OWNERSHIP_MS
          : 0;
      this.addGroundItem({
        dropId: randomUUID(),
        kind: "gold",
        itemId: "",
        quantity: rolled.gold,
        rarity: "common",
        x: position.x,
        y: position.y,
        ownerCharacterId: goldAssignment.ownerCharacterId,
        ownerPartyId: goldAssignment.ownerPartyId,
        ownerUntilMs,
        despawnAtMs,
      });
    }

    for (const [index, drop] of rolled.items.entries()) {
      const itemId = drop.itemId;
      if (!hasItem(itemId)) {
        logger.warn({ roomId: this.roomId, itemId }, "drop table references unknown item");
        continue;
      }
      const assignment = itemAssignments[index]!;
      const dropId = randomUUID();
      const position = this.dropPosition({ x: input.x, y: input.y });
      const ownerUntilMs =
        assignment.ownerPartyId || assignment.ownerCharacterId
          ? input.now + DROP_OWNERSHIP_MS
          : 0;
      const row = {
        id: dropId,
        definitionId: itemId,
        location: "ground" as const,
        quantity: drop.quantity,
        upgradeLevel: 0,
        bonuses: [],
        createdBy: "drop",
        mapId: this.mapId,
        roomId: this.roomId,
        x: position.x,
        y: position.y,
        dropOwnerCharacterId: assignment.ownerCharacterId || null,
        ownerUntil: ownerUntilMs > 0 ? new Date(ownerUntilMs) : null,
        despawnAt: new Date(despawnAtMs),
      };
      let inserted = await getServerServices().items.insertGroundItem(row);
      if (!inserted) {
        inserted = await getServerServices().items.insertGroundItem(row);
      }
      if (!inserted) {
        logger.error({ roomId: this.roomId, itemId, dropId }, "dropping item skipped");
        continue;
      }
      this.addGroundItem({
        dropId,
        kind: "item",
        itemId,
        quantity: drop.quantity,
        rarity: getItem(itemId).rarity,
        x: position.x,
        y: position.y,
        ownerCharacterId: assignment.ownerCharacterId,
        ownerPartyId: assignment.ownerPartyId,
        ownerUntilMs,
        despawnAtMs,
      });
    }

    this.updateInterest();
  }

  private emitMonsterAttack(monsterId: string, hit: CombatHit): void {
    const monsterRuntime = this.monsterRuntimes.get(monsterId);
    if (!monsterRuntime) {
      return;
    }
    const origin = monsterRuntime.mover.pos;
    const radiusSquared = COMBAT_EVENT_RADIUS_PX * COMBAT_EVENT_RADIUS_PX;
    const recipients = this.clients.filter((client) => {
      const runtime = this.runtimes.get(client.sessionId);
      if (!runtime) {
        return false;
      }
      const dx = runtime.mover.pos.x - origin.x;
      const dy = runtime.mover.pos.y - origin.y;
      return dx * dx + dy * dy <= radiusSquared;
    });
    const payload: CombatEventPayload = {
      eventSeq: ++this.eventSeq,
      attacker: { kind: "monster", monsterId },
      hits: [hit],
    };
    for (const client of recipients) {
      this.safeSend(client, MSG.combat, payload);
    }
  }

  private handlePlayerDeath(sessionId: string, now: number): void {
    const runtime = this.runtimes.get(sessionId);
    const player = this.state.players.get(sessionId);
    if (!runtime || !player || runtime.dead) {
      return;
    }

    this.clearAutoWalk(runtime, sessionId, "target_lost");
    runtime.dead = true;
    runtime.diedAtMs = now;
    runtime.pending.length = 0;
    runtime.pendingAttack = null;
    if (runtime.pendingCast) {
      this.cancelPendingCast(runtime, sessionId, "dead");
    }
    runtime.pendingCast = null;
    runtime.buffs.clear();
    runtime.healOverTime = [];
    this.sendBuffState(sessionId);
    runtime.lastIntent = { kind: "none" };
    runtime.mover.path = [];
    runtime.graceTicksRemaining = 0;
    runtime.targetMonsterId = null;
    runtime.nextChaseRepathAtMs = 0;
    runtime.bestTargetDistSq = Number.POSITIVE_INFINITY;
    runtime.noProgressSinceMs = 0;
    runtime.emptyChasePaths = 0;
    runtime.progression.hp = 0;
    player.dead = true;
    player.hp = 0;
    player.moving = false;
    this.parties.updateMember(runtime.characterId, { dead: true });

    runtime.progression.xp = Math.max(
      0,
      runtime.progression.xp - deathXpLoss(runtime.progression.level, runtime.progression.xp),
    );
    runtime.dirty = true;
    this.clearPlayerFromMonsters(sessionId);

    const delay = getServerServices().combatTuning.respawnHereDelayMs ?? RESPAWN_HERE_DELAY_MS;
    const payload: DeathPayload = { respawnHereAtMs: now + delay };
    const client = this.clients.find((candidate) => candidate.sessionId === sessionId);
    if (client) {
      this.safeSend(client, MSG.death, payload);
    }
    this.sendSelfStats(sessionId);
  }

  private sendSelfStats(sessionId: string): void {
    const runtime = this.runtimes.get(sessionId);
    const player = this.state.players.get(sessionId);
    const client = this.clients.find((candidate) => candidate.sessionId === sessionId);
    if (!runtime || !player || !client) {
      return;
    }
    this.safeSend(client, MSG.selfStats, buildSelfStats(runtime, player));
  }

  private clientFor(sessionId: string): Client | undefined {
    return this.clients.find((candidate) => candidate.sessionId === sessionId);
  }

  private sendInventory(sessionId: string): void {
    const runtime = this.runtimes.get(sessionId);
    const client = this.clientFor(sessionId);
    if (!runtime || !client) {
      return;
    }
    this.safeSend(client, MSG.inventory, buildInventorySnapshot(runtime));
  }

  private sendItemError(client: Client, code: ItemActionErrorCode): void {
    this.safeSend(client, MSG.inventoryError, { code });
  }

  private sendBlacksmithError(
    client: Client,
    code: ItemActionErrorCode,
    message?: string,
  ): void {
    this.safeSend(client, MSG.blacksmithError, { code, message });
  }

  private sendErrorFor(
    channel: "item" | "blacksmith",
    client: Client,
    code: ItemActionErrorCode,
    message?: string,
  ): void {
    if (channel === "blacksmith") {
      this.sendBlacksmithError(client, code, message);
      return;
    }
    this.sendItemError(client, code);
  }

  /**
   * Item commands are validated only when they reach the head of the queue, so
   * two clicks in the same tick cannot both see the pre-mutation state.
   */
  private runItemCommand(
    client: Client,
    handler: (runtime: PlayerRuntime) => Promise<void>,
    channel: "item" | "blacksmith" = "item",
  ): void {
    const runtime = this.runtimes.get(client.sessionId);
    if (!runtime || runtime.inventoryClosed) {
      return;
    }
    const run = async (): Promise<void> => {
      const current = this.runtimes.get(client.sessionId);
      if (!current || current.inventoryClosed) {
        return;
      }
      if (current.dead) {
        this.sendErrorFor(channel, client, "dead");
        return;
      }
      try {
        await handler(current);
      } catch (error) {
        await this.handleItemFailure(client, current, error, channel);
      }
    };
    const next = (runtime.inventoryChain ?? Promise.resolve()).then(run, run);
    runtime.inventoryChain = next.then(
      () => undefined,
      () => undefined,
    );
  }

  /**
   * Promise-returning admin variant of `runItemCommand`. It shares the player's
   * item chain so grants/gold/stat edits cannot interleave with pickups, shops,
   * kick saves or warps. The returned promise rejects with a mapped error.
   */
  private runAdminCommand<T>(
    sessionId: string,
    handler: (runtime: PlayerRuntime) => Promise<T>,
    guards: { allowDead?: boolean } = {},
  ): Promise<T> {
    const initial = this.runtimes.get(sessionId);
    if (!initial) {
      return Promise.reject(new ServiceError("conflict", "Player is no longer in this room."));
    }
    const run = async (): Promise<T> => {
      const current = this.runtimes.get(sessionId);
      if (!current) {
        throw new ServiceError("conflict", "Player is no longer in this room.");
      }
      if (current.inventoryClosed || current.warping) {
        throw new ServiceError("conflict", "Player session is closing; retry after reconnect.");
      }
      if (current.dead && !guards.allowDead) {
        throw new ServiceError("conflict", "Player is dead.");
      }
      try {
        return await handler(current);
      } catch (error) {
        throw toAdminError(error);
      }
    };
    const next = (initial.inventoryChain ?? Promise.resolve()).then(run, run);
    initial.inventoryChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async applyItemPlan(
    runtime: PlayerRuntime,
    state: InventoryState,
    plan: ItemPlan,
  ): Promise<{ gold: number }> {
    const { gold } = await getServerServices().items.apply(
      runtime.accountId,
      runtime.characterId,
      plan,
    );
    // Assign only after the commit; a failed write leaves the old snapshot.
    runtime.inventory = state;
    runtime.gold = gold;
    runtime.inventoryRevision++;
    this.sendInventoryById(runtime);
    if (plan.changes.some((change) => this.touchesEquipment(change))) {
      this.refreshEquipment(runtime);
    }
    return { gold };
  }

  private touchesEquipment(change: ItemPlan["changes"][number]): boolean {
    if (change.kind === "insert") {
      return change.location === "equipment";
    }
    if (change.kind === "delete") {
      return change.expect.location === "equipment";
    }
    return change.expect.location === "equipment" || change.to.location === "equipment";
  }

  private sessionForRuntime(runtime: PlayerRuntime): string | undefined {
    return [...this.runtimes.entries()].find(([, value]) => value === runtime)?.[0];
  }

  private sendInventoryById(runtime: PlayerRuntime): void {
    const sessionId = this.sessionForRuntime(runtime);
    if (sessionId) {
      this.sendInventory(sessionId);
    }
  }

  /** Recompute equipment-derived maxima/layers after an equip or unequip. */
  private refreshEquipment(runtime: PlayerRuntime): void {
    const sessionId = this.sessionForRuntime(runtime);
    const player = sessionId ? this.state.players.get(sessionId) : undefined;
    if (!sessionId || !player || !isClassId(player.classId)) {
      return;
    }
    recomputeMaxima(
      runtime.progression,
      player.classId,
      equipmentBonusStats(runtime.inventory),
    );
    player.maxHp = runtime.progression.maxHp;
    player.hp = runtime.progression.hp;
    player.maxMp = runtime.progression.maxMp;
    player.mp = runtime.progression.mp;
    const layers = equipmentVisualKeys(runtime.inventory);
    player.weaponLayer = layers.weaponLayer;
    player.armorLayer = layers.armorLayer;
    player.helmetLayer = layers.helmetLayer;
    player.shieldLayer = layers.shieldLayer;
    this.sendSelfStats(sessionId);
  }

  private sendPickupResult(client: Client, payload: PickupResultPayload): void {
    this.safeSend(client, MSG.pickupResult, payload);
  }

  private removeGroundItem(dropId: string): void {
    this.groundItems.delete(dropId);
    this.state.groundItems.delete(dropId);
  }

  private restoreGroundItem(item: GroundItemRuntime): void {
    if (!this.groundItems.has(item.dropId)) {
      this.addGroundItem(item);
    }
  }

  /**
   * Pick up an item or a gold pile. Gold is reserved by removing it from room
   * state before the await; items are claimed by the DB conditional update.
   */
  private async pickupDrop(
    client: Client,
    runtime: PlayerRuntime,
    dropId: string,
  ): Promise<void> {
    if (runtime.dead) {
      throw new ItemError("dead", "Cannot pick up items while dead.");
    }
    const drop = this.groundItems.get(dropId);
    if (!drop) {
      throw new ItemError("already_taken", "That drop is gone.");
    }
    const now = Date.now();
    const dx = runtime.mover.pos.x - drop.x;
    const dy = runtime.mover.pos.y - drop.y;
    const radius = PICKUP_RADIUS_PX * PICKUP_RADIUS_PX;
    if (dx * dx + dy * dy > radius) {
      throw new ItemError("out_of_range", "Walk closer to pick that up.");
    }
    const partyId = this.parties.getByCharacter(runtime.characterId)?.id ?? null;
    if (!canPickupDrop(drop, runtime.characterId, partyId, now)) {
      throw new ItemError("not_owner", "That drop belongs to another player.");
    }

    if (drop.kind === "gold") {
      if (runtime.gold >= MAX_GOLD) {
        throw new ItemError("not_usable", "Your gold is at the cap.");
      }
      this.removeGroundItem(dropId);
      try {
        const before = runtime.gold;
        const plan = planGoldPickup(runtime.characterId, drop.quantity, dropId);
        const { gold } = await getServerServices().items.apply(
          runtime.accountId,
          runtime.characterId,
          plan,
        );
        runtime.gold = gold;
        runtime.inventoryRevision++;
        this.sendInventory(client.sessionId);
        const credited = gold - before;
        if (credited < drop.quantity) {
          this.restoreGroundItem({ ...drop, quantity: drop.quantity - credited });
        }
        this.sendPickupResult(client, {
          dropId,
          ok: credited > 0,
          gold: credited,
          code: credited > 0 ? undefined : "not_usable",
        });
      } catch (error) {
        this.restoreGroundItem(drop);
        throw error;
      }
      return;
    }

    const plan = planPickup(
      runtime.inventory,
      runtime.characterId,
      {
        id: drop.dropId,
        itemId: drop.itemId,
        quantity: drop.quantity,
        upgradeLevel: 0,
        bonuses: [],
        mapId: this.mapId,
      },
      randomUUID,
    );
    await this.applyItemPlan(runtime, plan.state, plan.plan);
    this.removeGroundItem(dropId);
    this.sendPickupResult(client, {
      dropId,
      ok: true,
      itemId: drop.itemId,
      quantity: drop.quantity,
    });
  }

  private async useItem(
    client: Client,
    runtime: PlayerRuntime,
    instanceId: string,
  ): Promise<void> {
    if (runtime.dead) {
      throw new ItemError("dead", "Cannot use items while dead.");
    }
    if (runtime.warping) {
      throw new ItemError("warping", "Cannot use items while warping.");
    }
    const now = Date.now();
    if (now < runtime.itemUseReadyAtMs) {
      throw new ItemError("cooldown", "Item use is on cooldown.");
    }
    const stack = runtime.inventory.items.find((item) => item.id === instanceId);
    if (!stack) {
      throw new ItemError("item_not_found", "Item is not in the inventory.");
    }
    const definition = getItem(stack.itemId);
    const effect = definition.effect;
    if (!effect) {
      throw new ItemError("not_consumable", "That item cannot be used.");
    }
    if (effect.kind === "heal_hp" && runtime.progression.hp >= runtime.progression.maxHp) {
      throw new ItemError("at_full_health", "HP is already full.");
    }
    if (effect.kind === "heal_mp" && runtime.progression.mp >= runtime.progression.maxMp) {
      throw new ItemError("at_full_mana", "MP is already full.");
    }

    const before = runtime.inventory;
    const consumed = planConsume(runtime.inventory, runtime.characterId, instanceId);
    runtime.itemUseReadyAtMs = now + ITEM_USE_COOLDOWN_MS;
    await this.applyItemPlan(runtime, consumed.state, consumed.plan);

    if (effect.kind === "warp_town") {
      const accepted = await this.beginWarp(client, defaultSpawn(), {
        awaitInventory: false,
      });
      if (!accepted) {
        await this.refundConsumedItem(runtime, before);
      }
      return;
    }

    if (effect.kind === "heal_hp") {
      runtime.progression.hp = Math.min(
        runtime.progression.maxHp,
        runtime.progression.hp + effect.amount,
      );
    } else {
      runtime.progression.mp = Math.min(
        runtime.progression.maxMp,
        runtime.progression.mp + effect.amount,
      );
    }
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.hp = runtime.progression.hp;
      player.mp = runtime.progression.mp;
    }
    runtime.dirty = true;
    void this.enqueueSave(runtime, {
      mapId: this.mapId,
      x: runtime.mover.pos.x,
      y: runtime.mover.pos.y,
    });
    this.sendSelfStats(client.sessionId);
  }

  private async refundConsumedItem(
    runtime: PlayerRuntime,
    before: InventoryState,
  ): Promise<void> {
    const changes = diffInventory(runtime.inventory, before, runtime.characterId, "refund");
    if (changes.length === 0) {
      return;
    }
    const plan: ItemPlan = {
      changes,
      logs: describeChanges(changes, "refund", { reason: "warp_failed" }),
    };
    await this.applyItemPlan(runtime, before, plan);
  }

  private isNearNpc(runtime: PlayerRuntime, npc: { x: number; y: number }): boolean {
    const dx = runtime.mover.pos.x - npc.x;
    const dy = runtime.mover.pos.y - npc.y;
    return dx * dx + dy * dy <= NPC_INTERACT_RADIUS_PX * NPC_INTERACT_RADIUS_PX;
  }

  private interactNpc(client: Client, npcId: string): void {
    const runtime = this.runtimes.get(client.sessionId);
    if (!runtime) {
      return;
    }
    const point = this.assets.npcs.find((npc) => npc.npcId === npcId);
    if (!point) {
      this.sendItemError(client, "unknown_npc");
      return;
    }
    if (!this.isNearNpc(runtime, point)) {
      this.sendItemError(client, "out_of_range");
      return;
    }
    let info;
    try {
      info = getNpc(npcId);
    } catch {
      this.sendItemError(client, "unknown_npc");
      return;
    }
    const payload: NpcDialogPayload = {
      npcId,
      name: info.name,
      kind: info.kind,
      greeting: info.greeting,
      shopId: info.shopId,
    };
    this.safeSend(client, MSG.npcDialog, payload);
  }

  private requireShopRange(runtime: PlayerRuntime, shopId: string): void {
    let shop;
    try {
      shop = getShop(shopId);
    } catch {
      throw new ItemError("unknown_shop", `Unknown shop "${shopId}".`);
    }
    const point = this.assets.npcs.find((npc) => npc.npcId === shop.npcId);
    if (!point || !this.isNearNpc(runtime, point)) {
      throw new ItemError("out_of_range", "Walk closer to the shop.");
    }
  }

  private requireAnyShopRange(runtime: PlayerRuntime): void {
    for (const npc of this.assets.npcs) {
      let info;
      try {
        info = getNpc(npc.npcId);
      } catch {
        continue;
      }
      if (info.kind === "shop" && this.isNearNpc(runtime, npc)) {
        return;
      }
    }
    throw new ItemError("out_of_range", "Walk closer to a shop.");
  }

  private sendWarehouse(client: Client): void {
    const runtime = this.runtimes.get(client.sessionId);
    if (!runtime) {
      return;
    }
    this.safeSend(client, MSG.warehouse, buildWarehouseSnapshot(runtime));
  }

  private announceUpgrade(sessionId: string, instanceId: string, level: number): void {
    const runtime = this.runtimes.get(sessionId);
    const player = this.state.players.get(sessionId);
    if (!runtime || !player) {
      return;
    }
    const stack =
      runtime.inventory.items.find((item) => item.id === instanceId) ??
      runtime.inventory.equipment.find((item) => item?.id === instanceId) ??
      null;
    const itemName = stack && hasItem(stack.itemId) ? getItem(stack.itemId).name : "an item";
    getServerServices().adminBus.broadcastAnnouncement({
      message: `${player.name} forged ${itemName} to +${level}!`,
      kind: "upgrade",
      sentAtMs: Date.now(),
    });
  }

  private requireBlacksmithRange(runtime: PlayerRuntime): void {
    for (const point of this.assets.npcs) {
      let info;
      try {
        info = getNpc(point.npcId);
      } catch {
        continue;
      }
      if (info.kind === "blacksmith" && this.isNearNpc(runtime, point)) {
        return;
      }
    }
    throw new ItemError("out_of_range", "Walk closer to the blacksmith.");
  }

  private requireWarehouseRange(runtime: PlayerRuntime, npcId?: string): void {
    for (const point of this.assets.npcs) {
      if (npcId && point.npcId !== npcId) {
        continue;
      }
      let info;
      try {
        info = getNpc(point.npcId);
      } catch {
        continue;
      }
      if (info.kind === "warehouse" && this.isNearNpc(runtime, point)) {
        return;
      }
    }
    throw new ItemError("out_of_range", "Walk closer to the warehouse keeper.");
  }

  private async ensureWarehouse(runtime: PlayerRuntime): Promise<void> {
    if (!runtime.warehouse) {
      runtime.warehouse = await getServerServices().items.loadWarehouse(runtime.accountId);
      runtime.warehouseRevision++;
    }
  }

  private async openWarehouse(client: Client, runtime: PlayerRuntime): Promise<void> {
    runtime.warehouse = await getServerServices().items.loadWarehouse(runtime.accountId);
    runtime.warehouseRevision++;
    this.sendWarehouse(client);
  }

  private async handlePickupFailure(
    client: Client,
    runtime: PlayerRuntime,
    dropId: string,
    error: unknown,
  ): Promise<void> {
    if (error instanceof ItemError) {
      if (error.code === "already_taken") {
        // Someone else won the row claim; remove the stale view entity.
        this.removeGroundItem(dropId);
      }
      if (error.code === "stale") {
        try {
          await this.reloadRuntimeInventory(runtime);
          this.sendInventory(client.sessionId);
        } catch (reloadError) {
          logger.error(
            { roomId: this.roomId, session: client.sessionId, error: reloadError },
            "inventory reload failed after pickup",
          );
        }
      }
      this.sendPickupResult(client, { dropId, ok: false, code: error.code });
      return;
    }
    logger.error(
      { roomId: this.roomId, session: client.sessionId, dropId, error },
      "pickup failed",
    );
    this.sendPickupResult(client, { dropId, ok: false, code: "internal" });
  }

  private async reloadRuntimeInventory(runtime: PlayerRuntime): Promise<void> {
    const loaded = await getServerServices().items.loadInventory(
      runtime.accountId,
      runtime.characterId,
    );
    runtime.inventory = loaded.inventory;
    runtime.gold = loaded.gold;
    runtime.inventoryRevision++;
  }

  private async handleItemFailure(
    client: Client,
    runtime: PlayerRuntime,
    error: unknown,
    channel: "item" | "blacksmith" = "item",
  ): Promise<void> {
    if (error instanceof ItemError) {
      if (error.code === "stale") {
        logger.warn(
          { roomId: this.roomId, session: client.sessionId, code: error.code },
          "stale item command; reloading inventory",
        );
        try {
          await this.reloadRuntimeInventory(runtime);
          this.sendInventory(client.sessionId);
          if (runtime.warehouse) {
            runtime.warehouse = await getServerServices().items.loadWarehouse(runtime.accountId);
            runtime.warehouseRevision++;
            this.sendWarehouse(client);
          }
        } catch (reloadError) {
          logger.error(
            { roomId: this.roomId, session: client.sessionId, error: reloadError },
            "inventory reload failed",
          );
        }
        this.sendErrorFor(channel, client, "stale");
        return;
      }
      if (error.code !== "internal") {
        this.sendErrorFor(channel, client, error.code, error.message);
        return;
      }
    }
    logger.error(
      { roomId: this.roomId, session: client.sessionId, error },
      "item command failed",
    );
    this.sendErrorFor(channel, client, "internal");
  }

  private applyRegen(now: number): void {
    for (const [sessionId, runtime] of this.runtimes) {
      const player = this.state.players.get(sessionId);
      if (player) {
        applyRegenTick(runtime, player, now);
      }
    }
  }

  private processRespawns(now: number): void {
    for (const client of [...this.clients]) {
      const runtime = this.runtimes.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      if (!runtime || !player) {
        continue;
      }
      const choice = runtime.pendingRespawn;
      if (!choice) {
        continue;
      }
      runtime.pendingRespawn = null;
      if (!runtime.dead) {
        continue;
      }

      if (choice === "town") {
        void this.respawnInTown(client);
        continue;
      }

      const delay = getServerServices().combatTuning.respawnHereDelayMs ?? RESPAWN_HERE_DELAY_MS;
      if (now < runtime.diedAtMs + delay) {
        this.safeSend(client, MSG.death, { respawnHereAtMs: runtime.diedAtMs + delay });
        continue;
      }

      const fraction =
        getServerServices().combatTuning.respawnHereHpFraction ?? RESPAWN_HERE_HP_FRACTION;
      const hp = Math.max(1, Math.round(runtime.progression.maxHp * fraction));
      runtime.progression.hp = hp;
      runtime.dead = false;
      runtime.diedAtMs = 0;
      runtime.regenAccumMs = 0;
      player.dead = false;
      player.hp = hp;
      player.moving = false;
      this.parties.updateMember(runtime.characterId, { dead: false });
      const spawn = this.resolveSpawn(player.x, player.y);
      runtime.mover.pos.x = spawn.x;
      runtime.mover.pos.y = spawn.y;
      runtime.mover.path = [];
      runtime.lastIntent = { kind: "none" };
      player.x = spawn.x;
      player.y = spawn.y;
      runtime.dirty = true;
      this.updateInterest();
      this.sendSelfStats(client.sessionId);
    }
  }

  private async respawnInTown(client: Client): Promise<void> {
    const runtime = this.runtimes.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!runtime || !player || !runtime.dead || runtime.warping) {
      return;
    }

    runtime.progression.hp = runtime.progression.maxHp;
    runtime.progression.mp = runtime.progression.maxMp;
    player.hp = runtime.progression.hp;
    player.mp = runtime.progression.mp;

    const village = defaultSpawn();
    const accepted = await this.beginWarp(client, village);
    if (!accepted) {
      const delay = getServerServices().combatTuning.respawnHereDelayMs ?? RESPAWN_HERE_DELAY_MS;
      this.safeSend(client, MSG.death, { respawnHereAtMs: runtime.diedAtMs + delay });
    }
  }

  /** Award kill XP to the player who landed the killing blow (party XP is Phase 6). */
  private awardXpForKill(killed: KilledMonster, killerSessionId: string): void {
    const killer = this.runtimes.get(killerSessionId);
    if (!killer || killer.dead) {
      return;
    }
    const spec = getMonster(killed.typeId);
    const recipients = new Set<string>([killerSessionId]);
    const party = this.parties.getByCharacter(killer.characterId);
    if (party) {
      const radiusSquared = PARTY_XP_RADIUS_PX * PARTY_XP_RADIUS_PX;
      for (const member of this.parties.members(party)) {
        const runtime = this.runtimes.get(member.sessionId);
        if (!runtime || runtime.characterId !== member.characterId || runtime.dead) {
          continue;
        }
        const dx = runtime.mover.pos.x - killed.x;
        const dy = runtime.mover.pos.y - killed.y;
        if (dx * dx + dy * dy <= radiusSquared) {
          recipients.add(member.sessionId);
        }
      }
    }
    this.awardXpToGroup([...recipients], spec.xp, spec.level);
  }

  /** Award the same party-bonus XP to each eligible session once. */
  private awardXpToGroup(
    sessionIds: readonly string[],
    baseXp: number,
    sourceLevel: number,
  ): void {
    const unique = [...new Set(sessionIds)].filter((sessionId) => {
      const runtime = this.runtimes.get(sessionId);
      return Boolean(runtime && !runtime.dead);
    });
    if (unique.length === 0) {
      return;
    }
    const xpRate = getServerServices().adminRuntime.settings.xpRate;
    if (!(xpRate > 0)) {
      return;
    }
    for (const sessionId of unique) {
      const runtime = this.runtimes.get(sessionId);
      if (!runtime) {
        continue;
      }
      const gain = partyMemberXpGain(
        baseXp,
        sourceLevel,
        runtime.progression.level,
        unique.length,
        xpRate,
      );
      if (gain > 0) {
        this.grantXp(sessionId, gain);
      }
    }
  }

  private grantXp(sessionId: string, gained: number): boolean {
    const runtime = this.runtimes.get(sessionId);
    const player = this.state.players.get(sessionId);
    if (!runtime || !player || runtime.dead) {
      return false;
    }
    const previousLevel = runtime.progression.level;
    const previousXp = runtime.progression.xp;
    const result = applyXpGain(previousLevel, previousXp, gained);
    runtime.progression.level = result.level;
    runtime.progression.xp = result.xp;
    runtime.progression.statPoints += result.statPointsGained;
    recomputeSkillPoints(runtime.progression);

    if (result.levelsGained > 0 && isClassId(player.classId)) {
      recomputeMaxima(
        runtime.progression,
        player.classId,
        equipmentBonusStats(runtime.inventory),
      );
      runtime.progression.hp = runtime.progression.maxHp;
      runtime.progression.mp = runtime.progression.maxMp;
      player.level = runtime.progression.level;
      player.maxHp = runtime.progression.maxHp;
      player.maxMp = runtime.progression.maxMp;
      player.hp = runtime.progression.hp;
      player.mp = runtime.progression.mp;

      const levelUp: LevelUpPayload = {
        sessionId,
        name: player.name,
        level: runtime.progression.level,
        x: runtime.mover.pos.x,
        y: runtime.mover.pos.y,
      };
      const radiusSquared = COMBAT_EVENT_RADIUS_PX * COMBAT_EVENT_RADIUS_PX;
      for (const client of this.clients) {
        const other = this.runtimes.get(client.sessionId);
        if (!other) {
          continue;
        }
        const dx = other.mover.pos.x - runtime.mover.pos.x;
        const dy = other.mover.pos.y - runtime.mover.pos.y;
        if (dx * dx + dy * dy <= radiusSquared) {
          this.safeSend(client, MSG.levelUp, levelUp);
        }
      }
    }

    if (
      runtime.progression.level === previousLevel &&
      runtime.progression.xp === previousXp
    ) {
      return false;
    }

    runtime.dirty = true;
    this.sendSelfStats(sessionId);
    this.sendSkillState(sessionId);
    void this.enqueueSave(runtime, {
      mapId: this.mapId,
      x: runtime.mover.pos.x,
      y: runtime.mover.pos.y,
    });
    return true;
  }

  /**
   * Skill/doctrine commands share the inventory chain so two purchases cannot
   * both read the same point balance in one tick.
   */
  private runSkillCommand(
    client: Client,
    handler: (runtime: PlayerRuntime) => Promise<void>,
  ): void {
    const runtime = this.runtimes.get(client.sessionId);
    if (!runtime) {
      return;
    }
    const run = async (): Promise<void> => {
      if (runtime.inventoryClosed) {
        return;
      }
      try {
        await handler(runtime);
      } catch (error) {
        if (error instanceof SkillRuleError) {
          this.safeSend(client, MSG.skillError, toSkillErrorPayload(error));
          return;
        }
        logger.error(
          { roomId: this.roomId, characterId: runtime.characterId, error },
          "skill command failed",
        );
        this.safeSend(client, MSG.skillError, {
          code: "internal",
          message: "Could not update your skills. Try again.",
        });
      }
    };
    const next = (runtime.inventoryChain ?? Promise.resolve()).then(run, run);
    runtime.inventoryChain = next.then(
      () => undefined,
      () => undefined,
    );
  }

  private chooseDoctrine(client: Client, doctrineId: string): void {
    this.runSkillCommand(client, async (runtime) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !isClassId(player.classId)) {
        throw new SkillRuleError("internal", "Character class is not playable.");
      }
      const chosen = validateDoctrineChoice(runtime.progression, player.classId, doctrineId);
      const saved = await getServerServices().saveSkillState(runtime.characterId, {
        doctrine: chosen,
        skillPoints: runtime.progression.skillPoints,
      });
      if (!saved) {
        throw new SkillRuleError("internal", "Character no longer exists.");
      }
      runtime.progression.doctrine = chosen;
      runtime.dirty = true;
      this.sendSkillState(client.sessionId);
      this.sendSelfStats(client.sessionId);
      this.sendSystemMessage(client, `Doctrine chosen: ${chosen}.`);
    });
  }

  private upgradeSkill(client: Client, skillId: string): void {
    this.runSkillCommand(client, async (runtime) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !isClassId(player.classId)) {
        throw new SkillRuleError("internal", "Character class is not playable.");
      }
      const result = validateSkillUpgrade(runtime.progression, player.classId, skillId);
      const saved = await getServerServices().saveSkillState(runtime.characterId, {
        ranks: { [skillId]: result.rank },
        skillPoints: result.skillPoints,
      });
      if (!saved) {
        throw new SkillRuleError("internal", "Character no longer exists.");
      }
      runtime.progression.skills[skillId] = result.rank;
      runtime.progression.skillPoints = result.skillPoints;
      runtime.dirty = true;
      this.sendSkillState(client.sessionId);
      this.sendSelfStats(client.sessionId);
    });
  }

  private sendSkillState(sessionId: string): void {
    const runtime = this.runtimes.get(sessionId);
    const player = this.state.players.get(sessionId);
    const client = this.clientFor(sessionId);
    if (!runtime || !player || !client || !isClassId(player.classId)) {
      return;
    }
    this.safeSend(
      client,
      MSG.skillState,
      buildSkillState(runtime.progression, player.classId, runtime.skillCooldowns),
    );
  }

  private partyMemberInput(
    runtime: PlayerRuntime,
    player: PlayerState,
    sessionId: string,
  ): PartyMemberInput {
    return {
      characterId: runtime.characterId,
      sessionId,
      name: player.name,
      level: runtime.progression.level,
      classId: player.classId,
      hp: runtime.progression.hp,
      maxHp: runtime.progression.maxHp,
      mp: runtime.progression.mp,
      maxMp: runtime.progression.maxMp,
      dead: runtime.dead,
    };
  }

  private resolvePartyTarget(
    characterId: string | undefined,
    name: string | undefined,
  ): { client: Client; runtime: PlayerRuntime; player: PlayerState; sessionId: string } | null {
    const wantedName = name?.trim().toLowerCase();
    for (const [sessionId, player] of this.state.players) {
      const runtime = this.runtimes.get(sessionId);
      if (!runtime) {
        continue;
      }
      if (
        (characterId && player.characterId === characterId) ||
        (wantedName && player.name.toLowerCase() === wantedName)
      ) {
        const client = this.clientFor(sessionId);
        if (client) {
          return { client, runtime, player, sessionId };
        }
      }
    }
    return null;
  }

  private handlePartyInvite(
    client: Client,
    characterId: string | undefined,
    name: string | undefined,
  ): void {
    const runtime = this.runtimes.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!runtime || !player) {
      return;
    }
    try {
      let party = this.parties.getByCharacter(runtime.characterId);
      if (!party) {
        party = this.parties.create(this.partyMemberInput(runtime, player, client.sessionId));
        this.sendPartyState(party);
      }
      const target = this.resolvePartyTarget(characterId, name);
      if (!target) {
        throw new PartyRuleError("target_offline", "That player is not in this room.");
      }
      const invite = this.parties.invite(
        runtime.characterId,
        target.player.characterId,
        target.player.name,
      );
      this.safeSend(target.client, MSG.partyInvite, toPartyInvitePayload(invite));
    } catch (error) {
      this.sendPartyError(client, error);
    }
  }

  private handlePartyRespond(client: Client, inviteId: string, accept: boolean): void {
    const runtime = this.runtimes.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!runtime || !player) {
      return;
    }
    try {
      if (!accept) {
        if (!this.parties.decline(inviteId, runtime.characterId)) {
          throw new PartyRuleError("invite_not_found", "That invitation is no longer available.");
        }
        return;
      }
      const party = this.parties.accept(
        inviteId,
        this.partyMemberInput(runtime, player, client.sessionId),
      );
      this.broadcastParty(party);
    } catch (error) {
      this.sendPartyError(client, error);
    }
  }

  private leavePartyCommand(client: Client): void {
    const runtime = this.runtimes.get(client.sessionId);
    if (!runtime) {
      return;
    }
    try {
      const result = this.parties.leave(runtime.characterId);
      this.releaseOwnershipFor(runtime.characterId);
      this.sendEmptyParty(client);
      if (result.party) {
        this.broadcastParty(result.party);
      }
    } catch (error) {
      this.sendPartyError(client, error);
    }
  }

  /** Warp/disconnect cleanup: no client message to the leaving member. */
  private leavePartyInternal(characterId: string): void {
    try {
      const result = this.parties.leave(characterId);
      this.releaseOwnershipFor(characterId);
      if (result.party) {
        this.broadcastParty(result.party);
      }
    } catch {
      // Not in a party.
    }
  }

  private setPartyLoot(client: Client, rule: "free_for_all" | "round_robin"): void {
    const runtime = this.runtimes.get(client.sessionId);
    if (!runtime) {
      return;
    }
    try {
      const party = this.parties.setLootRule(runtime.characterId, rule);
      this.broadcastParty(party);
    } catch (error) {
      this.sendPartyError(client, error);
    }
  }

  /** Downgrade or clear locks held by a character or a disbanded party. */
  private releaseOwnershipFor(characterId: string): void {
    for (const drop of this.groundItems.values()) {
      let changed = false;
      if (drop.ownerCharacterId === characterId) {
        const party = drop.ownerPartyId ? this.parties.get(drop.ownerPartyId) : undefined;
        if (party && party.members.size > 0) {
          drop.ownerCharacterId = "";
        } else {
          drop.ownerPartyId = "";
          drop.ownerCharacterId = "";
          drop.ownerUntilMs = 0;
        }
        changed = true;
      } else if (drop.ownerPartyId && !this.parties.get(drop.ownerPartyId)) {
        drop.ownerPartyId = "";
        drop.ownerCharacterId = "";
        drop.ownerUntilMs = 0;
        changed = true;
      }
      if (changed) {
        const state = this.state.groundItems.get(drop.dropId);
        if (state) {
          state.ownerCharacterId = drop.ownerCharacterId;
          state.ownerPartyId = drop.ownerPartyId;
          state.ownerUntilMs = drop.ownerUntilMs;
        }
      }
    }
  }

  private sendPartyError(client: Client, error: unknown): void {
    if (error instanceof PartyRuleError) {
      this.safeSend(client, MSG.partyError, { code: error.code, message: error.message });
      return;
    }
    logger.error({ roomId: this.roomId, session: client.sessionId, error }, "party command failed");
    this.safeSend(client, MSG.partyError, {
      code: "internal",
      message: "Party action failed. Try again.",
    });
  }

  private sendPartyState(party: Party): void {
    this.broadcastParty(party);
  }

  private broadcastParty(party: Party): void {
    const snapshot: PartyStatePayload = this.parties.snapshot(party);
    for (const member of party.members.values()) {
      const client = this.clientFor(member.sessionId);
      if (client) {
        this.safeSend(client, MSG.partyState, snapshot);
      }
    }
  }

  private sendEmptyParty(client: Client): void {
    const empty: PartyStatePayload = {
      partyId: "",
      leaderCharacterId: "",
      lootRule: "free_for_all",
      members: [],
    };
    this.safeSend(client, MSG.partyState, empty);
  }

  private refreshPartyVitals(): void {
    for (const party of this.parties.all()) {
      for (const member of party.members.values()) {
        const runtime = this.runtimes.get(member.sessionId);
        const player = this.state.players.get(member.sessionId);
        if (!runtime || !player) {
          continue;
        }
        this.parties.updateMember(member.characterId, {
          level: runtime.progression.level,
          hp: runtime.progression.hp,
          maxHp: runtime.progression.maxHp,
          mp: runtime.progression.mp,
          maxMp: runtime.progression.maxMp,
          dead: runtime.dead,
        });
      }
      this.broadcastParty(party);
    }
  }

  private castSkill(client: Client, request: import("@jadethrone/shared").CastSkillMessage): void {
    const runtime = this.runtimes.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!runtime || !player || !isClassId(player.classId)) {
      return;
    }
    try {
      if (!hasSkill(request.skillId)) {
        this.safeSend(client, MSG.skillError, {
          code: "unknown_skill",
          message: "Unknown skill.",
        });
        return;
      }
      const skill = getSkill(request.skillId);
      const targetPos = this.skillAim(runtime, skill, request);
      const allySessionId = this.resolveAllySession(request.targetCharacterId);
      const partySessionIds = this.partySessionIdsFor(runtime);
      const validation = validateSkillCast({
        progression: runtime.progression,
        classId: player.classId,
        request,
        now: Date.now(),
        cooldowns: runtime.skillCooldowns,
        hasPendingCast: runtime.pendingCast !== null,
        dead: runtime.dead,
        warping: runtime.warping,
        casterPos: runtime.mover.pos,
        targetPos,
      });
      const now = Date.now();
      runtime.progression.mp = Math.max(0, runtime.progression.mp - validation.mpCost);
      player.mp = runtime.progression.mp;
      startSkillCooldown(runtime.skillCooldowns, skill, now);
      runtime.pendingCast = createPendingCast(validation, request, now, {
        targetPos,
        allySessionId,
        partySessionIds,
      });
      runtime.dirty = true;
      this.sendSelfStats(client.sessionId);
      this.sendSkillState(client.sessionId);
      const start: SkillCastStartPayload = {
        skillId: skill.id,
        name: skill.name,
        completesAtMs: runtime.pendingCast.completesAtMs,
        castTimeMs: skill.castTimeMs,
      };
      this.safeSend(client, MSG.skillCastStart, start);
    } catch (error) {
      if (error instanceof SkillRuleError) {
        this.safeSend(client, MSG.skillError, toSkillErrorPayload(error));
        return;
      }
      logger.error({ roomId: this.roomId, session: client.sessionId, error }, "skill cast failed");
      this.safeSend(client, MSG.skillError, {
        code: "internal",
        message: "Could not cast that skill.",
      });
    }
  }

  private skillAim(
    runtime: PlayerRuntime,
    skill: ReturnType<typeof getSkill>,
    request: {
      x?: number;
      y?: number;
      targetMonsterId?: string;
      targetStoneId?: string;
      targetCharacterId?: string;
      dir?: number;
    },
  ): { x: number; y: number } | undefined {
    if (request.x !== undefined && request.y !== undefined) {
      return { x: request.x, y: request.y };
    }
    if (request.targetCharacterId) {
      for (const active of this.runtimes.values()) {
        if (active.characterId === request.targetCharacterId) {
          return { x: active.mover.pos.x, y: active.mover.pos.y };
        }
      }
    }
    if (request.targetMonsterId) {
      const monster = this.monsterRuntimes.get(request.targetMonsterId);
      if (monster) {
        return { x: monster.mover.pos.x, y: monster.mover.pos.y };
      }
    }
    if (request.targetStoneId) {
      const stone = this.stones.get(request.targetStoneId);
      if (stone) {
        return { x: stone.x, y: stone.y };
      }
    }
    if (request.dir !== undefined && skill.target === "ground") {
      const vector = DIR8_VECTORS[request.dir] ?? DIR8_VECTORS[0]!;
      return {
        x: runtime.mover.pos.x + vector.x * skill.rangePx,
        y: runtime.mover.pos.y + vector.y * skill.rangePx,
      };
    }
    return undefined;
  }

  private resolveAllySession(characterId: string | undefined): string | undefined {
    if (!characterId) {
      return undefined;
    }
    for (const [sessionId, player] of this.state.players) {
      if (player.characterId === characterId) {
        return sessionId;
      }
    }
    return undefined;
  }

  private partySessionIdsFor(runtime: PlayerRuntime): string[] {
    const party = this.parties.getByCharacter(runtime.characterId);
    if (!party) {
      return [];
    }
    const result: string[] = [];
    for (const member of this.parties.members(party)) {
      for (const [sessionId, active] of this.runtimes) {
        if (active.characterId === member.characterId) {
          result.push(sessionId);
          break;
        }
      }
    }
    return result;
  }

  private cancelPendingCast(
    runtime: PlayerRuntime,
    sessionId: string,
    reason: SkillCastCancelPayload["reason"],
  ): void {
    if (!runtime.pendingCast) {
      return;
    }
    const skillId = runtime.pendingCast.skillId;
    runtime.pendingCast = null;
    const client = this.clientFor(sessionId);
    if (client) {
      this.safeSend(client, MSG.skillCastCancel, { skillId, reason });
    }
  }

  private processSkillCasts(now: number): void {
    for (const [sessionId, runtime] of this.runtimes) {
      const pending = runtime.pendingCast;
      if (!pending || now < pending.completesAtMs) {
        continue;
      }
      runtime.pendingCast = null;
      if (runtime.dead || runtime.warping) {
        continue;
      }
      const skill = getSkill(pending.skillId);
      const player = this.state.players.get(sessionId);
      if (!player || !isClassId(player.classId)) {
        continue;
      }
      const outcome = resolveSkillCast(
        {
          now,
          rng: this.rng,
          state: this.state,
          runtimes: this.runtimes,
          monsterRuntimes: this.monsterRuntimes,
          stoneRuntimes: this.stones.stones,
          grid: this.assets.grid,
          casterModifiers: playerBuffModifiers(runtime.buffs, now),
        },
        {
          sessionId,
          skill,
          rank: runtime.progression.skills[skill.id] ?? 1,
          dir: pending.request.dir as Parameters<typeof resolveSkillCast>[1]["dir"],
          targetPos: pending.targetPos,
          targetMonsterId: pending.request.targetMonsterId,
          targetStoneId: pending.request.targetStoneId,
          allySessionId: pending.allySessionId,
          partySessionIds: pending.partySessionIds,
        },
      );
      if (outcome) {
        this.applySkillOutcome(sessionId, skill, outcome, now);
      }
    }
  }

  private applySkillOutcome(
    sessionId: string,
    skill: ReturnType<typeof getSkill>,
    outcome: SkillOutcome,
    now: number,
  ): void {
    const runtime = this.runtimes.get(sessionId);
    const player = this.state.players.get(sessionId);
    if (!runtime || !player) {
      return;
    }
    const affected = new Set<string>();
    if (outcome.stoneHits.length > 0) {
      this.applyStoneHits(sessionId, outcome.stoneHits, now);
    }
    for (const status of outcome.statuses) {
      const monster = this.monsterRuntimes.get(status.monsterId);
      if (!monster) {
        continue;
      }
      if (status.kind === "stun") {
        applyStunAt(monster.status, status.durationMs, getMonster(monster.typeId).isBoss, now);
      } else if (status.kind === "slow") {
        applySlow(monster.status, status.factor, status.durationMs, now);
      } else if (status.kind === "poison") {
        applyPoison(
          monster.status,
          {
            damagePerTick: status.damagePerTick,
            durationMs: status.durationMs,
            tickMs: status.tickMs,
            sourceSessionId: status.sourceSessionId,
          },
          now,
        );
      } else {
        monster.mover.pos = { x: status.destination.x, y: status.destination.y };
        monster.mover.path = [];
        const state = this.state.monsters.get(status.monsterId);
        if (state) {
          state.x = status.destination.x;
          state.y = status.destination.y;
        }
      }
    }
    for (const killed of outcome.killed) {
      this.finalizeSkillKill(killed, sessionId, now);
    }
    for (const heal of outcome.heals) {
      const target = this.runtimes.get(heal.targetSessionId);
      const targetPlayer = this.state.players.get(heal.targetSessionId);
      if (!target || !targetPlayer || target.dead) {
        continue;
      }
      target.progression.hp = Math.min(target.progression.maxHp, target.progression.hp + heal.amount);
      targetPlayer.hp = target.progression.hp;
      target.dirty = true;
      affected.add(heal.targetSessionId);
    }
    for (const hot of outcome.hots) {
      const target = this.runtimes.get(hot.targetSessionId);
      if (target) {
        target.healOverTime.push(hot);
      }
    }
    const buffResults: SkillBuffResult[] = [];
    for (const intent of outcome.buffs) {
      const target = this.runtimes.get(intent.targetSessionId);
      if (!target) {
        continue;
      }
      const buff = applyPlayerBuff(
        target.buffs,
        {
          sourceSkillId: intent.sourceSkillId,
          name: intent.name,
          iconKey: intent.iconKey,
          modifiers: intent.modifiers,
          durationMs: intent.durationMs,
          kind: intent.kind,
          stealth: intent.stealth,
        },
        now,
      );
      buffResults.push({
        targetSessionId: intent.targetSessionId,
        buff: toBuffView(buff),
      });
      affected.add(intent.targetSessionId);
    }
    for (const targetSessionId of outcome.cleanses) {
      const target = this.runtimes.get(targetSessionId);
      if (target) {
        removeDebuffs(target.buffs);
        affected.add(targetSessionId);
      }
    }
    if (outcome.selfDamage > 0) {
      runtime.progression.hp = Math.max(1, runtime.progression.hp - outcome.selfDamage);
      player.hp = runtime.progression.hp;
      runtime.dirty = true;
      affected.add(sessionId);
    }
    if (outcome.dash) {
      runtime.mover.pos = { x: outcome.dash.destination.x, y: outcome.dash.destination.y };
      runtime.mover.path = [];
      runtime.lastIntent = { kind: "none" };
      player.x = outcome.dash.destination.x;
      player.y = outcome.dash.destination.y;
      player.facing = facing4Index(outcome.dash.facing);
      runtime.dirty = true;
    }
    if (outcome.breaksStealth && removeStealth(runtime.buffs)) {
      affected.add(sessionId);
    }
    runtime.lastCombatAtMs = Math.max(runtime.lastCombatAtMs, outcome.hits.length > 0 ? now : 0);

    const payload: SkillCastPayload = {
      eventSeq: ++this.eventSeq,
      caster: { kind: "player", sessionId },
      skillId: skill.id,
      name: skill.name,
      type: skill.type,
      fx: skill.fx,
      x: outcome.x,
      y: outcome.y,
      targetX: outcome.targetX,
      targetY: outcome.targetY,
      hits: outcome.hits,
      heals: outcome.heals.map((heal) => ({
        targetSessionId: heal.targetSessionId,
        targetCharacterId: heal.targetCharacterId,
        amount: heal.amount,
        x: heal.x,
        y: heal.y,
      })),
      buffs: buffResults,
    };
    const radiusSquared = COMBAT_EVENT_RADIUS_PX * COMBAT_EVENT_RADIUS_PX;
    for (const client of this.clients) {
      const other = this.runtimes.get(client.sessionId);
      if (!other) {
        continue;
      }
      const dx = other.mover.pos.x - outcome.x;
      const dy = other.mover.pos.y - outcome.y;
      if (dx * dx + dy * dy <= radiusSquared) {
        this.safeSend(client, MSG.skillCast, payload);
      }
    }
    for (const affectedId of affected) {
      this.sendSelfStats(affectedId);
      this.sendBuffState(affectedId);
    }
    this.sendSelfStats(sessionId);
    this.sendBuffState(sessionId);
  }

  private finalizeSkillKill(killed: KilledMonster, killerSessionId: string, now: number): void {
    this.state.monsters.delete(killed.monsterId);
    this.monsterRuntimes.delete(killed.monsterId);
    notifyMonsterDeath(this.spawns, killed.monsterId, now);
    this.broadcastBossTimers();
    const payload: MonsterDiedPayload = { ...killed, killerSessionId };
    for (const client of this.clients) {
      this.safeSend(client, MSG.monsterDied, payload);
    }
    const killer = this.runtimes.get(killerSessionId);
    if (killer?.targetMonsterId === killed.monsterId) {
      this.clearAutoWalk(killer, killerSessionId, "target_lost");
    }
    this.awardXpForKill(killed, killerSessionId);
    void this.spawnDrops(killed, killerSessionId, now).catch((error: unknown) => {
      logger.error({ roomId: this.roomId, monsterId: killed.monsterId, error }, "drop spawn failed");
    });
  }

  private sendBuffState(sessionId: string): void {
    const runtime = this.runtimes.get(sessionId);
    const client = this.clientFor(sessionId);
    if (!runtime || !client) {
      return;
    }
    const payload: BuffStatePayload = { buffs: buffViews(runtime.buffs, Date.now()) };
    this.safeSend(client, MSG.buffState, payload);
  }

  private tickSkillEffects(now: number): void {
    for (const [sessionId, runtime] of this.runtimes) {
      if (pruneExpiredBuffs(runtime.buffs, now)) {
        this.sendBuffState(sessionId);
        this.sendSelfStats(sessionId);
      }
      if (runtime.healOverTime.length === 0) {
        continue;
      }
      let changed = false;
      for (const hot of runtime.healOverTime) {
        if (now < hot.nextTickAtMs) {
          continue;
        }
        hot.nextTickAtMs += hot.tickMs;
        runtime.progression.hp = Math.min(
          runtime.progression.maxHp,
          runtime.progression.hp + hot.amountPerTick,
        );
        const player = this.state.players.get(sessionId);
        if (player) {
          player.hp = runtime.progression.hp;
        }
        changed = true;
      }
      runtime.healOverTime = runtime.healOverTime.filter((hot) => hot.expiresAtMs > now);
      if (changed) {
        runtime.dirty = true;
        this.sendSelfStats(sessionId);
      }
    }

    const context = {
      now,
      rng: this.rng,
      state: this.state,
      runtimes: this.runtimes,
      monsterRuntimes: this.monsterRuntimes,
      stoneRuntimes: this.stones.stones,
    };
    for (const [monsterId, monster] of this.monsterRuntimes) {
      const tick = tickPoison(monster.status, now);
      if (!tick) {
        continue;
      }
      const applied = applyDamageToMonster(
        context,
        tick.sourceSessionId,
        monsterId,
        tick.damage,
        now,
      );
      if (applied?.killed) {
        this.finalizeSkillKill(applied.killed, tick.sourceSessionId, now);
      }
    }
  }

  private allocateStat(sessionId: string, stat: StatKey): void {
    const runtime = this.runtimes.get(sessionId);
    const player = this.state.players.get(sessionId);
    if (!runtime || !player || runtime.warping) {
      return;
    }
    if (runtime.progression.statPoints <= 0) {
      return;
    }
    if (runtime.progression.stats[stat] >= STAT_POINT_CAP) {
      return;
    }
    runtime.progression.stats[stat]++;
    runtime.progression.statPoints--;

    if (isClassId(player.classId)) {
      recomputeMaxima(
        runtime.progression,
        player.classId,
        equipmentBonusStats(runtime.inventory),
      );
    }
    player.maxHp = runtime.progression.maxHp;
    player.maxMp = runtime.progression.maxMp;
    player.hp = runtime.progression.hp;
    player.mp = runtime.progression.mp;
    runtime.dirty = true;
    this.sendSelfStats(sessionId);
    void this.enqueueSave(runtime, {
      mapId: this.mapId,
      x: runtime.mover.pos.x,
      y: runtime.mover.pos.y,
    });
  }

  private safeSend(client: Client, type: string, payload: unknown): void {
    try {
      client.send(type, payload);
    } catch (error) {
      logger.debug(
        { roomId: this.roomId, session: client.sessionId, type, error },
        "failed to send room message",
      );
    }
  }

  /** One snapshot per tick for the AI; positions come from authoritative movers. */
  private playerSnapshots(): AiPlayerSnapshot[] {
    const snapshots: AiPlayerSnapshot[] = [];
    for (const [sessionId, runtime] of this.runtimes) {
      if (runtime.invisible || hasStealth(runtime.buffs, Date.now())) {
        continue;
      }
      snapshots.push({
        sessionId,
        pos: runtime.mover.pos,
        dead: runtime.dead,
        warping: runtime.warping,
      });
    }
    return snapshots;
  }

  private stepMonsters(now: number, players: readonly AiPlayerSnapshot[]): void {
    let budget = MAX_ASTAR_PER_TICK;
    const takeAstar = (): boolean => {
      if (budget <= 0) {
        return false;
      }
      budget--;
      return true;
    };
    this.attackIntentCount = 0;

    for (const [monsterId, runtime] of this.monsterRuntimes) {
      if (runtime.hp <= 0) {
        continue;
      }
      const monster = this.state.monsters.get(monsterId);
      if (!monster) {
        continue;
      }
      const result = stepMonsterAi(
        {
          grid: this.assets.grid,
          now,
          players,
          takeAstar,
          rng: () => this.rng.next(),
        },
        runtime,
        monster,
        getMonster(runtime.typeId),
      );
      if (!result.attackTargetId) {
        continue;
      }
      const slot = (this.attackIntents[this.attackIntentCount] ??= {
        monsterId: "",
        targetSessionId: "",
      });
      slot.monsterId = monsterId;
      slot.targetSessionId = result.attackTargetId;
      this.attackIntentCount++;
    }
  }

  /** A player who leaves is no longer a valid monster target. */
  private clearPlayerFromMonsters(sessionId: string): void {
    for (const monster of this.monsterRuntimes.values()) {
      if (monster.targetSessionId !== sessionId) {
        continue;
      }
      monster.targetSessionId = null;
      monster.mover.path = [];
      monster.failedRepaths = 0;
      monster.lastTargetTileKey = null;
      monster.nextRepathAtMs = 0;
      if (monster.ai !== "return") {
        monster.ai = "return";
      }
    }
  }

  /** Trigger any warp zone the player is standing on (after movement). */
  private checkWarps(): void {
    const now = Date.now();
    for (const client of [...this.clients]) {
      const runtime = this.runtimes.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      if (
        !runtime ||
        !player ||
        runtime.warping ||
        runtime.dead ||
        now < runtime.warpCooldownUntilMs
      ) {
        continue;
      }
      const warp = this.assets.warps.find(
        (zone) =>
          player.x >= zone.x &&
          player.x <= zone.x + zone.w &&
          player.y >= zone.y &&
          player.y <= zone.y + zone.h,
      );
      if (warp) {
        void this.startWarp(client, warp);
      }
    }
  }

  /**
   * Persist the destination first, then reserve a seat authenticated by a
   * server-issued warp token. The target room's `onAuth` consumes the token
   * and loads the saved destination, so an expired access JWT cannot break a
   * map change.
   */
  private async startWarp(client: Client, warp: WarpZone): Promise<void> {
    await this.beginWarp(client, { mapId: warp.targetMap, x: warp.targetX, y: warp.targetY });
  }

  /**
   * Persist the destination first, then reserve a seat authenticated by a
   * server-issued warp token. The target room's `onAuth` consumes the token
   * and loads the saved destination, so an expired access JWT cannot break a
   * map change.
   *
   * Returns false when the destination could not be saved or the reservation
   * failed; a connected player has then been restored and can retry.
   */
  private async beginWarp(
    client: Client,
    destination: { mapId: MapId; x: number; y: number },
    options: { awaitInventory?: boolean } = {},
  ): Promise<boolean> {
    const runtime = this.runtimes.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!runtime || !player || runtime.warping) {
      return false;
    }
    runtime.warping = true;
    runtime.inventoryClosed = true;
    if (runtime.pendingCast) {
      this.cancelPendingCast(runtime, client.sessionId, "warped");
    }
    runtime.pendingCast = null;
    runtime.buffs.clear();
    runtime.healOverTime = [];
    // A return scroll calls beginWarp from inside the inventory chain. Awaiting
    // that same chain here would deadlock, so the caller that owns it skips it.
    if (options.awaitInventory !== false) {
      await runtime.inventoryChain?.catch(() => undefined);
    }
    const services = getServerServices();
    const source = {
      mapId: this.mapId,
      x: runtime.mover.pos.x,
      y: runtime.mover.pos.y,
    };

    const saved = await this.enqueueSave(runtime, destination);
    if (!saved) {
      runtime.warping = false;
      runtime.inventoryClosed = false;
      runtime.warpCooldownUntilMs = Date.now() + WARP_COOLDOWN_MS;
      logger.error(
        { roomId: this.roomId, session: client.sessionId },
        "warp destination save failed",
      );
      return false;
    }

    this.state.players.delete(client.sessionId);
    this.runtimes.delete(client.sessionId);
    this.clearPlayerFromMonsters(client.sessionId);
    this.leavePartyInternal(runtime.characterId);
    this.releaseOwnershipFor(runtime.characterId);
    // The move is intentional; do not let the target join "kick" this session.
    services.sessionRegistry.unregister(runtime.accountId, client.sessionId);
    this.unregisterAdminSession(client.sessionId);

    try {
      const token = issueWarpToken(destination.mapId, destination.x, destination.y, {
        accountId: runtime.accountId,
        characterId: runtime.characterId,
        tokenVersion: runtime.tokenVersion,
      });
      const reservation = await this.reserveSeat(destination.mapId, {
        characterId: runtime.characterId,
        map: destination.mapId,
        warpToken: token,
      });
      if (!this.clients.some((candidate) => candidate.sessionId === client.sessionId)) {
        // Client left before receiving the reservation; undo the destination
        // write so the next login does not spawn on a map it never reached.
        void this.enqueueSave(runtime, source);
        return false;
      }
      const payload: WarpPayload = {
        map: destination.mapId,
        x: destination.x,
        y: destination.y,
        reservation,
      };
      client.send(MSG.warp, payload);

      // A client that ignores the warp message must not keep occupying a seat
      // here (and holding a target-room reservation) forever.
      const leaveTimer = setTimeout(() => {
        if (this.clients.some((candidate) => candidate.sessionId === client.sessionId)) {
          logger.warn(
            { roomId: this.roomId, session: client.sessionId },
            "client did not leave after warp; disconnecting",
          );
          void this.enqueueSave(runtime, source);
          client.leave(4000);
        }
      }, WARP_CLIENT_LEAVE_TIMEOUT_MS);
      leaveTimer.unref?.();

      logger.info(
        {
          roomId: this.roomId,
          session: client.sessionId,
          from: this.mapId,
          to: destination.mapId,
        },
        "player warped",
      );
      return true;
    } catch (error) {
      // Restore the player only if the client is still connected here.
      if (this.clients.some((candidate) => candidate.sessionId === client.sessionId)) {
        runtime.warping = false;
        runtime.inventoryClosed = false;
        // Do not retry every tick while the warp zone still overlaps: without
        // this cooldown a persistent matchmaker failure would issue a token
        // and run a full reservation attempt 20 times per second.
        runtime.warpCooldownUntilMs = Date.now() + WARP_COOLDOWN_MS;
        this.state.players.set(client.sessionId, player);
        this.runtimes.set(client.sessionId, runtime);
        // The destination write succeeded; put the source position back.
        runtime.dirty = true;
        void this.enqueueSave(runtime, source);
        const accepted = await services.sessionRegistry.register({
          accountId: runtime.accountId,
          characterId: runtime.characterId,
          sessionId: client.sessionId,
          tokenVersion: runtime.tokenVersion,
          saveForKick: () => this.savePlayerNow(client.sessionId),
          send: (type, payload) => client.send(type, payload),
          leave: (code) => client.leave(code),
        });
        if (!accepted) {
          this.state.players.delete(client.sessionId);
          this.runtimes.delete(client.sessionId);
        } else {
          this.registerAdminSession(client.sessionId);
        }
        this.updateInterest();
      }
      logger.error({ roomId: this.roomId, session: client.sessionId, error }, "warp failed");
      return false;
    }
  }

  /**
   * Overridable seam so tests can exercise matchmaker failures without
   * replacing the ESM namespace (which is not configurable).
   */
  reserveSeat(
    map: MapId,
    options: { characterId: string; map: MapId; warpToken: string },
  ): ReturnType<typeof matchMaker.joinOrCreate> {
    return matchMaker.joinOrCreate(map, options, {
      headers: new Headers(),
      ip: "in-process",
    });
  }

  private playerSpeed(runtime: PlayerRuntime): number {
    return WALK_SPEED * (1 + equipmentBonusValue(runtime.inventory, "move_speed"));
  }

  private stepPlayer(
    runtime: PlayerRuntime,
    player: PlayerState,
    sessionId: string,
    now: number,
  ): void {
    const from = { x: runtime.mover.pos.x, y: runtime.mover.pos.y };
    let applied = false;

    // Apply at most ONE intent per tick. Bursty clients therefore cannot move
    // faster than 20 steps/s; excess inputs stay queued for later ticks.
    while (runtime.pending.length > 0) {
      const message = runtime.pending.shift()!;
      if (message.seq <= runtime.lastSeq) {
        continue; // stale or duplicated input
      }
      runtime.lastSeq = message.seq;
      this.applyMessage(runtime, sessionId, message);
      applied = true;
      break;
    }

    if (!applied) {
      if (runtime.targetMonsterId) {
        this.autoWalkStep(runtime, sessionId, now);
      } else if (runtime.lastIntent.kind === "path" && runtime.mover.path.length > 0) {
        // Click-to-move keeps following its path (speed-bounded by movement).
        runtime.mover = stepMover(runtime.mover, runtime.lastIntent, this.assets.grid, TICK_MS, this.playerSpeed(runtime));
      } else if (runtime.lastIntent.kind === "dir" && runtime.graceTicksRemaining > 0) {
        // Packet loss must not stop the character mid-step: keep the last
        // direction for a few ticks. An explicit `none` clears the grace and
        // stops immediately.
        runtime.graceTicksRemaining--;
        runtime.mover = stepMover(runtime.mover, runtime.lastIntent, this.assets.grid, TICK_MS, this.playerSpeed(runtime));
      } else {
        runtime.mover = stepMover(runtime.mover, { kind: "none" }, this.assets.grid, TICK_MS, this.playerSpeed(runtime));
      }
    }

    const to = runtime.mover.pos;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const moved = dx !== 0 || dy !== 0;

    if (moved) {
      if (runtime.pendingCast) {
        this.cancelPendingCast(runtime, sessionId, "moved");
      }
      runtime.dirty = true;
      player.x = to.x;
      player.y = to.y;
      player.facing = facing4Index(facing4FromDelta(dx, dy, facing4FromIndex(player.facing)));
      player.moving = true;
    } else if (player.moving) {
      player.moving = false;
    }
    if (player.lastSeq !== runtime.lastSeq) {
      player.lastSeq = runtime.lastSeq;
    }
  }

  /** Convert a validated intent into mover state and step it once. */
  private applyMessage(runtime: PlayerRuntime, sessionId: string, message: InputMessage): void {
    // Any deliberate movement cancels click-to-attack.
    if (runtime.targetMonsterId) {
      this.clearAutoWalk(runtime, sessionId, "cancelled");
    }
    switch (message.kind) {
      case "dir":
        runtime.mover.path = [];
        runtime.graceTicksRemaining = SERVER_TICK_GRACE_TICKS;
        runtime.lastIntent = { kind: "dir", dir: message.dir as Dir8 };
        break;
      case "path": {
        // Recompute from the current position every tick: with the same
        // target and grid the client predictor reproduces this exactly during
        // reconciliation, regardless of which input got acknowledged.
        runtime.graceTicksRemaining = 0;
        const target = { x: message.x, y: message.y };
        this.applyPathIntent(runtime, target);
        runtime.lastIntent = { kind: "path" };
        break;
      }
      case "none":
        runtime.mover.path = [];
        runtime.graceTicksRemaining = 0;
        runtime.lastIntent = { kind: "none" };
        break;
    }
    runtime.mover = stepMover(runtime.mover, runtime.lastIntent, this.assets.grid, TICK_MS, this.playerSpeed(runtime));
  }

  private attackRangeFor(player: PlayerState): number {
    const classId = isClassId(player.classId) ? player.classId : "warrior";
    return getClass(classId).attack.rangePx;
  }

  /** Click-to-attack: accept a live monster and switch the client to server-driven walking. */
  private setAutoWalkTarget(client: Client, monsterId: string): void {
    const runtime = this.runtimes.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    const monsterRuntime = this.monsterRuntimes.get(monsterId);
    const monster = this.state.monsters.get(monsterId);
    if (!runtime || !player || runtime.dead || runtime.warping) {
      return;
    }
    if (!monsterRuntime || !monster || monsterRuntime.hp <= 0 || monsterRuntime.ai === "return") {
      this.notifyTargetCleared(client, "target_lost");
      return;
    }
    const dx = monsterRuntime.mover.pos.x - runtime.mover.pos.x;
    const dy = monsterRuntime.mover.pos.y - runtime.mover.pos.y;
    if (dx * dx + dy * dy > AUTO_WALK_TARGET_RANGE_PX * AUTO_WALK_TARGET_RANGE_PX) {
      this.notifyTargetCleared(client, "target_lost");
      return;
    }

    const now = Date.now();
    runtime.targetMonsterId = monsterId;
    runtime.nextChaseRepathAtMs = now;
    runtime.bestTargetDistSq = Number.POSITIVE_INFINITY;
    runtime.noProgressSinceMs = now;
    runtime.emptyChasePaths = 0;
    runtime.mover.path = [];
    runtime.graceTicksRemaining = 0;
    runtime.lastIntent = { kind: "none" };
    this.safeSend(client, MSG.autoWalk, { active: true, targetMonsterId: monsterId });
  }

  /** One server-driven step toward (or attack on) the auto-walk target. */
  private autoWalkStep(runtime: PlayerRuntime, sessionId: string, now: number): void {
    const monsterId = runtime.targetMonsterId;
    if (!monsterId) {
      return;
    }
    const monsterRuntime = this.monsterRuntimes.get(monsterId);
    const monster = this.state.monsters.get(monsterId);
    const player = this.state.players.get(sessionId);
    if (!monsterRuntime || !monster || monsterRuntime.hp <= 0 || !player) {
      this.clearAutoWalk(runtime, sessionId, "target_lost");
      return;
    }

    const dx = monsterRuntime.mover.pos.x - runtime.mover.pos.x;
    const dy = monsterRuntime.mover.pos.y - runtime.mover.pos.y;
    const distanceSquared = dx * dx + dy * dy;
    const range = this.attackRangeFor(player);
    if (distanceSquared <= range * range) {
      // Standing still while attacking is progress, not a stuck chase.
      runtime.bestTargetDistSq = distanceSquared;
      runtime.noProgressSinceMs = now;
      runtime.mover.path = [];
      runtime.lastIntent = { kind: "none" };
      runtime.mover = stepMover(runtime.mover, { kind: "none" }, this.assets.grid, TICK_MS, this.playerSpeed(runtime));
      if (now >= runtime.attackReadyAtMs) {
        runtime.pendingAttack = { dir: dir8Towards(runtime.mover.pos, monsterRuntime.mover.pos) };
      }
      return;
    }

    if (distanceSquared < runtime.bestTargetDistSq) {
      runtime.bestTargetDistSq = distanceSquared;
      runtime.noProgressSinceMs = now;
    } else if (now - runtime.noProgressSinceMs > AUTO_WALK_GIVE_UP_MS) {
      this.clearAutoWalk(runtime, sessionId, "unreachable");
      return;
    }

    if (now >= runtime.nextChaseRepathAtMs || runtime.mover.path.length === 0) {
      runtime.nextChaseRepathAtMs = now + 250;
      const path = findPath(this.assets.grid, runtime.mover.pos, monsterRuntime.mover.pos);
      runtime.mover.path = path;
      if (path.length === 0) {
        runtime.emptyChasePaths++;
        if (runtime.emptyChasePaths >= AUTO_WALK_MAX_EMPTY_PATHS) {
          this.clearAutoWalk(runtime, sessionId, "unreachable");
          return;
        }
      } else {
        runtime.emptyChasePaths = 0;
      }
    }

    runtime.graceTicksRemaining = 0;
    runtime.lastIntent = { kind: "path" };
    runtime.mover = stepMover(runtime.mover, { kind: "path" }, this.assets.grid, TICK_MS, this.playerSpeed(runtime));
  }

  private clearAutoWalk(
    runtime: PlayerRuntime,
    sessionId: string,
    reason: TargetClearedReason,
  ): void {
    if (!runtime.targetMonsterId) {
      return;
    }
    runtime.targetMonsterId = null;
    runtime.mover.path = [];
    runtime.nextChaseRepathAtMs = 0;
    runtime.bestTargetDistSq = Number.POSITIVE_INFINITY;
    runtime.noProgressSinceMs = 0;
    runtime.emptyChasePaths = 0;
    const client = this.clients.find((candidate) => candidate.sessionId === sessionId);
    if (!client) {
      return;
    }
    this.notifyTargetCleared(client, reason);
  }

  private notifyTargetCleared(client: Client, reason: TargetClearedReason): void {
    this.safeSend(client, MSG.autoWalk, { active: false });
    this.safeSend(client, MSG.targetCleared, { reason });
  }

  /**
   * A* is bounded against hostile clients. A repeated unreachable goal is not
   * retried for a second, and a client that changes goal more than
   * PATH_RETARGET_MIN_MS apart keeps following its previous path. Legitimate
   * click-to-move repeats the same goal, so it still recomputes every tick and
   * stays bit-identical with the client predictor.
   */
  private applyPathIntent(runtime: PlayerRuntime, target: Vec2): void {
    const now = Date.now();
    const goalTx = Math.floor(target.x / TILE_SIZE);
    const goalTy = Math.floor(target.y / TILE_SIZE);
    const startTx = Math.floor(runtime.mover.pos.x / TILE_SIZE);
    const startTy = Math.floor(runtime.mover.pos.y / TILE_SIZE);
    const goalKey = `${goalTx},${goalTy}`;
    const failureKey = `${startTx},${startTy}->${goalKey}`;

    const failedUntil = runtime.failedPathUntilMs.get(failureKey);
    if (failedUntil !== undefined) {
      if (failedUntil > now) {
        return; // known unreachable; keep following the current path
      }
      runtime.failedPathUntilMs.delete(failureKey);
    }

    const retargeting = runtime.lastPathTargetKey !== goalKey;
    if (retargeting && now - runtime.lastPathRetargetAtMs < PATH_RETARGET_MIN_MS) {
      return; // retarget flood; keep the previous path
    }

    runtime.lastPathTargetKey = goalKey;
    runtime.lastPathRetargetAtMs = now;
    runtime.pathComputations++;
    const path = findPath(this.assets.grid, runtime.mover.pos, target);
    runtime.mover.path = path;

    const sameTile = startTx === goalTx && startTy === goalTy;
    if (path.length === 0 && !sameTile) {
      runtime.failedPathUntilMs.set(failureKey, now + PATH_FAILURE_CACHE_MS);
    }
    if (runtime.failedPathUntilMs.size > 32) {
      for (const [key, until] of runtime.failedPathUntilMs) {
        if (until <= now) {
          runtime.failedPathUntilMs.delete(key);
        }
      }
    }
  }

  /** Saved/reservation position when walkable, otherwise the map spawn. */
  private resolveSpawn(x: number | undefined, y: number | undefined): Vec2 {
    const requested = {
      x: Math.min(Math.max(x ?? this.assets.spawn.x, 0), this.assets.widthPx),
      y: Math.min(Math.max(y ?? this.assets.spawn.y, 0), this.assets.heightPx),
    };
    if (isWalkableAt(this.assets.grid, requested.x, requested.y)) {
      return requested;
    }
    return this.assets.spawn;
  }
}

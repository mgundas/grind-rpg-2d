import { Client, type Room } from "@colyseus/sdk";
import {
  MSG,
  SESSION_KICK_CODE,
  type AutoWalkPayload,
  type DeathPayload,
  type AnnouncementPayload,
  type BonusScrollAppliedPayload,
  type BossTimerPayload,
  type FriendErrorPayload,
  type FriendsStatePayload,
  type GuildErrorPayload,
  type GuildInvitePayload,
  type GuildStatePayload,
  type BuffView,
  type CastSkillMessage,
  type InputMessage,
  type InventoryErrorPayload,
  type InventorySnapshotPayload,
  type MapId,
  type MonsterDiedPayload,
  type ChannelId,
  type ChannelSwitchErrorPayload,
  type NpcDialogPayload,
  type TeleportErrorPayload,
  type PartyErrorPayload,
  type PartyInvitePayload,
  type PartyStatePayload,
  type PlayerTargetPayload,
  type RespawnOption,
  type SelfStatsPayload,
  type SessionKickedPayload,
  type SkillBookResultPayload,
  type SkillCastStartPayload,
  type SkillErrorPayload,
  type SkillStatePayload,
  type StatKey,
  type UpgradePreview,
  type UpgradeResultPayload,
  type TradeErrorPayload,
  type TradeInvitePayload,
  type TradeStatePayload,
  type WarpPayload,
  type WarehouseSnapshotPayload,
} from "@jadethrone/shared";
import { refreshClientCatalog } from "../data/catalog";
import { audio } from "../audio/service";
import { useUiStore } from "../ui/store";
import { ApiError, api } from "./api";
import { tokens } from "./tokens";

/**
 * Colyseus session lifecycle for the client. One room at a time; scenes read
 * the room through `getRoom()` and register state/message handlers.
 *
 * The access token is attached with `client.auth.token`, which the SDK forwards
 * as `Authorization: Bearer` on matchmaking and `_authToken` on the WebSocket.
 */

let sdk: Client | null = null;
let room: Room | null = null;
let connectPromise: Promise<Room> | null = null;

function serverUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL;
  if (configured) {
    return configured;
  }
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.hostname}:2567`;
}

export function getClient(): Client {
  sdk ??= new Client(serverUrl());
  return sdk;
}

export function getRoom(): Room | null {
  return room;
}

export function getSessionId(): string | null {
  return room?.sessionId ?? null;
}

export interface ConnectOptions {
  characterId: string;
  map: MapId;
  channel: ChannelId;
}

async function attemptJoin(
  client: Client,
  characterId: string,
  map: MapId,
  channel: ChannelId,
): Promise<Room> {
  const access = tokens.getAccess();
  if (access) {
    client.auth.token = access;
  }
  return client.joinOrCreate(map, { characterId, map, channel });
}

/** Join the character's saved map; one refresh/character-list retry on failure. */
export async function connect(options: ConnectOptions): Promise<Room> {
  if (connectPromise) {
    return connectPromise;
  }
  if (room) {
    // A previous failed attempt may have left a socket; never join a second
    // room on top of it (the server would kick the old session later anyway).
    await leave({ silent: true });
  }
  const ui = useUiStore.getState();
  ui.setConnectionPhase("connecting");
  ui.setConnectionError(null);
  ui.setChatFocused(false);
  ui.setMapId(options.map);
  ui.setChannel(options.channel);

  connectPromise = (async () => {
    try {
      const client = getClient();
      let joined: Room;
      try {
        joined = await attemptJoin(client, options.characterId, options.map, options.channel);
      } catch (firstError) {
        // The access token may have expired, or the character may have changed
        // maps in another tab. `/me` refreshes the token and reloads characters.
        const me = await api.me();
        useUiStore.getState().setCharacters(me.characters);
        const character = me.characters.find((candidate) => candidate.id === options.characterId);
        if (!character) {
          throw firstError;
        }
        useUiStore.getState().setMapId(character.map);
        useUiStore.getState().setChannel(character.channel);
        joined = await attemptJoin(client, character.id, character.map, character.channel);
      }

      room = joined;
      bindSessionEvents(joined);
      void refreshClientCatalog().catch(() => {
        // Base definitions stay usable if the catalog endpoint is unavailable.
      });
      const store = useUiStore.getState();
      store.setSessionKicked(null);
      store.setSessionId(joined.sessionId);
      store.setConnectionPhase("connected");
      return joined;
    } catch (error) {
      const store = useUiStore.getState();
      if (error instanceof ApiError && (error.code === "unauthorized" || error.status === 401)) {
        tokens.clear();
        store.setAnonymous("Session expired. Sign in again.");
      } else {
        store.setConnectionPhase("error");
        store.setConnectionError(String(error));
      }
      throw error;
    } finally {
      connectPromise = null;
    }
  })();

  return connectPromise;
}

/** Consume a warp reservation and make the new room current. */
export async function consumeWarp(payload: WarpPayload): Promise<Room> {
  const next = await getClient().consumeSeatReservation(payload.reservation);
  room = next;
  bindSessionEvents(next);
  const store = useUiStore.getState();
  store.setSessionKicked(null);
  store.setSessionId(next.sessionId);
  store.setMapId(payload.map);
  store.setChannel(payload.channel);
  store.setChannelSwitchError(null);
  store.bumpWorldEpoch();
  store.setParty(null);
  store.setPartyInvite(null);
  store.setBuffState({ buffs: [] });
  store.setCastState(null);
  store.setSkillState(null);
  store.setTargetStone(null);
  store.setConnectionPhase("connected");
  return next;
}

export async function leave(options: { silent?: boolean } = {}): Promise<void> {
  const current = room;
  room = null;
  const leaving = useUiStore.getState();
  leaving.setChatFocused(false);
  leaving.setAutoWalk(false);
  leaving.setTargetMonster(null);
  leaving.setTargetStone(null);
  leaving.setDeath(false, 0);
  leaving.setParty(null);
  leaving.setPartyInvite(null);
  leaving.setBuffState({ buffs: [] });
  leaving.setCastState(null);
  leaving.setSkillState(null);
  leaving.setInventory(null);
  leaving.setInventoryOpen(false);
  leaving.setInventoryError(null);
  leaving.setNpcDialog(null);
  leaving.setShopId(null);
  leaving.setAnnouncement(null);
  leaving.setWarehouse(null);
  leaving.setWarehouseOpen(false);
  leaving.setBlacksmithOpen(false);
  leaving.setBlacksmithPreview(null);
  leaving.setBlacksmithResult(null);
  leaving.setBlacksmithError(null);
  leaving.cancelScrollTarget();
  leaving.setBonusScrollResult(null);
  leaving.tradeDispatch({ type: "close" });
  leaving.chatDispatch({ type: "reset" });
  leaving.setPlayerContext(null);
  leaving.setFriendError(null);
  leaving.setFriends({ friends: [] });
  leaving.setFriendsOpen(false);
  leaving.setGuild({ guild: null });
  leaving.setGuildInvite(null);
  leaving.setGuildError(null);
  leaving.setGuildOpen(false);
  leaving.cancelSkillBook();
  leaving.setSkillBookResult(null);
  if (!current) {
    return;
  }
  await current.leave();
  if (!options.silent) {
    useUiStore.getState().setConnectionPhase("left");
  }
}

/** Leave (saving the position), revoke the refresh token, return to login. */
export async function logout(): Promise<void> {
  try {
    await leave({ silent: true });
  } catch {
    // The socket may already be gone; local cleanup still proceeds.
  }
  try {
    await api.logout();
  } catch {
    // The local session is cleared regardless of network/server errors.
  }
  const store = useUiStore.getState();
  store.setSessionKicked(null);
  store.setAnonymous();
}

export function sendInput(message: InputMessage): void {
  room?.send(MSG.input, message);
}

export function sendChat(text: string): void {
  room?.send(MSG.chat, { text });
}

export function sendFriendAdd(target: { characterId?: string; name?: string }): void {
  room?.send(MSG.friendAdd, target);
}

export function sendFriendRemove(characterId: string): void {
  room?.send(MSG.friendRemove, { characterId });
}

export function sendGuildCreate(name: string): void {
  room?.send(MSG.guildCreate, { name });
}

export function sendGuildInvite(target: { characterId?: string; name?: string }): void {
  room?.send(MSG.guildInvite, target);
}

export function sendGuildRespond(inviteId: string, accept: boolean): void {
  room?.send(MSG.guildRespond, { inviteId, accept });
}

export function sendGuildLeave(): void {
  room?.send(MSG.guildLeave, {});
}

export function sendGuildKick(characterId: string): void {
  room?.send(MSG.guildKick, { characterId });
}

export function sendGuildSetRank(characterId: string, rank: "officer" | "member"): void {
  room?.send(MSG.guildSetRank, { characterId, rank });
}

export function sendGuildDisband(): void {
  room?.send(MSG.guildDisband, {});
}

export function sendReadSkillBook(bookInstanceId: string, skillId: string): void {
  room?.send(MSG.readSkillBook, { bookInstanceId, skillId });
}

export function sendSetPvpMode(mode: "peaceful" | "kingdom" | "free"): void {
  room?.send(MSG.setPvpMode, { mode });
}

export function sendSetPlayerTarget(characterId: string | null): void {
  room?.send(MSG.setPlayerTarget, { characterId });
}

export function sendAttack(dir?: number): void {
  room?.send(MSG.attack, dir === undefined ? {} : { dir });
}

export function sendSetTarget(monsterId: string): void {
  room?.send(MSG.setTarget, { monsterId });
}

export function sendRespawn(option: RespawnOption): void {
  room?.send(MSG.respawn, { option });
}

export function sendAllocStat(stat: StatKey): void {
  room?.send(MSG.allocStat, { stat });
}

export function sendCastSkill(request: CastSkillMessage): void {
  room?.send(MSG.castSkill, request);
}

export function sendChooseDoctrine(doctrineId: string): void {
  room?.send(MSG.chooseDoctrine, { doctrineId });
}

export function sendUpgradeSkill(skillId: string): void {
  room?.send(MSG.upgradeSkill, { skillId });
}

export function sendPartyInvite(target: { characterId?: string; name?: string }): void {
  room?.send(MSG.partyInvite, target);
}

export function sendPartyRespond(inviteId: string, accept: boolean): void {
  room?.send(MSG.partyRespond, { inviteId, accept });
  if (!accept) {
    useUiStore.getState().setPartyInvite(null);
  }
}

export function sendPartyLeave(): void {
  room?.send(MSG.partyLeave, {});
  useUiStore.getState().setParty(null);
  useUiStore.getState().setPartyInvite(null);
}

export function sendPartySetLoot(rule: "free_for_all" | "round_robin"): void {
  room?.send(MSG.partySetLoot, { rule });
}

export function requestStats(): void {
  room?.send(MSG.requestStats, {});
}

export function requestInventory(): void {
  room?.send(MSG.requestInventory, {});
}

export function sendMoveItem(instanceId: string, toSlot: number): void {
  room?.send(MSG.moveItem, { instanceId, toSlot });
}

export function sendSplitStack(instanceId: string, quantity: number, toSlot?: number | null): void {
  room?.send(MSG.splitStack, { instanceId, quantity, toSlot: toSlot ?? null });
}

export function sendEquipItem(instanceId: string): void {
  room?.send(MSG.equipItem, { instanceId });
}

export function sendUnequipItem(slot: number): void {
  room?.send(MSG.unequipItem, { slot });
}

export function sendUseItem(instanceId: string): void {
  room?.send(MSG.useItem, { instanceId });
}

export function sendPickup(dropId: string): void {
  room?.send(MSG.pickup, { dropId });
}

export function sendInteractNpc(npcId: string): void {
  room?.send(MSG.interactNpc, { npcId });
}

export function sendChannelSwitch(channel: ChannelId): void {
  room?.send(MSG.channelSwitch, { channel });
}

export function sendTeleport(npcId: string, targetMap: string): void {
  room?.send(MSG.teleportRequest, { npcId, targetMap });
}

export function sendShopBuy(shopId: string, itemId: string, quantity = 1): void {
  room?.send(MSG.shopBuy, { shopId, itemId, quantity });
}

export function sendShopSell(instanceId: string, quantity = 1): void {
  room?.send(MSG.shopSell, { instanceId, quantity });
}

export function sendWarehouseOpen(npcId: string): void {
  room?.send(MSG.warehouseOpen, { npcId });
}

export function sendWarehouseDeposit(instanceId: string): void {
  room?.send(MSG.warehouseDeposit, { instanceId });
}

export function sendWarehouseWithdraw(instanceId: string, toSlot?: number | null): void {
  room?.send(MSG.warehouseWithdraw, { instanceId, toSlot: toSlot ?? null });
}

/** Ask the server for upgrade odds, costs and material ownership. */
export function sendRequestUpgradePreview(instanceId: string): void {
  room?.send(MSG.requestUpgradePreview, { instanceId });
}

/** Ask the blacksmith to roll one upgrade. */
export function sendUpgradeItem(instanceId: string, useBlessing: boolean): void {
  room?.send(MSG.upgradeItem, { instanceId, useBlessing });
}

/** Apply an enchant or reinforce scroll to an equipment item. */
export function sendApplyBonusScroll(scrollInstanceId: string, itemInstanceId: string): void {
  room?.send(MSG.applyBonusScroll, { scrollInstanceId, itemInstanceId });
}

export function sendTradeInvite(characterId: string): void {
  room?.send(MSG.tradeInvite, { characterId });
}

export function sendTradeRespond(tradeId: string, accept: boolean): void {
  room?.send(MSG.tradeRespond, { tradeId, accept });
}

export function sendTradeOffer(
  tradeId: string,
  revision: number,
  instanceIds: string[],
  gold: number,
): void {
  room?.send(MSG.tradeOffer, { tradeId, revision, instanceIds, gold });
}

export function sendTradeLock(tradeId: string, revision: number, locked: boolean): void {
  room?.send(MSG.tradeLock, { tradeId, revision, locked });
}

export function sendTradeAccept(tradeId: string, revision: number): void {
  room?.send(MSG.tradeAccept, { tradeId, revision });
}

export function sendTradeCancel(tradeId: string): void {
  room?.send(MSG.tradeCancel, { tradeId });
}

function bindSessionEvents(current: Room): void {
  current.onError((code, message) => {
    if (room !== current) {
      return;
    }
    const store = useUiStore.getState();
    store.setChatFocused(false);
    store.setConnectionPhase("error");
    store.setConnectionError(message ?? `connection error ${code}`);
  });

  current.onMessage(MSG.sessionKicked, (payload: SessionKickedPayload) => {
    const store = useUiStore.getState();
    store.setSessionKicked(payload.reason);
    if (payload.reason !== "duplicate" && payload.reason !== "admin") {
      // Login/logout/ban bumped the token version; these tokens are dead.
      tokens.clear();
    }
    store.setConnectionPhase("left");
  });

  current.onMessage(MSG.selfStats, (payload: SelfStatsPayload) => {
    const store = useUiStore.getState();
    store.setSelfStats(payload);
    if (payload.hp > 0) {
      store.setDeath(false, 0);
    }
  });

  current.onMessage(MSG.death, (payload: DeathPayload) => {
    audio.playSfx("sfx.death");
    const store = useUiStore.getState();
    store.setDeath(true, payload.respawnHereAtMs);
    store.setAutoWalk(false);
    store.setTargetMonster(null);
  });

  current.onMessage(MSG.autoWalk, (payload: AutoWalkPayload) => {
    const store = useUiStore.getState();
    store.setAutoWalk(payload.active);
    if (!payload.active) {
      store.setTargetMonster(null);
    }
  });

  current.onMessage(MSG.targetCleared, () => {
    useUiStore.getState().setTargetMonster(null);
  });

  current.onMessage(MSG.playerTarget, (payload: PlayerTargetPayload) => {
    useUiStore.getState().setTargetPlayer(payload.characterId);
  });

  current.onMessage(MSG.monsterDied, (payload: MonsterDiedPayload) => {
    const store = useUiStore.getState();
    if (store.targetMonsterId === payload.monsterId) {
      store.setTargetMonster(null);
    }
  });

  current.onMessage(MSG.inventory, (payload: InventorySnapshotPayload) => {
    useUiStore.getState().setInventory(payload);
  });

  current.onMessage(MSG.inventoryError, (payload: InventoryErrorPayload) => {
    useUiStore.getState().setInventoryError(payload);
  });

  current.onMessage(MSG.npcDialog, (payload: NpcDialogPayload) => {
    useUiStore.getState().setNpcDialog(payload);
  });

  current.onMessage(MSG.teleportError, (payload: TeleportErrorPayload) => {
    useUiStore.getState().setTeleportError(payload);
  });

  current.onMessage(MSG.channelSwitchError, (payload: ChannelSwitchErrorPayload) => {
    useUiStore.getState().setChannelSwitchError(payload);
  });

  current.onMessage(MSG.warehouse, (payload: WarehouseSnapshotPayload) => {
    useUiStore.getState().setWarehouse(payload);
  });

  current.onMessage(MSG.upgradePreview, (payload: UpgradePreview) => {
    useUiStore.getState().setBlacksmithPreview(payload);
  });

  current.onMessage(MSG.upgradeResult, (payload: UpgradeResultPayload) => {
    useUiStore.getState().setBlacksmithResult(payload);
  });

  current.onMessage(MSG.blacksmithError, (payload: { code: string; message?: string }) => {
    useUiStore.getState().setBlacksmithError(payload);
  });

  current.onMessage(MSG.bonusScrollApplied, (payload: BonusScrollAppliedPayload) => {
    const store = useUiStore.getState();
    store.setBonusScrollResult(payload);
    store.cancelScrollTarget();
  });

  current.onMessage(MSG.tradeInvite, (payload: TradeInvitePayload) => {
    useUiStore.getState().tradeDispatch({ type: "invite", invite: payload });
  });

  current.onMessage(MSG.tradeState, (payload: TradeStatePayload) => {
    useUiStore.getState().tradeDispatch({ type: "state", state: payload });
  });

  current.onMessage(MSG.tradeError, (payload: TradeErrorPayload) => {
    useUiStore.getState().tradeDispatch({ type: "error", error: payload });
  });

  current.onMessage(MSG.friendError, (payload: FriendErrorPayload) => {
    useUiStore.getState().setFriendError(payload);
  });

  current.onMessage(MSG.friendsState, (payload: FriendsStatePayload) => {
    useUiStore.getState().setFriends(payload);
  });

  current.onMessage(MSG.guildError, (payload: GuildErrorPayload) => {
    useUiStore.getState().setGuildError(payload);
  });

  current.onMessage(MSG.guildState, (payload: GuildStatePayload) => {
    useUiStore.getState().setGuild(payload);
  });

  current.onMessage(MSG.guildInvite, (payload: GuildInvitePayload) => {
    useUiStore.getState().setGuildInvite(payload);
  });

  current.onMessage(MSG.announcement, (payload: AnnouncementPayload) => {
    useUiStore.getState().setAnnouncement(payload);
  });

  current.onMessage(MSG.bossTimer, (payload: BossTimerPayload) => {
    useUiStore.getState().setBossTimer(payload);
  });

  current.onMessage(MSG.skillState, (payload: SkillStatePayload) => {
    useUiStore.getState().setSkillState(payload);
  });

  current.onMessage(MSG.skillBookResult, (payload: SkillBookResultPayload) => {
    const store = useUiStore.getState();
    store.setSkillBookResult(payload);
    if (payload.ok) {
      store.cancelSkillBook();
    }
  });

  current.onMessage(MSG.skillCastStart, (payload: SkillCastStartPayload) => {
    useUiStore.getState().setCastState(payload);
  });

  current.onMessage(MSG.skillCast, () => {
    useUiStore.getState().setCastState(null);
  });

  current.onMessage(MSG.skillCastCancel, () => {
    useUiStore.getState().setCastState(null);
  });

  current.onMessage(MSG.buffState, (payload: { buffs: BuffView[] }) => {
    useUiStore.getState().setBuffState(payload);
  });

  current.onMessage(MSG.partyState, (payload: PartyStatePayload) => {
    useUiStore.getState().setParty(payload);
  });

  current.onMessage(MSG.partyInvite, (payload: PartyInvitePayload) => {
    useUiStore.getState().setPartyInvite(payload);
  });

  current.onMessage(MSG.partyError, (payload: PartyErrorPayload) => {
    useUiStore.getState().chatDispatch({
      type: "push",
      message: {
        from: "system",
        name: "Party",
        kingdom: "system",
        channel: "system",
        text: payload.message,
        sentAt: Date.now(),
      },
    });
  });

  current.onMessage(MSG.skillError, (payload: SkillErrorPayload) => {
    useUiStore.getState().chatDispatch({
      type: "push",
      message: {
        from: "system",
        name: "System",
        kingdom: "system",
        channel: "system",
        text: payload.message,
        sentAt: Date.now(),
      },
    });
  });

  // The join-time snapshot can arrive before the SDK listener is bound.
  current.send(MSG.requestStats, {});
  current.send(MSG.requestInventory, {});
  current.send(MSG.requestSkillState, {});
  current.send(MSG.requestBossTimer, {});

  current.onLeave((code) => {
    if (room === current) {
      room = null;
      const store = useUiStore.getState();
      store.setChatFocused(false);
      store.setAutoWalk(false);
      store.setTargetMonster(null);
      store.setConnectionPhase("left");
      // The message can be lost; the close code is the fallback. Keep tokens
      // (a duplicate join here is not a credential problem).
      if (code === SESSION_KICK_CODE && !useUiStore.getState().sessionKickedReason) {
        useUiStore.getState().setSessionKicked("duplicate");
      }
    }
    if (pingRoom === current) {
      stopPingLoop();
    }
  });

  startPingLoop(current);
}

let pingTimer: ReturnType<typeof setInterval> | null = null;
let pingRoom: Room | null = null;
let pingMs = 0;

function startPingLoop(current: Room): void {
  stopPingLoop();
  pingRoom = current;
  pingMs = 0;
  const measure = () => {
    current.ping((ms) => {
      pingMs = pingMs === 0 ? ms : pingMs * 0.7 + ms * 0.3;
    });
  };
  measure();
  pingTimer = setInterval(measure, 2000);
}

function stopPingLoop(): void {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  pingRoom = null;
}

/** Smoothed round-trip time in ms for the F3 overlay (0 until first pong). */
export function getPingMs(): number {
  return Math.round(pingMs);
}

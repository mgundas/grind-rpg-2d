import { randomUUID } from "node:crypto";
import {
  MAX_GOLD,
  TRADE_MAX_OFFER_ITEMS,
  type TradeErrorCode,
  type TradeInvitePayload,
  type TradePhase,
} from "@jadethrone/shared";

export const TRADE_INVITE_TTL_MS = 30_000;
export const TRADE_IDLE_TTL_MS = 300_000;
export const TRADE_CLOSED_RETENTION_MS = 60_000;
export const TRADE_RANGE_PX = 1_500;

export class TradeRuleError extends Error {
  readonly code: TradeErrorCode;

  constructor(code: TradeErrorCode, message: string) {
    super(message);
    this.name = "TradeRuleError";
    this.code = code;
  }
}

export interface TradePeer {
  characterId: string;
  accountId: string;
  name: string;
}

export interface TradeOffer {
  instanceIds: string[];
  gold: number;
}

export interface TradeSide {
  characterId: string;
  accountId: string;
  name: string;
  offer: TradeOffer;
  /** A tradeOffer message arrived, even when the offer is empty (gifting). */
  offerSet: boolean;
  locked: boolean;
  accepted: boolean;
}

export type TradeCloseReason =
  | "swap_complete"
  | "declined"
  | "cancelled"
  | "left"
  | "warp"
  | "death"
  | "disconnect"
  | "timeout"
  | "inventory"
  | "error";

export interface TradeRecord {
  id: string;
  pairKey: string;
  revision: number;
  phase: TradePhase;
  /** Sorted by characterId so A/B is deterministic. */
  a: TradeSide;
  b: TradeSide;
  inviterCharacterId: string;
  invitedCharacterId: string | null;
  expiresAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
  closedAtMs: number | null;
  closeReason: TradeCloseReason | null;
}

export interface AcceptResult {
  trade: TradeRecord;
  readyToCommit: boolean;
}

export interface TradeRegistry {
  invite(from: TradePeer, target: TradePeer, now?: number): TradeRecord;
  acceptInvite(tradeId: string, characterId: string, now?: number): TradeRecord;
  declineInvite(tradeId: string, characterId: string, now?: number): TradeRecord;
  get(tradeId: string): TradeRecord | undefined;
  getByCharacter(characterId: string): TradeRecord | undefined;
  all(): TradeRecord[];
  side(trade: TradeRecord, characterId: string): TradeSide;
  other(trade: TradeRecord, characterId: string): TradeSide;
  setOffer(
    tradeId: string,
    characterId: string,
    revision: number,
    offer: TradeOffer,
    now?: number,
  ): TradeRecord;
  setLocked(
    tradeId: string,
    characterId: string,
    revision: number,
    locked: boolean,
    now?: number,
  ): TradeRecord;
  accept(tradeId: string, characterId: string, revision: number, now?: number): AcceptResult;
  complete(tradeId: string, now?: number): TradeRecord;
  cancel(tradeId: string, reason: TradeCloseReason, now?: number): TradeRecord;
  cancelForCharacter(
    characterId: string,
    reason: TradeCloseReason,
    now?: number,
  ): TradeRecord | null;
  prune(now?: number): { expiredInvites: TradeRecord[]; expiredTrades: TradeRecord[] };
  clear(): void;
}

export function sortedCharacterPairKey(one: string, two: string): string {
  return one < two ? `${one}:${two}` : `${two}:${one}`;
}

function sideForPeer(peer: TradePeer): TradeSide {
  return {
    characterId: peer.characterId,
    accountId: peer.accountId,
    name: peer.name,
    offer: { instanceIds: [], gold: 0 },
    offerSet: false,
    locked: false,
    accepted: false,
  };
}

function isActive(phase: TradePhase): boolean {
  return phase === "open" || phase === "locked";
}

function isTerminal(phase: TradePhase): boolean {
  return phase === "completed" || phase === "cancelled";
}

function sameOffer(one: TradeOffer, two: TradeOffer): boolean {
  if (one.gold !== two.gold || one.instanceIds.length !== two.instanceIds.length) {
    return false;
  }
  const left = [...one.instanceIds].sort();
  const right = [...two.instanceIds].sort();
  return left.every((id, index) => id === right[index]);
}

export function createTradeRegistry(options: {
  idFactory?: () => string;
  isOnline?: (characterId: string) => boolean;
} = {}): TradeRegistry {
  const idFactory = options.idFactory ?? randomUUID;
  const isOnline = options.isOnline ?? (() => true);
  const trades = new Map<string, TradeRecord>();
  const byCharacter = new Map<string, string>();
  const pairs = new Map<string, string>();

  function get(tradeId: string): TradeRecord | undefined {
    return trades.get(tradeId);
  }

  function requireTrade(tradeId: string): TradeRecord {
    const trade = trades.get(tradeId);
    if (!trade) {
      throw new TradeRuleError("not_found", "Trade not found.");
    }
    return trade;
  }

  function requireActive(trade: TradeRecord): TradeRecord {
    if (isTerminal(trade.phase)) {
      throw new TradeRuleError("cancelled", "This trade is no longer active.");
    }
    return trade;
  }

  function side(trade: TradeRecord, characterId: string): TradeSide {
    if (trade.a.characterId === characterId) {
      return trade.a;
    }
    if (trade.b.characterId === characterId) {
      return trade.b;
    }
    throw new TradeRuleError("not_found", "You are not part of this trade.");
  }

  function other(trade: TradeRecord, characterId: string): TradeSide {
    if (trade.a.characterId === characterId) {
      return trade.b;
    }
    if (trade.b.characterId === characterId) {
      return trade.a;
    }
    throw new TradeRuleError("not_found", "You are not part of this trade.");
  }

  function release(trade: TradeRecord): void {
    for (const characterId of [trade.a.characterId, trade.b.characterId]) {
      if (byCharacter.get(characterId) === trade.id) {
        byCharacter.delete(characterId);
      }
    }
    if (pairs.get(trade.pairKey) === trade.id) {
      pairs.delete(trade.pairKey);
    }
  }

  function close(
    trade: TradeRecord,
    phase: "completed" | "cancelled",
    reason: TradeCloseReason,
    now: number,
  ): TradeRecord {
    if (isTerminal(trade.phase)) {
      return trade;
    }
    trade.phase = phase;
    trade.closedAtMs = now;
    trade.updatedAtMs = now;
    trade.closeReason = reason;
    release(trade);
    return trade;
  }

  function cancel(tradeId: string, reason: TradeCloseReason, now = Date.now()): TradeRecord {
    return close(requireTrade(tradeId), "cancelled", reason, now);
  }

  function checkIdle(trade: TradeRecord, now: number): void {
    if (isActive(trade.phase) && now - trade.updatedAtMs >= TRADE_IDLE_TTL_MS) {
      close(trade, "cancelled", "timeout", now);
      throw new TradeRuleError("expired", "The trade timed out.");
    }
  }

  function checkRevision(trade: TradeRecord, revision: number): void {
    if (trade.revision !== revision) {
      throw new TradeRuleError("revision", "The trade changed; review the latest offer.");
    }
  }

  function invite(from: TradePeer, target: TradePeer, now = Date.now()): TradeRecord {
    if (from.characterId === target.characterId) {
      throw new TradeRuleError("self_trade", "You cannot trade with yourself.");
    }
    if (from.accountId === target.accountId) {
      throw new TradeRuleError("same_account", "Characters on one account cannot trade.");
    }
    if (!isOnline(target.characterId)) {
      throw new TradeRuleError("offline", "That player is not online.");
    }
    if (byCharacter.has(from.characterId) || byCharacter.has(target.characterId)) {
      throw new TradeRuleError("busy", "One of you is already trading.");
    }
    const pairKey = sortedCharacterPairKey(from.characterId, target.characterId);
    const existingId = pairs.get(pairKey);
    if (existingId) {
      const existing = trades.get(existingId);
      if (existing && isActive(existing.phase)) {
        throw new TradeRuleError("busy", "One of you is already trading.");
      }
      if (existing && existing.phase === "invited") {
        close(existing, "cancelled", "cancelled", now);
      }
    }

    // A character has at most one pending invite in each direction.
    for (const trade of trades.values()) {
      if (trade.phase !== "invited") {
        continue;
      }
      if (
        trade.inviterCharacterId === from.characterId ||
        trade.invitedCharacterId === from.characterId ||
        trade.inviterCharacterId === target.characterId ||
        trade.invitedCharacterId === target.characterId
      ) {
        close(trade, "cancelled", "cancelled", now);
      }
    }

    const sides = [sideForPeer(from), sideForPeer(target)].sort((one, two) =>
      one.characterId < two.characterId ? -1 : one.characterId > two.characterId ? 1 : 0,
    );
    const id = idFactory();
    const trade: TradeRecord = {
      id,
      pairKey,
      revision: 0,
      phase: "invited",
      a: sides[0]!,
      b: sides[1]!,
      inviterCharacterId: from.characterId,
      invitedCharacterId: target.characterId,
      expiresAtMs: now + TRADE_INVITE_TTL_MS,
      createdAtMs: now,
      updatedAtMs: now,
      closedAtMs: null,
      closeReason: null,
    };
    trades.set(id, trade);
    pairs.set(pairKey, id);
    return trade;
  }

  function acceptInvite(tradeId: string, characterId: string, now = Date.now()): TradeRecord {
    const trade = requireTrade(tradeId);
    if (trade.phase !== "invited" || trade.invitedCharacterId !== characterId) {
      throw new TradeRuleError("not_found", "No pending invite for you.");
    }
    if (trade.expiresAtMs !== null && now >= trade.expiresAtMs) {
      close(trade, "cancelled", "timeout", now);
      throw new TradeRuleError("expired", "The invite expired.");
    }
    if (!isOnline(trade.inviterCharacterId)) {
      close(trade, "cancelled", "disconnect", now);
      throw new TradeRuleError("offline", "The inviter is no longer online.");
    }
    if (
      byCharacter.has(trade.a.characterId) ||
      byCharacter.has(trade.b.characterId) ||
      isActive(trade.phase)
    ) {
      throw new TradeRuleError("busy", "One of you is already trading.");
    }
    trade.phase = "open";
    trade.invitedCharacterId = null;
    trade.expiresAtMs = null;
    trade.updatedAtMs = now;
    byCharacter.set(trade.a.characterId, trade.id);
    byCharacter.set(trade.b.characterId, trade.id);
    pairs.set(trade.pairKey, trade.id);
    return trade;
  }

  function declineInvite(tradeId: string, characterId: string, now = Date.now()): TradeRecord {
    const trade = requireTrade(tradeId);
    if (trade.phase !== "invited" || trade.invitedCharacterId !== characterId) {
      throw new TradeRuleError("not_found", "No pending invite for you.");
    }
    return close(trade, "cancelled", "declined", now);
  }

  function setOffer(
    tradeId: string,
    characterId: string,
    revision: number,
    offer: TradeOffer,
    now = Date.now(),
  ): TradeRecord {
    const trade = requireActive(requireTrade(tradeId));
    if (!isActive(trade.phase)) {
      throw new TradeRuleError("invalid_offer", "The invite has not been accepted.");
    }
    checkIdle(trade, now);
    checkRevision(trade, revision);
    if (
      offer.instanceIds.length > TRADE_MAX_OFFER_ITEMS ||
      new Set(offer.instanceIds).size !== offer.instanceIds.length ||
      !Number.isInteger(offer.gold) ||
      offer.gold < 0 ||
      offer.gold > MAX_GOLD
    ) {
      throw new TradeRuleError("invalid_offer", "That offer is not valid.");
    }
    const mine = side(trade, characterId);
    const opposite = other(trade, characterId);
    const oppositeIds = new Set(opposite.offer.instanceIds);
    if (offer.instanceIds.some((id) => oppositeIds.has(id))) {
      throw new TradeRuleError("invalid_offer", "Both sides cannot offer the same item.");
    }
    if (mine.offerSet && sameOffer(mine.offer, offer)) {
      return trade;
    }
    mine.offer = { instanceIds: [...offer.instanceIds], gold: offer.gold };
    mine.offerSet = true;
    trade.revision += 1;
    trade.a.locked = false;
    trade.b.locked = false;
    trade.a.accepted = false;
    trade.b.accepted = false;
    trade.phase = "open";
    trade.updatedAtMs = now;
    return trade;
  }

  function setLocked(
    tradeId: string,
    characterId: string,
    revision: number,
    locked: boolean,
    now = Date.now(),
  ): TradeRecord {
    const trade = requireActive(requireTrade(tradeId));
    if (!isActive(trade.phase)) {
      throw new TradeRuleError("invalid_offer", "The invite has not been accepted.");
    }
    checkIdle(trade, now);
    checkRevision(trade, revision);
    const mine = side(trade, characterId);
    if (locked && !mine.offerSet) {
      throw new TradeRuleError("invalid_offer", "Submit an offer before locking.");
    }
    mine.locked = locked;
    trade.a.accepted = false;
    trade.b.accepted = false;
    trade.phase = trade.a.locked && trade.b.locked ? "locked" : "open";
    trade.updatedAtMs = now;
    return trade;
  }

  function accept(
    tradeId: string,
    characterId: string,
    revision: number,
    now = Date.now(),
  ): AcceptResult {
    const trade = requireActive(requireTrade(tradeId));
    checkIdle(trade, now);
    checkRevision(trade, revision);
    if (trade.phase !== "locked") {
      throw new TradeRuleError("not_locked", "Both sides must lock before accepting.");
    }
    const mine = side(trade, characterId);
    if (mine.accepted) {
      return { trade, readyToCommit: trade.a.accepted && trade.b.accepted };
    }
    mine.accepted = true;
    trade.updatedAtMs = now;
    return { trade, readyToCommit: trade.a.accepted && trade.b.accepted };
  }

  function complete(tradeId: string, now = Date.now()): TradeRecord {
    const trade = requireTrade(tradeId);
    if (trade.phase !== "locked" || !trade.a.accepted || !trade.b.accepted) {
      throw new TradeRuleError("not_locked", "The trade is not ready to complete.");
    }
    return close(trade, "completed", "swap_complete", now);
  }

  function getByCharacter(characterId: string): TradeRecord | undefined {
    const id = byCharacter.get(characterId);
    return id ? trades.get(id) : undefined;
  }

  function cancelForCharacter(
    characterId: string,
    reason: TradeCloseReason,
    now = Date.now(),
  ): TradeRecord | null {
    const active = getByCharacter(characterId);
    if (active) {
      return close(active, "cancelled", reason, now);
    }
    for (const trade of trades.values()) {
      if (
        trade.phase === "invited" &&
        (trade.inviterCharacterId === characterId || trade.invitedCharacterId === characterId)
      ) {
        return close(trade, "cancelled", reason, now);
      }
    }
    return null;
  }

  function prune(now = Date.now()): {
    expiredInvites: TradeRecord[];
    expiredTrades: TradeRecord[];
  } {
    const expiredInvites: TradeRecord[] = [];
    const expiredTrades: TradeRecord[] = [];
    for (const [id, trade] of trades) {
      if (
        trade.phase === "invited" &&
        trade.expiresAtMs !== null &&
        now >= trade.expiresAtMs
      ) {
        expiredInvites.push(close(trade, "cancelled", "timeout", now));
        continue;
      }
      if (isActive(trade.phase) && now - trade.updatedAtMs >= TRADE_IDLE_TTL_MS) {
        expiredTrades.push(close(trade, "cancelled", "timeout", now));
        continue;
      }
      if (
        isTerminal(trade.phase) &&
        trade.closedAtMs !== null &&
        now - trade.closedAtMs >= TRADE_CLOSED_RETENTION_MS
      ) {
        trades.delete(id);
      }
    }
    return { expiredInvites, expiredTrades };
  }

  function clear(): void {
    trades.clear();
    byCharacter.clear();
    pairs.clear();
  }

  return {
    invite,
    acceptInvite,
    declineInvite,
    get,
    getByCharacter,
    all: () => [...trades.values()],
    side,
    other,
    setOffer,
    setLocked,
    accept,
    complete,
    cancel,
    cancelForCharacter,
    prune,
    clear,
  };
}

export function toTradeInvitePayload(trade: TradeRecord): TradeInvitePayload {
  const inviter = trade.a.characterId === trade.inviterCharacterId ? trade.a : trade.b;
  return {
    tradeId: trade.id,
    fromCharacterId: inviter.characterId,
    fromName: inviter.name,
    expiresAtMs: trade.expiresAtMs ?? trade.updatedAtMs,
  };
}

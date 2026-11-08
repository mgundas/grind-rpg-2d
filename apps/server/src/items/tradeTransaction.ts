import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  INVENTORY_GRID,
  MAX_GOLD,
  findFreeSlot,
  type GridSpec,
  type ItemDefinitionLike,
  type ItemStack,
  type TradeErrorCode,
} from "@jadethrone/shared";
import type { Db, Tx } from "../db/client";
import {
  characters,
  goldLog,
  itemLog,
  items,
  tradeLog,
  type ItemRow,
  type TradeItemSnapshot,
} from "../db/schema";
import { logger } from "../logger";
import { safeDefinition, toItemStack } from "./itemMappers";
import { groundClear, lockCharacter } from "./itemTransactions";

export interface TradeParticipantInput {
  accountId: string;
  characterId: string;
  gold: number;
  items: ReadonlyArray<ItemStack>;
}

export interface TradeExecutionInput {
  tradeId: string;
  revision: number;
  mapId: string;
  participants: readonly [TradeParticipantInput, TradeParticipantInput];
}

export interface TradeExecutionResult {
  tradeId: string;
  goldByCharacter: Record<string, number>;
  receivedByCharacter: Record<string, ItemStack[]>;
}

export class TradeExecutionError extends Error {
  readonly code: TradeErrorCode;

  constructor(code: TradeErrorCode, message: string) {
    super(message);
    this.name = "TradeExecutionError";
    this.code = code;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  );
}

function sameBonuses(one: readonly unknown[], two: readonly unknown[]): boolean {
  return JSON.stringify(one) === JSON.stringify(two);
}

/**
 * Place the incoming stacks into free cells of the receiver's remaining
 * inventory. Returns null when any stack does not fit; the order is stable
 * (`slot`, then id) so tests and retries produce the same layout.
 */
export function assignReceivedSlots(
  remaining: ReadonlyArray<ItemStack>,
  incoming: ReadonlyArray<ItemStack>,
  getDefinition: (itemId: string) => ItemDefinitionLike = safeDefinition,
  grid: GridSpec = INVENTORY_GRID,
): ItemStack[] | null {
  const working = [...remaining];
  const placed: ItemStack[] = [];
  const ordered = [...incoming].sort(
    (one, two) => one.slot - two.slot || one.id.localeCompare(two.id),
  );
  for (const stack of ordered) {
    const slot = findFreeSlot(working, getDefinition(stack.itemId).size, getDefinition, grid);
    if (slot === null) {
      return null;
    }
    const placedStack: ItemStack = {
      ...stack,
      slot,
      bonuses: [...stack.bonuses],
    };
    working.push(placedStack);
    placed.push(placedStack);
  }
  return placed;
}

interface VerifiedRows {
  byId: Map<string, ItemRow>;
}

async function lockOfferedRows(tx: Tx, ids: readonly string[]): Promise<VerifiedRows> {
  const rows =
    ids.length === 0
      ? []
      : await tx
          .select()
          .from(items)
          .where(inArray(items.id, [...ids]))
          .orderBy(items.id)
          .for("update");
  return { byId: new Map(rows.map((row) => [row.id, row])) };
}

function verifyOfferedStack(row: ItemRow | undefined, side: TradeParticipantInput, stack: ItemStack) {
  if (!row) {
    throw new TradeExecutionError("stale", "An offered item no longer exists.");
  }
  if (row.ownerCharacterId !== side.characterId) {
    throw new TradeExecutionError("not_owner", "An offered item is no longer yours.");
  }
  if (
    row.definitionId !== stack.itemId ||
    row.location !== "inventory" ||
    row.slot !== stack.slot ||
    row.quantity !== stack.quantity ||
    row.upgradeLevel !== stack.upgradeLevel ||
    !sameBonuses(row.bonuses, stack.bonuses)
  ) {
    throw new TradeExecutionError("stale", "An offered item changed; review the trade.");
  }
}

function snapshot(
  stack: ItemStack,
  assignedSlot: number,
): TradeItemSnapshot {
  return {
    instanceId: stack.id,
    itemId: stack.itemId,
    quantity: stack.quantity,
    upgradeLevel: stack.upgradeLevel,
    bonuses: [...stack.bonuses],
    fromSlot: stack.slot,
    toSlot: assignedSlot,
  };
}

/**
 * One transaction swaps both inventories and gold. Any failure rolls everything
 * back; runtimes are updated by the room only after this resolves.
 */
export async function applyTradeTransaction(
  db: Db,
  input: TradeExecutionInput,
): Promise<TradeExecutionResult> {
  try {
    const [first, second] = input.participants;
    if (first.characterId === second.characterId) {
      throw new TradeExecutionError("invalid_offer", "A trade needs two characters.");
    }
    if (first.accountId === second.accountId) {
      throw new TradeExecutionError("invalid_offer", "Characters on one account cannot trade.");
    }
    for (const side of input.participants) {
      if (
        !Number.isInteger(side.gold) ||
        side.gold < 0 ||
        side.gold > MAX_GOLD ||
        new Set(side.items.map((item) => item.id)).size !== side.items.length
      ) {
        throw new TradeExecutionError("invalid_offer", "That offer is not valid.");
      }
    }
    const firstIds = new Set(first.items.map((item) => item.id));
    if (second.items.some((item) => firstIds.has(item.id))) {
      throw new TradeExecutionError("invalid_offer", "Both sides cannot offer the same item.");
    }
    if (first.items.length === 0 && second.items.length === 0 && first.gold === 0 && second.gold === 0) {
      throw new TradeExecutionError("invalid_offer", "The trade is empty.");
    }

    const [a, b] =
      first.characterId < second.characterId ? [first, second] : [second, first];
    const allOffered = [...a.items, ...b.items];
    const allIds = allOffered.map((item) => item.id);

    return await db.transaction(async (tx) => {
      // Character locks in sorted UUID order prevent concurrent trade deadlocks.
      const aBalance = await lockCharacter(tx, a.accountId, a.characterId);
      const bBalance = await lockCharacter(tx, b.accountId, b.characterId);

      const { byId } = await lockOfferedRows(tx, allIds);
      for (const stack of a.items) {
        verifyOfferedStack(byId.get(stack.id), a, stack);
      }
      for (const stack of b.items) {
        verifyOfferedStack(byId.get(stack.id), b, stack);
      }

      const inventoryRows = await tx
        .select()
        .from(items)
        .where(
          and(
            inArray(items.ownerCharacterId, [a.characterId, b.characterId]),
            eq(items.location, "inventory"),
          ),
        )
        .orderBy(items.ownerCharacterId, items.slot)
        .for("update");

      if (aBalance.gold < a.gold || bBalance.gold < b.gold) {
        throw new TradeExecutionError("no_gold", "Not enough gold for that offer.");
      }
      const newABalance = aBalance.gold - a.gold + b.gold;
      const newBBalance = bBalance.gold - b.gold + a.gold;
      if (newABalance > MAX_GOLD || newBBalance > MAX_GOLD) {
        throw new TradeExecutionError("no_gold", "The gold offer exceeds the cap.");
      }

      const aOutgoing = new Set(a.items.map((item) => item.id));
      const bOutgoing = new Set(b.items.map((item) => item.id));
      const aRemaining = inventoryRows
        .filter((row) => row.ownerCharacterId === a.characterId && !aOutgoing.has(row.id))
        .map(toItemStack);
      const bRemaining = inventoryRows
        .filter((row) => row.ownerCharacterId === b.characterId && !bOutgoing.has(row.id))
        .map(toItemStack);

      const aReceives = assignReceivedSlots(aRemaining, b.items);
      const bReceives = assignReceivedSlots(bRemaining, a.items);
      if (aReceives === null || bReceives === null) {
        throw new TradeExecutionError("inventory_full", "A receiver has no room for the trade.");
      }

      const slotById = new Map<string, number>();
      for (const stack of aReceives) {
        slotById.set(stack.id, stack.slot);
      }
      for (const stack of bReceives) {
        slotById.set(stack.id, stack.slot);
      }

      // Park every moving row first: the two owners may swap the same slot ids.
      let parkCounter = 0;
      for (const stack of allOffered) {
        parkCounter += 1;
        await tx.update(items).set({ slot: -parkCounter }).where(eq(items.id, stack.id));
      }

      for (const stack of allOffered) {
        const receiver = a.items.some((item) => item.id === stack.id) ? b : a;
        await tx
          .update(items)
          .set({
            location: "inventory",
            slot: slotById.get(stack.id)!,
            quantity: stack.quantity,
            upgradeLevel: stack.upgradeLevel,
            bonuses: [...stack.bonuses],
            ownerCharacterId: receiver.characterId,
            ownerAccountId: null,
            ...groundClear(),
          })
          .where(eq(items.id, stack.id));
      }

      await tx
        .update(characters)
        .set({ gold: newABalance, updatedAt: new Date() })
        .where(eq(characters.id, a.characterId));
      await tx
        .update(characters)
        .set({ gold: newBBalance, updatedAt: new Date() })
        .where(eq(characters.id, b.characterId));

      const details = [
        {
          side: a,
          counterpart: b,
          before: aBalance.gold,
          after: newABalance,
        },
        {
          side: b,
          counterpart: a,
          before: bBalance.gold,
          after: newBBalance,
        },
      ];
      for (const entry of details) {
        const delta = entry.after - entry.before;
        if (delta === 0) {
          continue;
        }
        await tx.insert(goldLog).values({
          id: randomUUID(),
          characterId: entry.side.characterId,
          accountId: entry.side.accountId,
          delta,
          balanceAfter: entry.after,
          reason: "trade",
          detail: {
            tradeId: input.tradeId,
            counterpartCharacterId: entry.counterpart.characterId,
            offeredGold: entry.side.gold,
            receivedGold: entry.counterpart.gold,
          },
        });
      }

      for (const giving of [
        { giver: a, receiver: b, stacks: a.items },
        { giver: b, receiver: a, stacks: b.items },
      ]) {
        for (const stack of giving.stacks) {
          await tx.insert(itemLog).values({
            id: randomUUID(),
            itemId: stack.id,
            actorCharacterId: giving.giver.characterId,
            accountId: giving.giver.accountId,
            action: "trade",
            definitionId: stack.itemId,
            quantity: stack.quantity,
            fromLocation: "inventory",
            fromSlot: stack.slot,
            toLocation: "inventory",
            toSlot: slotById.get(stack.id)!,
            detail: {
              tradeId: input.tradeId,
              counterpartCharacterId: giving.receiver.characterId,
              revision: input.revision,
              upgradeLevel: stack.upgradeLevel,
              bonusCount: stack.bonuses.length,
            },
          });
        }
      }

      const itemsA = a.items.map((stack) => snapshot(stack, slotById.get(stack.id)!));
      const itemsB = b.items.map((stack) => snapshot(stack, slotById.get(stack.id)!));
      await tx.insert(tradeLog).values({
        id: input.tradeId,
        revision: input.revision,
        mapId: input.mapId,
        characterAId: a.characterId,
        accountAId: a.accountId,
        characterBId: b.characterId,
        accountBId: b.accountId,
        goldA: a.gold,
        goldB: b.gold,
        itemsA,
        itemsB,
        result: "completed",
        detail: {
          itemCount: itemsA.length + itemsB.length,
          goldMoved: a.gold + b.gold,
        },
      });

      return {
        tradeId: input.tradeId,
        goldByCharacter: {
          [a.characterId]: newABalance,
          [b.characterId]: newBBalance,
        },
        receivedByCharacter: {
          [a.characterId]: aReceives,
          [b.characterId]: bReceives,
        },
      };
    });
  } catch (error) {
    if (error instanceof TradeExecutionError) {
      throw error;
    }
    if (isUniqueViolation(error)) {
      throw new TradeExecutionError("stale", "The trade changed; reload required.");
    }
    logger.error(
      {
        tradeId: input.tradeId,
        participants: input.participants.map((side) => side.characterId),
        error,
      },
      "trade transaction failed",
    );
    throw new TradeExecutionError("internal", "Trade transaction failed.");
  }
}

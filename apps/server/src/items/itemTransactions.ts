import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { MAX_GOLD } from "@jadethrone/shared";
import type { Db, Tx } from "../db/client";
import { logger } from "../logger";
import { accounts, characters, goldLog, itemLog, items, type ItemRow } from "../db/schema";
import { ItemError } from "./errors";
import type { ItemChange, ItemPlan, RowState } from "./itemChanges";

export interface ItemTransactionContext {
  accountId: string;
  characterId: string;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  );
}

async function lockAccount(tx: Tx, accountId: string) {
  const [row] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .for("update")
    .limit(1);
  if (!row) {
    throw new ItemError("stale", "Account no longer exists.");
  }
}

export async function lockCharacter(
  tx: Tx,
  accountId: string,
  characterId: string,
): Promise<{ gold: number }> {
  const [row] = await tx
    .select({ gold: characters.gold })
    .from(characters)
    .where(and(eq(characters.id, characterId), eq(characters.accountId, accountId)))
    .for("update")
    .limit(1);
  if (!row) {
    throw new ItemError("stale", "Character no longer exists.");
  }
  return { gold: row.gold };
}

function sameBonuses(left: readonly unknown[], right: readonly unknown[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => JSON.stringify(value) === JSON.stringify(right[index]));
}

function stateMatches(row: ItemRow, expected: RowState): boolean {
  return (
    row.location === expected.location &&
    row.slot === expected.slot &&
    row.quantity === expected.quantity &&
    row.ownerCharacterId === expected.ownerCharacterId &&
    row.ownerAccountId === expected.ownerAccountId &&
    (row.mapId ?? null) === expected.mapId &&
    row.upgradeLevel === expected.upgradeLevel &&
    sameBonuses(row.bonuses, expected.bonuses)
  );
}

function verifyChange(change: ItemChange, row: ItemRow | undefined): void {
  if (change.kind === "insert") {
    if (row) {
      throw new ItemError("stale", "Item id already exists.");
    }
    return;
  }
  if (!row || !stateMatches(row, change.expect)) {
    if (change.expect.location === "ground") {
      throw new ItemError("already_taken", "That drop was already claimed.");
    }
    throw new ItemError("stale", "Item state changed; reload required.");
  }
}

export function groundClear() {
  return {
    mapId: null,
    roomId: null,
    x: null,
    y: null,
    dropOwnerCharacterId: null,
    ownerUntil: null,
    despawnAt: null,
  };
}

/**
 * The single executor for every item mutation. Locks the owner rows, verifies
 * every expectation, parks slot/location changes at unique negative slots so
 * swaps cannot trip the partial unique indexes, applies the writes, and appends
 * the item and gold ledgers.
 */
export async function applyItemTransaction(
  db: Db,
  context: ItemTransactionContext,
  plan: ItemPlan,
): Promise<{ gold: number }> {
  try {
    return await db.transaction(async (tx) => {
      if (plan.lockAccount) {
        await lockAccount(tx, context.accountId);
      }
      const { gold: currentGold } = await lockCharacter(
        tx,
        context.accountId,
        context.characterId,
      );

      const ids = [...new Set(plan.changes.map((change) => change.id))];
      const rows =
        ids.length === 0
          ? []
          : await tx
              .select()
              .from(items)
              .where(inArray(items.id, ids))
              .orderBy(items.id)
              .for("update");
      const byId = new Map(rows.map((row) => [row.id, row]));
      for (const change of plan.changes) {
        verifyChange(change, byId.get(change.id));
      }

      // Validate the gold delta before any item write. Two concurrent purchases
      // that both planned against the old balance must fail with `no_gold`
      // rather than colliding on a slot insert.
      let gold = currentGold;
      if (plan.gold) {
        const requested = Math.trunc(plan.gold.delta);
        if (requested < 0 && -requested > currentGold) {
          throw new ItemError("no_gold", "Not enough gold.");
        }
        gold = Math.max(0, Math.min(MAX_GOLD, currentGold + requested));
      }

      // Deletes first: they free slots for inserts/swaps in the same plan.
      for (const change of plan.changes) {
        if (change.kind === "delete") {
          await tx.delete(items).where(eq(items.id, change.id));
        }
      }

      // Park every row that changes its slot or location.
      let parkCounter = 0;
      for (const change of plan.changes) {
        if (
          change.kind === "update" &&
          (change.to.slot !== change.expect.slot ||
            change.to.location !== change.expect.location)
        ) {
          parkCounter++;
          await tx
            .update(items)
            .set({ slot: -parkCounter })
            .where(eq(items.id, change.id));
        }
      }

      for (const change of plan.changes) {
        if (change.kind !== "update") {
          continue;
        }
        await tx
          .update(items)
          .set({
            location: change.to.location,
            slot: change.to.slot,
            quantity: change.to.quantity,
            upgradeLevel: change.to.upgradeLevel,
            bonuses: [...change.to.bonuses],
            ownerCharacterId: change.to.ownerCharacterId,
            ownerAccountId: change.to.ownerAccountId,
            ...(change.to.location === "ground"
              ? { mapId: change.to.mapId }
              : groundClear()),
          })
          .where(eq(items.id, change.id));
      }

      for (const change of plan.changes) {
        if (change.kind !== "insert") {
          continue;
        }
        await tx.insert(items).values({
          id: change.id,
          definitionId: change.itemId,
          location: change.location,
          slot: change.slot,
          quantity: change.quantity,
          upgradeLevel: change.upgradeLevel,
          bonuses: [...change.bonuses],
          ownerCharacterId: change.ownerCharacterId,
          ownerAccountId: change.ownerAccountId,
          createdBy: change.createdBy,
        });
      }

      if (plan.gold) {
        const actual = gold - currentGold;
        await tx
          .update(characters)
          .set({ gold, updatedAt: new Date() })
          .where(eq(characters.id, context.characterId));
        if (actual !== 0) {
          await tx.insert(goldLog).values({
            id: randomUUID(),
            characterId: context.characterId,
            accountId: context.accountId,
            delta: actual,
            balanceAfter: gold,
            reason: plan.gold.reason,
            detail: plan.gold.detail ?? {},
          });
        }
      }

      if (plan.logs.length > 0) {
        await tx.insert(itemLog).values(
          plan.logs.map((log) => ({
            id: randomUUID(),
            itemId: log.itemId,
            actorCharacterId: context.characterId,
            accountId: context.accountId,
            action: log.action,
            definitionId: log.definitionId,
            quantity: log.quantity,
            fromLocation: log.fromLocation ?? null,
            fromSlot: log.fromSlot ?? null,
            toLocation: log.toLocation ?? null,
            toSlot: log.toSlot ?? null,
            detail: log.detail ?? {},
          })),
        );
      }

      return { gold };
    });
  } catch (error) {
    if (error instanceof ItemError) {
      throw error;
    }
    if (isUniqueViolation(error)) {
      throw new ItemError("stale", "Item slot changed; reload required.");
    }
    logger.error(
      { characterId: context.characterId, accountId: context.accountId, error },
      "item transaction failed",
    );
    throw new ItemError("internal", "Item transaction failed.");
  }
}

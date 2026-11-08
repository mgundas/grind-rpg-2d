import { randomUUID } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import type { WarehouseState } from "@jadethrone/shared";
import { BASE_CATALOG, type CatalogLookup } from "@jadethrone/data/catalog";
import type { Db } from "../db/client";
import { itemLog, items, type ItemRow, type NewItemRow } from "../db/schema";
import { logger } from "../logger";
import type { ItemPlan } from "./itemChanges";
import { applyItemTransaction } from "./itemTransactions";
import {
  applySkillBookTransaction,
  type SkillBookTransactionInput,
  type SkillBookTransactionResult,
} from "./skillBookTransaction";
import {
  applyTradeTransaction,
  type TradeExecutionInput,
  type TradeExecutionResult,
} from "./tradeTransaction";
import { loadInventory, loadWarehouse, type LoadedInventory } from "./itemRepository";

/**
 * The room's only seam into persistence. Game rules live in the pure planners;
 * this service just loads snapshots and applies plans.
 */
export interface ItemService {
  loadInventory(
    accountId: string,
    characterId: string,
    catalog?: CatalogLookup,
  ): Promise<LoadedInventory>;
  loadWarehouse(accountId: string, catalog?: CatalogLookup): Promise<WarehouseState>;
  apply(
    accountId: string,
    characterId: string,
    plan: ItemPlan,
  ): Promise<{ gold: number }>;
  /** One DB transaction swaps both sides; runtimes update only on success. */
  trade(input: TradeExecutionInput): Promise<TradeExecutionResult>;
  /** Consume a mastery book and persist level/cooldown in one transaction. */
  readSkillBook(input: SkillBookTransactionInput): Promise<SkillBookTransactionResult>;
  /** Ground drops are inserted before they enter room state (Task 13). */
  insertGroundItem(row: NewItemRow): Promise<boolean>;
  deleteGroundItem(id: string): Promise<boolean>;
  /** Purge already-expired leftovers when a room starts (never live drops). */
  deleteExpiredGroundItems(mapId: string): Promise<number>;
}

function despawnLog(row: ItemRow, reason: string) {
  return {
    id: randomUUID(),
    itemId: row.id,
    actorCharacterId: row.dropOwnerCharacterId ?? null,
    action: "despawn" as const,
    definitionId: row.definitionId,
    quantity: row.quantity,
    fromLocation: "ground",
    fromSlot: null,
    toLocation: null,
    toSlot: null,
    detail: {
      reason,
      mapId: row.mapId,
      roomId: row.roomId,
    },
  };
}

export function createItemService(db: Db): ItemService {
  return {
    loadInventory: (accountId, characterId, catalog = BASE_CATALOG) =>
      loadInventory(db, accountId, characterId, catalog),
    loadWarehouse: (accountId, catalog = BASE_CATALOG) => loadWarehouse(db, accountId, catalog),
    apply: (accountId, characterId, plan) =>
      applyItemTransaction(db, { accountId, characterId }, plan),
    trade: (input) => applyTradeTransaction(db, input),
    readSkillBook: (input) => applySkillBookTransaction(db, input),
    async insertGroundItem(row) {
      try {
        await db.transaction(async (tx) => {
          await tx.insert(items).values(row);
          await tx.insert(itemLog).values({
            id: randomUUID(),
            itemId: row.id,
            actorCharacterId: row.dropOwnerCharacterId ?? null,
            action: "drop",
            definitionId: row.definitionId,
            quantity: row.quantity ?? 1,
            fromLocation: null,
            fromSlot: null,
            toLocation: "ground",
            toSlot: null,
            detail: {
              mapId: row.mapId,
              roomId: row.roomId,
              x: row.x,
              y: row.y,
            },
          });
        });
        return true;
      } catch (error) {
        logger.error({ itemId: row.id, error }, "ground item insert failed");
        return false;
      }
    },
    async deleteGroundItem(id) {
      try {
        return await db.transaction(async (tx) => {
          const [row] = await tx
            .select()
            .from(items)
            .where(and(eq(items.id, id), eq(items.location, "ground")))
            .limit(1);
          if (!row) {
            return false;
          }
          await tx.delete(items).where(eq(items.id, id));
          await tx.insert(itemLog).values(despawnLog(row, "despawn"));
          return true;
        });
      } catch (error) {
        logger.error({ itemId: id, error }, "ground item delete failed");
        return false;
      }
    },
    async deleteExpiredGroundItems(mapId) {
      try {
        return await db.transaction(async (tx) => {
          const expired = (await tx
            .select()
            .from(items)
            .where(
              and(
                eq(items.location, "ground"),
                eq(items.mapId, mapId),
                lt(items.despawnAt, new Date()),
              ),
            )) as ItemRow[];
          if (expired.length === 0) {
            return 0;
          }
          await tx
            .delete(items)
            .where(
              and(
                eq(items.location, "ground"),
                eq(items.mapId, mapId),
                lt(items.despawnAt, new Date()),
              ),
            );
          await tx
            .insert(itemLog)
            .values(expired.map((row) => despawnLog(row, "stale_map_cleanup")));
          return expired.length;
        });
      } catch (error) {
        logger.error({ mapId, error }, "ground item map cleanup failed");
        return 0;
      }
    },
  };
}

import { and, eq } from "drizzle-orm";
import type { WarehouseState } from "@jadethrone/shared";
import type { Db } from "../db/client";
import { items, type NewItemRow } from "../db/schema";
import { logger } from "../logger";
import type { ItemPlan } from "./itemChanges";
import { applyItemTransaction } from "./itemTransactions";
import { loadInventory, loadWarehouse, type LoadedInventory } from "./itemRepository";

/**
 * The room's only seam into persistence. Game rules live in the pure planners;
 * this service just loads snapshots and applies plans.
 */
export interface ItemService {
  loadInventory(accountId: string, characterId: string): Promise<LoadedInventory>;
  loadWarehouse(accountId: string): Promise<WarehouseState>;
  apply(
    accountId: string,
    characterId: string,
    plan: ItemPlan,
  ): Promise<{ gold: number }>;
  /** Ground drops are inserted before they enter room state (Task 13). */
  insertGroundItem(row: NewItemRow): Promise<boolean>;
  deleteGroundItem(id: string): Promise<boolean>;
}

export function createItemService(db: Db): ItemService {
  return {
    loadInventory: (accountId, characterId) => loadInventory(db, accountId, characterId),
    loadWarehouse: (accountId) => loadWarehouse(db, accountId),
    apply: (accountId, characterId, plan) =>
      applyItemTransaction(db, { accountId, characterId }, plan),
    async insertGroundItem(row) {
      try {
        await db.insert(items).values(row);
        return true;
      } catch (error) {
        logger.error({ itemId: row.id, error }, "ground item insert failed");
        return false;
      }
    },
    async deleteGroundItem(id) {
      try {
        const deleted = await db
          .delete(items)
          .where(and(eq(items.id, id), eq(items.location, "ground")))
          .returning({ id: items.id });
        return deleted.length > 0;
      } catch (error) {
        logger.error({ itemId: id, error }, "ground item delete failed");
        return false;
      }
    },
  };
}

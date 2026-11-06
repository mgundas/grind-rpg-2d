import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  WAREHOUSE_GRID,
  normalizeInventory,
  type InventoryState,
  type WarehouseState,
} from "@jadethrone/shared";
import type { Db, Tx } from "../db/client";
import { accounts, characters, itemLog, items } from "../db/schema";
import { ItemError } from "./errors";
import {
  loadRowsIntoState,
  safeDefinition,
  toItemStack,
  type InventoryRepair,
} from "./itemMappers";

/** Loaded owner state: authoritative inventory/equipment plus the gold balance. */
export interface LoadedInventory {
  inventory: InventoryState;
  gold: number;
  repairs: readonly InventoryRepair[];
}

const INVENTORY_LOCATIONS = ["inventory", "equipment"];

async function persistRepairs(
  tx: Tx,
  repairs: ReadonlyArray<InventoryRepair>,
  actor: { characterId: string; accountId: string },
): Promise<void> {
  if (repairs.length === 0) {
    return;
  }
  const applied = new Map<string, InventoryRepair>();
  for (const repair of repairs) {
    applied.set(repair.itemId, repair);
  }
  for (const repair of applied.values()) {
    await tx
      .update(items)
      .set({
        location: repair.toLocation,
        slot: repair.toSlot,
        quantity: repair.quantity,
      })
      .where(eq(items.id, repair.itemId));
  }
  await tx.insert(itemLog).values(
    repairs.map((repair) => ({
      id: randomUUID(),
      itemId: repair.itemId,
      actorCharacterId: actor.characterId,
      accountId: actor.accountId,
      action: "repair",
      definitionId: repair.definitionId,
      quantity: repair.quantity,
      fromLocation: repair.fromLocation,
      fromSlot: repair.fromSlot,
      toLocation: repair.toLocation,
      toSlot: repair.toSlot,
      detail: { reason: repair.reason },
    })),
  );
}

/**
 * Read the character's gold and item rows under the character row lock, so the
 * snapshot, any repairs and the balance are one consistent state. Repairs are
 * persisted (and logged) before the state is returned.
 */
export async function loadInventory(
  db: Db,
  accountId: string,
  characterId: string,
): Promise<LoadedInventory> {
  return db.transaction(async (tx) => {
    const [character] = await tx
      .select({ id: characters.id, gold: characters.gold })
      .from(characters)
      .where(and(eq(characters.id, characterId), eq(characters.accountId, accountId)))
      .for("update")
      .limit(1);
    if (!character) {
      throw new ItemError("stale", "Character no longer exists.");
    }

    const rows = await tx
      .select()
      .from(items)
      .where(
        and(
          eq(items.ownerCharacterId, characterId),
          inArray(items.location, INVENTORY_LOCATIONS),
        ),
      )
      .orderBy(items.location, items.slot);

    const { inventory, repairs } = loadRowsIntoState(rows);
    await persistRepairs(tx, repairs, { characterId, accountId });
    return { inventory, gold: character.gold, repairs };
  });
}

/** Account warehouse snapshot, loaded lazily when a warehouse NPC is opened. */
export async function loadWarehouse(db: Db, accountId: string): Promise<WarehouseState> {
  return db.transaction(async (tx) => {
    const [account] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .for("update")
      .limit(1);
    if (!account) {
      throw new ItemError("stale", "Account no longer exists.");
    }

    const rows = await tx
      .select()
      .from(items)
      .where(and(eq(items.ownerAccountId, accountId), eq(items.location, "warehouse")))
      .orderBy(items.slot);

    const stacks = rows.map(toItemStack);
    const normalized = normalizeInventory(stacks, safeDefinition, WAREHOUSE_GRID);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const repairs = normalized.items.filter((stack) => {
      const row = byId.get(stack.id);
      return !row || row.slot !== stack.slot;
    });
    if (repairs.length > 0) {
      for (const stack of repairs) {
        await tx.update(items).set({ slot: stack.slot }).where(eq(items.id, stack.id));
      }
      // Warehouse repairs are logged without an actor character.
      await tx.insert(itemLog).values(
        repairs.map((stack) => ({
          id: randomUUID(),
          itemId: stack.id,
          accountId,
          action: "repair",
          definitionId: stack.itemId,
          quantity: stack.quantity,
          fromLocation: "warehouse",
          fromSlot: byId.get(stack.id)?.slot ?? null,
          toLocation: "warehouse",
          toSlot: stack.slot,
          detail: { reason: "overlap" },
        })),
      );
    }

    return { items: normalized.items };
  });
}

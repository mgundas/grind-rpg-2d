import { z } from "zod";
import { getItem, hasItem } from "./items";
import raw from "../dropTables.json";

/**
 * Drop tables (GAME_DESIGN.md §6.3). Gold is still rolled from the monster's
 * own `goldMin`/`goldMax`; tables describe item drops only. Rolls are done by
 * the server with the room RNG.
 */
const dropEntrySchema = z
  .object({
    itemId: z.string().min(1),
    chance: z.number().min(0).max(1),
    minQty: z.number().int().min(1),
    maxQty: z.number().int().min(1),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.maxQty < entry.minQty) {
      ctx.addIssue({ code: "custom", message: `${entry.itemId}: maxQty below minQty` });
    }
    if (!hasItem(entry.itemId)) {
      ctx.addIssue({ code: "custom", message: `unknown item "${entry.itemId}"` });
      return;
    }
    if (entry.maxQty > getItem(entry.itemId).maxStack) {
      ctx.addIssue({
        code: "custom",
        message: `${entry.itemId}: maxQty exceeds maxStack ${getItem(entry.itemId).maxStack}`,
      });
    }
  });

const dropTableSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    drops: z.array(dropEntrySchema),
  })
  .strict();

const dropTablesFileSchema = z
  .object({
    version: z.literal(1),
    dropTables: z.array(dropTableSchema).min(1),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const table of file.dropTables) {
      if (seen.has(table.id)) {
        ctx.addIssue({ code: "custom", message: `duplicate drop table "${table.id}"` });
      }
      seen.add(table.id);
      for (const entry of table.drops) {
        if (entry.chance === 0) {
          ctx.addIssue({ code: "custom", message: `${table.id}: zero-chance drop is dead data` });
        }
      }
    }
  });

export interface DropEntry {
  itemId: string;
  chance: number;
  minQty: number;
  maxQty: number;
}

export interface DropTable {
  id: string;
  drops: DropEntry[];
}

const parsed = dropTablesFileSchema.parse(raw);

export const DROP_TABLES: readonly DropTable[] = parsed.dropTables;

const byId = new Map(DROP_TABLES.map((table) => [table.id, table]));

export function hasDropTable(id: string): boolean {
  return byId.has(id);
}

export function getDropTable(id: string): DropTable {
  const found = byId.get(id);
  if (!found) {
    throw new Error(`unknown drop table "${id}"`);
  }
  return found;
}

import { z } from "zod";
import { hasItem } from "./items";
import raw from "../shops.json";

/**
 * NPC shop stock (GAME_DESIGN.md §7.6). Prices come from `items.json`; a shop
 * only decides what it offers.
 */
export interface ShopEntry {
  itemId: string;
}

export interface ShopInfo {
  id: string;
  name: string;
  npcId: string;
  items: ShopEntry[];
}

export function buildShops(
  rawJson: unknown,
  refs: { hasItem(id: string): boolean },
): readonly ShopInfo[] {
  const shopItemSchema = z
    .object({ itemId: z.string().min(1) })
    .strict()
    .superRefine((entry, ctx) => {
      if (!refs.hasItem(entry.itemId)) {
        ctx.addIssue({ code: "custom", message: `unknown item "${entry.itemId}"` });
      }
    });

  const shopSchema = z
    .object({
      id: z.string().regex(/^[a-z][a-z0-9_]*$/),
      name: z.string().min(1),
      npcId: z.string().min(1),
      items: z.array(shopItemSchema).min(1),
    })
    .strict();

  const fileSchema = z
    .object({
      version: z.literal(1),
      shops: z.array(shopSchema).min(1),
    })
    .superRefine((file, ctx) => {
      const ids = new Set<string>();
      for (const shop of file.shops) {
        if (ids.has(shop.id)) {
          ctx.addIssue({ code: "custom", message: `duplicate shop "${shop.id}"` });
        }
        ids.add(shop.id);
        const itemIds = new Set<string>();
        for (const entry of shop.items) {
          if (itemIds.has(entry.itemId)) {
            ctx.addIssue({
              code: "custom",
              message: `${shop.id}: duplicate item "${entry.itemId}"`,
            });
          }
          itemIds.add(entry.itemId);
        }
      }
    });

  return fileSchema.parse(rawJson).shops;
}

export const SHOPS: readonly ShopInfo[] = buildShops(raw, { hasItem });

const byId = new Map(SHOPS.map((shop) => [shop.id, shop]));

export function hasShop(id: string): boolean {
  return byId.has(id);
}

export function getShop(id: string): ShopInfo {
  const found = byId.get(id);
  if (!found) {
    throw new Error(`unknown shop "${id}"`);
  }
  return found;
}

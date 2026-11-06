import { z } from "zod";
import { getShop, hasShop } from "./shops";
import raw from "../npcs.json";

/**
 * NPC definitions (GAME_DESIGN.md §7.6). Positions live in the Tiled map
 * objects; this file holds the name, dialog and which shop/warehouse the NPC
 * opens.
 */
export const NPC_KINDS = ["shop", "warehouse", "blacksmith"] as const;
export type NpcKind = (typeof NPC_KINDS)[number];

const npcSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    name: z.string().min(1),
    kind: z.enum(NPC_KINDS),
    shopId: z.string().min(1).optional(),
    greeting: z.string().min(1),
  })
  .strict()
  .superRefine((npc, ctx) => {
    if (npc.kind === "shop") {
      if (!npc.shopId) {
        ctx.addIssue({ code: "custom", message: `${npc.id}: shop NPC needs shopId` });
        return;
      }
      if (!hasShop(npc.shopId)) {
        ctx.addIssue({ code: "custom", message: `${npc.id}: unknown shop "${npc.shopId}"` });
        return;
      }
      if (getShop(npc.shopId).npcId !== npc.id) {
        ctx.addIssue({ code: "custom", message: `${npc.id}: shop npcId mismatch` });
      }
    } else if (npc.shopId) {
      ctx.addIssue({ code: "custom", message: `${npc.id}: non-shop NPC cannot have shopId` });
    }
  });

const npcsFileSchema = z
  .object({
    version: z.literal(1),
    npcs: z.array(npcSchema).min(1),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const npc of file.npcs) {
      if (seen.has(npc.id)) {
        ctx.addIssue({ code: "custom", message: `duplicate NPC "${npc.id}"` });
      }
      seen.add(npc.id);
    }
  });

export interface NpcInfo {
  id: string;
  name: string;
  kind: NpcKind;
  shopId?: string;
  greeting: string;
}

const parsed = npcsFileSchema.parse(raw);

export const NPCS: readonly NpcInfo[] = parsed.npcs;

const byId = new Map(NPCS.map((npc) => [npc.id, npc]));

export function hasNpc(id: string): boolean {
  return byId.has(id);
}

export function getNpc(id: string): NpcInfo {
  const found = byId.get(id);
  if (!found) {
    throw new Error(`unknown NPC "${id}"`);
  }
  return found;
}

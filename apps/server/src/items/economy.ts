import type { Db } from "../db/client";
import { applyItemTransaction } from "./itemTransactions";
import type { GoldReason } from "./itemChanges";

/**
 * Credit/debit gold through the same transaction path as item changes. Gold is
 * intentionally not part of `CharacterSave`, so this is the only writer of
 * `characters.gold` outside character creation.
 */
export async function creditGold(
  db: Db,
  input: {
    accountId: string;
    characterId: string;
    amount: number;
    reason: Exclude<GoldReason, "shop_buy" | "shop_sell" | "starter">;
    detail?: Record<string, unknown>;
  },
): Promise<{ gold: number }> {
  return applyItemTransaction(
    db,
    { accountId: input.accountId, characterId: input.characterId },
    {
      changes: [],
      logs: [],
      gold: { delta: input.amount, reason: input.reason, detail: input.detail },
    },
  );
}

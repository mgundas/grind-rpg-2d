import { and, eq, inArray } from "drizzle-orm";
import {
  EQUIP_SLOTS,
  type InventoryState,
  type RandomSource,
} from "@jadethrone/shared";
import { BASE_CATALOG, type CatalogLookup } from "@jadethrone/data/catalog";
import type { Db } from "../db/client";
import {
  characterSkillMastery,
  characterSkills,
  characters,
  items,
} from "../db/schema";
import { ItemError } from "./errors";
import { applyItemPlanInTx, withItemTransaction } from "./itemTransactions";
import { toItemStack } from "./itemMappers";
import { planSkillBookRead } from "./skillBook";

export interface SkillBookTransactionInput {
  accountId: string;
  characterId: string;
  bookInstanceId: string;
  skillId: string;
  now: number;
  rng: RandomSource;
  catalog?: CatalogLookup;
}

export interface SkillBookTransactionResult {
  inventory: InventoryState;
  gold: number;
  skillId: string;
  bookDefinitionId: string;
  success: boolean;
  previousLevel: number;
  masterLevel: number;
  readAtMs: number;
  nextReadAtMs: number;
  chance: number;
}

function inventoryFromRows(rows: Awaited<ReturnType<typeof lockInventoryRows>>): InventoryState {
  const inventory: InventoryState = {
    items: [],
    equipment: Array.from({ length: EQUIP_SLOTS.length }, () => null),
  };
  for (const row of rows) {
    const stack = toItemStack(row);
    if (row.location === "equipment" && row.slot !== null) {
      if (row.slot >= 0 && row.slot < inventory.equipment.length) {
        inventory.equipment[row.slot] = stack;
      }
    } else {
      inventory.items.push(stack);
    }
  }
  return inventory;
}

function lockInventoryRows(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  characterId: string,
) {
  return tx
    .select()
    .from(items)
    .where(and(eq(items.ownerCharacterId, characterId), inArray(items.location, ["inventory", "equipment"])))
    .orderBy(items.location, items.slot)
    .for("update");
}

/**
 * One transaction: lock character/mastery/book rows, plan the read, apply the
 * item plan and persist the mastery level/cooldown. A failed roll still
 * consumes the book and sets the cooldown.
 */
export async function applySkillBookTransaction(
  db: Db,
  input: SkillBookTransactionInput,
): Promise<SkillBookTransactionResult> {
  return withItemTransaction(
    db,
    { accountId: input.accountId, characterId: input.characterId },
    async (tx) => {
      const [character] = await tx
        .select({
          id: characters.id,
          classId: characters.classId,
          doctrine: characters.doctrine,
          gold: characters.gold,
        })
        .from(characters)
        .where(
          and(
            eq(characters.id, input.characterId),
            eq(characters.accountId, input.accountId),
          ),
        )
        .for("update")
        .limit(1);
      if (!character) {
        throw new ItemError("stale", "Character no longer exists.");
      }

      await tx
        .insert(characterSkillMastery)
        .values({
          characterId: input.characterId,
          skillId: input.skillId,
          masterLevel: 0,
        })
        .onConflictDoNothing();
      const [mastery] = await tx
        .select()
        .from(characterSkillMastery)
        .where(
          and(
            eq(characterSkillMastery.characterId, input.characterId),
            eq(characterSkillMastery.skillId, input.skillId),
          ),
        )
        .for("update")
        .limit(1);
      if (!mastery) {
        throw new ItemError("internal", "Mastery row could not be locked.");
      }

      const [rankRow] = await tx
        .select({ rank: characterSkills.rank })
        .from(characterSkills)
        .where(
          and(
            eq(characterSkills.characterId, input.characterId),
            eq(characterSkills.skillId, input.skillId),
          ),
        )
        .limit(1);

      const rows = await lockInventoryRows(tx, input.characterId);
      const state = inventoryFromRows(rows);
      const read = planSkillBookRead(
        state,
        input.characterId,
        input.bookInstanceId,
        {
          skillId: input.skillId,
          rank: rankRow?.rank ?? 0,
          classId: character.classId as Parameters<typeof planSkillBookRead>[3]["classId"],
          doctrine: character.doctrine,
          mastery: {
            level: mastery.masterLevel,
            lastReadAtMs: mastery.lastReadAt?.getTime() ?? 0,
          },
          now: input.now,
          rng: input.rng,
        },
        input.catalog ?? BASE_CATALOG,
      );

      const { gold } = await applyItemPlanInTx(
        tx,
        { accountId: input.accountId, characterId: input.characterId },
        read.plan,
      );
      await tx
        .update(characterSkillMastery)
        .set({
          masterLevel: read.level,
          lastReadAt: new Date(input.now),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(characterSkillMastery.characterId, input.characterId),
            eq(characterSkillMastery.skillId, input.skillId),
          ),
        );

      return {
        inventory: read.state,
        gold,
        skillId: input.skillId,
        bookDefinitionId: read.bookItemId,
        success: read.success,
        previousLevel: read.previousLevel,
        masterLevel: read.level,
        readAtMs: read.readAtMs,
        nextReadAtMs: read.nextReadAtMs,
        chance: read.chance,
      };
    },
  );
}

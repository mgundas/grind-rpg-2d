import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  isClassId,
  isMapId,
  isWalkableAt,
  maxHp,
  maxMp,
  type AdminBanRequest,
  type AdminGiveItemRequest,
  type AdminUpdateCharacterRequest,
  type ItemInstanceDto,
} from "@jadethrone/shared";
import { getClass } from "@jadethrone/data/classes";
import { getItem, hasItem } from "@jadethrone/data/items";
import type { Db } from "../db/client";
import { accounts, characters, goldLog, type CharacterRow } from "../db/schema";
import { loadMapAssets } from "../maps/mapRegistry";
import { ServiceError } from "../errors";
import { logger } from "../logger";
import { ItemError } from "../items/errors";
import { toItemDto } from "../items/itemMappers";
import { applyItemTransaction } from "../items/itemTransactions";
import { loadInventory } from "../items/itemRepository";
import { planAdminGive, planAdminRemove } from "../items/planning";
import { writeAdminLog } from "./adminLog";

/** `bannedUntil IS NULL` means "not banned"; permanent bans use this sentinel. */
export const PERMANENT_BAN_UNTIL = new Date("9999-12-31T23:59:59.999Z");

async function audit(
  db: Db,
  actorAccountId: string,
  action: string,
  target: { accountId?: string | null; characterId?: string | null },
  detail: Record<string, unknown>,
  ip?: string | null,
): Promise<void> {
  try {
    await writeAdminLog(db, {
      actorAccountId,
      action,
      targetAccountId: target.accountId,
      targetCharacterId: target.characterId,
      detail,
      ip,
    });
  } catch (error) {
    // Never lose a successful mutation because the audit insert failed; log it.
    logger.error({ actorAccountId, action, error }, "admin audit write failed");
  }
}

export async function banAccount(
  db: Db,
  input: {
    actorAccountId: string;
    accountId: string;
    ban: AdminBanRequest;
    ip?: string | null;
  },
): Promise<{ bannedUntil: string; banReason: string | null }> {
  const bannedUntil =
    input.ban.durationMinutes === null
      ? PERMANENT_BAN_UNTIL
      : new Date(Date.now() + input.ban.durationMinutes * 60_000);

  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, input.accountId))
      .for("update")
      .limit(1);
    if (!row) {
      throw new ServiceError("not_found", "Account not found.");
    }
    await tx
      .update(accounts)
      .set({
        bannedUntil,
        banReason: input.ban.reason ?? null,
        tokenVersion: sql`${accounts.tokenVersion} + 1`,
      })
      .where(eq(accounts.id, input.accountId));
    await writeAdminLog(tx, {
      actorAccountId: input.actorAccountId,
      action: "account_ban",
      targetAccountId: input.accountId,
      detail: {
        durationMinutes: input.ban.durationMinutes,
        permanent: input.ban.durationMinutes === null,
        reason: input.ban.reason ?? null,
      },
      ip: input.ip,
    });
    return { bannedUntil: bannedUntil.toISOString(), banReason: input.ban.reason ?? null };
  });
  return result;
}

export async function unbanAccount(
  db: Db,
  input: {
    actorAccountId: string;
    accountId: string;
    ip?: string | null;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, input.accountId))
      .for("update")
      .limit(1);
    if (!row) {
      throw new ServiceError("not_found", "Account not found.");
    }
    await tx
      .update(accounts)
      .set({ bannedUntil: null, banReason: null })
      .where(eq(accounts.id, input.accountId));
    await writeAdminLog(tx, {
      actorAccountId: input.actorAccountId,
      action: "account_unban",
      targetAccountId: input.accountId,
      detail: {},
      ip: input.ip,
    });
  });
}

function validatePosition(row: CharacterRow, x: number, y: number): void {
  if (!isMapId(row.mapId)) {
    throw new ServiceError("internal", "Character has an unknown map.");
  }
  if (!isWalkableAt(loadMapAssets(row.mapId).grid, x, y)) {
    throw new ServiceError("validation", "That position is not walkable.", { position: "blocked" });
  }
}

export interface OfflineCharacterUpdateResult {
  level: number;
  gold: number;
  x: number;
  y: number;
  hp: number;
  mp: number;
}

/**
 * Offline admin edit. Level/stat changes recompute maxima; gold is an absolute
 * value converted to a logged delta. Position stays on the character's map.
 */
export async function updateCharacterOffline(
  db: Db,
  input: {
    actorAccountId: string;
    characterId: string;
    update: AdminUpdateCharacterRequest;
    ip?: string | null;
  },
): Promise<OfflineCharacterUpdateResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(characters)
      .where(eq(characters.id, input.characterId))
      .for("update")
      .limit(1);
    if (!row) {
      throw new ServiceError("not_found", "Character not found.");
    }

    const update = input.update;
    const level = update.level ?? row.level;
    const stats = {
      vit: update.statVit ?? row.statVit,
      int: update.statInt ?? row.statInt,
      str: update.statStr ?? row.statStr,
      dex: update.statDex ?? row.statDex,
    };
    if (!isClassId(row.classId)) {
      throw new ServiceError("internal", "Character has an unknown class.");
    }
    const info = getClass(row.classId);
    const maximumHp = maxHp({ baseHp: info.baseHp, vit: stats.vit, level });
    const maximumMp = maxMp({ baseMp: info.baseMp, int: stats.int, level });
    const x = update.x ?? row.x;
    const y = update.y ?? row.y;
    if (update.x !== undefined || update.y !== undefined) {
      validatePosition(row, x, y);
    }

    const nextGold = update.gold ?? row.gold;
    const goldDelta = nextGold - row.gold;
    const hp = Math.max(0, Math.min(row.hp, maximumHp));
    const mp = Math.max(0, Math.min(row.mp, maximumMp));

    await tx
      .update(characters)
      .set({
        level,
        xp: level !== row.level ? 0 : row.xp,
        gold: nextGold,
        hp,
        mp,
        statVit: stats.vit,
        statInt: stats.int,
        statStr: stats.str,
        statDex: stats.dex,
        x,
        y,
        updatedAt: new Date(),
      })
      .where(eq(characters.id, input.characterId));

    if (goldDelta !== 0) {
      await tx.insert(goldLog).values({
        id: randomUUID(),
        characterId: input.characterId,
        accountId: row.accountId,
        delta: goldDelta,
        balanceAfter: nextGold,
        reason: "admin",
        detail: { source: "admin_character_edit" },
      });
    }

    await writeAdminLog(tx, {
      actorAccountId: input.actorAccountId,
      action: "character_update",
      targetAccountId: row.accountId,
      targetCharacterId: input.characterId,
      detail: {
        fields: Object.keys(update),
        previousLevel: row.level,
        previousGold: row.gold,
        goldDelta,
      },
      ip: input.ip,
    });

    return { level, gold: nextGold, x, y, hp, mp };
  });
}

async function characterAccount(db: Db, characterId: string) {
  const [row] = await db
    .select({ id: characters.id, accountId: characters.accountId })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);
  if (!row) {
    throw new ServiceError("not_found", "Character not found.");
  }
  return row;
}

/**
 * Offline item grant. The route must check the live bus immediately before
 * calling this; `isOnline` re-checks after the load and aborts if the player
 * joined in the meantime (the admin can retry through the live path).
 */
export async function grantItemOffline(
  db: Db,
  input: {
    actorAccountId: string;
    characterId: string;
    request: AdminGiveItemRequest;
    ip?: string | null;
    isOnline?: (characterId: string) => boolean;
  },
): Promise<ItemInstanceDto> {
  if (!hasItem(input.request.definitionId)) {
    throw new ServiceError("validation", "Unknown item definition.", {
      definitionId: "unknown",
    });
  }
  const owner = await characterAccount(db, input.characterId);
  const loaded = await loadInventory(db, owner.accountId, input.characterId);
  if (input.isOnline?.(input.characterId)) {
    throw new ServiceError("conflict", "Character is online; retry the live grant.");
  }

  const definition = getItem(input.request.definitionId);
  const generatedIds: string[] = [];
  const newId = (): string => {
    const id = randomUUID();
    generatedIds.push(id);
    return id;
  };
  let plan;
  try {
    plan = planAdminGive(
      loaded.inventory,
      input.characterId,
      definition,
      input.request.quantity,
      input.request.upgradeLevel,
      input.request.bonuses,
      newId,
    );
  } catch (error) {
    if (error instanceof ItemError) {
      throw new ServiceError(
        error.code === "inventory_full" ? "conflict" : "validation",
        error.message,
      );
    }
    throw error;
  }

  await applyItemTransaction(
    db,
    { accountId: owner.accountId, characterId: input.characterId },
    plan.plan,
  );
  await audit(
    db,
    input.actorAccountId,
    "item_grant",
    { accountId: owner.accountId, characterId: input.characterId },
    {
      definitionId: definition.id,
      quantity: input.request.quantity,
      upgradeLevel: input.request.upgradeLevel,
    },
    input.ip,
  );

  const created =
    plan.state.items.find((item) => generatedIds.includes(item.id)) ??
    loaded.inventory.items.find((item) => item.itemId === definition.id);
  if (!created) {
    throw new ServiceError("internal", "Item grant did not produce a stack.");
  }
  return toItemDto(created);
}

export async function removeItemOffline(
  db: Db,
  input: {
    actorAccountId: string;
    characterId: string;
    itemId: string;
    ip?: string | null;
  },
): Promise<void> {
  const owner = await characterAccount(db, input.characterId);
  const loaded = await loadInventory(db, owner.accountId, input.characterId);
  let plan;
  try {
    plan = planAdminRemove(loaded.inventory, input.characterId, input.itemId);
  } catch (error) {
    if (error instanceof ItemError) {
      throw new ServiceError(
        error.code === "item_not_found" ? "not_found" : "validation",
        error.message,
      );
    }
    throw error;
  }
  await applyItemTransaction(
    db,
    { accountId: owner.accountId, characterId: input.characterId },
    plan.plan,
  );
  await audit(
    db,
    input.actorAccountId,
    "item_remove",
    { accountId: owner.accountId, characterId: input.characterId },
    { itemId: input.itemId },
    input.ip,
  );
}

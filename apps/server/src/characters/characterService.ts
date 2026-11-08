import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  CHARACTER_SLOTS,
  isClassId,
  isGender,
  isMapId,
  isValidCharacterName,
  isValidHairColor,
  isValidHairStyle,
  maxHp,
  maxMp,
  type CharacterSummary,
  type CreateCharacterRequest,
  type MapId,
} from "@jadethrone/shared";
import { getClass } from "@jadethrone/data/classes";
import { STARTER_KIT } from "@jadethrone/data/starterKits";
import type { Db } from "../db/client";
import { CHARACTER_UNIQUE, toServiceError } from "../db/errors";
import {
  accounts,
  characters,
  goldLog,
  itemLog,
  items,
  type CharacterRow,
} from "../db/schema";
import { ServiceError } from "../errors";
import { buildStarterKit } from "../items/starterKit";
import { loadSkillRanks } from "./characterSkills";
import { loadSkillMastery } from "./skillMastery";
import { toCharacterRecord, toCharacterSummary, type CharacterRecord } from "./characterMappers";
import { defaultSpawn, type CharacterSave } from "./spawn";

export type CharacterInsert = typeof characters.$inferInsert;
export type { CharacterSave, PositionSave } from "./spawn";

const MAX_POSITION = 65_535;
const MAX_HP_MP = 65_535;
const MAX_STAT = 90;
const MAX_LEVEL = 99;
const MAX_STAT_POINTS = 10_000;

function boundedInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    throw new ServiceError("validation", "Invalid character state.");
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizeSave(save: CharacterSave): CharacterSave {
  return {
    mapId: save.mapId,
    x: save.x,
    y: save.y,
    hp: boundedInt(save.hp, 0, MAX_HP_MP),
    mp: boundedInt(save.mp, 0, MAX_HP_MP),
    xp: boundedInt(save.xp, 0, Number.MAX_SAFE_INTEGER),
    level: boundedInt(save.level, 1, MAX_LEVEL),
    statVit: boundedInt(save.statVit, 0, MAX_STAT),
    statInt: boundedInt(save.statInt, 0, MAX_STAT),
    statStr: boundedInt(save.statStr, 0, MAX_STAT),
    statDex: boundedInt(save.statDex, 0, MAX_STAT),
    statPoints: boundedInt(save.statPoints, 0, MAX_STAT_POINTS),
  };
}

function validatePosition(mapId: MapId, x: number, y: number): void {
  if (!isMapId(mapId)) {
    throw new ServiceError("validation", "Unknown map.", { map: "unknown" });
  }
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x > MAX_POSITION ||
    y > MAX_POSITION
  ) {
    throw new ServiceError("validation", "Invalid character position.");
  }
}

/**
 * Pure creation logic: validate the request, derive the persisted starting
 * state from data/formulas, and return the row to insert. Kept separate so the
 * expensive/transactional path is testable without a database.
 */
export function buildNewCharacter(
  accountId: string,
  input: CreateCharacterRequest,
): CharacterInsert {
  const name = input.name.trim();
  if (!isValidCharacterName(name)) {
    throw new ServiceError("validation", "Names are 3–16 letters and numbers.", {
      name: "invalid",
    });
  }
  if (!isClassId(input.classId)) {
    throw new ServiceError("validation", "Unknown class.", { classId: "invalid" });
  }
  if (!isGender(input.gender)) {
    throw new ServiceError("validation", "Unknown gender.", { gender: "invalid" });
  }
  if (!isValidHairStyle(input.hairStyle)) {
    throw new ServiceError("validation", "Unknown hair style.", { hairStyle: "invalid" });
  }
  if (!isValidHairColor(input.hairColor)) {
    throw new ServiceError("validation", "Unknown hair colour.", { hairColor: "invalid" });
  }

  const info = getClass(input.classId);
  const spawn = defaultSpawn();
  const level = 1;

  return {
    id: randomUUID(),
    accountId,
    name,
    classId: info.id,
    doctrine: null,
    gender: input.gender,
    hairStyle: input.hairStyle,
    hairColor: input.hairColor,
    level,
    xp: 0,
    gold: STARTER_KIT.gold,
    hp: maxHp({ baseHp: info.baseHp, vit: info.stats.vit, level }),
    mp: maxMp({ baseMp: info.baseMp, int: info.stats.int, level }),
    statVit: info.stats.vit,
    statInt: info.stats.int,
    statStr: info.stats.str,
    statDex: info.stats.dex,
    statPoints: 0,
    skillPoints: 0,
    mapId: spawn.mapId,
    x: spawn.x,
    y: spawn.y,
    channel: 1,
    pvpMode: "peaceful",
    playtimeSeconds: 0,
  };
}

export async function listCharacters(db: Db, accountId: string): Promise<CharacterSummary[]> {
  try {
    const rows = await db
      .select()
      .from(characters)
      .where(eq(characters.accountId, accountId))
      .orderBy(asc(characters.createdAt), asc(characters.id));
    return rows.map(toCharacterSummary);
  } catch (error) {
    throw toServiceError(error);
  }
}

export async function createCharacter(
  db: Db,
  accountId: string,
  input: CreateCharacterRequest,
): Promise<CharacterSummary> {
  const insert = buildNewCharacter(accountId, input);
  try {
    return await db.transaction(async (tx) => {
      // The account row is the per-account mutex: count + insert must be atomic
      // or two parallel creates can exceed the four-slot limit.
      const [account] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.id, accountId))
        .for("update")
        .limit(1);
      if (!account) {
        throw new ServiceError("not_found", "Account not found.");
      }

      const existing = await tx.$count(characters, eq(characters.accountId, accountId));
      if (existing >= CHARACTER_SLOTS) {
        throw new ServiceError("slots_full", `All ${CHARACTER_SLOTS} character slots are in use.`);
      }

      const [row] = await tx.insert(characters).values(insert).returning();
      const characterRow = row as CharacterRow;

      // Starter gear lives in the same transaction: a failed create never
      // leaves orphan items or a gold ledger entry behind.
      const kit = buildStarterKit(characterRow.id, accountId, input.classId);
      if (kit.rows.length > 0) {
        await tx.insert(items).values(kit.rows);
      }
      if (kit.logs.length > 0) {
        await tx.insert(itemLog).values(kit.logs);
      }
      if (kit.gold > 0) {
        await tx.insert(goldLog).values({
          id: randomUUID(),
          characterId: characterRow.id,
          accountId,
          delta: kit.gold,
          balanceAfter: kit.gold,
          reason: "starter",
          detail: { kit: true },
        });
      }

      return toCharacterSummary(characterRow);
    });
  } catch (error) {
    throw toServiceError(error, CHARACTER_UNIQUE);
  }
}

export interface DeleteCharacterOptions {
  /** Injected by the route: in-process session registry lookup. */
  isOnline?: (characterId: string) => boolean;
}

export async function deleteCharacter(
  db: Db,
  accountId: string,
  characterId: string,
  options: DeleteCharacterOptions = {},
): Promise<void> {
  try {
    // Ownership first: never reveal another account's character state.
    const [owned] = await db
      .select({ id: characters.id })
      .from(characters)
      .where(and(eq(characters.id, characterId), eq(characters.accountId, accountId)))
      .limit(1);
    if (!owned) {
      throw new ServiceError("not_found", "Character not found.");
    }
    if (options.isOnline?.(characterId)) {
      throw new ServiceError(
        "character_online",
        "That character is currently online. Log out first.",
      );
    }

    const rows = await db
      .delete(characters)
      .where(and(eq(characters.id, characterId), eq(characters.accountId, accountId)))
      .returning({ id: characters.id });
    if (rows.length === 0) {
      throw new ServiceError("not_found", "Character not found.");
    }
  } catch (error) {
    throw toServiceError(error);
  }
}

export async function getCharacterForAccount(
  db: Db,
  accountId: string,
  characterId: string,
): Promise<CharacterRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(characterId)) {
    return null;
  }
  try {
    const [row] = await db
      .select()
      .from(characters)
      .where(and(eq(characters.id, characterId), eq(characters.accountId, accountId)))
      .limit(1);
    if (!row) {
      return null;
    }
    const skills = await loadSkillRanks(db, characterId);
    const skillMastery = await loadSkillMastery(db, characterId);
    return toCharacterRecord(row, skills, skillMastery);
  } catch (error) {
    throw toServiceError(error);
  }
}

/**
 * Persist the authoritative character state (position, vitals, progression).
 * Returns false when the row no longer exists (deleted mid-session), which
 * callers treat as a silent no-op.
 */
export async function saveCharacterState(
  db: Db,
  characterId: string,
  rawSave: CharacterSave,
): Promise<boolean> {
  validatePosition(rawSave.mapId, rawSave.x, rawSave.y);
  const save = normalizeSave(rawSave);
  try {
    const rows = await db
      .update(characters)
      .set({
        mapId: save.mapId,
        x: save.x,
        y: save.y,
        hp: save.hp,
        mp: save.mp,
        xp: save.xp,
        level: save.level,
        statVit: save.statVit,
        statInt: save.statInt,
        statStr: save.statStr,
        statDex: save.statDex,
        statPoints: save.statPoints,
        updatedAt: sql`now()`,
      })
      .where(eq(characters.id, characterId))
      .returning({ id: characters.id });
    return rows.length > 0;
  } catch (error) {
    throw toServiceError(error);
  }
}

export interface BulkCharacterSave extends CharacterSave {
  characterId: string;
}

/**
 * Dirty-player autosave in one round trip. Empty input is a no-op (e.g. an
 * idle room or a test teardown without a database).
 */
export async function saveCharacterStates(
  db: Db,
  saves: ReadonlyArray<BulkCharacterSave>,
): Promise<void> {
  if (saves.length === 0) {
    return;
  }
  const normalized = saves.map((save) => {
    validatePosition(save.mapId, save.x, save.y);
    return { characterId: save.characterId, ...normalizeSave(save) };
  });

  const values = normalized.map(
    (save) =>
      sql`(${save.characterId}::uuid, ${save.mapId}::text, ${save.x}::real, ${save.y}::real, ${save.hp}::int, ${save.mp}::int, ${save.xp}::bigint, ${save.level}::int, ${save.statVit}::int, ${save.statInt}::int, ${save.statStr}::int, ${save.statDex}::int, ${save.statPoints}::int)`,
  );
  try {
    await db.execute(sql`
      UPDATE ${characters} AS c
      SET map_id = v.map_id, x = v.x, y = v.y,
          hp = v.hp, mp = v.mp, xp = v.xp, level = v.level,
          stat_vit = v.stat_vit, stat_int = v.stat_int,
          stat_str = v.stat_str, stat_dex = v.stat_dex,
          stat_points = v.stat_points, updated_at = now()
      FROM (VALUES ${sql.join(values, sql`, `)}) AS v(
        id, map_id, x, y, hp, mp, xp, level,
        stat_vit, stat_int, stat_str, stat_dex, stat_points
      )
      WHERE c.id = v.id
    `);
  } catch (error) {
    throw toServiceError(error);
  }
}

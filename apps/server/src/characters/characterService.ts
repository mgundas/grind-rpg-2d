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
import type { Db } from "../db/client";
import { CHARACTER_UNIQUE, toServiceError } from "../db/errors";
import { accounts, characters, type CharacterRow } from "../db/schema";
import { ServiceError } from "../errors";
import { toCharacterRecord, toCharacterSummary, type CharacterRecord } from "./characterMappers";
import { defaultSpawn, type PositionSave } from "./spawn";

export type CharacterInsert = typeof characters.$inferInsert;

const MAX_POSITION = 65_535;

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
    gold: 0,
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
      return toCharacterSummary(row as CharacterRow);
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
  if (options.isOnline?.(characterId)) {
    throw new ServiceError(
      "character_online",
      "That character is currently online. Log out first.",
    );
  }
  try {
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
    return row ? toCharacterRecord(row) : null;
  } catch (error) {
    throw toServiceError(error);
  }
}

/**
 * Persist the authoritative position. Returns false when the row no longer
 * exists (deleted mid-session), which callers treat as a silent no-op.
 */
export async function saveCharacterPosition(
  db: Db,
  characterId: string,
  save: PositionSave,
): Promise<boolean> {
  validatePosition(save.mapId, save.x, save.y);
  try {
    const rows = await db
      .update(characters)
      .set({ mapId: save.mapId, x: save.x, y: save.y, updatedAt: new Date() })
      .where(eq(characters.id, characterId))
      .returning({ id: characters.id });
    return rows.length > 0;
  } catch (error) {
    throw toServiceError(error);
  }
}

export interface BulkPositionSave extends PositionSave {
  characterId: string;
}

/**
 * Dirty-player autosave in one round trip. Empty input is a no-op (e.g. an
 * idle room or a test teardown without a database).
 */
export async function saveCharacterPositions(
  db: Db,
  saves: ReadonlyArray<BulkPositionSave>,
): Promise<void> {
  if (saves.length === 0) {
    return;
  }
  for (const save of saves) {
    validatePosition(save.mapId, save.x, save.y);
  }

  const values = saves.map(
    (save) =>
      sql`(${save.characterId}::uuid, ${save.mapId}::text, ${save.x}::real, ${save.y}::real)`,
  );
  try {
    await db.execute(sql`
      UPDATE ${characters} AS c
      SET map_id = v.map_id, x = v.x, y = v.y, updated_at = now()
      FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, map_id, x, y)
      WHERE c.id = v.id
    `);
  } catch (error) {
    throw toServiceError(error);
  }
}

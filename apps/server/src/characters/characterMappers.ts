import {
  isClassId,
  isGender,
  isMapId,
  type CharacterSummary,
  type ClassId,
  type Gender,
  type MapId,
  type PvpMode,
  isPvpMode,
} from "@jadethrone/shared";
import { ServiceError } from "../errors";
import type { CharacterRow } from "../db/schema";
import type { SkillMasteryMap } from "./skillMastery";

/**
 * Server-side character shape used by the room/auth layer. It is the DB row
 * without timestamps/account internals that the game never needs.
 */
export interface CharacterRecord {
  id: string;
  accountId: string;
  name: string;
  classId: ClassId;
  doctrine: string | null;
  gender: Gender;
  hairStyle: number;
  hairColor: number;
  level: number;
  xp: number;
  gold: number;
  hp: number;
  mp: number;
  statVit: number;
  statInt: number;
  statStr: number;
  statDex: number;
  statPoints: number;
  skillPoints: number;
  /** Learned skill ranks keyed by skill id (rank 0 is never stored). */
  skills: Record<string, number>;
  skillMastery?: SkillMasteryMap;
  map: MapId;
  x: number;
  y: number;
  channel: number;
  pvpMode: PvpMode;
}

function invalidRow(message: string): never {
  throw new ServiceError("internal", `Corrupt character row: ${message}`);
}

export function toCharacterRecord(
  row: CharacterRow,
  skills: Record<string, number> = {},
  skillMastery: SkillMasteryMap = {},
): CharacterRecord {
  if (!isClassId(row.classId)) invalidRow(`class "${row.classId}"`);
  if (!isGender(row.gender)) invalidRow(`gender "${row.gender}"`);
  if (!isMapId(row.mapId)) invalidRow(`map "${row.mapId}"`);

  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    classId: row.classId,
    doctrine: row.doctrine,
    gender: row.gender,
    hairStyle: row.hairStyle,
    hairColor: row.hairColor,
    level: row.level,
    xp: row.xp,
    gold: row.gold,
    hp: row.hp,
    mp: row.mp,
    statVit: row.statVit,
    statInt: row.statInt,
    statStr: row.statStr,
    statDex: row.statDex,
    statPoints: row.statPoints,
    skillPoints: row.skillPoints,
    skills,
    skillMastery,
    map: row.mapId,
    x: row.x,
    y: row.y,
    channel: row.channel,
    pvpMode: isPvpMode(row.pvpMode) ? row.pvpMode : "peaceful",
  };
}

/** Public character data for the owner (character select screen / API). */
export function toCharacterSummary(row: CharacterRow): CharacterSummary {
  if (!isClassId(row.classId)) invalidRow(`class "${row.classId}"`);
  if (!isGender(row.gender)) invalidRow(`gender "${row.gender}"`);
  if (!isMapId(row.mapId)) invalidRow(`map "${row.mapId}"`);

  return {
    id: row.id,
    name: row.name,
    classId: row.classId,
    level: row.level,
    map: row.mapId,
    x: row.x,
    y: row.y,
    gender: row.gender,
    hairStyle: row.hairStyle,
    hairColor: row.hairColor,
    createdAt: row.createdAt.toISOString(),
  };
}

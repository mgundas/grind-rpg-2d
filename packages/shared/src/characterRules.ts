import { MAP_IDS, type MapId } from "./constants";

/**
 * Character-creation rules shared by the REST API, the room authenticator and
 * the React forms (GAME_DESIGN.md §4.1). Balance values (stats, HP/MP bases,
 * outfit colours) live in `packages/data/classes.json`, not here.
 */
export const CLASS_IDS = ["warrior", "assassin", "hexblade", "mystic"] as const;
export type ClassId = (typeof CLASS_IDS)[number];

export const GENDERS = ["male", "female"] as const;
export type Gender = (typeof GENDERS)[number];

export const HAIR_STYLE_COUNT = 3;
export const HAIR_COLOR_COUNT = 3;

/** One account can hold four characters (GAME_DESIGN.md §4.1). */
export const CHARACTER_SLOTS = 4;

export const CHARACTER_NAME_MIN = 3;
export const CHARACTER_NAME_MAX = 16;

/**
 * Letters and numbers only, 3–16 characters. Names are unique
 * case-insensitively at the database level; this rule is the UI/API pre-check.
 */
export const CHARACTER_NAME_PATTERN = /^[A-Za-z0-9]{3,16}$/;

export interface CharacterAppearance {
  classId: ClassId;
  gender: Gender;
  hairStyle: number;
  hairColor: number;
}

/** Character data safe to return to its owner (never includes account secrets). */
export interface CharacterSummary extends CharacterAppearance {
  id: string;
  name: string;
  level: number;
  map: MapId;
  x: number;
  y: number;
  createdAt: string;
}

export const MAP_LABELS: Record<MapId, string> = {
  map_ember_village: "Ember Village",
  map_ember_fields: "Ember Highlands",
  map_gale_village: "Gale Village",
  map_gale_highlands: "Gale Highlands",
  map_tide_village: "Tide Village",
  map_tide_highlands: "Tide Highlands",
  map_valley_of_echoes: "Valley of Echoes",
  map_corrupted_forest: "Corrupted Forest",
  map_spider_cave: "Spider Cave",
};

export function isValidCharacterName(name: string): boolean {
  return CHARACTER_NAME_PATTERN.test(name);
}

export function isClassId(value: string): value is ClassId {
  return (CLASS_IDS as readonly string[]).includes(value);
}

export function isGender(value: string): value is Gender {
  return (GENDERS as readonly string[]).includes(value);
}

export function isValidHairStyle(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < HAIR_STYLE_COUNT;
}

export function isValidHairColor(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < HAIR_COLOR_COUNT;
}

export function isMapId(value: string): value is MapId {
  return (MAP_IDS as readonly string[]).includes(value);
}

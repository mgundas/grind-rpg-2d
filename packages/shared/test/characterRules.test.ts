import { describe, expect, it } from "vitest";
import {
  CHARACTER_NAME_MAX,
  CHARACTER_SLOTS,
  CLASS_IDS,
  GENDERS,
  HAIR_COLOR_COUNT,
  HAIR_STYLE_COUNT,
  KINGDOM_IDS,
  KINGDOMS,
  MAP_IDS,
  MAP_LABELS,
  isClassId,
  isGender,
  isMapId,
  isValidCharacterName,
  isValidHairColor,
  isValidHairStyle,
} from "@jadethrone/shared";

describe("character name rules", () => {
  it("accepts letters and numbers from 3 to 16 characters", () => {
    expect(isValidCharacterName("Abc")).toBe(true);
    expect(isValidCharacterName("Bob123")).toBe(true);
    expect(isValidCharacterName("A".repeat(CHARACTER_NAME_MAX))).toBe(true);
  });

  it("rejects too short, too long, spaces, punctuation and non-ASCII", () => {
    expect(isValidCharacterName("ab")).toBe(false);
    expect(isValidCharacterName("a".repeat(CHARACTER_NAME_MAX + 1))).toBe(false);
    expect(isValidCharacterName("John Doe")).toBe(false);
    expect(isValidCharacterName("abc-def")).toBe(false);
    expect(isValidCharacterName("abc_def")).toBe(false);
    expect(isValidCharacterName("üser")).toBe(false);
    expect(isValidCharacterName("")).toBe(false);
  });
});

describe("character creation constants", () => {
  it("has four classes, two genders and three hair options", () => {
    expect(CLASS_IDS).toEqual(["warrior", "assassin", "hexblade", "mystic"]);
    expect(GENDERS).toEqual(["male", "female"]);
    expect(HAIR_STYLE_COUNT).toBe(3);
    expect(HAIR_COLOR_COUNT).toBe(3);
    expect(CHARACTER_SLOTS).toBe(4);
  });

  it("validates class, gender, hair and map ids", () => {
    expect(isClassId("warrior")).toBe(true);
    expect(isClassId("mage")).toBe(false);
    expect(isGender("female")).toBe(true);
    expect(isGender("other")).toBe(false);
    expect(isValidHairStyle(0)).toBe(true);
    expect(isValidHairStyle(HAIR_STYLE_COUNT)).toBe(false);
    expect(isValidHairStyle(-1)).toBe(false);
    expect(isValidHairStyle(1.5)).toBe(false);
    expect(isValidHairColor(2)).toBe(true);
    expect(isValidHairColor(3)).toBe(false);
    expect(isMapId("map_ember_village")).toBe(true);
    expect(isMapId("map_nowhere")).toBe(false);
  });

  it("keeps kingdom ids and map labels in sync with their data", () => {
    expect(KINGDOM_IDS).toEqual(KINGDOMS.map((kingdom) => kingdom.id));
    expect(Object.keys(MAP_LABELS).sort()).toEqual([...MAP_IDS].sort());
  });
});

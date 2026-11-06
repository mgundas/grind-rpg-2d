import { describe, expect, it } from "vitest";
import { VILLAGE_SPAWN } from "@jadethrone/data";
import type { CreateCharacterRequest } from "@jadethrone/shared";
import { buildNewCharacter } from "../../src/characters/characterService";
import { defaultSpawn } from "../../src/characters/spawn";
import { ServiceError } from "../../src/errors";

const ACCOUNT_ID = "3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b";

function input(overrides: Partial<CreateCharacterRequest> = {}): CreateCharacterRequest {
  return {
    name: "Grinder",
    classId: "warrior",
    gender: "male",
    hairStyle: 0,
    hairColor: 0,
    ...overrides,
  };
}

describe("buildNewCharacter", () => {
  it("derives a level-1 warrior from data and formulas", () => {
    const row = buildNewCharacter(ACCOUNT_ID, input());
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.accountId).toBe(ACCOUNT_ID);
    expect(row.name).toBe("Grinder");
    expect(row.classId).toBe("warrior");
    expect(row.gender).toBe("male");
    expect(row.hairStyle).toBe(0);
    expect(row.hairColor).toBe(0);
    expect(row.level).toBe(1);
    expect(row.xp).toBe(0);
    expect(row.gold).toBe(0);
    expect(row.hp).toBe(316); // 120 + 4*40 + 1*36
    expect(row.mp).toBe(92); // 20 + 3*20 + 1*12
    expect(row.statVit).toBe(4);
    expect(row.statInt).toBe(3);
    expect(row.statStr).toBe(6);
    expect(row.statDex).toBe(3);
    expect(row.doctrine).toBeNull();
    expect(row.mapId).toBe("map_ember_village");
    expect(row.x).toBe(VILLAGE_SPAWN.x);
    expect(row.y).toBe(VILLAGE_SPAWN.y);
    expect(row.channel).toBe(1);
    expect(row.pvpMode).toBe("peaceful");
    expect(row.playtimeSeconds).toBe(0);
  });

  it("uses each class's own base HP/MP", () => {
    expect(buildNewCharacter(ACCOUNT_ID, input({ classId: "assassin" })).hp).toBe(246);
    expect(buildNewCharacter(ACCOUNT_ID, input({ classId: "hexblade" })).hp).toBe(256);
    expect(buildNewCharacter(ACCOUNT_ID, input({ classId: "mystic" })).hp).toBe(236);
    expect(buildNewCharacter(ACCOUNT_ID, input({ classId: "mystic" })).mp).toBe(182);
  });

  it("rejects invalid creation input with field details", () => {
    const cases: Array<[Partial<CreateCharacterRequest>, string]> = [
      [{ name: "ab" }, "name"],
      [{ name: "a".repeat(17) }, "name"],
      [{ name: "Bad Name" }, "name"],
      [{ name: "Åsa" }, "name"],
      [{ classId: "paladin" as never }, "classId"],
      [{ gender: "other" as never }, "gender"],
      [{ hairStyle: 3 }, "hairStyle"],
      [{ hairStyle: -1 }, "hairStyle"],
      [{ hairStyle: 1.5 }, "hairStyle"],
      [{ hairColor: 3 }, "hairColor"],
    ];

    for (const [overrides, field] of cases) {
      try {
        buildNewCharacter(ACCOUNT_ID, input(overrides));
        throw new Error(`expected ${field} to be rejected`);
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
        expect((error as ServiceError).code).toBe("validation");
        expect((error as ServiceError).fields).toHaveProperty(field);
      }
    }
  });

  it("trims the character name", () => {
    expect(buildNewCharacter(ACCOUNT_ID, input({ name: "  Trimmed  " })).name).toBe("Trimmed");
  });
});

describe("defaultSpawn", () => {
  it("matches the generated village spawn", () => {
    expect(defaultSpawn()).toEqual({
      mapId: "map_ember_village",
      x: VILLAGE_SPAWN.x,
      y: VILLAGE_SPAWN.y,
    });
  });
});

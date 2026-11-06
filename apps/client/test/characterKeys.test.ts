import { describe, expect, it } from "vitest";
import { HAIR_COLORS, characterTextureKey } from "../src/assets/characterArt";

describe("characterTextureKey", () => {
  it("is deterministic for the same appearance", () => {
    const look = { classId: "warrior", gender: "male", hairStyle: 0, hairColor: 0 } as const;
    expect(characterTextureKey(look)).toBe(characterTextureKey({ ...look }));
  });

  it("changes with every cosmetic field", () => {
    const base = { classId: "warrior", gender: "male", hairStyle: 0, hairColor: 0 } as const;
    const keys = new Set([
      characterTextureKey(base),
      characterTextureKey({ ...base, classId: "assassin" }),
      characterTextureKey({ ...base, gender: "female" }),
      characterTextureKey({ ...base, hairStyle: 1 }),
      characterTextureKey({ ...base, hairColor: 1 }),
    ]);
    expect(keys.size).toBe(5);
  });

  it("ships three hair colours", () => {
    expect(HAIR_COLORS).toHaveLength(3);
  });
});

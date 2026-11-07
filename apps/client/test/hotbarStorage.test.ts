import { describe, expect, it } from "vitest";
import { parseHotbar } from "../src/ui/hotbarStorage";

describe("hotbar storage", () => {
  it("migrates Phase 5 string bindings to item bindings", () => {
    const parsed = parseHotbar(JSON.stringify(["potion_hp_s", null, 42, { kind: "skill", id: "x" }]));
    expect(parsed[0]).toEqual({ kind: "item", id: "potion_hp_s" });
    expect(parsed[1]).toBeNull();
    expect(parsed[2]).toBeNull();
    expect(parsed[3]).toEqual({ kind: "skill", id: "x" });
    expect(parsed).toHaveLength(8);
  });

  it("accepts item and skill objects and rejects malformed values", () => {
    const parsed = parseHotbar(
      JSON.stringify([
        { kind: "item", id: "potion_mp_s" },
        { kind: "skill", id: "warrior_blade_whirlwind" },
        { kind: "other", id: "x" },
        { kind: "skill" },
      ]),
    );
    expect(parsed[0]).toEqual({ kind: "item", id: "potion_mp_s" });
    expect(parsed[1]).toEqual({ kind: "skill", id: "warrior_blade_whirlwind" });
    expect(parsed[2]).toBeNull();
    expect(parsed[3]).toBeNull();
  });

  it("returns an empty bar for corrupt or missing storage", () => {
    expect(parseHotbar(null).every((entry) => entry === null)).toBe(true);
    expect(parseHotbar("not json").every((entry) => entry === null)).toBe(true);
    expect(parseHotbar("{}").every((entry) => entry === null)).toBe(true);
  });
});

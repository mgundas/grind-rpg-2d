import { describe, expect, it } from "vitest";
import { isGmRole, parseGmCommand } from "../../src/admin/gmCommands";

describe("GM command parser", () => {
  it("returns null for normal chat", () => {
    expect(parseGmCommand("hello")).toBeNull();
    expect(parseGmCommand("hello /not a command")).toBeNull();
  });

  it("parses movement and targeting commands", () => {
    expect(parseGmCommand("/goto 100 200")).toEqual({ kind: "goto", x: 100, y: 200 });
    expect(parseGmCommand("/warp Alice")).toEqual({ kind: "warp", name: "Alice" });
    expect(parseGmCommand("/summon Bob")).toEqual({ kind: "summon", name: "Bob" });
    expect(parseGmCommand("/kick Carol")).toEqual({ kind: "kick", name: "Carol" });
  });

  it("parses item, spawn and level commands with defaults", () => {
    expect(parseGmCommand("/item sword_ember_t1")).toEqual({
      kind: "item",
      itemId: "sword_ember_t1",
      count: 1,
    });
    expect(parseGmCommand("/spawn wild_dog 3")).toEqual({
      kind: "spawn",
      typeId: "wild_dog",
      count: 3,
    });
    expect(parseGmCommand("/level 15")).toEqual({ kind: "level", level: 15 });
  });

  it("rejects malformed commands instead of guessing", () => {
    expect(parseGmCommand("/goto a b")).toMatchObject({ kind: "unknown" });
    expect(parseGmCommand("/goto 1")).toMatchObject({ kind: "unknown" });
    expect(parseGmCommand("/level 0")).toMatchObject({ kind: "unknown" });
    expect(parseGmCommand("/level 100")).toMatchObject({ kind: "unknown" });
    expect(parseGmCommand("/item sword 0")).toMatchObject({ kind: "unknown" });
    expect(parseGmCommand("/unknown")).toMatchObject({ kind: "unknown" });
  });

  it("recognises the GM roles", () => {
    expect(isGmRole("gm")).toBe(true);
    expect(isGmRole("admin")).toBe(true);
    expect(isGmRole("player")).toBe(false);
  });
});

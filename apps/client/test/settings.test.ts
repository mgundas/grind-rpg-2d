import { describe, expect, it } from "vitest";
import {
  DEFAULT_KEYBINDS,
  KEYBIND_ACTIONS,
  displayKey,
  findKeyConflict,
  matchesKeybind,
  normalizeKey,
  parseKeybinds,
} from "../src/ui/keybinds";
import { defaultSettings, parseSettings } from "../src/ui/settings";

describe("normalizeKey", () => {
  it("normalizes letters, named keys and function keys", () => {
    expect(normalizeKey("W")).toBe("w");
    expect(normalizeKey(" ")).toBe("space");
    expect(normalizeKey("Escape")).toBe("escape");
    expect(normalizeKey("ArrowUp")).toBe("arrowup");
    expect(normalizeKey("F1")).toBe("f1");
    expect(normalizeKey("Enter")).toBe("enter");
  });
});

describe("displayKey", () => {
  it("renders readable labels", () => {
    expect(displayKey("w")).toBe("W");
    expect(displayKey("space")).toBe("Space");
    expect(displayKey("arrowleft")).toBe("←");
    expect(displayKey("f9")).toBe("F9");
    expect(displayKey("escape")).toBe("Esc");
  });
});

describe("findKeyConflict", () => {
  it("finds the action bound to a key", () => {
    expect(findKeyConflict(DEFAULT_KEYBINDS, "w")).toBe("moveUp");
    expect(findKeyConflict(DEFAULT_KEYBINDS, "F1")).toBe("hotbar5");
  });

  it("ignores the action being rebound", () => {
    expect(findKeyConflict(DEFAULT_KEYBINDS, "w", "moveUp")).toBeNull();
  });

  it("returns null for an unbound key", () => {
    expect(findKeyConflict(DEFAULT_KEYBINDS, "q")).toBeNull();
  });
});

describe("matchesKeybind", () => {
  it("matches case-insensitively and by named key", () => {
    expect(matchesKeybind(DEFAULT_KEYBINDS, { key: "W" }, "moveUp")).toBe(true);
    expect(matchesKeybind(DEFAULT_KEYBINDS, { key: " " }, "attack")).toBe(true);
    expect(matchesKeybind(DEFAULT_KEYBINDS, { key: "F3" }, "hotbar7")).toBe(true);
    expect(matchesKeybind(DEFAULT_KEYBINDS, { key: "F3" }, "debug")).toBe(false);
  });
});

describe("parseKeybinds", () => {
  it("fills missing and invalid entries with defaults", () => {
    const parsed = parseKeybinds({ moveUp: "T", attack: 42 });
    expect(parsed.moveUp).toBe("t");
    expect(parsed.attack).toBe(DEFAULT_KEYBINDS.attack);
    expect(Object.keys(parsed).sort()).toEqual([...KEYBIND_ACTIONS].sort());
  });

  it("falls back entirely for non-objects", () => {
    expect(parseKeybinds(null)).toEqual(DEFAULT_KEYBINDS);
    expect(parseKeybinds("nope")).toEqual(DEFAULT_KEYBINDS);
  });
});

describe("parseSettings", () => {
  it("returns defaults for missing or corrupt storage", () => {
    expect(parseSettings(null)).toEqual(defaultSettings());
    expect(parseSettings("{not json")).toEqual(defaultSettings());
    expect(parseSettings("[]")).toEqual(defaultSettings());
  });

  it("clamps volume and validates the zoom level", () => {
    const parsed = parseSettings(
      JSON.stringify({ masterVolume: 9, musicVolume: -2, sfxVolume: "loud", zoom: 7 }),
    );
    expect(parsed.masterVolume).toBe(1);
    expect(parsed.musicVolume).toBe(0);
    expect(parsed.sfxVolume).toBe(defaultSettings().sfxVolume);
    expect(parsed.zoom).toBe(defaultSettings().zoom);
  });

  it("keeps valid fields and fills the rest", () => {
    const parsed = parseSettings(
      JSON.stringify({
        showNames: false,
        showDamageNumbers: false,
        muted: true,
        zoom: 3,
        keybinds: { attack: "Q" },
      }),
    );
    expect(parsed.showNames).toBe(false);
    expect(parsed.showDamageNumbers).toBe(false);
    expect(parsed.muted).toBe(true);
    expect(parsed.zoom).toBe(3);
    expect(parsed.keybinds.attack).toBe("q");
    expect(parsed.keybinds.moveUp).toBe(DEFAULT_KEYBINDS.moveUp);
  });
});

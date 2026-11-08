import { describe, expect, it, vi } from "vitest";
import { createSocialDirectory, type SocialHandle } from "../../src/social/bus";

function handle(overrides: Partial<SocialHandle> = {}): SocialHandle {
  return {
    accountId: "account-1",
    characterId: "char-1",
    sessionId: "session-1",
    name: "Alice",
    kingdom: "ember",
    mapId: "map_ember_village",
    roomId: "room-1",
    send: vi.fn(),
    ...overrides,
  };
}

describe("social directory", () => {
  it("registers, finds case-insensitively and delivers", () => {
    const directory = createSocialDirectory();
    const alice = handle();
    directory.register(alice);
    expect(directory.isOnline("char-1")).toBe(true);
    expect(directory.findByName("alice")?.characterId).toBe("char-1");
    expect(directory.send("char-1", "chatMsg", { text: "hi" })).toBe(true);
    expect(alice.send).toHaveBeenCalledWith("chatMsg", { text: "hi" });
    expect(directory.send("missing", "chatMsg", {})).toBe(false);
  });

  it("keeps the newest handle when a duplicate session joins", () => {
    const directory = createSocialDirectory();
    const oldHandle = handle({ sessionId: "old", send: vi.fn() });
    const newHandle = handle({ sessionId: "new", send: vi.fn() });
    directory.register(oldHandle);
    directory.register(newHandle);

    directory.unregister("char-1", "old");
    expect(directory.get("char-1")?.sessionId).toBe("new");
    directory.send("char-1", "ping", {});
    expect(oldHandle.send).not.toHaveBeenCalled();
    expect(newHandle.send).toHaveBeenCalled();

    directory.unregister("char-1", "new");
    expect(directory.isOnline("char-1")).toBe(false);
  });

  it("swallows closed-client errors and deduplicates sendMany", () => {
    const directory = createSocialDirectory();
    const bad = handle({
      characterId: "bad",
      name: "Bad",
      send: () => {
        throw new Error("closed");
      },
    });
    const good = handle({ characterId: "good", name: "Good" });
    directory.register(bad);
    directory.register(good);

    expect(directory.send("bad", "x", {})).toBe(false);
    expect(directory.sendMany(["good", "good", "bad", "offline"], "x", {})).toBe(1);
    expect(good.send).toHaveBeenCalledTimes(1);
  });

  it("updates the live guild tag through the handle hook", () => {
    const directory = createSocialDirectory();
    const setGuildTag = vi.fn();
    directory.register(handle({ setGuildTag }));
    directory.updateGuildTag("char-1", "Jade");
    expect(setGuildTag).toHaveBeenCalledWith("Jade");
    directory.updateGuildTag("missing", "Jade");
  });

  it("clears all handles", () => {
    const directory = createSocialDirectory();
    directory.register(handle());
    directory.clear();
    expect(directory.list()).toHaveLength(0);
    expect(directory.findByName("Alice")).toBeUndefined();
  });
});

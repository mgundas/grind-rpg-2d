import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { MSG, SESSION_KICK_CODE } from "@jadethrone/shared";
import { SessionRegistry, type SessionHandle } from "../../src/auth/sessionRegistry";

function makeHandle(
  accountId: string,
  characterId: string,
  sessionId: string,
): SessionHandle & {
  saveForKick: Mock<() => Promise<void>>;
  send: Mock<(type: string, payload: unknown) => void>;
  leave: Mock<(code: number) => void>;
} {
  return {
    accountId,
    characterId,
    sessionId,
    saveForKick: vi.fn<() => Promise<void>>(async () => undefined),
    send: vi.fn<(type: string, payload: unknown) => void>(),
    leave: vi.fn<(code: number) => void>(),
  };
}

describe("SessionRegistry", () => {
  let registry: SessionRegistry;

  beforeEach(() => {
    registry = new SessionRegistry();
  });

  it("tracks the active account and character", async () => {
    const handle = makeHandle("acc-1", "char-1", "session-1");
    await registry.register(handle);
    expect(registry.getActive("acc-1")).toBe(handle);
    expect(registry.isCharacterOnline("char-1")).toBe(true);
  });

  it("saves, notifies and closes the previous session on a duplicate join", async () => {
    const first = makeHandle("acc-1", "char-1", "session-1");
    const second = makeHandle("acc-1", "char-1", "session-2");
    await registry.register(first);
    await registry.register(second);

    expect(first.saveForKick).toHaveBeenCalledOnce();
    expect(first.send).toHaveBeenCalledWith(MSG.sessionKicked, { reason: "duplicate" });
    expect(first.leave).toHaveBeenCalledWith(SESSION_KICK_CODE);
    expect(registry.getActive("acc-1")).toBe(second);
    expect(registry.isCharacterOnline("char-1")).toBe(true);
  });

  it("kicks with the login reason after a second login", async () => {
    const handle = makeHandle("acc-1", "char-1", "session-1");
    await registry.register(handle);
    await registry.kickAccount("acc-1", "login");

    expect(handle.saveForKick).toHaveBeenCalledOnce();
    expect(handle.send).toHaveBeenCalledWith(MSG.sessionKicked, { reason: "login" });
    expect(handle.leave).toHaveBeenCalledWith(SESSION_KICK_CODE);
    expect(registry.getActive("acc-1")).toBeUndefined();
    expect(registry.isCharacterOnline("char-1")).toBe(false);
  });

  it("still kicks when the pre-kick save fails", async () => {
    const handle = makeHandle("acc-1", "char-1", "session-1");
    handle.saveForKick.mockRejectedValueOnce(new Error("db down"));
    await registry.register(handle);
    await expect(registry.kickAccount("acc-1", "login")).resolves.toBeUndefined();
    expect(handle.leave).toHaveBeenCalledWith(SESSION_KICK_CODE);
    expect(registry.getActive("acc-1")).toBeUndefined();
  });

  it("does not kick a session that is registered again under the same id", async () => {
    const handle = makeHandle("acc-1", "char-1", "session-1");
    await registry.register(handle);
    await registry.register(handle);
    expect(handle.saveForKick).not.toHaveBeenCalled();
    expect(handle.leave).not.toHaveBeenCalled();
  });

  it("ignores an onLeave from a replaced session", async () => {
    const first = makeHandle("acc-1", "char-1", "session-1");
    const second = makeHandle("acc-1", "char-1", "session-2");
    await registry.register(first);
    await registry.register(second);

    registry.unregister("acc-1", first.sessionId);
    expect(registry.getActive("acc-1")).toBe(second);
    expect(registry.isCharacterOnline("char-1")).toBe(true);

    registry.unregister("acc-1", second.sessionId);
    expect(registry.getActive("acc-1")).toBeUndefined();
    expect(registry.isCharacterOnline("char-1")).toBe(false);
  });

  it("kicks by character id", async () => {
    const handle = makeHandle("acc-1", "char-1", "session-1");
    await registry.register(handle);
    await registry.kickCharacter("char-1", "login");
    expect(handle.leave).toHaveBeenCalledWith(SESSION_KICK_CODE);
    expect(registry.isCharacterOnline("char-1")).toBe(false);
  });
});

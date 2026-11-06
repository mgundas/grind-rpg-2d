import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { MSG, SESSION_KICK_CODE } from "@jadethrone/shared";
import { SessionRegistry, type SessionHandle } from "../../src/auth/sessionRegistry";

function makeHandle(
  accountId: string,
  characterId: string,
  sessionId: string,
  tokenVersion = 0,
): SessionHandle & {
  saveForKick: Mock<() => Promise<void>>;
  send: Mock<(type: string, payload: unknown) => void>;
  leave: Mock<(code: number) => void>;
} {
  return {
    accountId,
    characterId,
    sessionId,
    tokenVersion,
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

  it("rejects a reservation older than the account's current generation", async () => {
    registry.noteAccount("acc-1", 2);
    const stale = makeHandle("acc-1", "char-1", "session-old", 1);
    await expect(registry.register(stale)).resolves.toBe(false);
    expect(stale.leave).toHaveBeenCalledWith(SESSION_KICK_CODE);
    expect(registry.isCharacterOnline("char-1")).toBe(false);
  });

  it("does not let a stale registration kick the newer session", async () => {
    const current = makeHandle("acc-1", "char-1", "session-new", 2);
    await registry.register(current);
    const accepted = await registry.register(makeHandle("acc-1", "char-1", "session-old", 1));
    expect(accepted).toBe(false);
    expect(current.leave).not.toHaveBeenCalled();
    expect(registry.getActive("acc-1")).toBe(current);
  });

  it("serializes three concurrent registrations into one live session", async () => {
    const first = makeHandle("acc-1", "char-1", "session-1");
    first.saveForKick.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const second = makeHandle("acc-1", "char-1", "session-2");
    const third = makeHandle("acc-1", "char-1", "session-3");
    await Promise.all([
      registry.register(first),
      registry.register(second),
      registry.register(third),
    ]);

    const active = registry.getActive("acc-1");
    expect(active).toBeDefined();
    expect(active).not.toBe(first);
    const undone = [first, second, third].filter((handle) => handle.leave.mock.calls.length === 0);
    expect(undone).toHaveLength(1);
    expect(registry.isCharacterOnline("char-1")).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";
import type { AdminOnlinePlayer } from "@jadethrone/shared";
import {
  createAdminBus,
  type AdminLiveActions,
  type AdminRoomHandle,
} from "../../src/admin/liveBus";

function presence(overrides: Partial<AdminOnlinePlayer> = {}): AdminOnlinePlayer {
  return {
    accountId: "account-1",
    characterId: "char-1",
    sessionId: "session-1",
    name: "Hero",
    classId: "warrior",
    mapId: "map_ember_village",
    channel: 1,
    level: 1,
    role: "player",
    x: 10,
    y: 20,
    hp: 100,
    maxHp: 100,
    dead: false,
    ...overrides,
  };
}

function actions(
  overrides: Partial<AdminLiveActions> & { current?: AdminOnlinePlayer | null } = {},
): AdminLiveActions {
  const current = overrides.current === undefined ? presence() : overrides.current;
  return {
    characterId: current?.characterId ?? "char-1",
    sessionId: current?.sessionId ?? "session-1",
    roomId: "room-1",
    presence: () => current,
    grantItem: vi.fn(),
    removeItem: vi.fn(),
    setGold: vi.fn(),
    updateCharacter: vi.fn(),
    teleportTown: vi.fn(),
    spawnMonster: vi.fn(),
    ...overrides,
  } as AdminLiveActions;
}

function room(roomId: string, announce = vi.fn(() => 2)): AdminRoomHandle {
  return {
    roomId,
    mapId: "map_ember_village",
    startedAtMs: 1,
    maxClients: 200,
    playerCount: () => 2,
    announce,
    saveAllForShutdown: vi.fn(async () => undefined),
  };
}

describe("AdminBus", () => {
  it("registers, lists and finds players by name", () => {
    const bus = createAdminBus();
    bus.register(actions());
    expect(bus.onlineCount()).toBe(1);
    expect(bus.list()).toEqual([presence()]);
    expect(bus.findByName("hero")).toBeDefined();
    expect(bus.findByName("nope")).toBeUndefined();
  });

  it("only unregisters the matching session", () => {
    const bus = createAdminBus();
    bus.register(actions());
    bus.register(actions({ current: presence({ sessionId: "session-2" }) }));
    bus.unregister("char-1", "session-1");
    expect(bus.get("char-1")?.sessionId).toBe("session-2");
    bus.unregister("char-1", "session-2");
    expect(bus.get("char-1")).toBeUndefined();
  });

  it("prunes a player whose presence went away", () => {
    const bus = createAdminBus();
    bus.register(actions({ current: null }));
    expect(bus.list()).toEqual([]);
    expect(bus.get("char-1")).toBeUndefined();
  });

  it("cleans up every player belonging to a disposed room", () => {
    const bus = createAdminBus();
    bus.register(actions());
    bus.register(
      actions({
        characterId: "char-2",
        sessionId: "session-2",
        roomId: "room-2",
        current: presence({ characterId: "char-2", sessionId: "session-2" }),
      }),
    );
    bus.registerRoom(room("room-1"));
    bus.registerRoom(room("room-2"));
    bus.unregisterRoom("room-1");
    expect(bus.roomHandles().map((handle) => handle.roomId)).toEqual(["room-2"]);
    expect(bus.get("char-1")).toBeUndefined();
    expect(bus.get("char-2")).toBeDefined();
  });

  it("broadcasts once per room and survives a failing room", () => {
    const bus = createAdminBus();
    const first = vi.fn(() => 2);
    const failing = vi.fn(() => {
      throw new Error("boom");
    });
    const third = vi.fn(() => 3);
    bus.registerRoom(room("room-1", first));
    bus.registerRoom(room("room-2", failing));
    bus.registerRoom(room("room-3", third));

    const delivered = bus.broadcastAnnouncement({ message: "hello", kind: "admin" });
    expect(delivered).toBe(5);
    expect(first).toHaveBeenCalledTimes(1);
    expect(failing).toHaveBeenCalledTimes(1);
    expect(third).toHaveBeenCalledTimes(1);
  });

  it("samples and prunes the 24h online history", () => {
    const bus = createAdminBus();
    bus.register(actions());
    const day = 24 * 60 * 60 * 1000;
    bus.sampleOnlineHistory(1_000_000);
    bus.sampleOnlineHistory(1_000_000 + day + 1);
    expect(bus.history().map((sample) => sample.online)).toEqual([1]);
  });

  it("clear removes everything", () => {
    const bus = createAdminBus();
    bus.register(actions());
    bus.registerRoom(room("room-1"));
    bus.sampleOnlineHistory();
    bus.clear();
    expect(bus.list()).toEqual([]);
    expect(bus.roomHandles()).toEqual([]);
    expect(bus.history()).toEqual([]);
  });
});

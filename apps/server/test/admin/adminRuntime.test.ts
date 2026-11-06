import { describe, expect, it, vi } from "vitest";
import type { Db } from "../../src/db/client";
import type { AnnouncementRow } from "../../src/db/schema";
import { createAdminBus } from "../../src/admin/liveBus";
import { createAdminRuntime } from "../../src/admin/adminRuntime";
import type { AdminLiveActions } from "../../src/admin/liveBus";

function actions(): AdminLiveActions {
  return {
    characterId: "char-1",
    sessionId: "session-1",
    roomId: "room-1",
    presence: () => ({
      accountId: "account-1",
      characterId: "char-1",
      sessionId: "session-1",
      name: "Hero",
      classId: "warrior",
      mapId: "map_ember_village",
      channel: 1,
      level: 1,
      role: "player",
      x: 0,
      y: 0,
      hp: 100,
      maxHp: 100,
      dead: false,
    }),
    grantItem: vi.fn(),
    removeItem: vi.fn(),
    setGold: vi.fn(),
    updateCharacter: vi.fn(),
    teleportTown: vi.fn(),
    spawnMonster: vi.fn(),
  } as AdminLiveActions;
}

function announcement(overrides: Partial<AnnouncementRow> = {}): AnnouncementRow {
  return {
    id: "announcement-1",
    message: "Recurring hello",
    kind: "recurring",
    intervalMs: 60_000,
    active: true,
    createdBy: "account-1",
    createdAt: new Date(0),
    lastSentAt: null,
    expiresAt: null,
    ...overrides,
  };
}

describe("AdminRuntime", () => {
  it("updates rates and reports status", () => {
    const bus = createAdminBus();
    const runtime = createAdminRuntime({ db: {} as Db, bus });
    runtime.setRates(2, 0.5);
    expect(runtime.settings).toMatchObject({ xpRate: 2, dropRate: 0.5 });
    expect(runtime.status()).toMatchObject({ xpRate: 2, dropRate: 0.5, online: 0 });
  });

  it("samples the bus history", () => {
    const bus = createAdminBus();
    bus.register(actions());
    const runtime = createAdminRuntime({ db: {} as Db, bus });
    runtime.sampleHistory(1000);
    expect(bus.history()).toEqual([{ atMs: 1000, online: 1 }]);
  });

  it("broadcasts due recurring announcements and skips fresh ones", async () => {
    const bus = createAdminBus();
    const markSent = vi.fn(async () => undefined);
    const rows = [
      announcement(),
      announcement({
        id: "announcement-2",
        lastSentAt: new Date(59_000),
        message: "Fresh",
      }),
    ];
    const runtime = createAdminRuntime({
      db: {} as Db,
      bus,
      loadRecurring: async () => rows,
      markAnnouncementSent: markSent,
    });
    const room = {
      roomId: "room-1",
      mapId: "map_ember_village" as const,
      startedAtMs: 0,
      maxClients: 200,
      playerCount: () => 1,
      announce: vi.fn(() => 1),
      saveAllForShutdown: vi.fn(async () => undefined),
    };
    bus.registerRoom(room);

    await runtime.processRecurringAnnouncements(60_000);
    expect(room.announce).toHaveBeenCalledTimes(1);
    expect(markSent).toHaveBeenCalledWith(expect.anything(), "announcement-1", 60_000);
    expect(markSent).not.toHaveBeenCalledWith(expect.anything(), "announcement-2", 60_000);
  });

  it("schedules, counts down, saves rooms and shuts down", async () => {
    const bus = createAdminBus();
    const room = {
      roomId: "room-1",
      mapId: "map_ember_village" as const,
      startedAtMs: 0,
      maxClients: 200,
      playerCount: () => 1,
      announce: vi.fn(() => 1),
      saveAllForShutdown: vi.fn(async () => undefined),
    };
    bus.registerRoom(room);
    const shutdown = vi.fn(async () => undefined);
    const runtime = createAdminRuntime({ db: {} as Db, bus, shutdown });

    runtime.scheduleShutdown(10, "Maintenance", 0);
    expect(runtime.settings.shutdownAtMs).toBe(600_000);
    expect(room.announce).toHaveBeenCalledTimes(1);

    await runtime.processShutdown(9 * 60_000);
    expect(room.announce).toHaveBeenCalledTimes(2);

    await runtime.processShutdown(600_000);
    expect(room.saveAllForShutdown).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(runtime.settings.shutdownAtMs).toBeNull();

    // The deadline is idempotent.
    await runtime.processShutdown(600_001);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("cancels a scheduled shutdown", async () => {
    const bus = createAdminBus();
    const shutdown = vi.fn(async () => undefined);
    const runtime = createAdminRuntime({ db: {} as Db, bus, shutdown });
    runtime.scheduleShutdown(5, "Maintenance", 0);
    runtime.cancelShutdown();
    expect(runtime.settings.shutdownAtMs).toBeNull();
    await runtime.processShutdown(10_000_000);
    expect(shutdown).not.toHaveBeenCalled();
  });

  it("starts and stops its timers idempotently", () => {
    vi.useFakeTimers();
    try {
      const bus = createAdminBus();
      const runtime = createAdminRuntime({ db: {} as Db, bus });
      runtime.start();
      runtime.start();
      runtime.stop();
      runtime.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

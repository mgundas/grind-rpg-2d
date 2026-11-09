import { and, eq, or, isNull, gt } from "drizzle-orm";
import type { AdminRoomTickStats, AdminServerStatus } from "@jadethrone/shared";
import type { Db } from "../db/client";
import { announcements, type AnnouncementRow } from "../db/schema";
import { logger } from "../logger";
import type { AdminBus } from "./liveBus";

export interface AdminRuntimeSettings {
  xpRate: number;
  dropRate: number;
  shutdownAtMs: number | null;
  shutdownMessage: string | null;
}

export interface AdminRuntimeOptions {
  db: Db;
  bus: AdminBus;
  /** Test seam: returns recurring rows that are due at `now`. */
  loadRecurring?: (db: Db, now: number) => Promise<AnnouncementRow[]>;
  /** Test seam: persist the send time. */
  markAnnouncementSent?: (db: Db, id: string, now: number) => Promise<void>;
  /** Test seam: invoked at the deadline instead of a real Colyseus server. */
  shutdown?: () => Promise<void>;
}

export interface AdminRuntime {
  readonly settings: AdminRuntimeSettings;
  setRates(xpRate: number, dropRate: number): void;
  status(): AdminServerStatus;
  start(): void;
  stop(): void;
  attachServer(server: { gracefullyShutdown(exit?: boolean, err?: Error): Promise<void> }): void;

  sampleHistory(now?: number): void;
  processRecurringAnnouncements(now?: number): Promise<void>;
  scheduleShutdown(delayMinutes: number, message: string, now?: number): void;
  cancelShutdown(): void;
  processShutdown(now?: number): Promise<void>;
}

const HISTORY_INTERVAL_MS = 5 * 60 * 1000;
const ANNOUNCEMENT_INTERVAL_MS = 30 * 1000;
const SHUTDOWN_INTERVAL_MS = 15 * 1000;
const SHUTDOWN_NOTICES_MS = [10 * 60_000, 5 * 60_000, 60_000, 30_000, 10_000];

function defaultRecurring(db: Db, now: number): Promise<AnnouncementRow[]> {
  return db
    .select()
    .from(announcements)
    .where(
      and(
        eq(announcements.active, true),
        eq(announcements.kind, "recurring"),
        or(isNull(announcements.expiresAt), gt(announcements.expiresAt, new Date(now))),
      ),
    )
    .limit(100);
}

async function defaultMarkSent(db: Db, id: string, now: number): Promise<void> {
  await db
    .update(announcements)
    .set({ lastSentAt: new Date(now) })
    .where(eq(announcements.id, id));
}

export function createAdminRuntime(options: AdminRuntimeOptions): AdminRuntime {
  const settings: AdminRuntimeSettings = {
    xpRate: 1,
    dropRate: 1,
    shutdownAtMs: null,
    shutdownMessage: null,
  };
  const loadRecurring = options.loadRecurring ?? defaultRecurring;
  const markSent = options.markAnnouncementSent ?? defaultMarkSent;
  const noticesSent = new Set<number>();
  let server: { gracefullyShutdown(exit?: boolean, err?: Error): Promise<void> } | null = null;
  let historyTimer: ReturnType<typeof setInterval> | null = null;
  let announcementTimer: ReturnType<typeof setInterval> | null = null;
  let shutdownTimer: ReturnType<typeof setInterval> | null = null;
  let shutdownStarted = false;
  let stopped = false;
  let processingAnnouncements = false;

  async function processRecurringAnnouncements(now = Date.now()): Promise<void> {
    if (processingAnnouncements) {
      return;
    }
    processingAnnouncements = true;
    try {
      const rows = await loadRecurring(options.db, now);
      for (const row of rows) {
        if (row.lastSentAt && row.lastSentAt.getTime() + (row.intervalMs ?? 0) > now) {
          continue;
        }
        const delivered = options.bus.broadcastAnnouncement({
          id: row.id,
          message: row.message,
          kind: "scheduled",
          sentAtMs: now,
        });
        // Do not consume the slot when nobody was online; retry on the next scan.
        if (delivered > 0) {
          await markSent(options.db, row.id, now);
        }
      }
    } catch (error) {
      logger.error({ error }, "recurring announcement scan failed");
    } finally {
      processingAnnouncements = false;
    }
  }

  async function finishShutdown(): Promise<void> {
    if (shutdownStarted) {
      return;
    }
    shutdownStarted = true;
    const rooms = options.bus.roomHandles();
    await Promise.allSettled(rooms.map((room) => room.saveAllForShutdown()));
    options.bus.broadcastAnnouncement({
      message: settings.shutdownMessage ?? "Server shutting down.",
      kind: "shutdown",
      sentAtMs: Date.now(),
    });
    const shutdown = options.shutdown ?? server?.gracefullyShutdown.bind(server);
    if (shutdown) {
      await shutdown().catch((error: unknown) => {
        logger.error({ error }, "graceful shutdown failed");
      });
    } else {
      logger.warn("shutdown deadline reached without an attached server");
    }
    settings.shutdownAtMs = null;
  }

  async function processShutdown(now = Date.now()): Promise<void> {
    if (settings.shutdownAtMs === null) {
      return;
    }
    const remaining = settings.shutdownAtMs - now;
    if (remaining <= 0) {
      await finishShutdown();
      return;
    }
    // One countdown message per tick, starting with the largest unsent
    // threshold. Thresholds at/above the initial delay were covered by the
    // immediate scheduling message.
    const notice = SHUTDOWN_NOTICES_MS.find(
      (threshold) => remaining <= threshold && !noticesSent.has(threshold),
    );
    if (notice !== undefined) {
      noticesSent.add(notice);
      const minutes = Math.max(1, Math.ceil(remaining / 60_000));
      options.bus.broadcastAnnouncement({
        message: `${settings.shutdownMessage ?? "Server maintenance"} (${minutes} min)`,
        kind: "shutdown",
        sentAtMs: now,
      });
    }
  }

  return {
    settings,
    setRates(xpRate, dropRate) {
      settings.xpRate = xpRate;
      settings.dropRate = dropRate;
    },
    status() {
      const tickRooms = options.bus.tickSummary();
      let worst: AdminRoomTickStats | null = null;
      for (const room of tickRooms) {
        if (!worst || room.p95Ms > worst.p95Ms) {
          worst = room;
        }
      }
      return {
        xpRate: settings.xpRate,
        dropRate: settings.dropRate,
        shutdownAtMs: settings.shutdownAtMs,
        shutdownMessage: settings.shutdownMessage,
        uptimeSeconds: Math.round(process.uptime()),
        online: options.bus.onlineCount(),
        tick: {
          rooms: tickRooms,
          worstP95Ms: worst?.p95Ms ?? 0,
          worstRoomId: worst?.roomId ?? null,
        },
      };
    },
    start() {
      if (stopped) {
        return;
      }
      if (historyTimer === null) {
        historyTimer = setInterval(() => options.bus.sampleOnlineHistory(), HISTORY_INTERVAL_MS);
        historyTimer.unref?.();
      }
      if (announcementTimer === null) {
        announcementTimer = setInterval(
          () => void processRecurringAnnouncements(),
          ANNOUNCEMENT_INTERVAL_MS,
        );
        announcementTimer.unref?.();
      }
      if (shutdownTimer === null) {
        shutdownTimer = setInterval(() => void processShutdown(), SHUTDOWN_INTERVAL_MS);
        shutdownTimer.unref?.();
      }
    },
    stop() {
      stopped = true;
      if (historyTimer) clearInterval(historyTimer);
      if (announcementTimer) clearInterval(announcementTimer);
      if (shutdownTimer) clearInterval(shutdownTimer);
      historyTimer = null;
      announcementTimer = null;
      shutdownTimer = null;
    },
    attachServer(next) {
      server = next;
    },
    sampleHistory(now = Date.now()) {
      options.bus.sampleOnlineHistory(now);
    },
    processRecurringAnnouncements,
    scheduleShutdown(delayMinutes, message, now = Date.now()) {
      if (!Number.isFinite(delayMinutes) || delayMinutes <= 0) {
        throw new Error("Shutdown delay must be positive.");
      }
      const delayMs = delayMinutes * 60_000;
      settings.shutdownAtMs = now + delayMs;
      settings.shutdownMessage = message;
      shutdownStarted = false;
      noticesSent.clear();
      for (const threshold of SHUTDOWN_NOTICES_MS) {
        if (threshold >= delayMs) {
          noticesSent.add(threshold);
        }
      }
      options.bus.broadcastAnnouncement({
        message: `${message} (${delayMinutes} min)`,
        kind: "shutdown",
        sentAtMs: now,
      });
    },
    cancelShutdown() {
      settings.shutdownAtMs = null;
      settings.shutdownMessage = null;
      noticesSent.clear();
      shutdownStarted = false;
    },
    processShutdown,
  };
}

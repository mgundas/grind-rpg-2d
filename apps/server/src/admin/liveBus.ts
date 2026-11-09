import {
  type AdminGiveItemRequest,
  type AdminOnlinePlayer,
  type AdminRoomTickStats,
  type AdminUpdateCharacterRequest,
  type AnnouncementPayload,
  type ItemInstanceDto,
  type MapId,
} from "@jadethrone/shared";
import type { AdminOnlineSource } from "./adminService";
import type { TickStatsSnapshot } from "../rooms/tickStats";
import { logger } from "../logger";

/**
 * One live character, implemented by MapRoom closures. Registration is keyed
 * by character id and guarded by session id so a late leave from an old room
 * cannot remove the newer session.
 */
export interface AdminLiveActions {
  readonly characterId: string;
  readonly sessionId: string;
  readonly roomId: string;
  /** Null once the room has removed the runtime (warp/leave in flight). */
  presence(): AdminOnlinePlayer | null;
  grantItem(request: AdminGiveItemRequest): Promise<ItemInstanceDto>;
  removeItem(instanceId: string): Promise<void>;
  /** Absolute gold; returns the final authoritative balance. */
  setGold(gold: number): Promise<number>;
  updateCharacter(update: AdminUpdateCharacterRequest): Promise<void>;
  teleportTown(): Promise<void>;
  spawnMonster(typeId: string, count: number, x?: number, y?: number): Promise<number>;
}

/** One live room; room-wide concerns live here, not on every player. */
export interface AdminRoomHandle {
  readonly roomId: string;
  readonly mapId: MapId;
  readonly channel?: number;
  readonly startedAtMs: number;
  readonly maxClients: number;
  playerCount(): number;
  /** Sends MSG.announcement once to every client in the room. */
  announce(payload: AnnouncementPayload): number;
  saveAllForShutdown(): Promise<void>;
  /** Optional: rooms without tick instrumentation simply return null. */
  tickStats?(): TickStatsSnapshot | null;
}

export interface AdminBus extends AdminOnlineSource {
  register(actions: AdminLiveActions): void;
  unregister(characterId: string, sessionId: string): void;
  get(characterId: string): AdminLiveActions | undefined;
  list(): AdminOnlinePlayer[];
  findByName(name: string): AdminLiveActions | undefined;
  onlineCount(): number;

  registerRoom(handle: AdminRoomHandle): void;
  unregisterRoom(roomId: string): void;
  roomHandles(): readonly AdminRoomHandle[];
  tickSummary(): AdminRoomTickStats[];
  rooms(): Array<{
    roomId: string;
    mapId: MapId;
    channel?: number;
    startedAtMs: number;
    maxClients: number;
    players: number;
  }>;
  broadcastAnnouncement(payload: AnnouncementPayload): number;

  sampleOnlineHistory(now?: number): void;
  history(): Array<{ atMs: number; online: number }>;
  clear(): void;
}

const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function createAdminBus(): AdminBus {
  const players = new Map<string, AdminLiveActions>();
  const rooms = new Map<string, AdminRoomHandle>();
  const samples: Array<{ atMs: number; online: number }> = [];

  function prune(characterId: string, actions: AdminLiveActions): void {
    if (players.get(characterId) === actions) {
      players.delete(characterId);
    }
  }

  function list(): AdminOnlinePlayer[] {
    const result: AdminOnlinePlayer[] = [];
    for (const [characterId, actions] of players) {
      const presence = actions.presence();
      if (presence === null) {
        prune(characterId, actions);
        continue;
      }
      result.push(presence);
    }
    return result;
  }

  return {
    register(actions) {
      // A newer session replaces the old one; unregister is session-guarded.
      players.set(actions.characterId, actions);
    },
    unregister(characterId, sessionId) {
      const current = players.get(characterId);
      if (current?.sessionId === sessionId) {
        players.delete(characterId);
      }
    },
    get(characterId) {
      const actions = players.get(characterId);
      if (actions && actions.presence() === null) {
        prune(characterId, actions);
        return undefined;
      }
      return actions;
    },
    list,
    findByName(name) {
      const needle = name.trim().toLowerCase();
      if (!needle) {
        return undefined;
      }
      for (const characterId of players.keys()) {
        const actions = players.get(characterId);
        if (!actions) {
          continue;
        }
        const presence = actions.presence();
        if (presence === null) {
          prune(characterId, actions);
          continue;
        }
        if (presence.name.toLowerCase() === needle) {
          return actions;
        }
      }
      return undefined;
    },
    onlineCount() {
      return list().length;
    },

    registerRoom(handle) {
      rooms.set(handle.roomId, handle);
    },
    unregisterRoom(roomId) {
      rooms.delete(roomId);
      for (const [characterId, actions] of players) {
        if (actions.roomId === roomId) {
          players.delete(characterId);
        }
      }
    },
    roomHandles() {
      return [...rooms.values()];
    },
    tickSummary() {
      const result: AdminRoomTickStats[] = [];
      for (const room of rooms.values()) {
        try {
          const stats = room.tickStats?.();
          if (!stats) {
            continue;
          }
          result.push({
            roomId: room.roomId,
            mapId: room.mapId,
            channel: room.channel,
            players: room.playerCount(),
            ...stats,
          });
        } catch (error) {
          logger.error({ roomId: room.roomId, error }, "tick stats snapshot failed");
        }
      }
      return result;
    },
    rooms() {
      return [...rooms.values()].map((room) => ({
        roomId: room.roomId,
        mapId: room.mapId,
        channel: room.channel,
        startedAtMs: room.startedAtMs,
        maxClients: room.maxClients,
        players: room.playerCount(),
      }));
    },
    broadcastAnnouncement(payload) {
      let delivered = 0;
      for (const room of rooms.values()) {
        try {
          delivered += room.announce(payload);
        } catch (error) {
          logger.error({ roomId: room.roomId, error }, "admin announcement failed");
        }
      }
      return delivered;
    },

    sampleOnlineHistory(now = Date.now()) {
      samples.push({ atMs: now, online: list().length });
      const cutoff = now - HISTORY_WINDOW_MS;
      while (samples.length > 0 && samples[0]!.atMs < cutoff) {
        samples.shift();
      }
    },
    history() {
      return samples.map((sample) => ({ ...sample }));
    },
    clear() {
      players.clear();
      rooms.clear();
      samples.length = 0;
    },
  };
}

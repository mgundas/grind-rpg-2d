import type { MapId } from "./constants";

/** Broadcast when a spirit stone breaks; the state entity is removed in the same patch. */
export interface StoneDestroyedPayload {
  stoneId: string;
  typeId: string;
  name: string;
  x: number;
  y: number;
  killerSessionId: string | null;
}

/** Field-boss clock. `respawnAtMs` is null while the boss is alive. */
export interface BossTimerPayload {
  bossTypeId: string;
  name: string;
  mapId: MapId;
  alive: boolean;
  respawnAtMs: number | null;
}

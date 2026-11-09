import { ROOM_NAME_VILLAGE, type MapId } from "@jadethrone/shared";
import { loadMapAssets } from "../maps/mapRegistry";

/** Every new character starts in Ember Village (the only home map in Phase 2). */
export const DEFAULT_SPAWN_MAP: MapId = ROOM_NAME_VILLAGE;

export interface PositionSave {
  mapId: MapId;
  x: number;
  y: number;
}

/** Everything the room persists on autosave, leave, kick, warp and level-up. */
export interface CharacterSave extends PositionSave {
  /** Channel the character was last seen on (1–4). */
  channel?: number;
  hp: number;
  mp: number;
  xp: number;
  level: number;
  statVit: number;
  statInt: number;
  statStr: number;
  statDex: number;
  statPoints: number;
}

export function defaultSpawn(): PositionSave {
  const { spawn } = loadMapAssets(DEFAULT_SPAWN_MAP);
  return { mapId: DEFAULT_SPAWN_MAP, x: spawn.x, y: spawn.y };
}

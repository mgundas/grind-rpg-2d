/** Game identity — keep the name in one constant (GAME_DESIGN.md §3). */
export const GAME_NAME = "Jade Throne";

/** Tile size in px (LPC standard, GAME_DESIGN.md §2). */
export const TILE_SIZE = 32;

/** Server simulation tick (GAME_DESIGN.md §5.1). */
export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;

export const DEFAULT_SERVER_PORT = 2567;

/** The three kingdoms and their placeholder colors (GAME_DESIGN.md §3). */
export interface KingdomInfo {
  id: string;
  label: string;
  /** Placeholder tint for procedurally generated characters. */
  color: string;
}

/** Stable kingdom ids. Kept as a tuple so Zod enums can use them. */
export const KINGDOM_IDS = ["ember", "gale", "tide"] as const;
export type KingdomId = (typeof KINGDOM_IDS)[number];

export const KINGDOMS: readonly KingdomInfo[] = [
  { id: "ember", label: "Ember", color: "#d9453a" },
  { id: "gale", label: "Gale", color: "#e0b526" },
  { id: "tide", label: "Tide", color: "#3e8fd9" },
];

/** Ground item beam / icon frame colors (GAME_DESIGN.md §2). */
export type Rarity = "common" | "fine" | "rare" | "legendary";

export const RARITY_COLORS: Record<Rarity, string> = {
  common: "#b8c0c8",
  fine: "#4a90d9",
  rare: "#9b59d0",
  legendary: "#d4a017",
};

/** Base walk speed in px/s (GAME_DESIGN.md §5). */
export const WALK_SPEED = 200;

/** Core stat block shared by classes, characters and combat formulas. */
export interface Stats {
  vit: number;
  int: number;
  str: number;
  dex: number;
}

/** Progression caps (GAME_DESIGN.md §4.3). */
export const MAX_LEVEL = 99;
export const STAT_POINT_CAP = 90;
export const STAT_POINTS_PER_LEVEL = 3;

/** Combat timings and ranges (GAME_DESIGN.md §5, §6). */
export const ATTACK_ARC_DEGREES = 120;
/** cos(60°), the half-angle of the 120° frontal arc; must match the degrees above. */
export const ATTACK_ARC_HALF_COS = 0.5;
export const ATTACK_RANGE_PAD_PX = 16;
export const COMBAT_TIMEOUT_MS = 5000;
export const REGEN_INTERVAL_MS = 3000;
export const MONSTER_SLEEP_RADIUS_PX = 1200;
export const MONSTER_ATTACK_RANGE_HYSTERESIS_PX = 16;
export const MONSTER_CHASE_REPATH_MS = 500;
export const MONSTER_WANDER_RADIUS_PX = 96;
export const MAX_ASTAR_PER_TICK = 10;
export const RESPAWN_HERE_DELAY_MS = 10_000;
export const RESPAWN_HERE_HP_FRACTION = 0.3;
export const AUTO_WALK_TARGET_RANGE_PX = 1000;
export const AUTO_WALK_GIVE_UP_MS = 1500;
export const AUTO_WALK_STOP_MARGIN_PX = 24;
export const AUTO_WALK_MAX_EMPTY_PATHS = 3;
/** Chaser repaths share one per-tick A* allowance so N chasers cannot spike the tick. */
export const AUTO_WALK_MAX_ASTAR_PER_TICK = 4;
/** Non-level-up XP gains are saved at most this often; leave/autosave covers the rest. */
export const XP_SAVE_INTERVAL_MS = 10_000;
export const COMBAT_EVENT_RADIUS_PX = 900;

/** Phase-4 economy interaction ranges and timings (GAME_DESIGN.md §6.3, §7). */
export const MAX_GOLD = 2_000_000_000;
/** Maximum single-stack kinds one trade side may offer (90 inventory cells). */
export const TRADE_MAX_OFFER_ITEMS = 90;
/** Hard ceiling for one admin/GM spawn command. */
export const MAX_ADMIN_SPAWN = 50;
export const PICKUP_RADIUS_PX = 56;
export const DROP_OWNERSHIP_MS = 30_000;
export const GROUND_ITEM_DESPAWN_MS = 120_000;
export const ITEM_USE_COOLDOWN_MS = 500;
export const NPC_INTERACT_RADIUS_PX = 64;
/** Extra drop positions stay close to the corpse but never overlap it exactly. */
export const DROP_SCATTER_MIN_PX = 12;
export const DROP_SCATTER_MAX_PX = 24;

/**
 * Interest management (GAME_DESIGN.md §5.1): entities are added to a
 * client's view inside the lower radius and removed beyond the upper one —
 * the gap is hysteresis against boundary flicker.
 */
export const INTEREST_RADIUS_PX = 900;
export const INTEREST_ADD_RADIUS_PX = 850;
export const INTEREST_INTERVAL_MS = 250;

/** Remote interpolation + reconciliation thresholds (GAME_DESIGN.md §5.1). */
export const REMOTE_INTERP_DELAY_MS = 100;
export const SNAP_THRESHOLD_PX = 64;
export const ERROR_SMOOTH_MS = 100;
export const TELEPORT_THRESHOLD_PX = 200;

/** Local chat (GAME_DESIGN.md §9). Uses the interest-add radius so every
 * recipient is visible. */
export const CHAT_RANGE_PX = INTEREST_ADD_RADIUS_PX;
export const CHAT_COOLDOWN_MS = 1000;

/** Pointer hold/click thresholds and camera zoom (GAME_DESIGN.md §5). */
export const HOLD_TO_STEER_MS = 200;
export const CLICK_MAX_MS = 200;
export const CAMERA_ZOOM = 2;
export const SHOUT_COOLDOWN_MS = 15_000;
export const SHOUT_LEVEL = 15;
export const CHAT_MAX_LEN = 120;

/** Prediction bookkeeping. */
export const INPUT_HISTORY_SIZE = 64;

/** Cap a single render-frame delta (tab refocus) so the fixed-step burst is bounded. */
export const MAX_FRAME_DELTA_MS = 250;

/** Ticks the server keeps applying the last intent after input stops (~150 ms). */
export const SERVER_TICK_GRACE_TICKS = 3;

/** Warp guard against instant ping-pong between maps. */
export const WARP_COOLDOWN_MS = 2000;

/** A* node expansion budget (a 160x160 map has 25,600 tiles). */
export const MAX_PATH_EXPAND = 12000;

/**
 * Minimum delay between click-to-move retargets from one player. Repeating the
 * same target is free (the server reuses the stored path), but a client that
 * changes target every tick cannot force 20 full A* runs per second.
 */
export const PATH_RETARGET_MIN_MS = 100;

/** Player feet collision box in px, centred on the ground position. */
export const PLAYER_BODY = { halfW: 10, halfH: 6 } as const;

/**
 * Correctly-rounded double nearest 1/sqrt(2), as a literal. The movement step
 * must never call Math.sqrt/hypot/trig, so diagonal speed is bit-identical on
 * the client and the server regardless of engine math differences.
 */
export const INV_SQRT2 = 0.7071067811865476;

/** Room names double as map ids (GAME_DESIGN.md §10.2: one room type per map). */
export const ROOM_NAME_VILLAGE = "map_ember_village";
/** Ember's 15–30 map. Kept at its Phase-1 id so saved characters survive (D77). */
export const ROOM_NAME_FIELDS = "map_ember_fields";
export const ROOM_NAME_GALE_VILLAGE = "map_gale_village";
export const ROOM_NAME_GALE_HIGHLANDS = "map_gale_highlands";
export const ROOM_NAME_TIDE_VILLAGE = "map_tide_village";
export const ROOM_NAME_TIDE_HIGHLANDS = "map_tide_highlands";
export const ROOM_NAME_VALLEY = "map_valley_of_echoes";
export const ROOM_NAME_FOREST = "map_corrupted_forest";
export const ROOM_NAME_SPIDER_CAVE = "map_spider_cave";

export const MAP_IDS = [
  ROOM_NAME_VILLAGE,
  ROOM_NAME_FIELDS,
  ROOM_NAME_GALE_VILLAGE,
  ROOM_NAME_GALE_HIGHLANDS,
  ROOM_NAME_TIDE_VILLAGE,
  ROOM_NAME_TIDE_HIGHLANDS,
  ROOM_NAME_VALLEY,
  ROOM_NAME_FOREST,
  ROOM_NAME_SPIDER_CAVE,
] as const;
export type MapId = (typeof MAP_IDS)[number];

/** Kingdom home maps, used by character creation and respawns. */
export const KINGDOM_VILLAGE_MAPS = {
  ember: ROOM_NAME_VILLAGE,
  gale: ROOM_NAME_GALE_VILLAGE,
  tide: ROOM_NAME_TIDE_VILLAGE,
} as const;

/** Per-channel room cap (GAME_DESIGN.md §10.2: max 200 players per channel). */
export const MAX_PLAYERS_PER_CHANNEL = 200;

/** Map channels CH1–CH4 (GAME_DESIGN.md §10.2). */
export const CHANNEL_IDS = [1, 2, 3, 4] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];
export const DEFAULT_CHANNEL: ChannelId = 1;
export const MIN_CHANNEL: ChannelId = 1;
export const MAX_CHANNEL: ChannelId = 4;

export function isChannelId(value: unknown): value is ChannelId {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= MIN_CHANNEL && value <= MAX_CHANNEL
  );
}

/** Stale or corrupt values (a 0/NULL column, a bad join option) fall back to CH1. */
export function clampChannelId(value: unknown): ChannelId {
  return isChannelId(value) ? value : DEFAULT_CHANNEL;
}

/** Mounted walk speed is 300 px/s (GAME_DESIGN.md §5). */
export const MOUNT_SPEED_MULT = 1.5;

/** Per-client message rate limit in msgs/s (GAME_DESIGN.md §10.2). */
export const MAX_MESSAGES_PER_SECOND = 30;

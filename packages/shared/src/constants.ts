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

/** Demo spawn point until real maps exist (Phase 1 uses map spawn objects). */
export const SPAWN_POINT = { x: 400, y: 304 };

/** Per-channel room cap (GAME_DESIGN.md §10.2: max 200 players per channel). */
export const MAX_PLAYERS_PER_CHANNEL = 200;

/** Per-client message rate limit in msgs/s (GAME_DESIGN.md §10.2). */
export const MESSAGES_PER_SECOND_LIMIT = 30;

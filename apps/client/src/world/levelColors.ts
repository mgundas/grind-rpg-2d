/**
 * Monster nameplate colours by level difference (GAME_DESIGN.md §2):
 * grey for far below, white for even, yellow for above, red for dangerous.
 */
export type LevelRelation = "gray" | "white" | "yellow" | "red";

export const LEVEL_COLORS: Record<LevelRelation, string> = {
  gray: "#8a928a",
  white: "#e8efe9",
  yellow: "#e8c34a",
  red: "#e05a4f",
};

export function levelRelation(monsterLevel: number, playerLevel: number): LevelRelation {
  const gap = monsterLevel - playerLevel;
  if (gap >= 5) {
    return "red";
  }
  if (gap >= 1) {
    return "yellow";
  }
  if (gap <= -5) {
    return "gray";
  }
  return "white";
}

export function monsterNameColor(monsterLevel: number, playerLevel: number): string {
  return LEVEL_COLORS[levelRelation(monsterLevel, playerLevel)];
}

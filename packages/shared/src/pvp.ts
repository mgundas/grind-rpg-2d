/** PvP mode and eligibility rules (GAME_DESIGN.md §9). */
export const PVP_MODES = ["peaceful", "kingdom", "free"] as const;
export type PvpMode = (typeof PVP_MODES)[number];

export function isPvpMode(value: unknown): value is PvpMode {
  return value === "peaceful" || value === "kingdom" || value === "free";
}

export interface PvpActor {
  characterId: string;
  kingdom: string;
  pvpMode: PvpMode;
  partyId?: string | null;
  guildId?: string | null;
  dead?: boolean;
  warping?: boolean;
}

export interface PvpMapPolicy {
  pvpAllowed: boolean;
  safe: boolean;
}

/**
 * The single authority for whether one player may damage another. Applied to
 * basic attacks and every offensive skill target shape.
 */
export function canAttackPlayer(
  attacker: PvpActor,
  target: PvpActor,
  policy: PvpMapPolicy,
): boolean {
  if (attacker.characterId === target.characterId) {
    return false;
  }
  if (attacker.dead || target.dead || attacker.warping || target.warping) {
    return false;
  }
  if (!policy.pvpAllowed || policy.safe) {
    return false;
  }
  if (attacker.pvpMode === "peaceful" || target.pvpMode === "peaceful") {
    return false;
  }
  if (attacker.partyId && attacker.partyId === target.partyId) {
    return false;
  }
  if (attacker.guildId && attacker.guildId === target.guildId) {
    return false;
  }
  if (attacker.pvpMode === "free") {
    return true;
  }
  return attacker.kingdom !== target.kingdom;
}

import {
  critChance,
  defenseOf,
  isClassId,
  physicalAttack,
  xpToNextLevel,
  type SelfStatsPayload,
} from "@jadethrone/shared";
import { equipmentBonusStats } from "../items/equipment";
import type { PlayerRuntime } from "../rooms/playerRuntime";
import type { PlayerState } from "../rooms/state/WorldState";

/**
 * Owner-only progression snapshot. XP, stat points and raw stats stay off
 * public state; HP/MP are included so the HUD can reconcile from one message.
 */
export function buildSelfStats(runtime: PlayerRuntime, player: PlayerState): SelfStatsPayload {
  const progression = runtime.progression;
  const classId = isClassId(player.classId) ? player.classId : "warrior";
  const equipment = equipmentBonusStats(runtime.inventory);
  return {
    level: progression.level,
    xp: progression.xp,
    xpToNext: xpToNextLevel(progression.level),
    hp: progression.hp,
    maxHp: progression.maxHp,
    mp: progression.mp,
    maxMp: progression.maxMp,
    statPoints: progression.statPoints,
    stats: { ...progression.stats },
    attack: physicalAttack({
      classId,
      stats: progression.stats,
      level: progression.level,
      weaponAttack: equipment.attack,
    }),
    defense: defenseOf(progression.stats.vit) + equipment.defense,
    critChance: critChance(progression.stats.dex, equipment.critChance),
    doctrine: progression.doctrine,
    skillPoints: progression.skillPoints,
  };
}

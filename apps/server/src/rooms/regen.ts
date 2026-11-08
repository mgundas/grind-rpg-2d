import {
  COMBAT_TIMEOUT_MS,
  REGEN_INTERVAL_MS,
  TICK_MS,
  hpRegenAmount,
  mpRegenAmount,
} from "@jadethrone/shared";
import type { PlayerRuntime } from "./playerRuntime";
import type { PlayerState } from "./state/WorldState";
import { BASE_CATALOG, type CatalogLookup } from "@jadethrone/data/catalog";
import { equipmentBonusValue } from "../items/equipment";

/**
 * Out-of-combat/in-combat HP and MP regeneration (GAME_DESIGN.md §4.4).
 * Returns true when a schema value changed. Dead/warping players are skipped
 * and their accumulator is reset so they cannot bank a burst of regen.
 */
export function applyRegenTick(
  runtime: PlayerRuntime,
  player: PlayerState,
  now: number,
  catalog: CatalogLookup = BASE_CATALOG,
): boolean {
  if (runtime.dead || runtime.warping) {
    runtime.regenAccumMs = 0;
    return false;
  }

  runtime.regenAccumMs += TICK_MS;
  let changed = false;
  while (runtime.regenAccumMs >= REGEN_INTERVAL_MS) {
    runtime.regenAccumMs -= REGEN_INTERVAL_MS;
    const inCombat = now - runtime.lastCombatAtMs <= COMBAT_TIMEOUT_MS;
    const regenBonus = 1 + equipmentBonusValue(runtime.inventory, "hp_regen", catalog);
    const nextHp = Math.min(
      runtime.progression.maxHp,
      runtime.progression.hp +
        Math.round(hpRegenAmount(runtime.progression.maxHp, inCombat) * regenBonus),
    );
    const nextMp = Math.min(
      runtime.progression.maxMp,
      runtime.progression.mp + mpRegenAmount(runtime.progression.maxMp),
    );
    if (nextHp !== runtime.progression.hp || nextMp !== runtime.progression.mp) {
      changed = true;
    }
    runtime.progression.hp = nextHp;
    runtime.progression.mp = nextMp;
  }

  if (changed) {
    player.hp = runtime.progression.hp;
    player.mp = runtime.progression.mp;
    runtime.dirty = true;
  }
  return changed;
}

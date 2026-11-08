import {
  bonusValue,
  equipmentForStats,
  equipmentLayerKeys,
  sumEquipmentStats,
  type BonusType,
  type EquipmentLayerKeys,
  type FullItemStats,
  type InventoryState,
} from "@jadethrone/shared";
import { hasItem } from "@jadethrone/data/items";
import { safeDefinition } from "./itemMappers";

/** Sum of all equipped item stats (weapon attack, armor defense, HP/MP, crit). */
export function equipmentBonusStats(state: InventoryState): FullItemStats {
  return sumEquipmentStats(equipmentForStats(state, safeDefinition));
}

/** Sum one non-classic bonus type across equipped items. */
export function equipmentBonusValue(state: InventoryState, type: BonusType): number {
  let total = 0;
  for (const stack of state.equipment) {
    if (!stack || !hasItem(stack.itemId)) {
      continue;
    }
    total += bonusValue(stack.bonuses, type);
  }
  return total;
}

/** Visual layer keys mirrored into PlayerState for own/remote rendering. */
export function equipmentVisualKeys(state: InventoryState): EquipmentLayerKeys {
  return equipmentLayerKeys(state, safeDefinition);
}

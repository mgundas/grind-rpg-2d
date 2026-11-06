import {
  equipmentForStats,
  equipmentLayerKeys,
  sumEquipmentStats,
  type EquipmentLayerKeys,
  type FullItemStats,
  type InventoryState,
} from "@jadethrone/shared";
import { safeDefinition } from "./itemMappers";

/** Sum of all equipped item stats (weapon attack, armor defense, HP/MP, crit). */
export function equipmentBonusStats(state: InventoryState): FullItemStats {
  return sumEquipmentStats(equipmentForStats(state, safeDefinition));
}

/** Visual layer keys mirrored into PlayerState for own/remote rendering. */
export function equipmentVisualKeys(state: InventoryState): EquipmentLayerKeys {
  return equipmentLayerKeys(state, safeDefinition);
}

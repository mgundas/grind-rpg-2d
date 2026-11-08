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
import { BASE_CATALOG, type CatalogLookup } from "@jadethrone/data/catalog";
import { safeDefinition } from "./itemMappers";

/** Sum of all equipped item stats (weapon attack, armor defense, HP/MP, crit). */
export function equipmentBonusStats(
  state: InventoryState,
  catalog: CatalogLookup = BASE_CATALOG,
): FullItemStats {
  return sumEquipmentStats(equipmentForStats(state, (id) => safeDefinition(id, catalog)));
}

/** Sum one non-classic bonus type across equipped items. */
export function equipmentBonusValue(
  state: InventoryState,
  type: BonusType,
  catalog: CatalogLookup = BASE_CATALOG,
): number {
  let total = 0;
  for (const stack of state.equipment) {
    if (!stack || !catalog.hasItem(stack.itemId)) {
      continue;
    }
    total += bonusValue(stack.bonuses, type);
  }
  return total;
}

/** Visual layer keys mirrored into PlayerState for own/remote rendering. */
export function equipmentVisualKeys(
  state: InventoryState,
  catalog: CatalogLookup = BASE_CATALOG,
): EquipmentLayerKeys {
  return equipmentLayerKeys(state, (id) => safeDefinition(id, catalog));
}

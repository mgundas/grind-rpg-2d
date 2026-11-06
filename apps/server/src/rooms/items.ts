import type { InventorySnapshotPayload, WarehouseSnapshotPayload } from "@jadethrone/shared";
import { toItemDto } from "../items/itemMappers";
import type { PlayerRuntime } from "./playerRuntime";

/** Owner-only snapshot sent on join, after every mutation and on request. */
export function buildInventorySnapshot(runtime: PlayerRuntime): InventorySnapshotPayload {
  return {
    revision: runtime.inventoryRevision,
    gold: runtime.gold,
    items: runtime.inventory.items.map(toItemDto),
    equipment: runtime.inventory.equipment.map((item) => (item ? toItemDto(item) : null)),
  };
}

export function buildWarehouseSnapshot(runtime: PlayerRuntime): WarehouseSnapshotPayload {
  return {
    revision: runtime.warehouseRevision,
    items: (runtime.warehouse?.items ?? []).map(toItemDto),
  };
}

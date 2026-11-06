import type { AdminOnlinePlayer, InventoryState, ItemStack } from "@jadethrone/shared";
import { ServiceError } from "../errors";
import { ItemError } from "../items/errors";
import type { PlayerRuntime } from "./playerRuntime";
import type { PlayerState } from "./state/WorldState";

/** Snapshot used by the admin dashboard and player list. */
export function buildAdminPresence(
  sessionId: string,
  runtime: PlayerRuntime,
  player: PlayerState,
  mapId: string,
): AdminOnlinePlayer {
  return {
    accountId: runtime.accountId,
    characterId: runtime.characterId,
    sessionId,
    name: player.name,
    classId: player.classId,
    mapId,
    channel: runtime.channel,
    level: runtime.progression.level,
    role: runtime.role,
    x: player.x,
    y: player.y,
    hp: runtime.progression.hp,
    maxHp: runtime.progression.maxHp,
    dead: runtime.dead,
  };
}

/** The stack created by an admin grant, or the stack a full merge grew. */
export function findGrantedStack(
  before: InventoryState,
  after: InventoryState,
  generatedId: string | null,
  itemId: string,
): ItemStack | null {
  if (generatedId) {
    const created = after.items.find((item) => item.id === generatedId);
    if (created) {
      return created;
    }
  }
  const beforeQuantities = new Map(before.items.map((item) => [item.id, item.quantity]));
  return (
    after.items.find(
      (item) => item.itemId === itemId && item.quantity > (beforeQuantities.get(item.id) ?? 0),
    ) ?? null
  );
}

/** Map item-domain failures onto the admin HTTP taxonomy. */
export function toAdminError(error: unknown): ServiceError {
  if (error instanceof ServiceError) {
    return error;
  }
  if (error instanceof ItemError) {
    if (error.code === "item_not_found") {
      return new ServiceError("not_found", error.message);
    }
    if (error.code === "inventory_full" || error.code === "slot_occupied") {
      return new ServiceError("conflict", error.message);
    }
    if (error.code === "internal") {
      return new ServiceError("internal", error.message);
    }
    return new ServiceError("validation", error.message);
  }
  return new ServiceError("internal", "Admin action failed.");
}

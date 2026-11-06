import { randomUUID } from "node:crypto";
import { EQUIP_SLOTS, type ClassId } from "@jadethrone/shared";
import { getItem } from "@jadethrone/data/items";
import { STARTER_KIT, getStarterWeapon } from "@jadethrone/data/starterKits";
import type { NewItemRow, itemLog } from "../db/schema";
import { toNewItemRow } from "./itemMappers";

export interface StarterKitRows {
  rows: NewItemRow[];
  logs: Array<typeof itemLog.$inferInsert>;
  gold: number;
}

/**
 * Build the rows inserted inside `createCharacter`'s existing transaction.
 * UUIDs are generated here so a failed name/insert rolls the whole kit back.
 */
export function buildStarterKit(
  characterId: string,
  accountId: string,
  classId: ClassId,
): StarterKitRows {
  const rows: NewItemRow[] = [];
  const logs: Array<typeof itemLog.$inferInsert> = [];

  const weaponId = getStarterWeapon(classId);
  const weapon = getItem(weaponId);
  const weaponSlot = EQUIP_SLOTS.indexOf("weapon");
  const weaponStack = {
    id: randomUUID(),
    itemId: weaponId,
    slot: weaponSlot,
    quantity: 1,
    upgradeLevel: 0,
    bonuses: [],
  };
  rows.push(toNewItemRow(weaponStack, { characterId }, "equipment", "starter"));
  logs.push({
    id: randomUUID(),
    itemId: weaponStack.id,
    actorCharacterId: characterId,
    accountId,
    action: "starter",
    definitionId: weaponId,
    quantity: 1,
    toLocation: "equipment",
    toSlot: weaponSlot,
    detail: { classId, kind: "weapon", itemName: weapon.name },
  });

  let slot = 0;
  for (const potion of STARTER_KIT.potions) {
    const definition = getItem(potion.itemId);
    const stack = {
      id: randomUUID(),
      itemId: potion.itemId,
      slot,
      quantity: potion.quantity,
      upgradeLevel: 0,
      bonuses: [],
    };
    rows.push(toNewItemRow(stack, { characterId }, "inventory", "starter"));
    logs.push({
      id: randomUUID(),
      itemId: stack.id,
      actorCharacterId: characterId,
      accountId,
      action: "starter",
      definitionId: potion.itemId,
      quantity: potion.quantity,
      toLocation: "inventory",
      toSlot: slot,
      detail: { classId, kind: "potion", itemName: definition.name },
    });
    slot += definition.size;
  }

  return { rows, logs, gold: STARTER_KIT.gold };
}

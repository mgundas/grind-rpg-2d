import { describe, expect, it } from "vitest";
import { EQUIP_SLOTS } from "@jadethrone/shared";
import type { ItemRow } from "../../src/db/schema";
import { loadRowsIntoState } from "../../src/items/itemMappers";

function row(overrides: Partial<ItemRow> = {}): ItemRow {
  return {
    id: "item-1",
    definitionId: "potion_hp_s",
    ownerCharacterId: "char-1",
    ownerAccountId: null,
    location: "inventory",
    slot: 0,
    quantity: 1,
    upgradeLevel: 0,
    bonuses: [],
    createdBy: "test",
    createdAt: new Date(),
    mapId: null,
    roomId: null,
    x: null,
    y: null,
    dropOwnerCharacterId: null,
    ownerUntil: null,
    despawnAt: null,
    ...overrides,
  };
}

describe("loadRowsIntoState", () => {
  it("builds inventory and eight equipment slots", () => {
    const { inventory, repairs } = loadRowsIntoState([
      row({ id: "potion", slot: 0, quantity: 5 }),
      row({
        id: "weapon",
        definitionId: "sword_ember_t1",
        location: "equipment",
        slot: EQUIP_SLOTS.indexOf("weapon"),
      }),
    ]);
    expect(repairs).toHaveLength(0);
    expect(inventory.items).toHaveLength(1);
    expect(inventory.equipment).toHaveLength(8);
    expect(inventory.equipment[0]?.id).toBe("weapon");
  });

  it("repairs overlapping inventory rows", () => {
    const { inventory, repairs } = loadRowsIntoState([
      row({ id: "a", slot: 0 }),
      row({ id: "b", slot: 0 }),
    ]);
    expect(inventory.items.map((item) => item.slot).sort()).toEqual([0, 1]);
    expect(repairs.some((repair) => repair.reason === "overlap")).toBe(true);
  });

  it("moves a misplaced equipment row into the inventory", () => {
    const { inventory, repairs } = loadRowsIntoState([
      row({
        id: "weapon",
        definitionId: "sword_ember_t1",
        location: "equipment",
        slot: 5,
      }),
    ]);
    expect(inventory.equipment.every((entry) => entry === null)).toBe(true);
    expect(inventory.items[0]?.id).toBe("weapon");
    expect(repairs[0]?.reason).toBe("equipment_slot");
  });

  it("clamps an equipped stack to one", () => {
    const { inventory, repairs } = loadRowsIntoState([
      row({
        id: "weapon",
        definitionId: "sword_ember_t1",
        location: "equipment",
        slot: 0,
        quantity: 3,
      }),
    ]);
    expect(inventory.equipment[0]?.quantity).toBe(1);
    expect(repairs[0]?.reason).toBe("equipment_quantity");
  });

  it("moves an unknown definition out of equipment without throwing", () => {
    const { inventory, repairs } = loadRowsIntoState([
      row({
        id: "unknown",
        definitionId: "deleted_weapon",
        location: "equipment",
        slot: 0,
      }),
    ]);
    expect(inventory.equipment[0]).toBeNull();
    expect(inventory.items[0]?.id).toBe("unknown");
    expect(repairs[0]?.reason).toBe("unknown_definition");
  });
});

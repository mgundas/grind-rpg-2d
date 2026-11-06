#!/usr/bin/env node
/**
 * Phase-4 economy/data sanity check. Runs without a server/database:
 *   node --import tsx scripts/verify-phase4-economy.mjs
 *
 * Covers item catalogue integrity, drop tables, shops/NPCs, starter kits,
 * multi-cell inventory placement, stacking/splitting, equipment aggregation
 * and the gold needed for a starting character to buy potions.
 */
import {
  INVENTORY_CELLS,
  WAREHOUSE_CELLS,
  addItem,
  emptyInventory,
  equipItem,
  splitStack,
  equipmentForStats,
} from "../packages/shared/src/inventory.ts";
import { sumEquipmentStats } from "../packages/shared/src/items.ts";
import { ITEMS, getItem, hasItem } from "../packages/data/src/items.ts";
import { DROP_TABLES, getDropTable } from "../packages/data/src/dropTables.ts";
import { SHOPS, getShop } from "../packages/data/src/shops.ts";
import { NPCS, getNpc } from "../packages/data/src/npcs.ts";
import { STARTER_KIT, getStarterWeapon } from "../packages/data/src/starterKits.ts";
import { CLASS_IDS } from "../packages/shared/src/characterRules.ts";

let failures = 0;
function check(label, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!condition) {
    failures += 1;
  }
}

check("at least 60 item definitions", ITEMS.length >= 60, `${ITEMS.length}`);
check("inventory has 90 cells", INVENTORY_CELLS === 90);
check("warehouse has 135 cells", WAREHOUSE_CELLS === 135);
check("item ids are unique", new Set(ITEMS.map((item) => item.id)).size === ITEMS.length);

for (const item of ITEMS) {
  check(
    `${item.id} price/stack rules`,
    (!item.stackable || item.maxStack >= 2) &&
      (item.stackable || item.maxStack === 1) &&
      item.size >= 1 &&
      item.size <= 3 &&
      (item.buyPrice === 0 || item.sellPrice <= item.buyPrice),
  );
}

check(
  "drop tables reference real items",
  DROP_TABLES.every((table) =>
    table.drops.every(
      (drop) =>
        hasItem(drop.itemId) &&
        drop.chance > 0 &&
        drop.chance <= 1 &&
        drop.maxQty >= drop.minQty &&
        drop.maxQty <= getItem(drop.itemId).maxStack,
    ),
  ),
);
check(
  "wild_dog gives a deterministic material",
  getDropTable("wild_dog").drops.some(
    (drop) => drop.itemId === "material_wolf_fang" && drop.chance === 1,
  ),
);

for (const shop of SHOPS) {
  check(
    `shop ${shop.id} stocks sellable data`,
    shop.items.every((entry) => hasItem(entry.itemId) && getItem(entry.itemId).buyPrice > 0),
  );
  const npc = NPCS.find((candidate) => candidate.id === shop.npcId);
  check(`shop ${shop.id} has its NPC`, npc?.kind === "shop" && npc?.shopId === shop.id);
}
check("five town NPCs exist", NPCS.length === 5);
check("warehouse keeper exists", getNpc("warehouse_keeper").kind === "warehouse");

for (const classId of CLASS_IDS) {
  const weapon = getItem(getStarterWeapon(classId));
  check(
    `${classId} starter weapon is legal`,
    weapon.type === "weapon" &&
      weapon.levelReq === 1 &&
      (weapon.classes === "all" || weapon.classes.includes(classId)),
  );
}
check("starter gold buys at least three small potions", STARTER_KIT.gold >= 3 * 40);

// Inventory maths: 125 potions (maxStack 100) become a 100-stack and a 25-stack.
const potion = getItem("potion_hp_s");
const added = addItem(
  emptyInventory(),
  potion,
  { id: "stack-a", itemId: potion.id, slot: 0, quantity: 125, upgradeLevel: 0, bonuses: [] },
  () => "stack-b",
  (id) => getItem(id),
);
check("125 potions create two stacks", added.ok && added.state.items.length === 2);
check(
  "potion quantities total 125",
  added.ok && added.state.items.reduce((sum, item) => sum + item.quantity, 0) === 125,
);

if (added.ok) {
  const split = splitStack(added.state, "stack-a", 25, "stack-c", null, (id) => getItem(id));
  check("splitting a stack succeeds", split.ok && split.state.items.length === 3);
}

// Equipment: a tier-1 sword and armour raise the expected stats.
const withGear = emptyInventory();
withGear.items.push(
  { id: "w", itemId: "sword_ember_t1", slot: 0, quantity: 1, upgradeLevel: 0, bonuses: [] },
  { id: "a", itemId: "armor_warrior_t1", slot: 3, quantity: 1, upgradeLevel: 0, bonuses: [] },
);
const equippedWeapon = equipItem(withGear, "w", "warrior", 1, (id) => getItem(id));
check("tier-1 sword equips", equippedWeapon.ok && equippedWeapon.state.equipment[0]?.id === "w");
if (equippedWeapon.ok) {
  const equippedArmor = equipItem(equippedWeapon.state, "a", "warrior", 1, (id) => getItem(id));
  check("tier-1 armour equips", equippedArmor.ok && equippedArmor.state.equipment[1]?.id === "a");
  if (equippedArmor.ok) {
    const stats = sumEquipmentStats(equipmentForStats(equippedArmor.state, (id) => getItem(id)));
    check("equipment adds attack", stats.attack === 6, `${stats.attack}`);
    check("equipment adds defence", stats.defense === 4, `${stats.defense}`);
    check("equipment adds max HP", stats.maxHp === 20, `${stats.maxHp}`);
  }
}

// Shop affordability: starting gold covers the early-game kit.
const general = getShop("general_goods");
const affordable = general.items.filter((entry) => getItem(entry.itemId).buyPrice <= STARTER_KIT.gold);
check("general goods has affordable entries", affordable.length >= 3);

if (failures > 0) {
  console.error(`\n${failures} Phase-4 economy check(s) failed.`);
  process.exit(1);
}
console.log("\nAll Phase-4 economy checks passed.");

import {
  cloneInventory,
  isEquipmentType,
  type InventoryState,
  type ItemStack,
  type RandomSource,
  type UpgradePreview,
  type UpgradeMaterialView,
} from "@jadethrone/shared";
import { getItem, hasItem } from "@jadethrone/data/items";
import { getUpgradeStep, MAX_UPGRADE_LEVEL, type UpgradeStep } from "@jadethrone/data/upgrades";
import { ItemError } from "./errors";
import { describeChanges, type GoldDelta, type ItemPlan } from "./itemChanges";
import { diffInventory } from "./planning";

const BLESSING_SCROLL = "scroll_blessing";

export interface UpgradePlanResult {
  /** Next in-memory inventory; commit the plan before assigning it. */
  state: InventoryState;
  plan: ItemPlan;
  success: boolean;
  previousLevel: number;
  level: number | null;
  destroyed: boolean;
  usedBlessing: boolean;
}

interface LocatedStack {
  stack: ItemStack;
  location: "inventory" | "equipment";
}

function locate(state: InventoryState, instanceId: string): LocatedStack | null {
  const inventory = state.items.find((item) => item.id === instanceId);
  if (inventory) {
    return { stack: inventory, location: "inventory" };
  }
  const equipment = state.equipment.find((item) => item?.id === instanceId);
  return equipment ? { stack: equipment, location: "equipment" } : null;
}

function countItems(state: InventoryState, itemId: string): number {
  return state.items
    .filter((item) => item.itemId === itemId)
    .reduce((total, item) => total + item.quantity, 0);
}

/** Consume `quantity` from inventory stacks, mutating the working state. */
function consumeItem(state: InventoryState, itemId: string, quantity: number): void {
  let remaining = quantity;
  for (let index = 0; index < state.items.length && remaining > 0; index += 1) {
    const stack = state.items[index]!;
    if (stack.itemId !== itemId) {
      continue;
    }
    const consumed = Math.min(stack.quantity, remaining);
    remaining -= consumed;
    if (consumed === stack.quantity) {
      state.items.splice(index, 1);
      index -= 1;
    } else {
      state.items[index] = { ...stack, quantity: stack.quantity - consumed };
    }
  }
  if (remaining > 0) {
    throw new ItemError("not_usable", `Not enough ${itemId}.`);
  }
}

/** Apply the level outcome to the working inventory. */
function applyTargetLevel(state: InventoryState, instanceId: string, level: number | null): void {
  const inventoryIndex = state.items.findIndex((item) => item.id === instanceId);
  if (inventoryIndex >= 0) {
    if (level === null) {
      state.items.splice(inventoryIndex, 1);
    } else {
      state.items[inventoryIndex] = { ...state.items[inventoryIndex]!, upgradeLevel: level };
    }
    return;
  }
  const equipmentIndex = state.equipment.findIndex((item) => item?.id === instanceId);
  if (equipmentIndex < 0) {
    throw new ItemError("item_not_found", "Item not found.");
  }
  const stack = state.equipment[equipmentIndex]!;
  state.equipment[equipmentIndex] = level === null ? null : { ...stack, upgradeLevel: level };
}

function previewMaterials(
  state: InventoryState,
  step: UpgradeStep | undefined,
): UpgradeMaterialView[] {
  return (step?.materials ?? []).map((material) => ({
    itemId: material.itemId,
    required: material.quantity,
    owned: countItems(state, material.itemId),
  }));
}

export function buildUpgradePreview(
  state: InventoryState,
  gold: number,
  instanceId: string,
): UpgradePreview {
  const located = locate(state, instanceId);
  if (!located) {
    throw new ItemError("item_not_found", "Item not found.");
  }
  const definition = getItem(located.stack.itemId);
  if (!isEquipmentType(definition.type)) {
    throw new ItemError("not_usable", "Only equipment can be upgraded.");
  }
  const currentLevel = located.stack.upgradeLevel;
  const step = getUpgradeStep(currentLevel);
  if (!step) {
    return {
      instanceId,
      currentLevel,
      maxLevel: MAX_UPGRADE_LEVEL,
      nextLevel: null,
      chance: null,
      gold: null,
      materials: [],
      hasGold: true,
      hasMaterials: true,
      blessingAvailable: countItems(state, BLESSING_SCROLL) > 0,
      canUpgrade: false,
    };
  }
  const materials = previewMaterials(state, step);
  const hasMaterials = materials.every((material) => material.owned >= material.required);
  const hasGold = gold >= step.gold;
  return {
    instanceId,
    currentLevel,
    maxLevel: MAX_UPGRADE_LEVEL,
    nextLevel: step.to,
    chance: step.chance,
    gold: step.gold,
    materials,
    hasGold,
    hasMaterials,
    blessingAvailable: countItems(state, BLESSING_SCROLL) > 0,
    canUpgrade: hasGold && hasMaterials,
  };
}

/**
 * Plan one atomic upgrade against a copy of the inventory. The caller supplies
 * the authoritative gold balance; the transaction re-validates it when
 * applying the plan, then assigns `state` only after the commit.
 */
export function planUpgrade(
  state: InventoryState,
  gold: number,
  characterId: string,
  instanceId: string,
  options: { useBlessing: boolean; rng: RandomSource },
): UpgradePlanResult {
  const located = locate(state, instanceId);
  if (!located) {
    throw new ItemError("item_not_found", "Item not found.");
  }
  const definition = getItem(located.stack.itemId);
  if (!isEquipmentType(definition.type)) {
    throw new ItemError("not_usable", "Only equipment can be upgraded.");
  }
  const previousLevel = located.stack.upgradeLevel;
  const step = getUpgradeStep(previousLevel);
  if (!step) {
    throw new ItemError("not_usable", "This item is already at maximum level.");
  }
  if (options.useBlessing && countItems(state, BLESSING_SCROLL) <= 0) {
    throw new ItemError("not_usable", "No Blessing Scroll available.");
  }
  if (gold < step.gold) {
    throw new ItemError("no_gold", "Not enough gold for this upgrade.");
  }
  for (const material of step.materials) {
    if (countItems(state, material.itemId) < material.quantity) {
      throw new ItemError("not_usable", `Not enough ${material.itemId}.`);
    }
  }

  const next = cloneInventory(state);
  for (const material of step.materials) {
    consumeItem(next, material.itemId, material.quantity);
  }

  const success = options.rng.next() < step.chance;
  const usedBlessing = !success && options.useBlessing;
  if (usedBlessing) {
    consumeItem(next, BLESSING_SCROLL, 1);
  }

  let level: number | null = previousLevel + 1;
  let destroyed = false;
  if (!success) {
    if (usedBlessing) {
      level = Math.max(0, previousLevel - 1);
    } else {
      level = null;
      destroyed = true;
    }
  }
  applyTargetLevel(next, instanceId, level);

  const detail = {
    instanceId,
    previousLevel,
    level,
    success,
    usedBlessing,
    chance: step.chance,
  };
  const action = success
    ? "upgrade_success"
    : usedBlessing
      ? "upgrade_blessing_saved"
      : "upgrade_failure";
  const changes = diffInventory(state, next, characterId, "upgrade");
  const goldDelta: GoldDelta = {
    delta: -step.gold,
    reason: "upgrade",
    detail,
  };

  return {
    state: next,
    plan: {
      changes,
      logs: describeChanges(changes, action, detail),
      gold: goldDelta,
    },
    success,
    previousLevel,
    level,
    destroyed,
    usedBlessing,
  };
}

/** Exposed for tests/tooling; the blessing scroll id is data-driven item data. */
export const UPGRADE_BLESSING_ITEM = BLESSING_SCROLL;

// Keep the imported item lookup meaningful for callers that validate definitions.
export function isUpgradeableItem(itemId: string): boolean {
  return hasItem(itemId) && isEquipmentType(getItem(itemId).type);
}

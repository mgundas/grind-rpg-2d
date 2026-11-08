import {
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
import {
  describeChanges,
  rowStateFromStack,
  type DeleteChange,
  type GoldDelta,
  type ItemChange,
  type ItemPlan,
  type UpdateChange,
} from "./itemChanges";

const BLESSING_SCROLL = "scroll_blessing";

export interface UpgradePlanResult {
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

/** Consume `quantity` from inventory stacks, returning the plan changes. */
function consumeItem(
  state: InventoryState,
  characterId: string,
  itemId: string,
  quantity: number,
): ItemChange[] {
  let remaining = quantity;
  const changes: ItemChange[] = [];
  for (const stack of state.items) {
    if (remaining <= 0) {
      break;
    }
    if (stack.itemId !== itemId) {
      continue;
    }
    const consumed = Math.min(stack.quantity, remaining);
    remaining -= consumed;
    const expect = rowStateFromStack(stack, "inventory", characterId);
    if (consumed === stack.quantity) {
      changes.push({
        kind: "delete",
        id: stack.id,
        itemId: stack.itemId,
        expect,
      });
    } else {
      changes.push({
        kind: "update",
        id: stack.id,
        itemId: stack.itemId,
        expect,
        to: {
          ...expect,
          quantity: stack.quantity - consumed,
        },
      });
    }
  }
  if (remaining > 0) {
    throw new ItemError("not_usable", `Not enough ${itemId}.`);
  }
  return changes;
}

function targetChange(
  located: LocatedStack,
  characterId: string,
  upgradeLevel: number | null,
): ItemChange {
  const expect = rowStateFromStack(located.stack, located.location, characterId);
  if (upgradeLevel === null) {
    const change: DeleteChange = {
      kind: "delete",
      id: located.stack.id,
      itemId: located.stack.itemId,
      expect,
    };
    return change;
  }
  const change: UpdateChange = {
    kind: "update",
    id: located.stack.id,
    itemId: located.stack.itemId,
    expect,
    to: { ...expect, upgradeLevel },
  };
  return change;
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
 * Plan one atomic upgrade. The caller supplies the authoritative gold balance;
 * the transaction re-validates it when applying the plan.
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

  const changes: ItemChange[] = [];
  for (const material of step.materials) {
    changes.push(...consumeItem(state, characterId, material.itemId, material.quantity));
  }

  const success = options.rng.next() < step.chance;
  const usedBlessing = !success && options.useBlessing;
  if (usedBlessing) {
    changes.push(...consumeItem(state, characterId, BLESSING_SCROLL, 1));
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
  changes.push(targetChange(located, characterId, level));
  const goldDelta: GoldDelta = {
    delta: -step.gold,
    reason: "upgrade",
    detail: {
      instanceId,
      previousLevel,
      level,
      success,
      usedBlessing,
      chance: step.chance,
    },
  };
  const action = success
    ? "upgrade_success"
    : usedBlessing
      ? "upgrade_blessing_saved"
      : "upgrade_failure";

  return {
    plan: {
      changes,
      logs: describeChanges(changes, action, {
        instanceId,
        previousLevel,
        level,
        success,
        usedBlessing,
        chance: step.chance,
      }),
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

import {
  cloneInventory,
  isEquipmentType,
  type InventoryState,
  type RandomSource,
  type UpgradePreview,
  type UpgradeMaterialView,
} from "@jadethrone/shared";
import { getItem, hasItem } from "@jadethrone/data/items";
import { getUpgradeStep, MAX_UPGRADE_LEVEL, type UpgradeStep } from "@jadethrone/data/upgrades";
import { ItemError } from "./errors";
import { describeChanges, type GoldDelta, type ItemPlan } from "./itemChanges";
import { consumeItem, countItem, findStack, setStack } from "./inventoryDraft";
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

function previewMaterials(
  state: InventoryState,
  step: UpgradeStep | undefined,
): UpgradeMaterialView[] {
  return (step?.materials ?? []).map((material) => ({
    itemId: material.itemId,
    required: material.quantity,
    owned: countItem(state, material.itemId),
  }));
}

export function buildUpgradePreview(
  state: InventoryState,
  gold: number,
  instanceId: string,
): UpgradePreview {
  const located = findStack(state, instanceId);
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
      blessingAvailable: countItem(state, BLESSING_SCROLL) > 0,
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
    blessingAvailable: countItem(state, BLESSING_SCROLL) > 0,
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
  const located = findStack(state, instanceId);
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
  if (options.useBlessing && countItem(state, BLESSING_SCROLL) <= 0) {
    throw new ItemError("not_usable", "No Blessing Scroll available.");
  }
  if (gold < step.gold) {
    throw new ItemError("no_gold", "Not enough gold for this upgrade.");
  }
  for (const material of step.materials) {
    if (countItem(state, material.itemId) < material.quantity) {
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
  const target = findStack(next, instanceId);
  setStack(
    next,
    instanceId,
    level === null ? null : { ...target!.stack, upgradeLevel: level },
  );

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

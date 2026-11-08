/** Wire contracts for the blacksmith upgrade flow (Phase 7). */

export interface UpgradeMaterialView {
  itemId: string;
  required: number;
  owned: number;
}

export interface UpgradePreview {
  instanceId: string;
  currentLevel: number;
  maxLevel: number;
  /** Null when the item is already at +9. */
  nextLevel: number | null;
  chance: number | null;
  gold: number | null;
  materials: UpgradeMaterialView[];
  hasGold: boolean;
  hasMaterials: boolean;
  blessingAvailable: boolean;
  canUpgrade: boolean;
}

export interface UpgradeResultPayload {
  instanceId: string;
  success: boolean;
  previousLevel: number;
  /** Final level after success or blessing downgrade; null when destroyed. */
  level: number | null;
  destroyed: boolean;
  usedBlessing: boolean;
}

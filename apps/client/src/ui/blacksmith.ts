import type { UpgradePreview, UpgradeResultPayload } from "@jadethrone/shared";

/** Client-side blacksmith flow; the server remains authoritative for the roll. */
export type BlacksmithPhase = "idle" | "preview" | "rolling" | "result";

export interface BlacksmithState {
  phase: BlacksmithPhase;
  instanceId: string | null;
  preview: UpgradePreview | null;
  useBlessing: boolean;
  result: UpgradeResultPayload | null;
  error: string | null;
}

export const initialBlacksmithState: BlacksmithState = {
  phase: "idle",
  instanceId: null,
  preview: null,
  useBlessing: false,
  result: null,
  error: null,
};

export type BlacksmithAction =
  | { type: "select"; instanceId: string }
  | { type: "preview"; preview: UpgradePreview }
  | { type: "error"; message: string }
  | { type: "toggleBlessing"; value: boolean }
  | { type: "roll" }
  | { type: "result"; result: UpgradeResultPayload }
  | { type: "reset" };

export function blacksmithReducer(
  state: BlacksmithState,
  action: BlacksmithAction,
): BlacksmithState {
  switch (action.type) {
    case "select":
      return {
        ...initialBlacksmithState,
        phase: "preview",
        instanceId: action.instanceId,
      };
    case "preview":
      if (action.preview.instanceId !== state.instanceId) {
        return state;
      }
      return { ...state, phase: "preview", preview: action.preview, error: null };
    case "error":
      return { ...state, phase: "preview", error: action.message };
    case "toggleBlessing":
      return { ...state, useBlessing: action.value };
    case "roll":
      if (!state.preview || !state.instanceId) {
        return state;
      }
      return { ...state, phase: "rolling", result: null, error: null };
    case "result":
      return { ...state, phase: "result", result: action.result, error: null };
    case "reset":
      return initialBlacksmithState;
    default:
      return state;
  }
}

export interface UpgradeMaterialView {
  itemId: string;
  required: number;
  owned: number;
  ok: boolean;
}

export interface UpgradePreviewView {
  chanceText: string;
  goldText: string;
  materials: UpgradeMaterialView[];
  canRoll: boolean;
  blockReason: string | null;
}

/** Pure presentation derived from the server preview and the blessing toggle. */
export function formatUpgradePreview(
  preview: UpgradePreview,
  useBlessing: boolean,
): UpgradePreviewView {
  const materials = preview.materials.map((material) => ({
    itemId: material.itemId,
    required: material.required,
    owned: material.owned,
    ok: material.owned >= material.required,
  }));
  let blockReason: string | null = null;
  if (preview.nextLevel === null) {
    blockReason = "Already at +9";
  } else if (!preview.hasMaterials) {
    blockReason = "Missing materials";
  } else if (!preview.hasGold) {
    blockReason = "Not enough gold";
  } else if (useBlessing && !preview.blessingAvailable) {
    blockReason = "No Blessing Scroll";
  }
  return {
    chanceText: preview.chance === null ? "MAX" : `${Math.round(preview.chance * 100)}%`,
    goldText: preview.gold === null ? "—" : preview.gold.toLocaleString("en-US"),
    materials,
    canRoll: blockReason === null,
    blockReason,
  };
}

/** One-line outcome for the result card. */
export function resultSummary(result: UpgradeResultPayload): string {
  if (result.success) {
    return `Forged to +${result.level ?? "?"}`;
  }
  if (result.destroyed) {
    return "The item shattered";
  }
  if (result.usedBlessing) {
    return `Blessing saved it — now +${result.level ?? 0}`;
  }
  return "The forge rejected the item";
}

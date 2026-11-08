import { describe, expect, it } from "vitest";
import type { UpgradePreview, UpgradeResultPayload } from "@jadethrone/shared";
import {
  blacksmithReducer,
  formatUpgradePreview,
  initialBlacksmithState,
  resultSummary,
} from "../src/ui/blacksmith";

function preview(overrides: Partial<UpgradePreview> = {}): UpgradePreview {
  return {
    instanceId: "item-1",
    currentLevel: 3,
    maxLevel: 9,
    nextLevel: 4,
    chance: 0.7,
    gold: 8_000,
    materials: [{ itemId: "material_wolf_fang", required: 1, owned: 2 }],
    hasGold: true,
    hasMaterials: true,
    blessingAvailable: true,
    canUpgrade: true,
    ...overrides,
  };
}

describe("formatUpgradePreview", () => {
  it("formats chance, gold and owned materials", () => {
    const view = formatUpgradePreview(preview(), false);
    expect(view.chanceText).toBe("70%");
    expect(view.goldText).toBe("8,000");
    expect(view.materials).toEqual([
      { itemId: "material_wolf_fang", required: 1, owned: 2, ok: true },
    ]);
    expect(view.canRoll).toBe(true);
    expect(view.blockReason).toBeNull();
  });

  it("blocks missing materials, gold or blessing", () => {
    expect(formatUpgradePreview(preview({ hasMaterials: false }), false).blockReason).toBe(
      "Missing materials",
    );
    expect(formatUpgradePreview(preview({ hasGold: false }), false).blockReason).toBe(
      "Not enough gold",
    );
    const noBlessing = preview({ blessingAvailable: false });
    expect(formatUpgradePreview(noBlessing, true).blockReason).toBe("No Blessing Scroll");
    expect(formatUpgradePreview(noBlessing, false).blockReason).toBeNull();
  });

  it("marks max-level items as unrollable", () => {
    const maxed = preview({
      currentLevel: 9,
      nextLevel: null,
      chance: null,
      gold: null,
      materials: [],
      canUpgrade: false,
    });
    const view = formatUpgradePreview(maxed, false);
    expect(view.chanceText).toBe("MAX");
    expect(view.goldText).toBe("—");
    expect(view.canRoll).toBe(false);
    expect(view.blockReason).toBe("Already at +9");
  });
});

describe("blacksmithReducer", () => {
  it("moves from selection through preview, roll and result", () => {
    let state = blacksmithReducer(initialBlacksmithState, {
      type: "select",
      instanceId: "item-1",
    });
    expect(state.phase).toBe("preview");
    expect(state.preview).toBeNull();

    state = blacksmithReducer(state, { type: "preview", preview: preview() });
    expect(state.preview?.chance).toBe(0.7);

    state = blacksmithReducer(state, { type: "toggleBlessing", value: true });
    expect(state.useBlessing).toBe(true);

    state = blacksmithReducer(state, { type: "roll" });
    expect(state.phase).toBe("rolling");

    const result: UpgradeResultPayload = {
      instanceId: "item-1",
      success: true,
      previousLevel: 3,
      level: 4,
      destroyed: false,
      usedBlessing: false,
    };
    state = blacksmithReducer(state, { type: "result", result });
    expect(state.phase).toBe("result");
    expect(state.result).toEqual(result);
  });

  it("ignores a preview for a different instance", () => {
    const selected = blacksmithReducer(initialBlacksmithState, {
      type: "select",
      instanceId: "item-1",
    });
    const state = blacksmithReducer(selected, {
      type: "preview",
      preview: preview({ instanceId: "other" }),
    });
    expect(state.preview).toBeNull();
  });

  it("does not roll without a preview and resets cleanly", () => {
    const selected = blacksmithReducer(initialBlacksmithState, {
      type: "select",
      instanceId: "item-1",
    });
    expect(blacksmithReducer(selected, { type: "roll" }).phase).toBe("preview");
    expect(
      blacksmithReducer(selected, { type: "reset" }),
    ).toEqual(initialBlacksmithState);
  });
});

describe("resultSummary", () => {
  it("describes success, destruction and blessing saves", () => {
    const base: UpgradeResultPayload = {
      instanceId: "item-1",
      success: true,
      previousLevel: 6,
      level: 7,
      destroyed: false,
      usedBlessing: false,
    };
    expect(resultSummary(base)).toBe("Forged to +7");
    expect(resultSummary({ ...base, success: false, level: null, destroyed: true })).toBe(
      "The item shattered",
    );
    expect(
      resultSummary({ ...base, success: false, level: 5, usedBlessing: true }),
    ).toBe("Blessing saved it — now +5");
  });
});

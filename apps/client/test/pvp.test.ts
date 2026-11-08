import { describe, expect, it } from "vitest";
import { playerNameColor, pvpModeLabel } from "../src/ui/pvp";

describe("client pvp presentation", () => {
  it("turns free players red and keeps kingdom colours otherwise", () => {
    expect(playerNameColor("free", "ember")).toBe("#ff7a6e");
    expect(playerNameColor("kingdom", "ember")).not.toBe("#ff7a6e");
    expect(playerNameColor(undefined, undefined)).toBe("#cfd8d3");
  });

  it("labels the three stances", () => {
    expect(pvpModeLabel("peaceful")).toBe("Peaceful");
    expect(pvpModeLabel("kingdom")).toBe("Kingdom");
    expect(pvpModeLabel("free")).toBe("Free");
  });
});

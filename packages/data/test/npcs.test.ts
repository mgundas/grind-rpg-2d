import { describe, expect, it } from "vitest";
import { getNpc, hasNpc, NPCS } from "@jadethrone/data/npcs";
import { getShop } from "@jadethrone/data/shops";

describe("npcs.json", () => {
  it("defines the town NPCs with unique ids", () => {
    expect(NPCS.map((npc) => npc.id).sort()).toEqual([
      "armorer",
      "blacksmith",
      "general_goods",
      "warehouse_keeper",
      "waykeeper",
      "weaponsmith",
    ]);
  });

  it("gives shop NPCs a valid, matching shop", () => {
    for (const npc of NPCS.filter((candidate) => candidate.kind === "shop")) {
      expect(npc.shopId).toBeDefined();
      expect(getShop(npc.shopId!).npcId).toBe(npc.id);
    }
  });

  it("covers the blacksmith, warehouse and teleporter roles", () => {
    expect(getNpc("blacksmith").kind).toBe("blacksmith");
    expect(getNpc("warehouse_keeper").kind).toBe("warehouse");
    expect(getNpc("warehouse_keeper").greeting).toMatch(/account/i);
    expect(getNpc("waykeeper").kind).toBe("teleporter");
    expect(getNpc("waykeeper").shopId).toBeUndefined();
  });

  it("looks NPCs up by id", () => {
    expect(hasNpc("blacksmith")).toBe(true);
    expect(hasNpc("nope")).toBe(false);
    expect(() => getNpc("nope")).toThrow(/unknown NPC/);
  });
});

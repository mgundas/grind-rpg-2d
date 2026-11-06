import { describe, expect, it } from "vitest";
import { CLASS_IDS, EQUIP_SLOTS } from "@jadethrone/shared";
import { getItem } from "@jadethrone/data/items";
import { STARTER_KIT } from "@jadethrone/data/starterKits";
import { buildStarterKit } from "../../src/items/starterKit";

describe("buildStarterKit", () => {
  it("gives every class an equipped level-1 weapon, potions and gold", () => {
    for (const classId of CLASS_IDS) {
      const kit = buildStarterKit("char-1", "account-1", classId);
      expect(kit.gold).toBe(STARTER_KIT.gold);
      expect(kit.rows).toHaveLength(1 + STARTER_KIT.potions.length);
      expect(kit.logs).toHaveLength(kit.rows.length);

      const weapon = kit.rows.find((row) => row.location === "equipment");
      expect(weapon).toBeDefined();
      expect(weapon?.slot).toBe(EQUIP_SLOTS.indexOf("weapon"));
      expect(weapon?.quantity).toBe(1);
      expect(getItem(weapon!.definitionId).levelReq).toBe(1);

      const potion = kit.rows.find((row) => row.location === "inventory");
      expect(potion?.quantity).toBe(5);
      expect(new Set(kit.rows.map((row) => row.id)).size).toBe(kit.rows.length);
    }
  });

  it("uses creator and log actions that identify starter gear", () => {
    const kit = buildStarterKit("char-1", "account-1", "warrior");
    for (const row of kit.rows) {
      expect(row.createdBy).toBe("starter");
      expect(row.ownerCharacterId).toBe("char-1");
    }
    for (const log of kit.logs) {
      expect(log.action).toBe("starter");
      expect(log.accountId).toBe("account-1");
    }
  });
});

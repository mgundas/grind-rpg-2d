import { describe, expect, it } from "vitest";
import {
  applyFieldValues,
  entryIdOf,
  fieldValuesFor,
  fieldsForDataset,
  parsePayloadJson,
} from "../src/lib/gameDataEditor";

describe("game data editor helpers", () => {
  it("derives entry ids per dataset", () => {
    expect(entryIdOf("items", { id: "potion_hp_s" })).toBe("potion_hp_s");
    expect(entryIdOf("upgrades", { from: 5 })).toBe("5");
    expect(entryIdOf("bonuses", { type: "attack" })).toBe("attack");
  });

  it("parses object payloads and rejects arrays or invalid JSON", () => {
    expect(parsePayloadJson('{"id":"x"}')).toEqual({ ok: true, payload: { id: "x" } });
    expect(parsePayloadJson("[]").ok).toBe(false);
    expect(parsePayloadJson("42").ok).toBe(false);
    expect(parsePayloadJson("{ nope }").ok).toBe(false);
  });

  it("fills structured fields from the payload", () => {
    const fields = fieldsForDataset("monsters");
    const values = fieldValuesFor(fields, { name: "Wolf", level: 4, hp: 120 });
    expect(values.name).toBe("Wolf");
    expect(values.level).toBe("4");
    expect(values.hp).toBe("120");
    expect(values.attack).toBe("");
  });

  it("applies item fields as numbers and rejects non-numeric input", () => {
    const fields = fieldsForDataset("items");
    const applied = applyFieldValues(fields, { id: "x", name: "Old" }, {
      name: "New",
      levelReq: "3",
      buyPrice: "120",
      sellPrice: "40",
      maxStack: "10",
    });
    expect(applied.ok).toBe(true);
    expect(applied.payload).toMatchObject({
      id: "x",
      name: "New",
      levelReq: 3,
      buyPrice: 120,
      sellPrice: 40,
      maxStack: 10,
    });
    expect(
      applyFieldValues(fields, { id: "x" }, {
        name: "New",
        levelReq: "many",
        buyPrice: "1",
        sellPrice: "1",
        maxStack: "1",
      }).ok,
    ).toBe(false);
  });

  it("offers no structured fields for nested datasets", () => {
    expect(fieldsForDataset("skills")).toEqual([]);
    expect(fieldsForDataset("upgrades")).toEqual([]);
  });

  it("rejects blank required numeric fields", () => {
    const result = applyFieldValues(
      fieldsForDataset("monsters"),
      { id: "m" },
      { name: "M", level: "", hp: "", attack: "", defense: "", xp: "", goldMin: "", goldMax: "" },
    );
    expect(result.ok).toBe(false);
  });
});

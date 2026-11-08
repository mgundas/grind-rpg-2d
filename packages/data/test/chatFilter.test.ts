import { describe, expect, it } from "vitest";
import { buildProfanityList, filterProfanity } from "../src/chatFilter";

describe("chat profanity filter", () => {
  it("replaces whole words and preserves length", () => {
    expect(filterProfanity("damn this shit", ["damn", "shit"])).toBe("**** this ****");
    expect(filterProfanity("DAMN it", ["damn"])).toBe("**** it");
  });

  it("does not replace partial words", () => {
    expect(filterProfanity("classic assessment", ["ass"])).toBe("classic assessment");
    expect(filterProfanity("hellfire", ["hell"])).toBe("hellfire");
  });

  it("validates the data list", () => {
    expect(buildProfanityList({ version: 1, profanity: ["bad"] })).toEqual(["bad"]);
    expect(() => buildProfanityList({ version: 1, profanity: [] })).toThrow();
  });
});

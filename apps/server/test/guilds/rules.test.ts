import { describe, expect, it } from "vitest";
import {
  canDisband,
  canInvite,
  canKick,
  canPromote,
  validateGuildName,
  GuildRuleError,
} from "../../src/guilds/rules";

describe("guild rules", () => {
  it("normalizes and validates names", () => {
    expect(validateGuildName("  Jade   Throne  ")).toBe("Jade Throne");
    expect(validateGuildName("A12")).toBe("A12");
    for (const name of ["", "ab", "a".repeat(21), "-bad", "bad!"]) {
      expect(() => validateGuildName(name)).toThrow(GuildRuleError);
    }
  });

  it("applies the rank permission matrix", () => {
    expect(canInvite("leader")).toBe(true);
    expect(canInvite("officer")).toBe(true);
    expect(canInvite("member")).toBe(false);

    expect(canKick("leader", "officer")).toBe(true);
    expect(canKick("leader", "leader")).toBe(false);
    expect(canKick("officer", "member")).toBe(true);
    expect(canKick("officer", "officer")).toBe(false);
    expect(canKick("member", "member")).toBe(false);

    expect(canPromote("leader")).toBe(true);
    expect(canPromote("officer")).toBe(false);
    expect(canDisband("leader")).toBe(true);
    expect(canDisband("officer")).toBe(false);
  });
});

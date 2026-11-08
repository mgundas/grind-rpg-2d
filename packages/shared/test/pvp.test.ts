import { describe, expect, it } from "vitest";
import { canAttackPlayer, isPvpMode, type PvpActor } from "../src/pvp";

const MAP = { pvpAllowed: true, safe: false };
const SAFE = { pvpAllowed: false, safe: true };

function actor(overrides: Partial<PvpActor> = {}): PvpActor {
  return {
    characterId: "a",
    kingdom: "ember",
    pvpMode: "kingdom",
    ...overrides,
  };
}

describe("pvp rules", () => {
  it("blocks self, safe maps, peaceful modes and friendly groups", () => {
    expect(canAttackPlayer(actor(), actor({ characterId: "a" }), MAP)).toBe(false);
    expect(canAttackPlayer(actor(), actor({ characterId: "b" }), SAFE)).toBe(false);
    expect(
      canAttackPlayer(actor({ pvpMode: "peaceful" }), actor({ characterId: "b" }), MAP),
    ).toBe(false);
    expect(
      canAttackPlayer(actor(), actor({ characterId: "b", pvpMode: "peaceful" }), MAP),
    ).toBe(false);
    expect(
      canAttackPlayer(actor({ partyId: "p" }), actor({ characterId: "b", partyId: "p" }), MAP),
    ).toBe(false);
    expect(
      canAttackPlayer(actor({ guildId: "g" }), actor({ characterId: "b", guildId: "g" }), MAP),
    ).toBe(false);
  });

  it("allows kingdom attacks only across kingdoms", () => {
    expect(canAttackPlayer(actor(), actor({ characterId: "b", kingdom: "gale" }), MAP)).toBe(
      true,
    );
    expect(canAttackPlayer(actor(), actor({ characterId: "b", kingdom: "ember" }), MAP)).toBe(
      false,
    );
  });

  it("free mode attacks anyone except peaceful/grouped targets", () => {
    expect(
      canAttackPlayer(
        actor({ pvpMode: "free" }),
        actor({ characterId: "b", kingdom: "ember" }),
        MAP,
      ),
    ).toBe(true);
    expect(
      canAttackPlayer(
        actor({ pvpMode: "free" }),
        actor({ characterId: "b", kingdom: "ember", pvpMode: "peaceful" }),
        MAP,
      ),
    ).toBe(false);
  });

  it("rejects dead or warping participants and validates modes", () => {
    expect(canAttackPlayer(actor({ dead: true }), actor({ characterId: "b" }), MAP)).toBe(false);
    expect(canAttackPlayer(actor(), actor({ characterId: "b", warping: true }), MAP)).toBe(false);
    expect(isPvpMode("free")).toBe(true);
    expect(isPvpMode("chaos")).toBe(false);
  });
});

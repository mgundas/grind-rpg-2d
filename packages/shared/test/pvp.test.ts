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
    expect(canAttackPlayer(actor({ pvpMode: "peaceful" }), actor({ characterId: "b" }), MAP)).toBe(
      false,
    );
    expect(canAttackPlayer(actor(), actor({ characterId: "b", pvpMode: "peaceful" }), MAP)).toBe(
      false,
    );
    expect(
      canAttackPlayer(actor({ partyId: "p" }), actor({ characterId: "b", partyId: "p" }), MAP),
    ).toBe(false);
    expect(
      canAttackPlayer(actor({ guildId: "g" }), actor({ characterId: "b", guildId: "g" }), MAP),
    ).toBe(false);
  });

  it("allows kingdom attacks only across kingdoms", () => {
    expect(canAttackPlayer(actor(), actor({ characterId: "b", kingdom: "gale" }), MAP)).toBe(true);
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

  it("pins the full 3x3 mode matrix for same-kingdom players", () => {
    const modes = ["peaceful", "kingdom", "free"] as const;
    const expected: Record<(typeof modes)[number], Record<(typeof modes)[number], boolean>> = {
      peaceful: { peaceful: false, kingdom: false, free: false },
      kingdom: { peaceful: false, kingdom: false, free: false },
      // Free mode can hit a same-kingdom player who cannot retaliate; this
      // asymmetry is deliberate (free = open PvP flag).
      free: { peaceful: false, kingdom: true, free: true },
    };
    for (const attackerMode of modes) {
      for (const targetMode of modes) {
        expect(
          canAttackPlayer(
            actor({ pvpMode: attackerMode }),
            actor({ characterId: "b", pvpMode: targetMode }),
            MAP,
          ),
        ).toBe(expected[attackerMode][targetMode]);
      }
    }
  });

  it("rejects dead or warping participants and validates modes", () => {
    expect(canAttackPlayer(actor({ dead: true }), actor({ characterId: "b" }), MAP)).toBe(false);
    expect(canAttackPlayer(actor(), actor({ characterId: "b", warping: true }), MAP)).toBe(false);
    expect(isPvpMode("free")).toBe(true);
    expect(isPvpMode("chaos")).toBe(false);
  });
});

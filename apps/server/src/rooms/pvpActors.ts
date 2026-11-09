import type { PvpActor, PvpMapPolicy, PvpMode } from "@jadethrone/shared";
import { canAttackPlayer } from "@jadethrone/shared";

export interface PvpActorInput {
  sessionId: string;
  characterId: string;
  kingdom: string;
  pvpMode: PvpMode;
  partyId: string | null;
  guildId: string | null;
  dead: boolean;
  warping: boolean;
  invisible: boolean;
  /** Stealthed players cannot be targeted or hit by other players. */
  stealth: boolean;
  pvpReady: boolean;
}

/** Builds the session-indexed eligibility map; hidden/not-ready actors are omitted. */
export function buildPvpActors(inputs: Iterable<PvpActorInput>): Map<string, PvpActor> {
  const actors = new Map<string, PvpActor>();
  for (const input of inputs) {
    if (input.invisible || input.stealth || !input.pvpReady) {
      continue;
    }
    actors.set(input.sessionId, {
      characterId: input.characterId,
      kingdom: input.kingdom,
      pvpMode: input.pvpMode,
      partyId: input.partyId,
      guildId: input.guildId,
      dead: input.dead,
      warping: input.warping,
    });
  }
  return actors;
}

export function canPvpTarget(
  actors: ReadonlyMap<string, PvpActor>,
  policy: PvpMapPolicy,
  attackerSessionId: string,
  targetSessionId: string,
): boolean {
  const attacker = actors.get(attackerSessionId);
  const target = actors.get(targetSessionId);
  if (!attacker || !target) {
    return false;
  }
  return canAttackPlayer(attacker, target, policy);
}

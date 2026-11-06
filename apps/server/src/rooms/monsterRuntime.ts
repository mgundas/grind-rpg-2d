import { createMover, type MoverState, type Vec2 } from "@jadethrone/shared";

/** Monster AI states (GAME_DESIGN.md §6.1). */
export type MonsterAiState = "idle" | "chase" | "attack" | "return";

/**
 * Server-private monster state. The synchronized `MonsterState` is derived
 * from `mover.pos` after each AI tick.
 */
export interface MonsterRuntime {
  id: string;
  typeId: string;
  groupId: string;
  /** Spawn point and leash anchor. */
  home: Vec2;
  mover: MoverState;
  ai: MonsterAiState;
  targetSessionId: string | null;
  attackReadyAtMs: number;
  nextRepathAtMs: number;
  nextWanderAtMs: number;
  /** Last target tile used for repath throttling. */
  lastTargetTileKey: string | null;
  /** Consecutive failed chase paths; three sends the monster home. */
  failedRepaths: number;
  generation: number;
  spawnIndex: number;
}

export function createMonsterRuntime(input: {
  id: string;
  typeId: string;
  groupId: string;
  home: Vec2;
  generation: number;
  spawnIndex: number;
  now?: number;
}): MonsterRuntime {
  const now = input.now ?? Date.now();
  return {
    id: input.id,
    typeId: input.typeId,
    groupId: input.groupId,
    home: { x: input.home.x, y: input.home.y },
    mover: createMover(input.home),
    ai: "idle",
    targetSessionId: null,
    attackReadyAtMs: 0,
    nextRepathAtMs: now,
    nextWanderAtMs: now + 1000,
    lastTargetTileKey: null,
    failedRepaths: 0,
    generation: input.generation,
    spawnIndex: input.spawnIndex,
  };
}

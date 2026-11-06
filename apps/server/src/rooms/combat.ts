import {
  critChance,
  critDamage,
  defenseOf,
  facing4FromDir8,
  facing4FromIndex,
  facing4Index,
  findArcTargets,
  hitChance,
  isClassId,
  physicalAttack,
  resolveDamage,
  rollCrit,
  rollHit,
  type CombatHit,
  type ArcTarget,
  type Dir8,
  type RandomSource,
} from "@jadethrone/shared";
import { getClass } from "@jadethrone/data/classes";
import { getMonster } from "@jadethrone/data/monsters";
import type { MonsterRuntime } from "./monsterRuntime";
import type { PlayerRuntime } from "./playerRuntime";
import type { WorldState } from "./state/WorldState";

/**
 * Player basic-attack resolution (GAME_DESIGN.md §5, §6). Pure: it never sends
 * messages, deletes entities or notifies spawns — the room performs those after
 * receiving the outcome, so a swing is atomic and testable without a network.
 */

export interface CombatContext {
  now: number;
  rng: RandomSource;
  state: WorldState;
  runtimes: ReadonlyMap<string, PlayerRuntime>;
  monsterRuntimes: ReadonlyMap<string, MonsterRuntime>;
}

export interface KilledMonster {
  monsterId: string;
  typeId: string;
  x: number;
  y: number;
}

export interface SwingOutcome {
  /** Every target in the arc, nearest first; misses included. */
  hits: CombatHit[];
  killed: KilledMonster[];
  /** Monsters that actually took damage; used for pack aggro. */
  damagedMonsterIds: string[];
}

/** Null means the swing was rejected (no runtime, dead, warping, cooldown). */
export function resolvePlayerSwing(
  ctx: CombatContext,
  sessionId: string,
  dir: Dir8 | null,
): SwingOutcome | null {
  const runtime = ctx.runtimes.get(sessionId);
  const player = ctx.state.players.get(sessionId);
  if (!runtime || !player || runtime.dead || runtime.warping) {
    return null;
  }
  if (ctx.now < runtime.attackReadyAtMs) {
    return null;
  }
  if (!isClassId(player.classId)) {
    return null;
  }

  const profile = getClass(player.classId).attack;
  runtime.attackReadyAtMs = ctx.now + profile.cooldownMs;

  const facing = dir !== null ? facing4FromDir8(dir) : facing4FromIndex(player.facing);
  if (dir !== null) {
    player.facing = facing4Index(facing);
  }

  // Candidates come from authoritative movers; returning and dead monsters are
  // removed before the arc test so they cannot consume max-target slots.
  const candidates: ArcTarget[] = [];
  for (const [monsterId, monsterRuntime] of ctx.monsterRuntimes) {
    if (monsterRuntime.hp <= 0 || monsterRuntime.ai === "return") {
      continue;
    }
    if (!ctx.state.monsters.has(monsterId)) {
      continue;
    }
    candidates.push({
      id: monsterId,
      x: monsterRuntime.mover.pos.x,
      y: monsterRuntime.mover.pos.y,
    });
  }

  const origin = runtime.mover.pos;
  const targetIds = findArcTargets(candidates, {
    origin,
    facing,
    rangePx: profile.rangePx,
    maxTargets: profile.maxTargets,
  });

  const stats = runtime.progression.stats;
  const attack = physicalAttack({
    classId: player.classId,
    stats,
    level: runtime.progression.level,
  });

  const hits: CombatHit[] = [];
  const killed: KilledMonster[] = [];
  const damagedMonsterIds: string[] = [];

  for (const monsterId of targetIds) {
    const monsterRuntime = ctx.monsterRuntimes.get(monsterId);
    const monster = ctx.state.monsters.get(monsterId);
    // Another swing in the same tick may already have removed it.
    if (!monsterRuntime || !monster || monsterRuntime.hp <= 0) {
      continue;
    }
    const spec = getMonster(monsterRuntime.typeId);
    const x = monsterRuntime.mover.pos.x;
    const y = monsterRuntime.mover.pos.y;
    const target = { kind: "monster" as const, monsterId };

    const chance = hitChance({
      attackerDex: stats.dex,
      defenderDex: spec.dex,
      attackerLevel: runtime.progression.level,
      defenderLevel: spec.level,
    });
    if (!rollHit(ctx.rng, chance)) {
      hits.push({ target, x, y, miss: true, crit: false, damage: 0 });
      continue;
    }

    const base = resolveDamage(ctx.rng, attack, spec.defense);
    const crit = rollCrit(ctx.rng, critChance(stats.dex));
    const damage = crit ? critDamage(base) : base;

    monsterRuntime.hp = Math.max(0, monsterRuntime.hp - damage);
    monster.hp = monsterRuntime.hp;
    hits.push({ target, x, y, miss: false, crit, damage });
    damagedMonsterIds.push(monsterId);
    runtime.lastCombatAtMs = ctx.now;

    if (monsterRuntime.hp === 0) {
      killed.push({ monsterId, typeId: monsterRuntime.typeId, x, y });
    }
  }

  return { hits, killed, damagedMonsterIds };
}

export interface MonsterAttackOutcome {
  hit: CombatHit;
  victimDead: boolean;
}

/**
 * Monster basic attack. The AI only decides that a swing happens and consumes
 * its cooldown; the hit/damage/crit rolls and HP application live here so both
 * sides use the same formulas. Null means the target or monster is no longer
 * valid (dead, warping, returning, removed mid-tick).
 */
export function resolveMonsterAttack(
  ctx: CombatContext,
  monsterId: string,
  targetSessionId: string,
): MonsterAttackOutcome | null {
  const monsterRuntime = ctx.monsterRuntimes.get(monsterId);
  const monster = ctx.state.monsters.get(monsterId);
  const runtime = ctx.runtimes.get(targetSessionId);
  const player = ctx.state.players.get(targetSessionId);
  if (
    !monsterRuntime ||
    !monster ||
    monsterRuntime.hp <= 0 ||
    monsterRuntime.ai === "return" ||
    !runtime ||
    !player ||
    runtime.dead ||
    runtime.warping ||
    runtime.progression.hp <= 0
  ) {
    return null;
  }

  const spec = getMonster(monsterRuntime.typeId);
  const stats = runtime.progression.stats;
  const victim = { kind: "player" as const, sessionId: targetSessionId };
  const x = runtime.mover.pos.x;
  const y = runtime.mover.pos.y;

  const chance = hitChance({
    attackerDex: spec.dex,
    defenderDex: stats.dex,
    attackerLevel: spec.level,
    defenderLevel: runtime.progression.level,
  });
  if (!rollHit(ctx.rng, chance)) {
    return {
      hit: { target: victim, x, y, miss: true, crit: false, damage: 0 },
      victimDead: false,
    };
  }

  const base = resolveDamage(ctx.rng, spec.attack, defenseOf(stats.vit));
  const crit = rollCrit(ctx.rng, critChance(spec.dex));
  const damage = crit ? critDamage(base) : base;

  runtime.progression.hp = Math.max(0, runtime.progression.hp - damage);
  player.hp = runtime.progression.hp;
  runtime.lastCombatAtMs = ctx.now;

  return {
    hit: { target: victim, x, y, miss: false, crit, damage },
    victimDead: runtime.progression.hp === 0,
  };
}

import {
  applyBuffModifiers,
  buffModifierTotals,
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
  skillDamage,
  type CombatHit,
  type ArcTarget,
  type Dir8,
  type RandomSource,
} from "@jadethrone/shared";
import { getClass } from "@jadethrone/data/classes";
import { equipmentBonusStats, equipmentBonusValue } from "../items/equipment";
import { BASE_CATALOG, type CatalogLookup } from "@jadethrone/data/catalog";
import { playerBuffModifiers } from "../skills/effects";
import type { MonsterRuntime } from "./monsterRuntime";
import type { PlayerRuntime } from "./playerRuntime";
import type { WorldState } from "./state/WorldState";
import type { StoneRuntime } from "./stoneManager";

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
  /** Optional so monster-only tests and rooms keep working. */
  stoneRuntimes?: ReadonlyMap<string, StoneRuntime>;
  /** Overridable definitions; defaults to the base catalog. */
  catalog?: CatalogLookup;
}

export interface KilledMonster {
  monsterId: string;
  typeId: string;
  x: number;
  y: number;
  /** Highest damage contributor (fallback: the killing blow). */
  ownerSessionId: string;
}

export type StoneHit = CombatHit & {
  target: { kind: "stone"; stoneId: string };
};

/** Symmetric record for the room; never produced by the swing resolver. */
export interface KilledStone {
  stoneId: string;
  infoId: string;
  x: number;
  y: number;
  ownerSessionId: string;
}

export interface MonsterDamageResult {
  hp: number;
  killed: KilledMonster | null;
}

export interface SwingOutcome {
  /** Every target in the arc, nearest first; misses included. */
  hits: CombatHit[];
  killed: KilledMonster[];
  /** Monsters that actually took damage; used for pack aggro. */
  damagedMonsterIds: string[];
  /** Stone damage intents; the room applies these through StoneManager. */
  stoneHits: StoneHit[];
}

/** Highest damage contributor, skipping players who are no longer present. */
export function topDamageOwner(
  damageBy: ReadonlyMap<string, number>,
  liveSessions: ReadonlyMap<string, PlayerRuntime>,
  fallbackSessionId: string,
): string {
  let ownerSessionId = fallbackSessionId;
  let bestDamage = -1;
  for (const [contributor, amount] of damageBy) {
    if (!liveSessions.has(contributor)) {
      continue;
    }
    if (amount > bestDamage) {
      bestDamage = amount;
      ownerSessionId = contributor;
    }
  }
  return ownerSessionId;
}

/**
 * Apply damage to one monster. Combat remains the only place that writes
 * monster HP/damage credit; the room handles death cleanup from the returned
 * kill record.
 */
export function applyDamageToMonster(
  ctx: CombatContext,
  sessionId: string,
  monsterId: string,
  damage: number,
  _now: number,
): MonsterDamageResult | null {
  void _now;
  const monsterRuntime = ctx.monsterRuntimes.get(monsterId);
  const monster = ctx.state.monsters.get(monsterId);
  if (!monsterRuntime || !monster || monsterRuntime.hp <= 0) {
    return null;
  }
  const safeDamage = Math.max(0, Math.floor(damage));
  if (safeDamage === 0) {
    return { hp: monsterRuntime.hp, killed: null };
  }
  monsterRuntime.hp = Math.max(0, monsterRuntime.hp - safeDamage);
  monster.hp = monsterRuntime.hp;
  monsterRuntime.damageBy.set(
    sessionId,
    (monsterRuntime.damageBy.get(sessionId) ?? 0) + safeDamage,
  );
  if (monsterRuntime.hp > 0) {
    return { hp: monsterRuntime.hp, killed: null };
  }
  return {
    hp: 0,
    killed: {
      monsterId,
      typeId: monsterRuntime.typeId,
      x: monsterRuntime.mover.pos.x,
      y: monsterRuntime.mover.pos.y,
      ownerSessionId: topDamageOwner(monsterRuntime.damageBy, ctx.runtimes, sessionId),
    },
  };
}

/** Stones always hit; only damage and crit rolls are consumed. */
export function resolveStoneHit(
  ctx: CombatContext,
  sessionId: string,
  stoneId: string,
  attack: number,
  critChanceValue: number,
  power = 1,
): StoneHit | null {
  const runtime = ctx.stoneRuntimes?.get(stoneId);
  if (!runtime || runtime.hp <= 0) {
    return null;
  }
  const info = (ctx.catalog ?? BASE_CATALOG).findStone(runtime.infoId);
  if (!info) {
    return null;
  }
  const base = skillDamage(ctx.rng, attack, info.defense, power);
  const crit = rollCrit(ctx.rng, critChanceValue);
  return {
    target: { kind: "stone", stoneId },
    x: runtime.x,
    y: runtime.y,
    miss: false,
    crit,
    damage: crit ? critDamage(base) : base,
  };
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
  const buffModifiers = playerBuffModifiers(runtime.buffs, ctx.now);
  const attackSpeed = Math.max(
    0,
    buffModifierTotals(buffModifiers, "attackSpeed").percent,
  );
  const gearAttackSpeed = equipmentBonusValue(runtime.inventory, "attack_speed", ctx.catalog);
  runtime.attackReadyAtMs =
    ctx.now + profile.cooldownMs / (1 + attackSpeed + gearAttackSpeed);

  const facing = dir !== null ? facing4FromDir8(dir) : facing4FromIndex(player.facing);
  if (dir !== null) {
    player.facing = facing4Index(facing);
  }

  // Candidates come from authoritative movers; returning and dead monsters are
  // removed before the arc test so they cannot consume max-target slots.
  const candidates: ArcTarget[] = [];
  const refs = new Map<string, { kind: "monster" | "stone"; id: string }>();
  for (const [monsterId, monsterRuntime] of ctx.monsterRuntimes) {
    if (monsterRuntime.hp <= 0 || monsterRuntime.ai === "return") {
      continue;
    }
    if (!ctx.state.monsters.has(monsterId)) {
      continue;
    }
    const key = `m:${monsterId}`;
    refs.set(key, { kind: "monster", id: monsterId });
    candidates.push({
      id: key,
      x: monsterRuntime.mover.pos.x,
      y: monsterRuntime.mover.pos.y,
    });
  }
  for (const [stoneId, stoneRuntime] of ctx.stoneRuntimes ?? []) {
    if (stoneRuntime.hp <= 0) {
      continue;
    }
    const key = `s:${stoneId}`;
    refs.set(key, { kind: "stone", id: stoneId });
    candidates.push({ id: key, x: stoneRuntime.x, y: stoneRuntime.y });
  }

  const origin = runtime.mover.pos;
  const targetIds = findArcTargets(candidates, {
    origin,
    facing,
    rangePx: profile.rangePx,
    maxTargets: profile.maxTargets,
  });

  const stats = runtime.progression.stats;
  const equipment = equipmentBonusStats(runtime.inventory, ctx.catalog);
  const attack = applyBuffModifiers(
    physicalAttack({
      classId: player.classId,
      stats,
      level: runtime.progression.level,
      weaponAttack: equipment.attack,
    }),
    buffModifiers,
    "attack",
  );
  const critChanceValue = applyBuffModifiers(
    critChance(stats.dex, equipment.critChance),
    buffModifiers,
    "critChance",
  );

  const hits: CombatHit[] = [];
  const killed: KilledMonster[] = [];
  const damagedMonsterIds: string[] = [];
  const stoneHits: StoneHit[] = [];
  let damaged = false;

  for (const key of targetIds) {
    const ref = refs.get(key);
    // A target can disappear between candidate collection and resolution.
    if (!ref) {
      continue;
    }
    if (ref.kind === "stone") {
      const hit = resolveStoneHit(ctx, sessionId, ref.id, attack, critChanceValue);
      if (hit) {
        hits.push(hit);
        stoneHits.push(hit);
        damaged = true;
      }
      continue;
    }

    const monsterId = ref.id;
    const monsterRuntime = ctx.monsterRuntimes.get(monsterId);
    const monster = ctx.state.monsters.get(monsterId);
    // Another swing in the same tick may already have removed it.
    if (!monsterRuntime || !monster || monsterRuntime.hp <= 0) {
      continue;
    }
    const spec = (ctx.catalog ?? BASE_CATALOG).findMonster(monsterRuntime.typeId);
    if (!spec) {
      continue;
    }
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
    const crit = rollCrit(ctx.rng, critChanceValue);
    const rolled = crit ? critDamage(base) : base;
    const category = spec.bonusCategory;
    const strong =
      equipmentBonusValue(runtime.inventory, "strong_monsters", ctx.catalog) +
      (category === "animal"
        ? equipmentBonusValue(runtime.inventory, "strong_animals", ctx.catalog)
        : category === "spirit"
          ? equipmentBonusValue(runtime.inventory, "strong_spirits", ctx.catalog)
          : 0);
    const damage = Math.max(1, Math.round(rolled * (1 + strong)));
    const applied = applyDamageToMonster(ctx, sessionId, monsterId, damage, ctx.now);
    if (!applied) {
      continue;
    }
    hits.push({ target, x, y, miss: false, crit, damage });
    damagedMonsterIds.push(monsterId);
    damaged = true;
    if (applied.killed) {
      killed.push(applied.killed);
    }
  }

  if (damaged) {
    runtime.lastCombatAtMs = ctx.now;
  }
  return { hits, killed, damagedMonsterIds, stoneHits };
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

  const spec = (ctx.catalog ?? BASE_CATALOG).findMonster(monsterRuntime.typeId);
  if (!spec) {
    return null;
  }
  const stats = runtime.progression.stats;
  const mods = playerBuffModifiers(runtime.buffs, ctx.now);
  const evasion = Math.min(
    0.5,
    Math.max(0, buffModifierTotals(mods, "evasion").flat),
  );
  const victim = { kind: "player" as const, sessionId: targetSessionId };
  const x = runtime.mover.pos.x;
  const y = runtime.mover.pos.y;

  const chance = Math.max(
    0.2,
    hitChance({
      attackerDex: spec.dex,
      defenderDex: stats.dex,
      attackerLevel: spec.level,
      defenderLevel: runtime.progression.level,
    }) - evasion,
  );
  if (!rollHit(ctx.rng, chance)) {
    return {
      hit: { target: victim, x, y, miss: true, crit: false, damage: 0 },
      victimDead: false,
    };
  }

  const equipment = equipmentBonusStats(runtime.inventory, ctx.catalog);
  const base = resolveDamage(
    ctx.rng,
    spec.attack,
    applyBuffModifiers(
      defenseOf(stats.vit) + equipment.defense,
      mods,
      "defense",
    ),
  );
  const crit = rollCrit(ctx.rng, critChance(spec.dex));
  const damage = crit ? critDamage(base) : base;

  runtime.progression.hp = Math.max(0, runtime.progression.hp - damage);
  player.hp = runtime.progression.hp;
  runtime.lastCombatAtMs = ctx.now;
  runtime.dirty = true;

  return {
    hit: { target: victim, x, y, miss: false, crit, damage },
    victimDead: runtime.progression.hp === 0,
  };
}

import {
  applyBuffModifiers,
  critChance,
  critDamage,
  DIR8_VECTORS,
  dir8Towards,
  facing4FromDir8,
  facing4FromIndex,
  facing4Index,
  findArcTargets,
  findCircleTargets,
  findLineTargets,
  isClassId,
  isWalkableAt,
  magicAttackOf,
  nearestWalkable,
  physicalAttack,
  rollCrit,
  rollHit,
  skillDamage,
  skillHealAmount,
  skillPowerAtRank,
  stepMover,
  type ArcTarget,
  type BuffModifier,
  type CollisionGrid,
  type CombatHit,
  type Dir8,
  type Facing4,
  type Vec2,
} from "@jadethrone/shared";
import { BASE_CATALOG } from "@jadethrone/data/catalog";
import type { SkillEffect, SkillInfo } from "@jadethrone/data/skills";
import { equipmentBonusStats, equipmentBonusValue } from "../items/equipment";
import {
  applyDamageToMonster,
  canHitPlayer,
  resolvePlayerHit,
  type CombatContext,
  type KilledMonster,
  type PlayerHit,
  type StoneHit,
} from "../rooms/combat";

export interface SkillCombatContext extends CombatContext {
  grid: CollisionGrid;
  /** Active caster buff modifiers from Task 21; defaults to none. */
  casterModifiers?: readonly BuffModifier[];
}

export interface ResolveSkillInput {
  sessionId: string;
  skill: SkillInfo;
  rank: number;
  dir?: Dir8;
  targetPos?: Vec2;
  targetMonsterId?: string;
  targetStoneId?: string;
  allySessionId?: string;
  partySessionIds?: readonly string[];
}

export interface SkillHealIntent {
  targetSessionId: string;
  targetCharacterId: string;
  amount: number;
  rawAmount: number;
  x: number;
  y: number;
}

export interface SkillBuffIntent {
  targetSessionId: string;
  targetCharacterId: string;
  sourceSkillId: string;
  name: string;
  iconKey: string;
  kind: "buff" | "debuff";
  modifiers: BuffModifier[];
  durationMs: number;
  stealth: boolean;
}

export interface SkillHotIntent {
  targetSessionId: string;
  targetCharacterId: string;
  sourceSkillId: string;
  amountPerTick: number;
  tickMs: number;
  durationMs: number;
  expiresAtMs: number;
  nextTickAtMs: number;
}

export type SkillStatusIntent =
  | { kind: "stun"; monsterId: string; durationMs: number }
  | { kind: "slow"; monsterId: string; factor: number; durationMs: number }
  | {
      kind: "poison";
      monsterId: string;
      damagePerTick: number;
      durationMs: number;
      tickMs: number;
      sourceSessionId: string;
    }
  | { kind: "knockback"; monsterId: string; destination: Vec2 };

export interface SkillOutcome {
  skillId: string;
  type: SkillInfo["type"];
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  hits: CombatHit[];
  stoneHits: StoneHit[];
  playerHits: PlayerHit[];
  killed: KilledMonster[];
  damagedMonsterIds: string[];
  statuses: SkillStatusIntent[];
  heals: SkillHealIntent[];
  hots: SkillHotIntent[];
  buffs: SkillBuffIntent[];
  cleanses: string[];
  selfDamage: number;
  dash: { destination: Vec2; facing: Facing4 } | null;
  breaksStealth: boolean;
}

interface ArcRef {
  kind: "monster" | "stone" | "player";
  id: string;
}

function clampToRange(origin: Vec2, point: Vec2, rangePx: number): Vec2 {
  if (rangePx <= 0) {
    return { x: origin.x, y: origin.y };
  }
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const distanceSquared = dx * dx + dy * dy;
  if (distanceSquared <= rangePx * rangePx) {
    return { x: point.x, y: point.y };
  }
  const distance = Math.sqrt(distanceSquared) || 1;
  return {
    x: origin.x + (dx / distance) * rangePx,
    y: origin.y + (dy / distance) * rangePx,
  };
}

function aimPoint(ctx: SkillCombatContext, input: ResolveSkillInput, origin: Vec2): Vec2 {
  if (input.targetPos) {
    return input.targetPos;
  }
  const targetId = input.targetMonsterId ?? input.targetStoneId;
  if (targetId) {
    const monster = ctx.monsterRuntimes.get(input.targetMonsterId ?? "");
    if (monster) {
      return { x: monster.mover.pos.x, y: monster.mover.pos.y };
    }
    const stone = ctx.stoneRuntimes?.get(input.targetStoneId ?? "");
    if (stone) {
      return { x: stone.x, y: stone.y };
    }
  }
  if (input.dir !== undefined) {
    const vector = DIR8_VECTORS[input.dir] ?? DIR8_VECTORS[0]!;
    return {
      x: origin.x + vector.x * input.skill.rangePx,
      y: origin.y + vector.y * input.skill.rangePx,
    };
  }
  return { x: origin.x, y: origin.y };
}

function collectCandidates(
  ctx: SkillCombatContext,
  attackerSessionId: string,
): {
  candidates: ArcTarget[];
  refs: Map<string, ArcRef>;
} {
  const candidates: ArcTarget[] = [];
  const refs = new Map<string, ArcRef>();
  for (const [monsterId, runtime] of ctx.monsterRuntimes) {
    if (runtime.hp <= 0 || runtime.ai === "return" || !ctx.state.monsters.has(monsterId)) {
      continue;
    }
    const key = `m:${monsterId}`;
    refs.set(key, { kind: "monster", id: monsterId });
    candidates.push({ id: key, x: runtime.mover.pos.x, y: runtime.mover.pos.y });
  }
  for (const [stoneId, runtime] of ctx.stoneRuntimes ?? []) {
    if (runtime.hp <= 0) {
      continue;
    }
    const key = `s:${stoneId}`;
    refs.set(key, { kind: "stone", id: stoneId });
    candidates.push({ id: key, x: runtime.x, y: runtime.y });
  }
  if (ctx.pvp) {
    for (const [targetSessionId, targetRuntime] of ctx.runtimes) {
      if (
        targetSessionId === attackerSessionId ||
        targetRuntime.dead ||
        targetRuntime.warping ||
        !ctx.state.players.has(targetSessionId) ||
        !canHitPlayer(ctx, attackerSessionId, targetSessionId)
      ) {
        continue;
      }
      const key = `p:${targetSessionId}`;
      refs.set(key, { kind: "player", id: targetSessionId });
      candidates.push({
        id: key,
        x: targetRuntime.mover.pos.x,
        y: targetRuntime.mover.pos.y,
      });
    }
  }
  return { candidates, refs };
}

function statusIntents(
  effect: SkillEffect,
  monsterId: string,
  rank: number,
  sourceSessionId: string,
  origin: Vec2,
  target: Vec2,
  grid: CollisionGrid,
): SkillStatusIntent | null {
  const durationMs = effect.durationMs ?? 0;
  switch (effect.kind) {
    case "stun":
      return { kind: "stun", monsterId, durationMs };
    case "slow":
      return {
        kind: "slow",
        monsterId,
        factor: 1 - Math.min(1, Math.max(0, effect.value ?? 0)),
        durationMs,
      };
    case "poison":
      return {
        kind: "poison",
        monsterId,
        damagePerTick: Math.max(
          1,
          Math.round((effect.value ?? 0) + (effect.perRank ?? 0) * (rank - 1)),
        ),
        durationMs,
        tickMs: effect.tickMs ?? 1000,
        sourceSessionId,
      };
    case "knockback": {
      const direction = dir8Towards(origin, target);
      if (direction === null) {
        return null;
      }
      const distance = Math.max(0, effect.value ?? 0);
      const moved = stepMover(
        { pos: target, path: [] },
        { kind: "dir", dir: direction },
        grid,
        1000,
        distance,
      ).pos;
      return { kind: "knockback", monsterId, destination: moved };
    }
    default:
      return null;
  }
}

/** Resolve one already-validated skill cast. Room applies buffs/statuses/HP. */
export function resolveSkillCast(
  ctx: SkillCombatContext,
  input: ResolveSkillInput,
): SkillOutcome | null {
  const runtime = ctx.runtimes.get(input.sessionId);
  const player = ctx.state.players.get(input.sessionId);
  if (!runtime || !player || runtime.dead || runtime.warping || !isClassId(player.classId)) {
    return null;
  }
  const skill = input.skill;
  const rank = Math.max(1, Math.floor(input.rank));
  const origin = { x: runtime.mover.pos.x, y: runtime.mover.pos.y };
  const aim = aimPoint(ctx, input, origin);
  const facing: Facing4 =
    input.dir !== undefined ? facing4FromDir8(input.dir) : facing4FromIndex(player.facing);
  if (input.dir !== undefined) {
    player.facing = facing4Index(facing);
  }

  const outcome: SkillOutcome = {
    skillId: skill.id,
    type: skill.type,
    x: origin.x,
    y: origin.y,
    targetX: aim.x,
    targetY: aim.y,
    hits: [],
    stoneHits: [],
    playerHits: [],
    killed: [],
    damagedMonsterIds: [],
    statuses: [],
    heals: [],
    hots: [],
    buffs: [],
    cleanses: [],
    selfDamage: 0,
    dash: null,
    breaksStealth:
      Boolean(skill.damage) ||
      skill.effects.some((effect) =>
        ["stun", "slow", "poison", "knockback"].includes(effect.kind),
      ),
  };

  const equipment = equipmentBonusStats(runtime.inventory, ctx.catalog);
  const stats = runtime.progression.stats;
  const modifiers = ctx.casterModifiers ?? [];
  const damage = skill.damage;
  const attack = damage
    ? damage.scaling === "physical"
      ? applyBuffModifiers(
          physicalAttack({
            classId: player.classId,
            stats,
            level: runtime.progression.level,
            weaponAttack: equipment.attack,
          }),
          modifiers,
          "attack",
        )
      : applyBuffModifiers(
          magicAttackOf(stats.int, runtime.progression.level),
          modifiers,
          "attack",
        )
    : 0;
  const critValue = Math.min(
    1,
    applyBuffModifiers(
      critChance(stats.dex, equipment.critChance),
      modifiers,
      "critChance",
    ),
  );
  const power = damage ? skillPowerAtRank(damage.basePower, damage.powerPerRank, rank) : 0;

  if (skill.type === "buff" || skill.type === "heal") {
    const targets = friendlyTargets(ctx, input, origin);
    const buffEffects = skill.effects.filter(
      (effect) => effect.kind === "buff" || effect.kind === "stealth",
    );
    const modifiersFromSkill: BuffModifier[] = buffEffects.flatMap((effect) =>
      effect.kind === "buff" && effect.stat && effect.mode
        ? [
            {
              stat: effect.stat,
              mode: effect.mode,
              value: (effect.value ?? 0) + (effect.perRank ?? 0) * (rank - 1),
            },
          ]
        : [],
    );
    const buffDuration = Math.max(
      0,
      ...buffEffects.map((effect) => effect.durationMs ?? 0),
    );
    const hotEffect = skill.effects.find((effect) => effect.kind === "heal_over_time");
    const heal = skill.heal;
    const magicAttack = magicAttackOf(stats.int, runtime.progression.level);
    for (const sessionId of targets) {
      const targetRuntime = ctx.runtimes.get(sessionId);
      const targetPlayer = ctx.state.players.get(sessionId);
      if (!targetRuntime || !targetPlayer || targetRuntime.dead) {
        continue;
      }
      if (buffEffects.length > 0) {
        outcome.buffs.push({
          targetSessionId: sessionId,
          targetCharacterId: targetRuntime.characterId,
          sourceSkillId: skill.id,
          name: skill.name,
          iconKey: skill.iconKey,
          kind: "buff",
          modifiers: modifiersFromSkill,
          durationMs: buffDuration,
          stealth: buffEffects.some((effect) => effect.kind === "stealth"),
        });
      }
      if (skill.effects.some((effect) => effect.kind === "cleanse")) {
        outcome.cleanses.push(sessionId);
      }
      if (heal && !heal.overTime) {
        const raw = skillHealAmount(heal.base, heal.perRank, rank, magicAttack);
        const amount = Math.max(0, Math.min(raw, targetRuntime.progression.maxHp - targetRuntime.progression.hp));
        if (amount > 0) {
          outcome.heals.push({
            targetSessionId: sessionId,
            targetCharacterId: targetRuntime.characterId,
            amount,
            rawAmount: raw,
            x: targetRuntime.mover.pos.x,
            y: targetRuntime.mover.pos.y,
          });
        }
      }
      if (heal?.overTime && heal.durationMs) {
        const raw = skillHealAmount(heal.base, heal.perRank, rank, magicAttack);
        const durationMs = heal.durationMs;
        const tickMs = 1000;
        const ticks = Math.max(1, Math.ceil(durationMs / tickMs));
        outcome.hots.push({
          targetSessionId: sessionId,
          targetCharacterId: targetRuntime.characterId,
          sourceSkillId: skill.id,
          amountPerTick: Math.max(1, Math.floor(raw / ticks)),
          tickMs,
          durationMs,
          expiresAtMs: ctx.now + durationMs,
          nextTickAtMs: ctx.now + tickMs,
        });
      }
      if (hotEffect?.durationMs) {
        const amountPerTick = Math.max(
          1,
          Math.round((hotEffect.value ?? 0) + (hotEffect.perRank ?? 0) * (rank - 1)),
        );
        outcome.hots.push({
          targetSessionId: sessionId,
          targetCharacterId: targetRuntime.characterId,
          sourceSkillId: skill.id,
          amountPerTick,
          tickMs: hotEffect.tickMs ?? 1000,
          durationMs: hotEffect.durationMs,
          expiresAtMs: ctx.now + hotEffect.durationMs,
          nextTickAtMs: ctx.now + (hotEffect.tickMs ?? 1000),
        });
      }
    }
    if (skill.selfDamagePct) {
      outcome.selfDamage = Math.min(
        Math.floor(runtime.progression.maxHp * skill.selfDamagePct),
        Math.max(0, runtime.progression.hp - 1),
      );
    }
    return outcome;
  }

  const { candidates, refs } = collectCandidates(ctx, input.sessionId);
  const maxTargets = skill.maxTargets ?? (skill.type === "projectile" ? 1 : 8);
  let center = aim;
  let targetIds: string[] = [];
  if (skill.type === "melee_aoe") {
    center = origin;
    targetIds = findArcTargets(candidates, {
      origin,
      facing,
      rangePx: skill.radiusPx,
      maxTargets,
    });
  } else if (skill.type === "area") {
    center = clampToRange(origin, aim, skill.rangePx);
    targetIds = findCircleTargets(candidates, {
      center,
      radiusPx: skill.radiusPx,
      maxTargets,
    });
  } else if (skill.type === "projectile") {
    const end = clampToRange(origin, aim, skill.rangePx);
    center = end;
    targetIds = findLineTargets(candidates, {
      origin,
      end,
      widthPx: Math.max(24, skill.radiusPx * 2),
      padPx: 8,
      maxTargets,
    });
  } else if (skill.type === "dash") {
    const dx = aim.x - origin.x;
    const dy = aim.y - origin.y;
    const direction =
      dx * dx + dy * dy > 1 ? (dir8Towards(origin, aim) ?? 0) : null;
    // Sweep in small steps: one long `stepMover` call only tests the endpoint,
    // so a 220 px dash would tunnel through a 32 px wall that has walkable
    // ground behind it. Marching keeps the dash inside the collision grid.
    const dashStepPx = 8;
    let dashed = { pos: origin, path: [] as Vec2[] };
    if (direction !== null) {
      const steps = Math.ceil(skill.rangePx / dashStepPx);
      for (let i = 0; i < steps; i++) {
        const next = stepMover(
          dashed,
          { kind: "dir", dir: direction },
          ctx.grid,
          1000,
          dashStepPx,
        );
        if (next.pos.x === dashed.pos.x && next.pos.y === dashed.pos.y) {
          break;
        }
        dashed = next;
      }
    }
    const destination = dashed.pos;
    const safe =
      isWalkableAt(ctx.grid, destination.x, destination.y)
        ? destination
        : (nearestWalkable(ctx.grid, destination.x, destination.y, 2) ?? origin);
    center = safe;
    outcome.dash = {
      destination: safe,
      facing: direction === null ? facing : facing4FromDir8(direction),
    };
    targetIds = findCircleTargets(candidates, {
      center: safe,
      radiusPx: skill.radiusPx,
      maxTargets,
    });
  }
  outcome.targetX = center.x;
  outcome.targetY = center.y;

  let totalMonsterDamage = 0;
  for (const key of targetIds) {
    const ref = refs.get(key);
    if (!ref) {
      continue;
    }
    if (ref.kind === "player") {
      const hit = resolvePlayerHit(
        ctx,
        input.sessionId,
        ref.id,
        attack,
        critValue,
        power,
      );
      if (hit) {
        outcome.hits.push(hit);
        outcome.playerHits.push(hit);
      }
      continue;
    }
    if (ref.kind === "stone") {
      const stone = ctx.stoneRuntimes?.get(ref.id);
      if (!stone) {
        continue;
      }
      const info = (ctx.catalog ?? BASE_CATALOG).findStone(stone.infoId);
      if (!info) {
        continue;
      }
      const base = skillDamage(ctx.rng, attack, info.defense, power);
      const crit = rollCrit(ctx.rng, critValue);
      const stoneDamage = crit ? critDamage(base) : base;
      const hit: StoneHit = {
        target: { kind: "stone", stoneId: ref.id },
        x: stone.x,
        y: stone.y,
        miss: false,
        crit,
        damage: stoneDamage,
      };
      outcome.hits.push(hit);
      outcome.stoneHits.push(hit);
      continue;
    }
    const monsterRuntime = ctx.monsterRuntimes.get(ref.id);
    const monster = ctx.state.monsters.get(ref.id);
    if (!monsterRuntime || !monster || monsterRuntime.hp <= 0) {
      continue;
    }
    const spec = (ctx.catalog ?? BASE_CATALOG).findMonster(monsterRuntime.typeId);
    if (!spec) {
      continue;
    }
    const chance = hitChanceFor(stats.dex, spec.dex, runtime.progression.level, spec.level);
    const x = monsterRuntime.mover.pos.x;
    const y = monsterRuntime.mover.pos.y;
    const target = { kind: "monster" as const, monsterId: ref.id };
    if (!rollHit(ctx.rng, chance)) {
      outcome.hits.push({ target, x, y, miss: true, crit: false, damage: 0 });
      continue;
    }
    const base = skillDamage(ctx.rng, attack, spec.defense, power);
    const crit = rollCrit(ctx.rng, critValue);
    const rolled = crit ? critDamage(base) : base;
    const strong =
      equipmentBonusValue(runtime.inventory, "strong_monsters", ctx.catalog) +
      (spec.bonusCategory === "animal"
        ? equipmentBonusValue(runtime.inventory, "strong_animals", ctx.catalog)
        : spec.bonusCategory === "spirit"
          ? equipmentBonusValue(runtime.inventory, "strong_spirits", ctx.catalog)
          : 0);
    const hitDamage = Math.max(1, Math.round(rolled * (1 + strong)));
    const applied = applyDamageToMonster(ctx, input.sessionId, ref.id, hitDamage, ctx.now);
    if (!applied) {
      continue;
    }
    outcome.hits.push({ target, x, y, miss: false, crit, damage: hitDamage });
    outcome.damagedMonsterIds.push(ref.id);
    totalMonsterDamage += hitDamage;
    if (applied.killed) {
      outcome.killed.push(applied.killed);
    }
    for (const effect of skill.effects) {
      const intent = statusIntents(
        effect,
        ref.id,
        rank,
        input.sessionId,
        origin,
        { x, y },
        ctx.grid,
      );
      if (intent) {
        outcome.statuses.push(intent);
      }
    }
  }

  const lifestealEffects = skill.effects.filter((effect) => effect.kind === "lifesteal");
  const lifestealFraction = Math.min(
    1,
    Math.max(
      0,
      (damage?.lifestealPct ?? 0) +
        lifestealEffects.reduce(
          (total, effect) => total + (effect.value ?? 0) + (effect.perRank ?? 0) * (rank - 1),
          0,
        ),
    ),
  );
  const lifesteal = Math.floor(totalMonsterDamage * lifestealFraction);
  if (lifesteal > 0) {
    const amount = Math.max(
      0,
      Math.min(lifesteal, runtime.progression.maxHp - runtime.progression.hp),
    );
    if (amount > 0) {
      outcome.heals.push({
        targetSessionId: input.sessionId,
        targetCharacterId: runtime.characterId,
        amount,
        rawAmount: lifesteal,
        x: origin.x,
        y: origin.y,
      });
    }
  }

  if (skill.selfDamagePct) {
    outcome.selfDamage = Math.min(
      Math.floor(runtime.progression.maxHp * skill.selfDamagePct),
      Math.max(0, runtime.progression.hp - 1),
    );
  }
  if (
    outcome.damagedMonsterIds.length > 0 ||
    outcome.stoneHits.length > 0 ||
    outcome.playerHits.some((hit) => !hit.miss) ||
    outcome.statuses.length > 0
  ) {
    runtime.lastCombatAtMs = ctx.now;
  }
  return outcome;
}

function friendlyTargets(
  ctx: SkillCombatContext,
  input: ResolveSkillInput,
  origin: Vec2,
): string[] {
  const skill = input.skill;
  const party = input.partySessionIds ?? [];
  const caster = input.sessionId;
  if (skill.target === "self") {
    return [caster];
  }
  if (skill.target === "ally") {
    return input.allySessionId && (input.allySessionId === caster || party.includes(input.allySessionId))
      ? [input.allySessionId]
      : [caster];
  }
  const sessions = new Set<string>([caster, ...party]);
  if (skill.target === "ground") {
    const center = clampToRange(origin, input.targetPos ?? origin, skill.rangePx);
    const radius = skill.radiusPx + 32;
    return [...sessions].filter((sessionId) => {
      const runtime = ctx.runtimes.get(sessionId);
      if (!runtime || runtime.dead) {
        return false;
      }
      const dx = runtime.mover.pos.x - center.x;
      const dy = runtime.mover.pos.y - center.y;
      return dx * dx + dy * dy <= radius * radius;
    });
  }
  const reach = skill.rangePx + 32;
  return [...sessions].filter((sessionId) => {
    const runtime = ctx.runtimes.get(sessionId);
    if (!runtime || runtime.dead) {
      return false;
    }
    const dx = runtime.mover.pos.x - origin.x;
    const dy = runtime.mover.pos.y - origin.y;
    return dx * dx + dy * dy <= reach * reach;
  });
}

function hitChanceFor(
  attackerDex: number,
  defenderDex: number,
  attackerLevel: number,
  defenderLevel: number,
): number {
  return Math.min(
    0.98,
    Math.max(0.4, 0.7 + (attackerDex - defenderDex) * 0.005 + (attackerLevel - defenderLevel) * 0.01),
  );
}

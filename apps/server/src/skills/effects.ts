import type { BuffModifier, BuffView } from "@jadethrone/shared";

/** One active player buff. Keyed by source skill so recasts refresh it. */
export interface PlayerBuff {
  id: string;
  sourceSkillId: string;
  name: string;
  iconKey: string;
  kind: "buff" | "debuff";
  modifiers: BuffModifier[];
  expiresAtMs: number;
  stacks: number;
  /** Monsters ignore this player until an offensive action breaks it. */
  stealth: boolean;
}

export interface PoisonStatus {
  damagePerTick: number;
  tickMs: number;
  nextTickAtMs: number;
  expiresAtMs: number;
  sourceSessionId: string;
}

/** Server-private monster statuses. */
export interface MonsterStatus {
  stunUntilMs: number;
  slowUntilMs: number;
  slowFactor: number;
  poison: PoisonStatus | null;
}

export function createMonsterStatus(): MonsterStatus {
  return { stunUntilMs: 0, slowUntilMs: 0, slowFactor: 1, poison: null };
}

export interface PlayerBuffInput {
  sourceSkillId: string;
  name: string;
  iconKey: string;
  modifiers: BuffModifier[];
  durationMs: number;
  kind?: "buff" | "debuff";
  stealth?: boolean;
}

/** Insert or refresh a buff; the same skill never stacks multiplicatively. */
export function applyPlayerBuff(
  buffs: Map<string, PlayerBuff>,
  input: PlayerBuffInput,
  now: number,
): PlayerBuff {
  const existing = buffs.get(input.sourceSkillId);
  const buff: PlayerBuff = {
    id: existing?.id ?? input.sourceSkillId,
    sourceSkillId: input.sourceSkillId,
    name: input.name,
    iconKey: input.iconKey,
    kind: input.kind ?? "buff",
    modifiers: input.modifiers.map((modifier) => ({ ...modifier })),
    expiresAtMs: now + Math.max(0, input.durationMs),
    stacks: (existing?.stacks ?? 0) + 1,
    stealth: input.stealth ?? false,
  };
  buffs.set(input.sourceSkillId, buff);
  return buff;
}

export function activeBuffs(
  buffs: ReadonlyMap<string, PlayerBuff>,
  now: number,
): PlayerBuff[] {
  return [...buffs.values()].filter((buff) => buff.expiresAtMs > now);
}

export function pruneExpiredBuffs(
  buffs: Map<string, PlayerBuff>,
  now: number,
): boolean {
  let removed = false;
  for (const [id, buff] of buffs) {
    if (buff.expiresAtMs <= now) {
      buffs.delete(id);
      removed = true;
    }
  }
  return removed;
}

export function buffViews(
  buffs: ReadonlyMap<string, PlayerBuff>,
  now: number,
): BuffView[] {
  return activeBuffs(buffs, now).map((buff) => ({
    id: buff.id,
    sourceSkillId: buff.sourceSkillId,
    name: buff.name,
    iconKey: buff.iconKey,
    kind: buff.kind,
    expiresAtMs: buff.expiresAtMs,
    stacks: buff.stacks,
  }));
}

export function playerBuffModifiers(
  buffs: ReadonlyMap<string, PlayerBuff>,
  now: number,
): BuffModifier[] {
  const result: BuffModifier[] = [];
  for (const buff of activeBuffs(buffs, now)) {
    result.push(...buff.modifiers);
  }
  return result;
}

export function hasStealth(
  buffs: ReadonlyMap<string, PlayerBuff>,
  now: number,
): boolean {
  return activeBuffs(buffs, now).some((buff) => buff.stealth);
}

export function removeStealth(buffs: Map<string, PlayerBuff>): boolean {
  let removed = false;
  for (const [id, buff] of buffs) {
    if (buff.stealth) {
      buffs.delete(id);
      removed = true;
    }
  }
  return removed;
}

/** Remove all debuff buffs (Purify). Buffs are kept. */
export function removeDebuffs(buffs: Map<string, PlayerBuff>): number {
  let removed = 0;
  for (const [id, buff] of buffs) {
    if (buff.kind === "debuff") {
      buffs.delete(id);
      removed++;
    }
  }
  return removed;
}

/** Bosses take half stun duration instead of being fully immune. */
export function applyStun(status: MonsterStatus, durationMs: number, isBoss: boolean): void {
  const duration = Math.max(0, durationMs) * (isBoss ? 0.5 : 1);
  status.stunUntilMs = Math.max(status.stunUntilMs, Date.now() + duration);
}

export function applyStunAt(
  status: MonsterStatus,
  durationMs: number,
  isBoss: boolean,
  now: number,
): void {
  const duration = Math.max(0, durationMs) * (isBoss ? 0.5 : 1);
  status.stunUntilMs = Math.max(status.stunUntilMs, now + duration);
}

export function applySlow(
  status: MonsterStatus,
  factor: number,
  durationMs: number,
  now: number,
): void {
  status.slowFactor = Math.min(1, Math.max(0.05, factor));
  status.slowUntilMs = Math.max(status.slowUntilMs, now + Math.max(0, durationMs));
}

export function movementFactor(status: MonsterStatus, now: number): number {
  return now < status.slowUntilMs ? status.slowFactor : 1;
}

export function isStunned(status: MonsterStatus, now: number): boolean {
  return now < status.stunUntilMs;
}

export interface PoisonInput {
  damagePerTick: number;
  durationMs: number;
  tickMs?: number;
  sourceSessionId: string;
}

export function applyPoison(
  status: MonsterStatus,
  input: PoisonInput,
  now: number,
): void {
  const tickMs = Math.max(100, input.tickMs ?? 1000);
  status.poison = {
    damagePerTick: Math.max(0, Math.floor(input.damagePerTick)),
    tickMs,
    nextTickAtMs: now + tickMs,
    expiresAtMs: now + Math.max(0, input.durationMs),
    sourceSessionId: input.sourceSessionId,
  };
}

/** Advance a poison tick; returns the damage due at `now`, or null. */
export function tickPoison(
  status: MonsterStatus,
  now: number,
): { damage: number; sourceSessionId: string } | null {
  const poison = status.poison;
  if (!poison) {
    return null;
  }
  if (now >= poison.expiresAtMs) {
    status.poison = null;
    return null;
  }
  if (now < poison.nextTickAtMs) {
    return null;
  }
  poison.nextTickAtMs += poison.tickMs;
  return {
    damage: poison.damagePerTick,
    sourceSessionId: poison.sourceSessionId,
  };
}

export function clearMonsterStatus(status: MonsterStatus): void {
  status.stunUntilMs = 0;
  status.slowUntilMs = 0;
  status.slowFactor = 1;
  status.poison = null;
}

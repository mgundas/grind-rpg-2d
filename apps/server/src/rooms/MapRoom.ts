import { matchMaker, type AuthContext, type Client, Room } from "@colyseus/core";
import { StateView } from "@colyseus/schema";
import {
  CHAT_COOLDOWN_MS,
  COMBAT_EVENT_RADIUS_PX,
  AUTO_WALK_GIVE_UP_MS,
  AUTO_WALK_MAX_EMPTY_PATHS,
  AUTO_WALK_TARGET_RANGE_PX,
  INTEREST_ADD_RADIUS_PX,
  INTEREST_INTERVAL_MS,
  INTEREST_RADIUS_PX,
  MAX_ASTAR_PER_TICK,
  MAX_MESSAGES_PER_SECOND,
  MAX_PLAYERS_PER_CHANNEL,
  MSG,
  PATH_RETARGET_MIN_MS,
  RESPAWN_HERE_DELAY_MS,
  RESPAWN_HERE_HP_FRACTION,
  SERVER_TICK_GRACE_TICKS,
  STAT_POINT_CAP,
  TICK_MS,
  TILE_SIZE,
  WARP_COOLDOWN_MS,
  allocStatMessageSchema,
  applyXpGain,
  attackMessageSchema,
  chatMessageSchema,
  chatRecipients,
  deathXpLoss,
  dir8Towards,
  facing4FromDelta,
  facing4FromIndex,
  facing4Index,
  findPath,
  inputMessageSchema,
  isClassId,
  isWalkableAt,
  monsterXpGain,
  requestStatsMessageSchema,
  respawnMessageSchema,
  seededRandomSource,
  seedFromString,
  setTargetMessageSchema,
  stepMover,
  type ChatMsgPayload,
  type CombatEventPayload,
  type CombatHit,
  type DeathPayload,
  type Dir8,
  type InputMessage,
  type LevelUpPayload,
  type MapId,
  type MonsterDiedPayload,
  type RandomSource,
  type StatKey,
  type TargetClearedReason,
  type Vec2,
  type WarpPayload,
  type WarpZone,
} from "@jadethrone/shared";
import { getClass } from "@jadethrone/data/classes";
import { getMonster } from "@jadethrone/data/monsters";
import { logger } from "../logger";
import { isMapId, loadMapAssets, type MapAssets } from "../maps/mapRegistry";
import { createPlayerRuntime, type PlayerRuntime } from "./playerRuntime";
import { PlayerState, WorldState } from "./state/WorldState";
import { issueWarpToken } from "./warpTokens";
import { getServerServices } from "../services";
import { buildSelfStats } from "../characters/selfStats";
import { progressionFromCharacter, recomputeMaxima } from "../characters/progression";
import { defaultSpawn, type CharacterSave } from "../characters/spawn";
import {
  resolveMonsterAttack,
  resolvePlayerSwing,
  type KilledMonster,
  type SwingOutcome,
} from "./combat";
import { applyRegenTick } from "./regen";
import { stepMonsterAi, type AiPlayerSnapshot } from "./monsterAi";
import type { MonsterRuntime } from "./monsterRuntime";
import {
  aggroGroup,
  createSpawnManager,
  notifyMonsterDeath,
  spawnAllGroups,
  tickSpawns,
  type SpawnManager,
} from "./spawnManager";
import type { JoinIdentity } from "../auth/joinAuth";

/** Max queued input messages per player; older inputs are dropped. */
const MAX_PENDING_INPUTS = 8;

/** Unreachable path targets are not retried before this delay. */
const PATH_FAILURE_CACHE_MS = 1000;

/** A client that never leaves after a warp is disconnected after this delay. */
const WARP_CLIENT_LEAVE_TIMEOUT_MS = 2000;

/** Dirty position autosave cadence (GAME_DESIGN.md §10.2). */
const AUTOSAVE_INTERVAL_MS = 60_000;

/**
 * One room instance per map (GAME_DESIGN.md §10.2). Authentication happens at
 * matchmaking (`static onAuth`); the room only trusts `client.auth`, the
 * server-issued spawn and the DB-backed persistence services.
 */
export class MapRoom extends Room {
  maxClients = MAX_PLAYERS_PER_CHANNEL;
  maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND;
  patchRate = 50;

  state = new WorldState();

  private mapId!: MapId;
  private assets!: MapAssets;
  private runtimes = new Map<string, PlayerRuntime>();
  private monsterRuntimes = new Map<string, MonsterRuntime>();
  private spawns!: SpawnManager;
  private rng!: RandomSource;
  /** Monotonic id for combat events, so clients can ignore stale arrivals. */
  private eventSeq = 0;
  /** Reused intent buffer: no per-tick allocation in the steady state. */
  private attackIntents: Array<{ monsterId: string; targetSessionId: string }> = [];
  private attackIntentCount = 0;

  /**
   * Colyseus 0.17 calls the STATIC method during matchmaking, before a seat is
   * reserved; its return value becomes `client.auth` in `onJoin`.
   */
  static async onAuth(
    token: string | undefined,
    options: unknown,
    context: AuthContext,
  ): Promise<JoinIdentity | null> {
    return getServerServices().joinAuthenticator(token, options, { ip: context.ip });
  }

  onCreate(): void {
    if (!isMapId(this.roomName)) {
      throw new Error(`unknown map room "${this.roomName}"`);
    }
    this.mapId = this.roomName;
    this.assets = loadMapAssets(this.mapId);
    this.rng = getServerServices().createRandomSource();
    this.spawns = createSpawnManager({
      mapId: this.mapId,
      grid: this.assets.grid,
      state: this.state,
      runtimes: this.monsterRuntimes,
      mobZones: this.assets.mobZones,
      // Deterministic per room: the room id is random, so two rooms never
      // share a layout, but a single room always reproduces its own packs.
      rngForGroup: (seed) => seededRandomSource(seedFromString(`${this.roomId}:${seed}`)),
    });
    spawnAllGroups(this.spawns, Date.now());

    this.onMessage(MSG.input, (client, raw) => {
      const parsed = inputMessageSchema.safeParse(raw);
      if (!parsed.success) {
        // A malformed message from a buggy/hostile client is dropped, not a
        // reason to disconnect a legitimate session.
        logger.warn(
          { session: client.sessionId, issues: parsed.error.issues.map((issue) => issue.message) },
          "dropped invalid input message",
        );
        return;
      }
      const runtime = this.runtimes.get(client.sessionId);
      if (!runtime) {
        return;
      }
      if (runtime.pending.length >= MAX_PENDING_INPUTS) {
        runtime.pending.shift();
        runtime.droppedInputs++;
      }
      runtime.pending.push(parsed.data);
    });

    this.onMessage(MSG.chat, (client, raw) => {
      const parsed = chatMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid chat message");
        return;
      }
      const runtime = this.runtimes.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      if (!runtime || !player) {
        return;
      }
      const now = Date.now();
      if (now < runtime.chatReadyAtMs) {
        return;
      }
      runtime.chatReadyAtMs = now + CHAT_COOLDOWN_MS;

      const participants = [...this.state.players.entries()].map(([sessionId, other]) => ({
        sessionId,
        x: other.x,
        y: other.y,
      }));
      const recipients = chatRecipients(participants, {
        sessionId: client.sessionId,
        x: player.x,
        y: player.y,
      });
      const payload: ChatMsgPayload = {
        from: client.sessionId,
        name: player.name,
        kingdom: player.kingdom,
        text: parsed.data.text,
      };
      for (const otherClient of this.clients) {
        if (recipients.includes(otherClient.sessionId)) {
          otherClient.send(MSG.chatMsg, payload);
        }
      }
    });

    this.onMessage(MSG.attack, (client, raw) => {
      const parsed = attackMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid attack message");
        return;
      }
      const runtime = this.runtimes.get(client.sessionId);
      if (!runtime) {
        return;
      }
      // One pending swing per tick: spamming collapses into a single attack.
      runtime.pendingAttack = {
        dir: parsed.data.dir === undefined ? null : (parsed.data.dir as Dir8),
      };
    });

    this.onMessage(MSG.setTarget, (client, raw) => {
      const parsed = setTargetMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid target message");
        return;
      }
      this.setAutoWalkTarget(client, parsed.data.monsterId);
    });

    this.onMessage(MSG.respawn, (client, raw) => {
      const parsed = respawnMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid respawn message");
        return;
      }
      const runtime = this.runtimes.get(client.sessionId);
      if (runtime) {
        runtime.pendingRespawn = parsed.data.option;
      }
    });

    this.onMessage(MSG.allocStat, (client, raw) => {
      const parsed = allocStatMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ session: client.sessionId }, "dropped invalid stat allocation");
        return;
      }
      this.allocateStat(client.sessionId, parsed.data.stat);
    });

    this.onMessage(MSG.requestStats, (client, raw) => {
      if (!requestStatsMessageSchema.safeParse(raw).success) {
        return;
      }
      this.sendSelfStats(client.sessionId);
    });

    this.setSimulationInterval(() => this.tick(), TICK_MS);
    // Interest management runs at 4 Hz, not every tick (GAME_DESIGN.md §5.1).
    this.clock.setInterval(() => this.updateInterest(), INTEREST_INTERVAL_MS);
    this.clock.setInterval(() => void this.autosave(), AUTOSAVE_INTERVAL_MS);
    logger.info({ roomId: this.roomId, mapId: this.mapId }, "map room created");
  }

  async onJoin(client: Client): Promise<void> {
    const auth = client.auth as JoinIdentity | undefined;
    if (!auth) {
      throw new Error("authenticated join without client.auth");
    }

    // The warp token was consumed and validated during matchmaking. Fall back
    // to the character's saved position for a normal join.
    const requested = auth.warpSpawn ?? { x: auth.character.x, y: auth.character.y };
    const spawn = this.resolveSpawn(requested.x, requested.y);
    const progression = progressionFromCharacter(auth.character);
    const runtime = createPlayerRuntime(spawn, {
      accountId: auth.account.id,
      characterId: auth.character.id,
      tokenVersion: auth.account.tokenVersion,
      progression,
    });
    runtime.dirty =
      Math.abs(spawn.x - auth.character.x) > 0.01 ||
      Math.abs(spawn.y - auth.character.y) > 0.01 ||
      progression.level !== auth.character.level ||
      progression.xp !== auth.character.xp ||
      progression.hp !== auth.character.hp ||
      progression.mp !== auth.character.mp ||
      progression.statPoints !== auth.character.statPoints;
    if (auth.warpSpawn) {
      runtime.warpCooldownUntilMs = Date.now() + WARP_COOLDOWN_MS;
    }

    const player = new PlayerState();
    player.characterId = auth.character.id;
    player.name = auth.character.name;
    player.kingdom = auth.account.kingdom;
    player.classId = auth.character.classId;
    player.gender = auth.character.gender;
    player.hairStyle = auth.character.hairStyle;
    player.hairColor = auth.character.hairColor;
    player.level = progression.level;
    player.x = runtime.mover.pos.x;
    player.y = runtime.mover.pos.y;
    player.facing = facing4Index("down");
    player.moving = false;
    player.lastSeq = 0;
    player.hp = progression.hp;
    player.maxHp = progression.maxHp;
    player.mp = progression.mp;
    player.maxMp = progression.maxMp;
    player.dead = false;

    // The view must exist before the player is added, so the very first
    // encoded state is already filtered for this client.
    client.view = new StateView();
    this.state.players.set(client.sessionId, player);
    this.runtimes.set(client.sessionId, runtime);
    this.updateInterest();

    // Replacing a session saves and closes the previous one first (duplicate
    // join or a login that did not go through the HTTP kick path). A stale
    // reservation (older token version than the account's current generation)
    // is rejected instead of kicking the newer session.
    const accepted = await getServerServices().sessionRegistry.register({
      accountId: auth.account.id,
      characterId: auth.character.id,
      sessionId: client.sessionId,
      tokenVersion: auth.account.tokenVersion,
      saveForKick: () => this.savePlayerNow(client.sessionId),
      send: (type, payload) => client.send(type, payload),
      leave: (code) => client.leave(code),
    });
    if (!accepted) {
      this.state.players.delete(client.sessionId);
      this.runtimes.delete(client.sessionId);
      this.updateInterest();
      return;
    }

    this.sendSelfStats(client.sessionId);

    // A duplicate join replaced and saved the previous session. Its save is
    // newer than the matchmaking snapshot, so refresh before the first tick
    // can overwrite it with stale HP/XP/position.
    const fresh = await getServerServices().loadCharacter(auth.account.id, auth.character.id);
    const activeRuntime = this.runtimes.get(client.sessionId);
    const activePlayer = this.state.players.get(client.sessionId);
    if (fresh && activeRuntime && activePlayer) {
      const refreshed = progressionFromCharacter(fresh);
      activeRuntime.progression = refreshed;
      activePlayer.level = refreshed.level;
      activePlayer.hp = refreshed.hp;
      activePlayer.maxHp = refreshed.maxHp;
      activePlayer.mp = refreshed.mp;
      activePlayer.maxMp = refreshed.maxMp;
      if (fresh.map === this.mapId) {
        const position = this.resolveSpawn(fresh.x, fresh.y);
        if (
          Math.abs(position.x - activeRuntime.mover.pos.x) > 0.5 ||
          Math.abs(position.y - activeRuntime.mover.pos.y) > 0.5
        ) {
          activeRuntime.mover.pos.x = position.x;
          activeRuntime.mover.pos.y = position.y;
          activeRuntime.mover.path = [];
          activePlayer.x = position.x;
          activePlayer.y = position.y;
        }
      }
      this.sendSelfStats(client.sessionId);
      this.updateInterest();
    }

    logger.info(
      {
        roomId: this.roomId,
        mapId: this.mapId,
        session: client.sessionId,
        characterId: player.characterId,
        name: player.name,
      },
      "player joined",
    );
  }

  async onLeave(client: Client, code: number): Promise<void> {
    const runtime = this.runtimes.get(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.runtimes.delete(client.sessionId);
    this.clearPlayerFromMonsters(client.sessionId);

    if (runtime) {
      getServerServices().sessionRegistry.unregister(runtime.accountId, client.sessionId);
      // A kick already saved and cleared `dirty`; a warp already persisted
      // the destination and removed the runtime.
      if (runtime.dirty) {
        await this.enqueueSave(runtime, this.deathAwareDestination(runtime));
      }
    }

    logger.info({ roomId: this.roomId, session: client.sessionId, closeCode: code }, "player left");
  }

  /**
   * A dead player who disconnects or is kicked restarts in town: save the
   * village spawn at full HP/MP so the next login is not a death screen.
   */
  private deathAwareDestination(runtime: PlayerRuntime): {
    mapId: MapId;
    x: number;
    y: number;
  } {
    if (!runtime.dead) {
      return {
        mapId: this.mapId,
        x: runtime.mover.pos.x,
        y: runtime.mover.pos.y,
      };
    }
    runtime.progression.hp = runtime.progression.maxHp;
    runtime.progression.mp = runtime.progression.maxMp;
    return defaultSpawn();
  }

  /** Save one player before a session is replaced (kick path). */
  private async savePlayerNow(sessionId: string): Promise<void> {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime || !runtime.dirty) {
      return;
    }
    await this.enqueueSave(runtime, this.deathAwareDestination(runtime));
  }

  /**
   * All writes for one runtime go through a promise chain, so an autosave
   * snapshot can never land after a newer kick/leave/warp write. `dirty` is
   * cleared only when the runtime still matches every saved field.
   */
  private enqueueSave(
    runtime: PlayerRuntime,
    destination: { mapId: MapId; x: number; y: number },
  ): Promise<boolean> {
    const snapshot = this.characterSave(runtime, destination);
    const run = async (): Promise<boolean> => {
      try {
        const saved = await getServerServices().saveCharacter(runtime.characterId, snapshot);
        if (saved && this.saveSnapshotMatches(runtime, snapshot)) {
          runtime.dirty = false;
        }
        return saved;
      } catch (error) {
        logger.error(
          { roomId: this.roomId, characterId: runtime.characterId, error },
          "character save failed",
        );
        return false;
      }
    };
    const next = (runtime.saveChain ?? Promise.resolve()).then(run, run);
    runtime.saveChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private characterSave(
    runtime: PlayerRuntime,
    destination: { mapId: MapId; x: number; y: number },
  ): CharacterSave {
    const progression = runtime.progression;
    return {
      mapId: destination.mapId,
      x: destination.x,
      y: destination.y,
      hp: progression.hp,
      mp: progression.mp,
      xp: progression.xp,
      level: progression.level,
      statVit: progression.stats.vit,
      statInt: progression.stats.int,
      statStr: progression.stats.str,
      statDex: progression.stats.dex,
      statPoints: progression.statPoints,
    };
  }

  private saveSnapshotMatches(runtime: PlayerRuntime, snapshot: CharacterSave): boolean {
    const progression = runtime.progression;
    return (
      runtime.mover.pos.x === snapshot.x &&
      runtime.mover.pos.y === snapshot.y &&
      progression.hp === snapshot.hp &&
      progression.mp === snapshot.mp &&
      progression.xp === snapshot.xp &&
      progression.level === snapshot.level &&
      progression.stats.vit === snapshot.statVit &&
      progression.stats.int === snapshot.statInt &&
      progression.stats.str === snapshot.statStr &&
      progression.stats.dex === snapshot.statDex &&
      progression.statPoints === snapshot.statPoints
    );
  }

  /** Periodic dirty-character flush (ordered per player by `enqueueSave`). */
  private async autosave(): Promise<void> {
    const pending: Array<Promise<boolean>> = [];
    for (const [sessionId, runtime] of this.runtimes) {
      if (!runtime.dirty || runtime.warping || runtime.dead) {
        continue;
      }
      const player = this.state.players.get(sessionId);
      if (!player) {
        continue;
      }
      pending.push(
        this.enqueueSave(runtime, {
          mapId: this.mapId,
          x: player.x,
          y: player.y,
        }),
      );
    }
    if (pending.length > 0) {
      await Promise.allSettled(pending);
    }
  }

  /**
   * StateView interest management: a player is added to a client's view inside
   * INTEREST_ADD_RADIUS_PX and removed beyond INTEREST_RADIUS_PX. The gap is
   * hysteresis; the own player is always visible.
   */
  private updateInterest(): void {
    const addSquared = INTEREST_ADD_RADIUS_PX * INTEREST_ADD_RADIUS_PX;
    const removeSquared = INTEREST_RADIUS_PX * INTEREST_RADIUS_PX;

    for (const client of this.clients) {
      const view = client.view;
      const own = this.state.players.get(client.sessionId);
      if (!view || !own) {
        continue;
      }
      for (const [sessionId, player] of this.state.players) {
        if (sessionId === client.sessionId) {
          if (!view.has(player)) {
            view.add(player);
          }
          continue;
        }
        const dx = player.x - own.x;
        const dy = player.y - own.y;
        const distanceSquared = dx * dx + dy * dy;
        const visible = view.has(player);
        if (!visible && distanceSquared <= addSquared) {
          view.add(player);
        } else if (visible && distanceSquared > removeSquared) {
          view.remove(player);
        }
      }

      for (const monster of this.state.monsters.values()) {
        const dx = monster.x - own.x;
        const dy = monster.y - own.y;
        const distanceSquared = dx * dx + dy * dy;
        const visible = view.has(monster);
        if (!visible && distanceSquared <= addSquared) {
          view.add(monster);
        } else if (visible && distanceSquared > removeSquared) {
          view.remove(monster);
        }
      }
    }
  }

  /**
   * Fixed 20 Hz step in the GAME_DESIGN order
   * `input -> movement -> ai -> (combat) -> (regen) -> spawns -> warps`.
   * Combat and regen are added in later tasks; the stage boundaries are kept so
   * each system observes the positions produced by the previous one.
   */
  private tick(): void {
    const now = Date.now();
    const players = this.playerSnapshots();
    for (const client of this.clients) {
      const runtime = this.runtimes.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      if (!runtime || !player || runtime.dead) {
        if (player && runtime?.dead) {
          player.moving = false;
        }
        continue;
      }
      this.stepPlayer(runtime, player, client.sessionId, now);
    }
    this.stepMonsters(now, players);
    this.runCombatPhase(now);
    this.applyRegen(now);
    this.processRespawns(now);
    const spawned = tickSpawns(
      this.spawns,
      now,
      players.filter((player) => !player.dead).map((player) => player.pos),
    );
    if (spawned > 0) {
      this.updateInterest();
    }
    this.checkWarps();
  }

  /** Resolve queued player swings, then monster intents from the AI phase. */
  private runCombatPhase(now: number): void {
    const context = {
      now,
      rng: this.rng,
      state: this.state,
      runtimes: this.runtimes,
      monsterRuntimes: this.monsterRuntimes,
    };

    for (const [sessionId, runtime] of this.runtimes) {
      const pending = runtime.pendingAttack;
      if (!pending) {
        continue;
      }
      runtime.pendingAttack = null;
      const outcome = resolvePlayerSwing(context, sessionId, pending.dir);
      if (outcome) {
        this.emitSwing(sessionId, outcome, now);
      }
    }

    for (let index = 0; index < this.attackIntentCount; index++) {
      const intent = this.attackIntents[index]!;
      const outcome = resolveMonsterAttack(context, intent.monsterId, intent.targetSessionId);
      if (!outcome) {
        continue;
      }
      this.emitMonsterAttack(intent.monsterId, outcome.hit);
      if (outcome.victimDead) {
        this.handlePlayerDeath(intent.targetSessionId, now);
      }
    }
    this.attackIntentCount = 0;
  }

  private emitSwing(sessionId: string, outcome: SwingOutcome, now: number): void {
    const attacker = this.runtimes.get(sessionId);
    if (!attacker) {
      return;
    }
    const origin = attacker.mover.pos;
    const radiusSquared = COMBAT_EVENT_RADIUS_PX * COMBAT_EVENT_RADIUS_PX;
    const recipients = this.clients.filter((client) => {
      const runtime = this.runtimes.get(client.sessionId);
      if (!runtime) {
        return false;
      }
      const dx = runtime.mover.pos.x - origin.x;
      const dy = runtime.mover.pos.y - origin.y;
      return dx * dx + dy * dy <= radiusSquared;
    });

    const payload: CombatEventPayload = {
      eventSeq: ++this.eventSeq,
      attacker: { kind: "player", sessionId },
      hits: outcome.hits,
    };
    for (const client of recipients) {
      this.safeSend(client, MSG.combat, payload);
    }

    // Aggro before cleanup: killing a monster must still wake the rest of its
    // pack (notifyMonsterDeath removes the group lookup).
    for (const monsterId of outcome.damagedMonsterIds) {
      aggroGroup(this.spawns, monsterId, sessionId);
    }

    for (const killed of outcome.killed) {
      this.state.monsters.delete(killed.monsterId);
      this.monsterRuntimes.delete(killed.monsterId);
      notifyMonsterDeath(this.spawns, killed.monsterId, now);
      const died: MonsterDiedPayload = { ...killed, killerSessionId: sessionId };
      for (const client of recipients) {
        this.safeSend(client, MSG.monsterDied, died);
      }
      if (attacker.targetMonsterId === killed.monsterId) {
        this.clearAutoWalk(attacker, sessionId, "target_lost");
      }
      this.awardKillXp(sessionId, killed);
    }
  }

  private emitMonsterAttack(monsterId: string, hit: CombatHit): void {
    const monsterRuntime = this.monsterRuntimes.get(monsterId);
    if (!monsterRuntime) {
      return;
    }
    const origin = monsterRuntime.mover.pos;
    const radiusSquared = COMBAT_EVENT_RADIUS_PX * COMBAT_EVENT_RADIUS_PX;
    const recipients = this.clients.filter((client) => {
      const runtime = this.runtimes.get(client.sessionId);
      if (!runtime) {
        return false;
      }
      const dx = runtime.mover.pos.x - origin.x;
      const dy = runtime.mover.pos.y - origin.y;
      return dx * dx + dy * dy <= radiusSquared;
    });
    const payload: CombatEventPayload = {
      eventSeq: ++this.eventSeq,
      attacker: { kind: "monster", monsterId },
      hits: [hit],
    };
    for (const client of recipients) {
      this.safeSend(client, MSG.combat, payload);
    }
  }

  private handlePlayerDeath(sessionId: string, now: number): void {
    const runtime = this.runtimes.get(sessionId);
    const player = this.state.players.get(sessionId);
    if (!runtime || !player || runtime.dead) {
      return;
    }

    this.clearAutoWalk(runtime, sessionId, "target_lost");
    runtime.dead = true;
    runtime.diedAtMs = now;
    runtime.pending.length = 0;
    runtime.pendingAttack = null;
    runtime.lastIntent = { kind: "none" };
    runtime.mover.path = [];
    runtime.graceTicksRemaining = 0;
    runtime.targetMonsterId = null;
    runtime.nextChaseRepathAtMs = 0;
    runtime.bestTargetDistSq = Number.POSITIVE_INFINITY;
    runtime.noProgressSinceMs = 0;
    runtime.emptyChasePaths = 0;
    runtime.progression.hp = 0;
    player.dead = true;
    player.hp = 0;
    player.moving = false;

    runtime.progression.xp = Math.max(
      0,
      runtime.progression.xp - deathXpLoss(runtime.progression.level, runtime.progression.xp),
    );
    runtime.dirty = true;
    this.clearPlayerFromMonsters(sessionId);

    const delay = getServerServices().combatTuning.respawnHereDelayMs ?? RESPAWN_HERE_DELAY_MS;
    const payload: DeathPayload = { respawnHereAtMs: now + delay };
    const client = this.clients.find((candidate) => candidate.sessionId === sessionId);
    if (client) {
      this.safeSend(client, MSG.death, payload);
    }
    this.sendSelfStats(sessionId);
  }

  private sendSelfStats(sessionId: string): void {
    const runtime = this.runtimes.get(sessionId);
    const player = this.state.players.get(sessionId);
    const client = this.clients.find((candidate) => candidate.sessionId === sessionId);
    if (!runtime || !player || !client) {
      return;
    }
    this.safeSend(client, MSG.selfStats, buildSelfStats(runtime, player));
  }

  private applyRegen(now: number): void {
    for (const [sessionId, runtime] of this.runtimes) {
      const player = this.state.players.get(sessionId);
      if (player) {
        applyRegenTick(runtime, player, now);
      }
    }
  }

  private processRespawns(now: number): void {
    for (const client of [...this.clients]) {
      const runtime = this.runtimes.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      if (!runtime || !player) {
        continue;
      }
      const choice = runtime.pendingRespawn;
      if (!choice) {
        continue;
      }
      runtime.pendingRespawn = null;
      if (!runtime.dead) {
        continue;
      }

      if (choice === "town") {
        void this.respawnInTown(client);
        continue;
      }

      const delay = getServerServices().combatTuning.respawnHereDelayMs ?? RESPAWN_HERE_DELAY_MS;
      if (now < runtime.diedAtMs + delay) {
        this.safeSend(client, MSG.death, { respawnHereAtMs: runtime.diedAtMs + delay });
        continue;
      }

      const fraction =
        getServerServices().combatTuning.respawnHereHpFraction ?? RESPAWN_HERE_HP_FRACTION;
      const hp = Math.max(1, Math.round(runtime.progression.maxHp * fraction));
      runtime.progression.hp = hp;
      runtime.dead = false;
      runtime.diedAtMs = 0;
      runtime.regenAccumMs = 0;
      player.dead = false;
      player.hp = hp;
      player.moving = false;
      const spawn = this.resolveSpawn(player.x, player.y);
      runtime.mover.pos.x = spawn.x;
      runtime.mover.pos.y = spawn.y;
      runtime.mover.path = [];
      runtime.lastIntent = { kind: "none" };
      player.x = spawn.x;
      player.y = spawn.y;
      runtime.dirty = true;
      this.updateInterest();
      this.sendSelfStats(client.sessionId);
    }
  }

  private async respawnInTown(client: Client): Promise<void> {
    const runtime = this.runtimes.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!runtime || !player || !runtime.dead || runtime.warping) {
      return;
    }

    runtime.progression.hp = runtime.progression.maxHp;
    runtime.progression.mp = runtime.progression.maxMp;
    player.hp = runtime.progression.hp;
    player.mp = runtime.progression.mp;

    const village = defaultSpawn();
    const accepted = await this.beginWarp(client, village);
    if (!accepted) {
      const delay = getServerServices().combatTuning.respawnHereDelayMs ?? RESPAWN_HERE_DELAY_MS;
      this.safeSend(client, MSG.death, { respawnHereAtMs: runtime.diedAtMs + delay });
    }
  }

  /** Award kill XP to the player who landed the killing blow (party XP is Phase 6). */
  private awardKillXp(sessionId: string, killed: KilledMonster): void {
    const runtime = this.runtimes.get(sessionId);
    const player = this.state.players.get(sessionId);
    if (!runtime || !player || runtime.dead) {
      return;
    }
    const spec = getMonster(killed.typeId);
    const gain = monsterXpGain(spec.xp, spec.level, runtime.progression.level);
    const result = applyXpGain(runtime.progression.level, runtime.progression.xp, gain);
    runtime.progression.level = result.level;
    runtime.progression.xp = result.xp;
    runtime.progression.statPoints += result.statPointsGained;

    if (result.levelsGained > 0 && isClassId(player.classId)) {
      recomputeMaxima(runtime.progression, player.classId);
      runtime.progression.hp = runtime.progression.maxHp;
      runtime.progression.mp = runtime.progression.maxMp;
      player.level = runtime.progression.level;
      player.maxHp = runtime.progression.maxHp;
      player.maxMp = runtime.progression.maxMp;
      player.hp = runtime.progression.hp;
      player.mp = runtime.progression.mp;

      const levelUp: LevelUpPayload = {
        sessionId,
        name: player.name,
        level: runtime.progression.level,
        x: runtime.mover.pos.x,
        y: runtime.mover.pos.y,
      };
      const radiusSquared = COMBAT_EVENT_RADIUS_PX * COMBAT_EVENT_RADIUS_PX;
      for (const client of this.clients) {
        const other = this.runtimes.get(client.sessionId);
        if (!other) {
          continue;
        }
        const dx = other.mover.pos.x - runtime.mover.pos.x;
        const dy = other.mover.pos.y - runtime.mover.pos.y;
        if (dx * dx + dy * dy <= radiusSquared) {
          this.safeSend(client, MSG.levelUp, levelUp);
        }
      }
    }

    runtime.dirty = true;
    this.sendSelfStats(sessionId);
    void this.enqueueSave(runtime, {
      mapId: this.mapId,
      x: runtime.mover.pos.x,
      y: runtime.mover.pos.y,
    });
  }

  private allocateStat(sessionId: string, stat: StatKey): void {
    const runtime = this.runtimes.get(sessionId);
    const player = this.state.players.get(sessionId);
    if (!runtime || !player || runtime.warping) {
      return;
    }
    if (runtime.progression.statPoints <= 0) {
      return;
    }
    if (runtime.progression.stats[stat] >= STAT_POINT_CAP) {
      return;
    }
    runtime.progression.stats[stat]++;
    runtime.progression.statPoints--;

    if (isClassId(player.classId)) {
      recomputeMaxima(runtime.progression, player.classId);
    }
    player.maxHp = runtime.progression.maxHp;
    player.maxMp = runtime.progression.maxMp;
    player.hp = runtime.progression.hp;
    player.mp = runtime.progression.mp;
    runtime.dirty = true;
    this.sendSelfStats(sessionId);
    void this.enqueueSave(runtime, {
      mapId: this.mapId,
      x: runtime.mover.pos.x,
      y: runtime.mover.pos.y,
    });
  }

  private safeSend(client: Client, type: string, payload: unknown): void {
    try {
      client.send(type, payload);
    } catch (error) {
      logger.debug(
        { roomId: this.roomId, session: client.sessionId, type, error },
        "failed to send room message",
      );
    }
  }

  /** One snapshot per tick for the AI; positions come from authoritative movers. */
  private playerSnapshots(): AiPlayerSnapshot[] {
    const snapshots: AiPlayerSnapshot[] = [];
    for (const [sessionId, runtime] of this.runtimes) {
      snapshots.push({
        sessionId,
        pos: runtime.mover.pos,
        dead: runtime.dead,
        warping: runtime.warping,
      });
    }
    return snapshots;
  }

  private stepMonsters(now: number, players: readonly AiPlayerSnapshot[]): void {
    let budget = MAX_ASTAR_PER_TICK;
    const takeAstar = (): boolean => {
      if (budget <= 0) {
        return false;
      }
      budget--;
      return true;
    };
    this.attackIntentCount = 0;

    for (const [monsterId, runtime] of this.monsterRuntimes) {
      if (runtime.hp <= 0) {
        continue;
      }
      const monster = this.state.monsters.get(monsterId);
      if (!monster) {
        continue;
      }
      const result = stepMonsterAi(
        {
          grid: this.assets.grid,
          now,
          players,
          takeAstar,
          rng: () => this.rng.next(),
        },
        runtime,
        monster,
        getMonster(runtime.typeId),
      );
      if (!result.attackTargetId) {
        continue;
      }
      const slot = (this.attackIntents[this.attackIntentCount] ??= {
        monsterId: "",
        targetSessionId: "",
      });
      slot.monsterId = monsterId;
      slot.targetSessionId = result.attackTargetId;
      this.attackIntentCount++;
    }
  }

  /** A player who leaves is no longer a valid monster target. */
  private clearPlayerFromMonsters(sessionId: string): void {
    for (const monster of this.monsterRuntimes.values()) {
      if (monster.targetSessionId !== sessionId) {
        continue;
      }
      monster.targetSessionId = null;
      monster.mover.path = [];
      monster.failedRepaths = 0;
      monster.lastTargetTileKey = null;
      monster.nextRepathAtMs = 0;
      if (monster.ai !== "return") {
        monster.ai = "return";
      }
    }
  }

  /** Trigger any warp zone the player is standing on (after movement). */
  private checkWarps(): void {
    const now = Date.now();
    for (const client of [...this.clients]) {
      const runtime = this.runtimes.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      if (
        !runtime ||
        !player ||
        runtime.warping ||
        runtime.dead ||
        now < runtime.warpCooldownUntilMs
      ) {
        continue;
      }
      const warp = this.assets.warps.find(
        (zone) =>
          player.x >= zone.x &&
          player.x <= zone.x + zone.w &&
          player.y >= zone.y &&
          player.y <= zone.y + zone.h,
      );
      if (warp) {
        void this.startWarp(client, warp);
      }
    }
  }

  /**
   * Persist the destination first, then reserve a seat authenticated by a
   * server-issued warp token. The target room's `onAuth` consumes the token
   * and loads the saved destination, so an expired access JWT cannot break a
   * map change.
   */
  private async startWarp(client: Client, warp: WarpZone): Promise<void> {
    await this.beginWarp(client, { mapId: warp.targetMap, x: warp.targetX, y: warp.targetY });
  }

  /**
   * Persist the destination first, then reserve a seat authenticated by a
   * server-issued warp token. The target room's `onAuth` consumes the token
   * and loads the saved destination, so an expired access JWT cannot break a
   * map change.
   *
   * Returns false when the destination could not be saved or the reservation
   * failed; a connected player has then been restored and can retry.
   */
  private async beginWarp(
    client: Client,
    destination: { mapId: MapId; x: number; y: number },
  ): Promise<boolean> {
    const runtime = this.runtimes.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!runtime || !player || runtime.warping) {
      return false;
    }
    runtime.warping = true;
    const services = getServerServices();
    const source = {
      mapId: this.mapId,
      x: runtime.mover.pos.x,
      y: runtime.mover.pos.y,
    };

    const saved = await this.enqueueSave(runtime, destination);
    if (!saved) {
      runtime.warping = false;
      runtime.warpCooldownUntilMs = Date.now() + WARP_COOLDOWN_MS;
      logger.error(
        { roomId: this.roomId, session: client.sessionId },
        "warp destination save failed",
      );
      return false;
    }

    this.state.players.delete(client.sessionId);
    this.runtimes.delete(client.sessionId);
    this.clearPlayerFromMonsters(client.sessionId);
    // The move is intentional; do not let the target join "kick" this session.
    services.sessionRegistry.unregister(runtime.accountId, client.sessionId);

    try {
      const token = issueWarpToken(destination.mapId, destination.x, destination.y, {
        accountId: runtime.accountId,
        characterId: runtime.characterId,
        tokenVersion: runtime.tokenVersion,
      });
      const reservation = await this.reserveSeat(destination.mapId, {
        characterId: runtime.characterId,
        map: destination.mapId,
        warpToken: token,
      });
      if (!this.clients.some((candidate) => candidate.sessionId === client.sessionId)) {
        // Client left before receiving the reservation; undo the destination
        // write so the next login does not spawn on a map it never reached.
        void this.enqueueSave(runtime, source);
        return false;
      }
      const payload: WarpPayload = {
        map: destination.mapId,
        x: destination.x,
        y: destination.y,
        reservation,
      };
      client.send(MSG.warp, payload);

      // A client that ignores the warp message must not keep occupying a seat
      // here (and holding a target-room reservation) forever.
      const leaveTimer = setTimeout(() => {
        if (this.clients.some((candidate) => candidate.sessionId === client.sessionId)) {
          logger.warn(
            { roomId: this.roomId, session: client.sessionId },
            "client did not leave after warp; disconnecting",
          );
          void this.enqueueSave(runtime, source);
          client.leave(4000);
        }
      }, WARP_CLIENT_LEAVE_TIMEOUT_MS);
      leaveTimer.unref?.();

      logger.info(
        {
          roomId: this.roomId,
          session: client.sessionId,
          from: this.mapId,
          to: destination.mapId,
        },
        "player warped",
      );
      return true;
    } catch (error) {
      // Restore the player only if the client is still connected here.
      if (this.clients.some((candidate) => candidate.sessionId === client.sessionId)) {
        runtime.warping = false;
        // Do not retry every tick while the warp zone still overlaps: without
        // this cooldown a persistent matchmaker failure would issue a token
        // and run a full reservation attempt 20 times per second.
        runtime.warpCooldownUntilMs = Date.now() + WARP_COOLDOWN_MS;
        this.state.players.set(client.sessionId, player);
        this.runtimes.set(client.sessionId, runtime);
        // The destination write succeeded; put the source position back.
        runtime.dirty = true;
        void this.enqueueSave(runtime, source);
        const accepted = await services.sessionRegistry.register({
          accountId: runtime.accountId,
          characterId: runtime.characterId,
          sessionId: client.sessionId,
          tokenVersion: runtime.tokenVersion,
          saveForKick: () => this.savePlayerNow(client.sessionId),
          send: (type, payload) => client.send(type, payload),
          leave: (code) => client.leave(code),
        });
        if (!accepted) {
          this.state.players.delete(client.sessionId);
          this.runtimes.delete(client.sessionId);
        }
        this.updateInterest();
      }
      logger.error({ roomId: this.roomId, session: client.sessionId, error }, "warp failed");
      return false;
    }
  }

  /**
   * Overridable seam so tests can exercise matchmaker failures without
   * replacing the ESM namespace (which is not configurable).
   */
  reserveSeat(
    map: MapId,
    options: { characterId: string; map: MapId; warpToken: string },
  ): ReturnType<typeof matchMaker.joinOrCreate> {
    return matchMaker.joinOrCreate(map, options, {
      headers: new Headers(),
      ip: "in-process",
    });
  }

  private stepPlayer(
    runtime: PlayerRuntime,
    player: PlayerState,
    sessionId: string,
    now: number,
  ): void {
    const from = { x: runtime.mover.pos.x, y: runtime.mover.pos.y };
    let applied = false;

    // Apply at most ONE intent per tick. Bursty clients therefore cannot move
    // faster than 20 steps/s; excess inputs stay queued for later ticks.
    while (runtime.pending.length > 0) {
      const message = runtime.pending.shift()!;
      if (message.seq <= runtime.lastSeq) {
        continue; // stale or duplicated input
      }
      runtime.lastSeq = message.seq;
      this.applyMessage(runtime, sessionId, message);
      applied = true;
      break;
    }

    if (!applied) {
      if (runtime.targetMonsterId) {
        this.autoWalkStep(runtime, sessionId, now);
      } else if (runtime.lastIntent.kind === "path" && runtime.mover.path.length > 0) {
        // Click-to-move keeps following its path (speed-bounded by movement).
        runtime.mover = stepMover(runtime.mover, runtime.lastIntent, this.assets.grid, TICK_MS);
      } else if (runtime.lastIntent.kind === "dir" && runtime.graceTicksRemaining > 0) {
        // Packet loss must not stop the character mid-step: keep the last
        // direction for a few ticks. An explicit `none` clears the grace and
        // stops immediately.
        runtime.graceTicksRemaining--;
        runtime.mover = stepMover(runtime.mover, runtime.lastIntent, this.assets.grid, TICK_MS);
      } else {
        runtime.mover = stepMover(runtime.mover, { kind: "none" }, this.assets.grid, TICK_MS);
      }
    }

    const to = runtime.mover.pos;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const moved = dx !== 0 || dy !== 0;

    if (moved) {
      runtime.dirty = true;
      player.x = to.x;
      player.y = to.y;
      player.facing = facing4Index(facing4FromDelta(dx, dy, facing4FromIndex(player.facing)));
      player.moving = true;
    } else if (player.moving) {
      player.moving = false;
    }
    if (player.lastSeq !== runtime.lastSeq) {
      player.lastSeq = runtime.lastSeq;
    }
  }

  /** Convert a validated intent into mover state and step it once. */
  private applyMessage(runtime: PlayerRuntime, sessionId: string, message: InputMessage): void {
    // Any deliberate movement cancels click-to-attack.
    if (runtime.targetMonsterId) {
      this.clearAutoWalk(runtime, sessionId, "cancelled");
    }
    switch (message.kind) {
      case "dir":
        runtime.mover.path = [];
        runtime.graceTicksRemaining = SERVER_TICK_GRACE_TICKS;
        runtime.lastIntent = { kind: "dir", dir: message.dir as Dir8 };
        break;
      case "path": {
        // Recompute from the current position every tick: with the same
        // target and grid the client predictor reproduces this exactly during
        // reconciliation, regardless of which input got acknowledged.
        runtime.graceTicksRemaining = 0;
        const target = { x: message.x, y: message.y };
        this.applyPathIntent(runtime, target);
        runtime.lastIntent = { kind: "path" };
        break;
      }
      case "none":
        runtime.mover.path = [];
        runtime.graceTicksRemaining = 0;
        runtime.lastIntent = { kind: "none" };
        break;
    }
    runtime.mover = stepMover(runtime.mover, runtime.lastIntent, this.assets.grid, TICK_MS);
  }

  private attackRangeFor(player: PlayerState): number {
    const classId = isClassId(player.classId) ? player.classId : "warrior";
    return getClass(classId).attack.rangePx;
  }

  /** Click-to-attack: accept a live monster and switch the client to server-driven walking. */
  private setAutoWalkTarget(client: Client, monsterId: string): void {
    const runtime = this.runtimes.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    const monsterRuntime = this.monsterRuntimes.get(monsterId);
    const monster = this.state.monsters.get(monsterId);
    if (!runtime || !player || runtime.dead || runtime.warping) {
      return;
    }
    if (!monsterRuntime || !monster || monsterRuntime.hp <= 0 || monsterRuntime.ai === "return") {
      this.notifyTargetCleared(client, "target_lost");
      return;
    }
    const dx = monsterRuntime.mover.pos.x - runtime.mover.pos.x;
    const dy = monsterRuntime.mover.pos.y - runtime.mover.pos.y;
    if (dx * dx + dy * dy > AUTO_WALK_TARGET_RANGE_PX * AUTO_WALK_TARGET_RANGE_PX) {
      this.notifyTargetCleared(client, "target_lost");
      return;
    }

    const now = Date.now();
    runtime.targetMonsterId = monsterId;
    runtime.nextChaseRepathAtMs = now;
    runtime.bestTargetDistSq = Number.POSITIVE_INFINITY;
    runtime.noProgressSinceMs = now;
    runtime.emptyChasePaths = 0;
    runtime.mover.path = [];
    runtime.graceTicksRemaining = 0;
    runtime.lastIntent = { kind: "none" };
    this.safeSend(client, MSG.autoWalk, { active: true, targetMonsterId: monsterId });
  }

  /** One server-driven step toward (or attack on) the auto-walk target. */
  private autoWalkStep(runtime: PlayerRuntime, sessionId: string, now: number): void {
    const monsterId = runtime.targetMonsterId;
    if (!monsterId) {
      return;
    }
    const monsterRuntime = this.monsterRuntimes.get(monsterId);
    const monster = this.state.monsters.get(monsterId);
    const player = this.state.players.get(sessionId);
    if (!monsterRuntime || !monster || monsterRuntime.hp <= 0 || !player) {
      this.clearAutoWalk(runtime, sessionId, "target_lost");
      return;
    }

    const dx = monsterRuntime.mover.pos.x - runtime.mover.pos.x;
    const dy = monsterRuntime.mover.pos.y - runtime.mover.pos.y;
    const distanceSquared = dx * dx + dy * dy;
    const range = this.attackRangeFor(player);
    if (distanceSquared <= range * range) {
      // Standing still while attacking is progress, not a stuck chase.
      runtime.bestTargetDistSq = distanceSquared;
      runtime.noProgressSinceMs = now;
      runtime.mover.path = [];
      runtime.lastIntent = { kind: "none" };
      runtime.mover = stepMover(runtime.mover, { kind: "none" }, this.assets.grid, TICK_MS);
      if (now >= runtime.attackReadyAtMs) {
        runtime.pendingAttack = { dir: dir8Towards(runtime.mover.pos, monsterRuntime.mover.pos) };
      }
      return;
    }

    if (distanceSquared < runtime.bestTargetDistSq) {
      runtime.bestTargetDistSq = distanceSquared;
      runtime.noProgressSinceMs = now;
    } else if (now - runtime.noProgressSinceMs > AUTO_WALK_GIVE_UP_MS) {
      this.clearAutoWalk(runtime, sessionId, "unreachable");
      return;
    }

    if (now >= runtime.nextChaseRepathAtMs || runtime.mover.path.length === 0) {
      runtime.nextChaseRepathAtMs = now + 250;
      const path = findPath(this.assets.grid, runtime.mover.pos, monsterRuntime.mover.pos);
      runtime.mover.path = path;
      if (path.length === 0) {
        runtime.emptyChasePaths++;
        if (runtime.emptyChasePaths >= AUTO_WALK_MAX_EMPTY_PATHS) {
          this.clearAutoWalk(runtime, sessionId, "unreachable");
          return;
        }
      } else {
        runtime.emptyChasePaths = 0;
      }
    }

    runtime.graceTicksRemaining = 0;
    runtime.lastIntent = { kind: "path" };
    runtime.mover = stepMover(runtime.mover, { kind: "path" }, this.assets.grid, TICK_MS);
  }

  private clearAutoWalk(
    runtime: PlayerRuntime,
    sessionId: string,
    reason: TargetClearedReason,
  ): void {
    if (!runtime.targetMonsterId) {
      return;
    }
    runtime.targetMonsterId = null;
    runtime.mover.path = [];
    runtime.nextChaseRepathAtMs = 0;
    runtime.bestTargetDistSq = Number.POSITIVE_INFINITY;
    runtime.noProgressSinceMs = 0;
    runtime.emptyChasePaths = 0;
    const client = this.clients.find((candidate) => candidate.sessionId === sessionId);
    if (!client) {
      return;
    }
    this.notifyTargetCleared(client, reason);
  }

  private notifyTargetCleared(client: Client, reason: TargetClearedReason): void {
    this.safeSend(client, MSG.autoWalk, { active: false });
    this.safeSend(client, MSG.targetCleared, { reason });
  }

  /**
   * A* is bounded against hostile clients. A repeated unreachable goal is not
   * retried for a second, and a client that changes goal more than
   * PATH_RETARGET_MIN_MS apart keeps following its previous path. Legitimate
   * click-to-move repeats the same goal, so it still recomputes every tick and
   * stays bit-identical with the client predictor.
   */
  private applyPathIntent(runtime: PlayerRuntime, target: Vec2): void {
    const now = Date.now();
    const goalTx = Math.floor(target.x / TILE_SIZE);
    const goalTy = Math.floor(target.y / TILE_SIZE);
    const startTx = Math.floor(runtime.mover.pos.x / TILE_SIZE);
    const startTy = Math.floor(runtime.mover.pos.y / TILE_SIZE);
    const goalKey = `${goalTx},${goalTy}`;
    const failureKey = `${startTx},${startTy}->${goalKey}`;

    const failedUntil = runtime.failedPathUntilMs.get(failureKey);
    if (failedUntil !== undefined) {
      if (failedUntil > now) {
        return; // known unreachable; keep following the current path
      }
      runtime.failedPathUntilMs.delete(failureKey);
    }

    const retargeting = runtime.lastPathTargetKey !== goalKey;
    if (retargeting && now - runtime.lastPathRetargetAtMs < PATH_RETARGET_MIN_MS) {
      return; // retarget flood; keep the previous path
    }

    runtime.lastPathTargetKey = goalKey;
    runtime.lastPathRetargetAtMs = now;
    runtime.pathComputations++;
    const path = findPath(this.assets.grid, runtime.mover.pos, target);
    runtime.mover.path = path;

    const sameTile = startTx === goalTx && startTy === goalTy;
    if (path.length === 0 && !sameTile) {
      runtime.failedPathUntilMs.set(failureKey, now + PATH_FAILURE_CACHE_MS);
    }
    if (runtime.failedPathUntilMs.size > 32) {
      for (const [key, until] of runtime.failedPathUntilMs) {
        if (until <= now) {
          runtime.failedPathUntilMs.delete(key);
        }
      }
    }
  }

  /** Saved/reservation position when walkable, otherwise the map spawn. */
  private resolveSpawn(x: number | undefined, y: number | undefined): Vec2 {
    const requested = {
      x: Math.min(Math.max(x ?? this.assets.spawn.x, 0), this.assets.widthPx),
      y: Math.min(Math.max(y ?? this.assets.spawn.y, 0), this.assets.heightPx),
    };
    if (isWalkableAt(this.assets.grid, requested.x, requested.y)) {
      return requested;
    }
    return this.assets.spawn;
  }
}

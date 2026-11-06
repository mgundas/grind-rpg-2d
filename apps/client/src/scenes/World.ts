import Phaser from "phaser";
import {
  KINGDOMS,
  REMOTE_INTERP_DELAY_MS,
  TILE_SIZE,
  buildCollisionGrid,
  dir8FromAxes,
  dir8Towards,
  extractMapObjects,
  facing4FromDir8,
  isClassId,
  isGender,
  isWalkableAt,
  nearestWalkable,
  parseTiledMap,
  type ChatMsgPayload,
  type CollisionGrid,
  type Dir8,
  type MapId,
  type TiledMapJson,
  type Vec2,
  type WarpPayload,
} from "@jadethrone/shared";
import { getMonster } from "@jadethrone/data/monsters";
import { getClass } from "@jadethrone/data/classes";
import {
  consumeWarp,
  getPingMs,
  getRoom,
  leave,
  sendAttack,
  sendInput,
  sendSetTarget,
} from "../network/session";
import { LocalPredictor, type DesiredInput } from "../state/predictor";
import {
  RemoteRegistry,
  SampleBuffer,
  type RemoteEntity,
  type RemotePlayerData,
} from "../state/remotes";
import { MonsterRegistry, type MonsterData, type MonsterEntity } from "../state/monsterRegistry";
import { useUiStore } from "../ui/store";
import { DEFAULT_MAP, tilemapKeyFor, tilesetNameFor, tilesetTextureKeyFor } from "../world/mapKeys";
import { monsterNameColor } from "../world/levelColors";
import { ensureCharacterTexture } from "../assets/characterTextures";
import type { CharacterLook } from "../assets/characterArt";

const KEY_CHARACTER = "char.body.male";
const HOLD_TO_STEER_MS = 200;
const CLICK_MAX_MS = 200;

interface RemotePlayerState {
  name: string;
  kingdom: string;
  classId: string;
  gender: string;
  hairStyle: number;
  hairColor: number;
  level: number;
  facing: number;
  x: number;
  y: number;
  lastSeq: number;
}

interface PlayersCollection {
  forEach(callback: (player: RemotePlayerState, sessionId: string) => void): void;
  get(sessionId: string): RemotePlayerState | undefined;
}

type MonsterStateLike = MonsterData;

interface MonstersCollection {
  forEach(callback: (monster: MonsterStateLike, monsterId: string) => void): void;
}

interface RoomStateLike {
  players?: PlayersCollection;
  monsters?: MonstersCollection;
}

interface RemoteVisual {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Ellipse;
  label: Phaser.GameObjects.Text;
}

interface MonsterVisual {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Ellipse;
  label: Phaser.GameObjects.Text;
  barBackground: Phaser.GameObjects.Rectangle;
  barFill: Phaser.GameObjects.Rectangle;
}

/**
 * Real map + own-character movement (Phase 1). The local predictor runs the
 * shared deterministic step at 20 Hz, sends intents, and reconciles against
 * the authoritative `(x, y, lastSeq)` in each patch. Remote players arrive in
 * task 15.
 */
export class WorldScene extends Phaser.Scene {
  private grid!: CollisionGrid;
  private spawn!: Vec2;
  private character!: Phaser.GameObjects.Sprite;
  private shadow!: Phaser.GameObjects.Ellipse;
  private arrow!: Phaser.GameObjects.Triangle;
  private mapId: MapId = DEFAULT_MAP;

  private predictor: LocalPredictor | null = null;
  private initializedFor: string | null = null;
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;
  private wasd: Record<string, Phaser.Input.Keyboard.Key> | null = null;
  private pointerHeld = false;
  private pointerDownAt = 0;
  private pointerWorld: Vec2 | null = null;
  private pathTarget: Vec2 | null = null;
  private facing: Dir8 = 2;

  private remoteRegistry = new RemoteRegistry();
  private remoteVisuals = new Map<string, RemoteVisual>();
  private monsterRegistry = new MonsterRegistry();
  private monsterVisuals = new Map<string, MonsterVisual>();
  private ownWalkBuffer = new SampleBuffer(32);
  private lastServerPosition = { x: 0, y: 0, lastSeq: 0 };
  private autoWalkPrev = false;
  private attackReadyAtMs = 0;
  private debugAccumMs = 0;
  private warping = false;
  private mapSwitchPending = false;

  constructor() {
    super({ key: "World" });
  }

  create(): void {
    // Scene instances survive restart(); reset everything map/room-scoped.
    this.predictor = null;
    this.initializedFor = null;
    this.remoteRegistry = new RemoteRegistry();
    this.remoteVisuals.clear();
    this.monsterRegistry = new MonsterRegistry();
    this.monsterVisuals.clear();
    this.ownWalkBuffer = new SampleBuffer(32);
    this.autoWalkPrev = false;
    this.attackReadyAtMs = 0;
    this.pathTarget = null;
    this.warping = false;
    this.mapSwitchPending = false;

    this.mapId = useUiStore.getState().mapId ?? DEFAULT_MAP;
    this.buildMap();
    this.buildCharacter();
    this.setupInput();

    this.input.keyboard?.off("keydown-F3");
    this.input.keyboard?.on("keydown-F3", (event: KeyboardEvent) => {
      event.preventDefault();
      useUiStore.getState().toggleDebug();
    });

    this.input.keyboard?.off("keydown-TAB");
    this.input.keyboard?.on("keydown-TAB", (event: KeyboardEvent) => {
      if (useUiStore.getState().chatFocused) {
        return;
      }
      event.preventDefault();
      this.cycleTarget();
    });

    const keyboard = this.input.keyboard;
    this.cursors = keyboard
      ? {
          up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP, false),
          down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN, false),
          left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT, false),
          right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT, false),
          space: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE, false),
          shift: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT, false),
        }
      : null;
    // `false` = do not preventDefault: typing WASD/space in chat/name inputs
    // must reach the DOM input.
    this.wasd = keyboard
      ? (keyboard.addKeys(
          {
            up: Phaser.Input.Keyboard.KeyCodes.W,
            down: Phaser.Input.Keyboard.KeyCodes.S,
            left: Phaser.Input.Keyboard.KeyCodes.A,
            right: Phaser.Input.Keyboard.KeyCodes.D,
          },
          false,
        ) as Record<string, Phaser.Input.Keyboard.Key>)
      : null;

    this.cameras.main.fadeIn(250, 0, 0, 0);

    const cam = this.cameras.main;
    cam.setZoom(2);
    cam.setBounds(
      0,
      0,
      this.grid.width * this.grid.tileSize,
      this.grid.height * this.grid.tileSize,
    );
    cam.startFollow(this.character, true, 0.1, 0.1);
  }

  update(_time: number, delta: number): void {
    const ui = useUiStore.getState();
    const room = getRoom();
    if (ui.connectionPhase !== "connected" || !room) {
      this.setOwnVisible(false);
      if (this.predictor || this.initializedFor || this.pathTarget || this.pointerHeld) {
        this.resetSessionState();
      }
      return;
    }

    if (ui.mapId && ui.mapId !== this.mapId) {
      if (!this.mapSwitchPending) {
        this.mapSwitchPending = true;
        this.scene.restart();
      }
      return;
    }

    this.ensurePredictor();

    const autoWalk = ui.autoWalk;
    if (this.autoWalkPrev && !autoWalk && this.predictor) {
      this.predictor.resetAt(
        { x: this.lastServerPosition.x, y: this.lastServerPosition.y },
        this.lastServerPosition.lastSeq,
      );
      this.pathTarget = null;
    }
    this.autoWalkPrev = autoWalk;

    const own = (room.state as RoomStateLike).players?.get(room.sessionId);
    if (this.predictor) {
      if (this.initializedFor !== room.sessionId) {
        return; // wait for the new session's first patch
      }
      if (autoWalk) {
        const visual = this.ownWalkBuffer.sample(this.time.now - REMOTE_INTERP_DELAY_MS);
        if (visual) {
          this.character.setPosition(visual.x, visual.y);
        }
      } else {
        const desired = this.resolveInput();
        this.predictor.update(delta, desired);
        if (this.pathTarget && !this.predictor.isFollowingPath) {
          this.pathTarget = null;
        }
        const visual = this.predictor.visualPosition;
        this.character.setPosition(visual.x, visual.y);
      }
    }

    if (
      !autoWalk &&
      !ui.dead &&
      !ui.chatFocused &&
      this.cursors &&
      Phaser.Input.Keyboard.JustDown(this.cursors.space)
    ) {
      this.tryAttack(own);
    }

    this.shadow.setPosition(this.character.x, this.character.y + 6);
    this.arrow.setPosition(this.character.x, this.character.y - 58);
    this.arrow.setRotation(facingRotation(this.facing));
    this.character.setDepth(this.character.y);
    this.shadow.setDepth(this.character.y - 1);
    this.arrow.setDepth(this.character.y + 1);

    this.updateRemotes();
    this.updateMonsters();

    this.debugAccumMs += delta;
    if (this.debugAccumMs >= 250) {
      this.debugAccumMs = 0;
      this.pushDebugStats();
    }
  }

  private ensurePredictor(): void {
    const ui = useUiStore.getState();
    if (ui.connectionPhase !== "connected") {
      return;
    }
    const room = getRoom();
    if (!room) {
      return;
    }
    if (this.predictor && this.initializedFor === room.sessionId) {
      return;
    }
    const state = room.state as RoomStateLike;
    const own = state.players?.get(room.sessionId);
    if (!own) {
      return; // wait for the first patch
    }

    const sessionId = room.sessionId;
    if (this.initializedFor !== sessionId) {
      this.clearRemoteVisuals();
      this.clearMonsterVisuals();
      this.remoteRegistry = new RemoteRegistry();
      this.monsterRegistry = new MonsterRegistry();
      this.pathTarget = null;
      this.pointerHeld = false;
      this.pointerWorld = null;
      this.pointerDownAt = 0;
      this.facing = 2;
    }
    this.predictor = new LocalPredictor(this.grid, { x: own.x, y: own.y }, sendInput);
    this.initializedFor = sessionId;
    this.character.setTexture(ensureCharacterTexture(this, lookFromPlayer(own)));
    this.character.setPosition(own.x, own.y);
    this.setOwnVisible(true);
    this.syncRemotes(state, sessionId);
    this.syncMonsters(state);

    room.onStateChange((next: unknown) => {
      const snapshot = next as RoomStateLike;
      const me = snapshot.players?.get(sessionId);
      if (me) {
        this.lastServerPosition = { x: me.x, y: me.y, lastSeq: me.lastSeq };
        if (useUiStore.getState().autoWalk) {
          this.ownWalkBuffer.push(this.time.now, me.x, me.y);
        }
        this.predictor?.reconcile(me.x, me.y, me.lastSeq);
      }
      this.syncRemotes(snapshot, sessionId);
      this.syncMonsters(snapshot);
    });

    room.onMessage("chatMsg", (payload: ChatMsgPayload) => {
      useUiStore.getState().pushChat(payload);
      this.showBubble(payload.from, payload.text);
    });

    room.onMessage("warp", (payload: WarpPayload) => {
      void this.handleWarp(payload);
    });
  }

  private setOwnVisible(visible: boolean): void {
    this.character.setVisible(visible);
    this.shadow.setVisible(visible);
    this.arrow.setVisible(visible);
  }

  private tryAttack(own: RemotePlayerState | undefined): void {
    if (!own || this.time.now < this.attackReadyAtMs || this.warping) {
      return;
    }
    const classId = isClassId(own.classId) ? own.classId : "warrior";
    this.attackReadyAtMs = this.time.now + getClass(classId).attack.cooldownMs;
    sendAttack(this.facing);
    // Optimistic swing; damage feedback arrives from the server event.
    this.tweens.add({
      targets: this.character,
      scaleX: 1.12,
      scaleY: 0.94,
      duration: 60,
      yoyo: true,
    });
  }

  /** Tab cycles visible monsters by distance from the player. */
  private cycleTarget(): void {
    const now = this.time.now;
    const candidates: Array<{ id: string; distance: number }> = [];
    for (const entity of this.monsterRegistry.entities.values()) {
      const pos = this.monsterRegistry.renderPosition(entity, now);
      if (!pos) {
        continue;
      }
      const dx = pos.x - this.character.x;
      const dy = pos.y - this.character.y;
      candidates.push({ id: entity.id, distance: dx * dx + dy * dy });
    }
    if (candidates.length === 0) {
      useUiStore.getState().setTargetMonster(null);
      return;
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const current = useUiStore.getState().targetMonsterId;
    const index = candidates.findIndex((candidate) => candidate.id === current);
    useUiStore.getState().setTargetMonster(candidates[(index + 1) % candidates.length]!.id);
  }

  /** Which monster (if any) the pointer is over, using render positions. */
  private monsterAtPointer(worldX: number, worldY: number): string | null {
    const now = this.time.now;
    let bestId: string | null = null;
    let bestDistance = 24 * 24;
    for (const entity of this.monsterRegistry.entities.values()) {
      const pos = this.monsterRegistry.renderPosition(entity, now);
      if (!pos) {
        continue;
      }
      const dx = pos.x - worldX;
      const dy = pos.y - worldY;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestId = entity.id;
      }
    }
    return bestId;
  }

  private clearRemoteVisuals(): void {
    for (const visual of this.remoteVisuals.values()) {
      visual.sprite.destroy();
      visual.shadow.destroy();
      visual.label.destroy();
    }
    this.remoteVisuals.clear();
  }

  private clearMonsterVisuals(): void {
    for (const visual of this.monsterVisuals.values()) {
      visual.sprite.destroy();
      visual.shadow.destroy();
      visual.label.destroy();
      visual.barBackground.destroy();
      visual.barFill.destroy();
    }
    this.monsterVisuals.clear();
  }

  /** Forget all room-scoped input/render state (logout, kick, session change). */
  private resetSessionState(): void {
    this.predictor = null;
    this.initializedFor = null;
    this.pathTarget = null;
    this.pointerHeld = false;
    this.pointerWorld = null;
    this.pointerDownAt = 0;
    this.facing = 2;
    this.remoteRegistry = new RemoteRegistry();
    this.clearRemoteVisuals();
    this.monsterRegistry = new MonsterRegistry();
    this.clearMonsterVisuals();
    this.ownWalkBuffer = new SampleBuffer(32);
    this.autoWalkPrev = false;
    this.attackReadyAtMs = 0;
    this.setOwnVisible(false);
  }

  /** Fade out, consume the reservation, then rebuild the scene on the new map. */
  private async handleWarp(payload: WarpPayload): Promise<void> {
    if (this.warping) {
      return;
    }
    this.warping = true;

    await new Promise<void>((resolve) => {
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => resolve());
      this.cameras.main.fadeOut(250, 0, 0, 0);
    });

    try {
      await leave({ silent: true });
      await consumeWarp(payload);
      // consumeWarp sets the store's map id only after the reservation is
      // accepted; restart rebuilds the map/collision grid for that id. Mark the
      // switch first so update() does not queue a second restart.
      this.mapSwitchPending = true;
      this.scene.restart();
    } catch (error) {
      this.warping = false;
      useUiStore.getState().setConnectionError(`Warp failed: ${String(error)}`);
      useUiStore.getState().setConnectionPhase("error");
      this.cameras.main.fadeIn(250, 0, 0, 0);
    }
  }

  private showBubble(sessionId: string, text: string): void {
    const ownSession = useUiStore.getState().sessionId;
    const target =
      sessionId === ownSession
        ? this.character
        : (this.remoteVisuals.get(sessionId)?.sprite ?? null);
    if (!target) {
      return;
    }
    const bubble = this.add
      .text(target.x, target.y - 62, text, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "11px",
        color: "#f2f7f4",
        backgroundColor: "rgba(10, 14, 12, 0.78)",
        padding: { x: 6, y: 4 },
        wordWrap: { width: 160 },
      })
      .setOrigin(0.5, 1);
    bubble.setDepth(target.y + 3);
    this.tweens.add({
      targets: bubble,
      y: bubble.y - 8,
      alpha: 0,
      delay: 2800,
      duration: 900,
      onComplete: () => bubble.destroy(),
    });
  }

  private pushDebugStats(): void {
    const predictor = this.predictor;
    const ui = useUiStore.getState();
    ui.setDebugStats({
      fps: this.game.loop.actualFps,
      pingMs: getPingMs(),
      mapId: ui.mapId,
      x: predictor?.position.x ?? this.character.x,
      y: predictor?.position.y ?? this.character.y,
      lastSeq: predictor?.ackSeq ?? 0,
      snapCount: predictor?.snaps ?? 0,
      visiblePlayers: this.remoteRegistry.entities.size,
      historyLength: predictor?.pendingInputs ?? 0,
    });
  }

  /** Create/destroy remote sprites for the currently visible players. */
  private syncRemotes(snapshot: RoomStateLike, ownSessionId: string): void {
    const visible: Record<string, RemotePlayerData> = {};
    snapshot.players?.forEach((player, sessionId) => {
      visible[sessionId] = {
        name: player.name,
        kingdom: player.kingdom,
        classId: player.classId,
        gender: player.gender,
        hairStyle: player.hairStyle,
        hairColor: player.hairColor,
        facing: player.facing,
        x: player.x,
        y: player.y,
      };
    });
    const { removed } = this.remoteRegistry.sync(visible, ownSessionId, this.time.now);
    for (const sessionId of removed) {
      const visual = this.remoteVisuals.get(sessionId);
      if (visual) {
        visual.sprite.destroy();
        visual.shadow.destroy();
        visual.label.destroy();
        this.remoteVisuals.delete(sessionId);
      }
    }
    for (const entity of this.remoteRegistry.entities.values()) {
      if (!this.remoteVisuals.has(entity.sessionId)) {
        this.createRemoteVisual(entity);
      }
    }
  }

  private createRemoteVisual(entity: RemoteEntity): void {
    const pos = entity.buffer.sample(-Infinity) ?? { x: 0, y: 0 };
    const color = KINGDOMS.find((kingdom) => kingdom.id === entity.kingdom)?.color ?? "#cfd8d3";
    const shadow = this.add.ellipse(pos.x, pos.y + 6, 24, 9, 0x000000, 0.3);
    const sprite = this.add
      .sprite(pos.x, pos.y, ensureCharacterTexture(this, lookFromPlayer(entity)))
      .setOrigin(0.5, 0.85);
    const label = this.add
      .text(pos.x, pos.y - 52, entity.name, {
        fontFamily: "monospace",
        fontSize: "10px",
        color,
        stroke: "#0b0f0d",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1);
    this.remoteVisuals.set(entity.sessionId, { sprite, shadow, label });
  }

  private updateRemotes(): void {
    const now = this.time.now;
    for (const entity of this.remoteRegistry.entities.values()) {
      const visual = this.remoteVisuals.get(entity.sessionId);
      if (!visual) {
        continue;
      }
      const pos = this.remoteRegistry.renderPosition(entity, now);
      if (!pos) {
        continue;
      }
      visual.sprite.setPosition(pos.x, pos.y);
      visual.sprite.setDepth(pos.y);
      visual.shadow.setPosition(pos.x, pos.y + 6);
      visual.shadow.setDepth(pos.y - 1);
      visual.label.setPosition(pos.x, pos.y - 52);
      visual.label.setDepth(pos.y + 2);
    }
  }

  private playerLevel(snapshot: RoomStateLike): number {
    const sessionId = useUiStore.getState().sessionId;
    return sessionId ? (snapshot.players?.get(sessionId)?.level ?? 1) : 1;
  }

  private syncMonsters(snapshot: RoomStateLike): void {
    const entries: Array<[string, MonsterData]> = [];
    snapshot.monsters?.forEach((monster, monsterId) => {
      entries.push([
        monsterId,
        {
          typeId: monster.typeId,
          name: monster.name,
          level: monster.level,
          x: monster.x,
          y: monster.y,
          facing: monster.facing,
          hp: monster.hp,
          maxHp: monster.maxHp,
          moving: monster.moving,
          isBoss: monster.isBoss,
        },
      ]);
    });

    const { removed } = this.monsterRegistry.sync(entries, this.time.now);
    for (const monsterId of removed) {
      const visual = this.monsterVisuals.get(monsterId);
      if (visual) {
        visual.sprite.destroy();
        visual.shadow.destroy();
        visual.label.destroy();
        visual.barBackground.destroy();
        visual.barFill.destroy();
        this.monsterVisuals.delete(monsterId);
      }
    }

    const level = this.playerLevel(snapshot);
    for (const entity of this.monsterRegistry.entities.values()) {
      const visual = this.monsterVisuals.get(entity.id);
      if (visual) {
        visual.label.setColor(monsterNameColor(entity.level, level));
      } else {
        this.createMonsterVisual(entity, level);
      }
    }
  }

  private createMonsterVisual(entity: MonsterEntity, playerLevel: number): void {
    const spec = getMonster(entity.typeId);
    const scale = spec.isBoss
      ? 1.4
      : spec.size === "large"
        ? 1.2
        : spec.size === "small"
          ? 0.85
          : 1;
    const pos = entity.buffer.sample(-Infinity) ?? { x: 0, y: 0 };
    const textureKey = this.textures.exists(spec.spriteKey) ? spec.spriteKey : KEY_CHARACTER;
    const shadow = this.add
      .ellipse(pos.x, pos.y + 6, 24 * scale, 9 * scale, 0x000000, 0.3)
      .setDepth(pos.y - 1);
    const sprite = this.add
      .sprite(pos.x, pos.y, textureKey)
      .setOrigin(0.5, 0.85)
      .setScale(scale)
      .setDepth(pos.y);
    const label = this.add
      .text(pos.x, pos.y - 52 * scale, entity.name, {
        fontFamily: "monospace",
        fontSize: `${spec.isBoss ? 11 : 10}px`,
        color: monsterNameColor(entity.level, playerLevel),
        stroke: "#0b0f0d",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(pos.y + 3);

    const barWidth = 34 * scale;
    const barBackground = this.add
      .rectangle(pos.x, pos.y - 62 * scale, barWidth, 4, 0x0b0f0d, 0.75)
      .setOrigin(0.5, 0.5)
      .setDepth(pos.y + 2)
      .setVisible(false);
    const barFill = this.add
      .rectangle(pos.x - barWidth / 2, pos.y - 62 * scale, barWidth, 3, 0xc0392b, 1)
      .setOrigin(0, 0.5)
      .setDepth(pos.y + 2)
      .setVisible(false);

    this.monsterVisuals.set(entity.id, {
      sprite,
      shadow,
      label,
      barBackground,
      barFill,
    });
  }

  private updateMonsters(): void {
    const now = this.time.now;
    const sessionId = useUiStore.getState().sessionId;
    const level = sessionId
      ? ((getRoom()?.state as RoomStateLike | undefined)?.players?.get(sessionId)?.level ?? 1)
      : 1;

    for (const entity of this.monsterRegistry.entities.values()) {
      const visual = this.monsterVisuals.get(entity.id);
      if (!visual) {
        continue;
      }
      const pos = this.monsterRegistry.renderPosition(entity, now);
      if (!pos) {
        continue;
      }
      const spec = getMonster(entity.typeId);
      const scale = entity.isBoss
        ? 1.4
        : spec.size === "large"
          ? 1.2
          : spec.size === "small"
            ? 0.85
            : 1;
      visual.sprite.setPosition(pos.x, pos.y);
      visual.sprite.setDepth(pos.y);
      visual.shadow.setPosition(pos.x, pos.y + 6);
      visual.shadow.setDepth(pos.y - 1);
      visual.label.setPosition(pos.x, pos.y - 52 * scale);
      visual.label.setDepth(pos.y + 3);
      visual.label.setColor(monsterNameColor(entity.level, level));

      const ratio = entity.maxHp > 0 ? Math.max(0, Math.min(1, entity.hp / entity.maxHp)) : 0;
      const showBar = ratio < 1;
      const barWidth = 34 * scale;
      visual.barBackground
        .setPosition(pos.x, pos.y - 62 * scale)
        .setDepth(pos.y + 2)
        .setVisible(showBar);
      visual.barFill
        .setPosition(pos.x - barWidth / 2, pos.y - 62 * scale)
        .setDisplaySize(barWidth * ratio, 3)
        .setDepth(pos.y + 2)
        .setVisible(showBar);
    }
  }

  /** Input precedence: chat focus > WASD > hold-to-steer > click path > idle. */
  private resolveInput(): DesiredInput {
    const ui = useUiStore.getState();
    if (ui.connectionPhase !== "connected" || ui.chatFocused || this.warping) {
      return { kind: "none" };
    }

    const dx = (this.keyDown("right") ? 1 : 0) - (this.keyDown("left") ? 1 : 0);
    const dy = (this.keyDown("down") ? 1 : 0) - (this.keyDown("up") ? 1 : 0);
    const dir = dir8FromAxes(dx as -1 | 0 | 1, dy as -1 | 0 | 1);
    if (dir !== null) {
      this.pathTarget = null;
      this.facing = dir;
      return { kind: "dir", dir };
    }

    if (
      this.pointerHeld &&
      this.pointerWorld &&
      this.time.now - this.pointerDownAt >= HOLD_TO_STEER_MS &&
      this.predictor
    ) {
      const steer = dir8Towards(this.predictor.position, this.pointerWorld);
      if (steer !== null) {
        this.pathTarget = null;
        this.facing = steer;
        return { kind: "dir", dir: steer };
      }
    }

    if (this.pathTarget) {
      return { kind: "path", x: this.pathTarget.x, y: this.pathTarget.y };
    }
    return { kind: "none" };
  }

  private keyDown(name: "up" | "down" | "left" | "right"): boolean {
    const numeric = {
      up: this.cursors?.up.isDown ?? false,
      down: this.cursors?.down.isDown ?? false,
      left: this.cursors?.left.isDown ?? false,
      right: this.cursors?.right.isDown ?? false,
    }[name];
    return numeric || (this.wasd?.[name]?.isDown ?? false);
  }

  private setupInput(): void {
    // Scene restarts re-enter create(); remove the previous listeners so a
    // click is not handled twice.
    this.input.off("pointerdown");
    this.input.off("pointermove");
    this.input.off("pointerup");

    const connected = () =>
      useUiStore.getState().connectionPhase === "connected" && getRoom() !== null;

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!connected()) {
        return;
      }
      this.pointerHeld = true;
      this.pointerDownAt = this.time.now;
      this.pointerWorld = { x: pointer.worldX, y: pointer.worldY };
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.pointerHeld && connected()) {
        this.pointerWorld = { x: pointer.worldX, y: pointer.worldY };
      }
    });
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (!connected()) {
        this.pointerHeld = false;
        return;
      }
      const heldMs = this.time.now - this.pointerDownAt;
      if (this.pointerHeld && heldMs <= CLICK_MAX_MS) {
        const monsterId = this.monsterAtPointer(pointer.worldX, pointer.worldY);
        if (monsterId) {
          this.pathTarget = null;
          useUiStore.getState().setTargetMonster(monsterId);
          sendSetTarget(monsterId);
          if (this.predictor) {
            const entity = this.monsterRegistry.entities.get(monsterId);
            const pos = entity ? this.monsterRegistry.renderPosition(entity, this.time.now) : null;
            const facing = pos ? dir8Towards(this.predictor.position, pos) : null;
            if (facing !== null) {
              this.facing = facing;
            }
          }
          this.pointerHeld = false;
          return;
        }
        this.pathTarget = { x: pointer.worldX, y: pointer.worldY };
        if (this.predictor) {
          const facing = dir8Towards(this.predictor.position, this.pathTarget);
          if (facing !== null) {
            this.facing = facing;
          }
        }
      }
      this.pointerHeld = false;
    });
  }

  private buildMap(): void {
    const key = tilemapKeyFor(this.mapId);
    // Phaser's tilemap cache stores `{ format, data }`; the JSON is our source
    // of truth, parsed with the same shared schema as the server.
    const cached = this.cache.tilemap.get(key) as { data?: unknown } | undefined;
    if (!cached?.data) {
      throw new Error(`tilemap "${key}" was not preloaded`);
    }
    const tiled = parseTiledMap(cached.data);
    this.grid = buildCollisionGrid(tiled);
    const objects = extractMapObjects(tiled);
    const spawn = objects.spawn;
    this.spawn = isWalkableAt(this.grid, spawn.x, spawn.y)
      ? spawn
      : (nearestWalkable(this.grid, spawn.x, spawn.y, 10) ?? spawn);

    const map = this.add.tilemap(key);
    const tileset = map.addTilesetImage(
      tilesetNameFor(this.mapId),
      tilesetTextureKeyFor(this.mapId),
      TILE_SIZE,
      TILE_SIZE,
      0,
      0,
      1,
    );
    if (!tileset) {
      throw new Error(`tileset texture for "${this.mapId}" is missing`);
    }
    map.createLayer("ground", tileset, 0, 0)?.setDepth(0);
    // Tall decor (trees, fences) is rendered as individual images so it sorts
    // against players by its base row instead of always drawing underneath.
    this.buildSortedDecor(tiled, tilesetTextureKeyFor(this.mapId));
    map.createLayer("above", tileset, 0, 0)?.setDepth(100000);
  }

  private buildSortedDecor(tiled: TiledMapJson, textureKey: string): void {
    const layer = tiled.layers.find((candidate) => candidate.name === "decor");
    if (!layer || layer.type !== "tilelayer") {
      return;
    }
    const firstGid = tiled.tilesets[0]?.firstgid ?? 1;
    for (let ty = 0; ty < layer.height; ty++) {
      for (let tx = 0; tx < layer.width; tx++) {
        const gid = layer.data[ty * layer.width + tx]!;
        if (gid === 0) {
          continue;
        }
        const bottom = (ty + 1) * TILE_SIZE;
        const image = this.add.image(
          tx * TILE_SIZE + TILE_SIZE / 2,
          bottom,
          textureKey,
          gid - firstGid,
        );
        image.setOrigin(0.5, 1);
        image.setDepth(bottom);
      }
    }
  }

  private buildCharacter(): void {
    this.shadow = this.add.ellipse(this.spawn.x, this.spawn.y + 6, 24, 9, 0x000000, 0.3);

    this.character = this.add.sprite(this.spawn.x, this.spawn.y, KEY_CHARACTER);
    this.character.setOrigin(0.5, 0.85);

    // Small facing arrow above the head; points down at rotation 0.
    this.arrow = this.add.triangle(
      this.spawn.x,
      this.spawn.y - 58,
      0,
      0,
      10,
      0,
      5,
      7,
      0xffffff,
      0.55,
    );
    this.arrow.setRotation(facingRotation(this.facing));

    this.tweens.add({
      targets: this.character,
      scaleY: 0.94,
      scaleX: 1 + (1 - 0.94) * 0.8,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    this.character.setDepth(this.spawn.y);
    // Hidden until the authenticated character's first state patch arrives.
    this.setOwnVisible(false);
  }
}

function lookFromPlayer(player: {
  classId: string;
  gender: string;
  hairStyle: number;
  hairColor: number;
}): CharacterLook {
  return {
    classId: isClassId(player.classId) ? player.classId : "warrior",
    gender: isGender(player.gender) ? player.gender : "male",
    hairStyle: Number.isInteger(player.hairStyle) ? player.hairStyle : 0,
    hairColor: Number.isInteger(player.hairColor) ? player.hairColor : 0,
  };
}

function facingRotation(dir: Dir8): number {
  switch (facing4FromDir8(dir)) {
    case "down":
      return 0;
    case "left":
      return Math.PI / 2;
    case "right":
      return -Math.PI / 2;
    case "up":
      return Math.PI;
  }
}

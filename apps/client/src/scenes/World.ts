import Phaser from "phaser";
import {
  TILE_SIZE,
  buildCollisionGrid,
  dir8FromAxes,
  dir8Towards,
  extractMapObjects,
  facing4FromDir8,
  isWalkableAt,
  nearestWalkable,
  parseTiledMap,
  type CollisionGrid,
  type Dir8,
  type MapId,
  type Vec2,
} from "@jadethrone/shared";
import { getRoom, sendInput } from "../network/session";
import { LocalPredictor, type DesiredInput } from "../state/predictor";
import { useUiStore } from "../ui/store";
import { DEFAULT_MAP, tilemapKeyFor, tilesetNameFor, tilesetTextureKeyFor } from "../world/mapKeys";

const KEY_CHARACTER = "char.body.male";
const HOLD_TO_STEER_MS = 200;
const CLICK_MAX_MS = 200;

interface OwnPlayerState {
  x: number;
  y: number;
  lastSeq: number;
}

interface RoomStateLike {
  players?: Record<string, OwnPlayerState>;
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

  constructor() {
    super({ key: "World" });
  }

  create(): void {
    this.mapId = useUiStore.getState().mapId ?? DEFAULT_MAP;
    this.buildMap();
    this.buildCharacter();
    this.setupInput();

    this.cursors = this.input.keyboard?.createCursorKeys() ?? null;
    this.wasd =
      (this.input.keyboard?.addKeys({
        up: Phaser.Input.Keyboard.KeyCodes.W,
        down: Phaser.Input.Keyboard.KeyCodes.S,
        left: Phaser.Input.Keyboard.KeyCodes.A,
        right: Phaser.Input.Keyboard.KeyCodes.D,
      }) as Record<string, Phaser.Input.Keyboard.Key>) ?? null;

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
    this.ensurePredictor();

    if (this.predictor) {
      const desired = this.resolveInput();
      this.predictor.update(delta, desired);
      if (this.pathTarget && !this.predictor.isFollowingPath) {
        this.pathTarget = null;
      }
      const visual = this.predictor.visualPosition;
      this.character.setPosition(visual.x, visual.y);
    }

    this.shadow.setPosition(this.character.x, this.character.y + 6);
    this.arrow.setPosition(this.character.x, this.character.y - 58);
    this.arrow.setRotation(facingRotation(this.facing));
    this.character.setDepth(this.character.y);
    this.shadow.setDepth(this.character.y - 1);
    this.arrow.setDepth(this.character.y + 1);
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
    const own = state.players?.[room.sessionId];
    if (!own) {
      return; // wait for the first patch
    }

    const sessionId = room.sessionId;
    this.predictor = new LocalPredictor(this.grid, { x: own.x, y: own.y }, sendInput);
    this.initializedFor = sessionId;
    this.character.setPosition(own.x, own.y);

    room.onStateChange((next: unknown) => {
      const snapshot = next as RoomStateLike;
      const me = snapshot.players?.[sessionId];
      if (me) {
        this.predictor?.reconcile(me.x, me.y, me.lastSeq);
      }
    });
  }

  /** Input precedence: chat focus > WASD > hold-to-steer > click path > idle. */
  private resolveInput(): DesiredInput {
    const ui = useUiStore.getState();
    if (ui.chatFocused) {
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
      const steer = dir8Towards(this.predictor.visualPosition, this.pointerWorld);
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
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      this.pointerHeld = true;
      this.pointerDownAt = this.time.now;
      this.pointerWorld = { x: pointer.worldX, y: pointer.worldY };
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.pointerHeld) {
        this.pointerWorld = { x: pointer.worldX, y: pointer.worldY };
      }
    });
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      const heldMs = this.time.now - this.pointerDownAt;
      if (this.pointerHeld && heldMs <= CLICK_MAX_MS) {
        this.pathTarget = { x: pointer.worldX, y: pointer.worldY };
        if (this.predictor) {
          const facing = dir8Towards(this.predictor.visualPosition, this.pathTarget);
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
    map.createLayer("decor", tileset, 0, 0)?.setDepth(1);
    map.createLayer("above", tileset, 0, 0)?.setDepth(100000);
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
  }
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

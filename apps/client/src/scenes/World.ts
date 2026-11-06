import Phaser from "phaser";
import {
  TILE_SIZE,
  buildCollisionGrid,
  extractMapObjects,
  isWalkableAt,
  nearestWalkable,
  parseTiledMap,
  type CollisionGrid,
  type MapId,
  type Vec2,
} from "@jadethrone/shared";
import { useUiStore } from "../ui/store";
import { DEFAULT_MAP, tilemapKeyFor, tilesetNameFor, tilesetTextureKeyFor } from "../world/mapKeys";

const KEY_CHARACTER = "char.body.male";

/**
 * Real map rendering (Phase 1): ground/decor/above layers, y-sorted entities,
 * camera zoom + lerp follow. Movement/prediction/remotes arrive in tasks 14–15.
 */
export class WorldScene extends Phaser.Scene {
  private grid!: CollisionGrid;
  private spawn!: Vec2;
  private character!: Phaser.GameObjects.Sprite;
  private mapId: MapId = DEFAULT_MAP;

  constructor() {
    super({ key: "World" });
  }

  create(): void {
    this.mapId = useUiStore.getState().mapId ?? DEFAULT_MAP;
    this.buildMap();
    this.buildCharacter();

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

  update(): void {
    // Y-sort: entities lower on screen draw in front.
    this.character.setDepth(this.character.y);
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
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.3);
    shadow.fillEllipse(this.spawn.x, this.spawn.y + 6, 24, 9);

    const character = this.add.sprite(this.spawn.x, this.spawn.y, KEY_CHARACTER);
    character.setOrigin(0.5, 0.85);

    // Phase-1 placeholder facing arrow (fixed down until movement drives it).
    const arrow = this.add.graphics();
    arrow.fillStyle(0xffffff, 0.55);
    arrow.fillTriangle(
      this.spawn.x - 5,
      this.spawn.y - 62,
      this.spawn.x + 5,
      this.spawn.y - 62,
      this.spawn.x,
      this.spawn.y - 55,
    );

    this.tweens.add({
      targets: character,
      scaleY: 0.94,
      scaleX: 1 + (1 - 0.94) * 0.8,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    this.character = character;
  }
}

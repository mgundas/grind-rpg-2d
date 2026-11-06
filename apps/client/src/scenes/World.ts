import Phaser from "phaser";
import { SPAWN_POINT, TILE_SIZE } from "@jadethrone/shared";

/**
 * Phase-0 demo world (docs/plans/phase-0.md §8.5) proving the whole asset
 * chain: placeholder tileset → generated tile ground, placeholder character
 * with shadow + fixed facing arrow + idle squash-and-stretch bob, example
 * item icon, camera zoom 2 with smooth lerp follow.
 *
 * No movement, no rooms — those are Phase 1.
 */

/** Texture keys from the asset manifest (public/assets/manifest.json). */
const KEY_TILESET = "tileset.village";
const KEY_CHARACTER = "char.body.male";
const KEY_ICON = "icon.item.sword_01";

const MAP_TILES_W = 40;
const MAP_TILES_H = 30;

/** Tile indexes into the placeholder strip (grass, dirt, stone, water, wall), firstgid = 1. */
const TILE_GRASS = 1;
const TILE_DIRT = 2;
const TILE_STONE = 3;
const TILE_WATER = 4;

const PATH_ROWS_START = 14;
const PATH_ROWS_END = 15;
const PATH_COLS_START = 19;
const PATH_COLS_END = 20;
/** Water strip along the full left edge (visible at the spawn camera). */
const WATER_COL_COUNT = 2;
/** Stone courtyard under the spawn point so every required tile kind is on screen. */
const COURTYARD_ROWS_START = 7;
const COURTYARD_ROWS_END = 12;
const COURTYARD_COLS_START = 9;
const COURTYARD_COLS_END = 15;

/**
 * Grass base, water strip along the left edge, dirt path cross through the
 * middle, stone courtyard around the spawn. All four ground kinds stay in
 * view at the spawn camera (zoom 2), which the acceptance matrix requires.
 */
function buildDemoMap(): number[][] {
  const rows: number[][] = [];
  for (let y = 0; y < MAP_TILES_H; y++) {
    const row: number[] = new Array<number>(MAP_TILES_W).fill(TILE_GRASS);
    const isPathRow = y >= PATH_ROWS_START && y <= PATH_ROWS_END;
    const onCourtyardRow = y >= COURTYARD_ROWS_START && y <= COURTYARD_ROWS_END;
    for (let x = 0; x < MAP_TILES_W; x++) {
      const skippedCourtyardCorner =
        (y === COURTYARD_ROWS_START || y === COURTYARD_ROWS_END) &&
        (x === COURTYARD_COLS_START || x === COURTYARD_COLS_END);
      if (x < WATER_COL_COUNT) {
        row[x] = TILE_WATER;
      } else if (isPathRow || (x >= PATH_COLS_START && x <= PATH_COLS_END)) {
        row[x] = TILE_DIRT;
      } else if (onCourtyardRow && !skippedCourtyardCorner) {
        row[x] = TILE_STONE;
      }
    }
    rows.push(row);
  }
  return rows;
}

export class WorldScene extends Phaser.Scene {
  constructor() {
    super({ key: "World" });
  }

  create(): void {
    this.buildGround();
    const character = this.buildCharacter();
    this.buildItemIcon();

    const cam = this.cameras.main;
    cam.setZoom(2);
    cam.setBounds(0, 0, MAP_TILES_W * TILE_SIZE, MAP_TILES_H * TILE_SIZE);
    cam.startFollow(character, true, 0.08, 0.08);
  }

  private buildGround(): void {
    const map = this.make.tilemap({
      data: buildDemoMap(),
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
    });
    const tileset = map.addTilesetImage("village", KEY_TILESET, TILE_SIZE, TILE_SIZE, 0, 0, 1);
    if (!tileset) {
      throw new Error(`tileset texture ${KEY_TILESET} missing from preloaded textures`);
    }
    const layer = map.createLayer(0, tileset, 0, 0);
    if (!layer) {
      throw new Error("could not create the demo ground layer");
    }
  }

  private buildCharacter(): Phaser.GameObjects.Sprite {
    const { x: spawnX, y: spawnY } = SPAWN_POINT;

    // Soft elliptical shadow at the feet (GAME_DESIGN.md §2).
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.3);
    shadow.fillEllipse(spawnX, spawnY + 6, 24, 9);

    // 64px frame drawn with feet near the bottom; an origin at (0.5, 0.85)
    // makes spawnY the ground contact point.
    const character = this.add.sprite(spawnX, spawnY, KEY_CHARACTER);
    character.setOrigin(0.5, 0.85);

    // Phase-0 facing is fixed "down": a small triangle floating above the head.
    const arrow = this.add.graphics();
    arrow.fillStyle(0xffffff, 0.55);
    arrow.fillTriangle(spawnX - 5, spawnY - 62, spawnX + 5, spawnY - 62, spawnX, spawnY - 55);

    // Idle squash-and-stretch bob; scale only, so pixelArt rendering stays crisp.
    this.tweens.add({
      targets: character,
      scaleY: 0.94,
      scaleX: 1 + (1 - 0.94) * 0.8,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    return character;
  }

  private buildItemIcon(): void {
    this.add
      .image(SPAWN_POINT.x + 72, SPAWN_POINT.y - 40, KEY_ICON)
      .setOrigin(0.5, 0.8)
      .setScale(0.5);
  }
}

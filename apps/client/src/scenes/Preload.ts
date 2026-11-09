import Phaser from "phaser";
import villageMap from "@jadethrone/data/maps/map_ember_village.json";
import fieldsMap from "@jadethrone/data/maps/map_ember_fields.json";
import { ITEMS } from "@jadethrone/data/items";
import { TILE_SIZE } from "@jadethrone/shared";
import type { AssetManifest } from "../assets/manifest";
import { createPlaceholder } from "../assets/placeholders";
import { TILEMAP_KEYS, TILESET_TEXTURE_KEYS } from "../world/mapKeys";

/**
 * Tilesets are horizontal strips. Register one frame per tile so tall decor
 * can be rendered as individual y-sorted images in World.
 */
function ensureTilesetFrames(scene: Phaser.Scene, key: string): void {
  if (!scene.textures.exists(key)) {
    return;
  }
  const texture = scene.textures.get(key);
  const image = texture.getSourceImage();
  const columns = Math.floor(image.width / TILE_SIZE);
  for (let index = 0; index < columns; index++) {
    texture.add(index, 0, index * TILE_SIZE, 0, TILE_SIZE, TILE_SIZE);
  }
}

const TIPS = [
  "Click the ground to walk; WASD also works.",
  "Press Tab to cycle nearby monsters.",
  "Spirit stones drop upgrade materials — break them with a party.",
  "Upgrade gear at the blacksmith; +7 and above announce server-wide.",
  "Drink potions from the hotbar with 1–4.",
  "Trade face to face to move items safely.",
  "The field boss respawns on a fixed timer.",
  "Higher-level monsters give less XP; level up where the fight is fair.",
];

/**
 * Loads every manifest entry; files that exist win, files that 404 get a
 * procedural placeholder under the same key (GAME_DESIGN.md §2.1). Offers a
 * progress bar while loading.
 */
export class PreloadScene extends Phaser.Scene {
  private progressBar: Phaser.GameObjects.Graphics | null = null;
  private progressBox: Phaser.GameObjects.Graphics | null = null;
  private progressHandler: ((value: number) => void) | null = null;
  private tip: Phaser.GameObjects.Text | null = null;

  constructor() {
    super({ key: "Preload" });
  }

  preload(): void {
    const manifest = this.game.registry.get("manifest") as AssetManifest | undefined;
    if (!manifest) {
      this.scene.start("Boot");
      return;
    }

    // Seed Phaser's tilemap cache with the bundled Tiled JSON. Importing the
    // same files the server bundles guarantees the client builds the exact
    // same collision grid.
    if (!this.cache.tilemap.exists(TILEMAP_KEYS.village)) {
      this.cache.tilemap.add(TILEMAP_KEYS.village, {
        format: Phaser.Tilemaps.Formats.TILED_JSON,
        data: villageMap,
      });
    }
    if (!this.cache.tilemap.exists(TILEMAP_KEYS.fields)) {
      this.cache.tilemap.add(TILEMAP_KEYS.fields, {
        format: Phaser.Tilemaps.Formats.TILED_JSON,
        data: fieldsMap,
      });
    }

    this.buildProgressBar();

    for (const [key, entry] of Object.entries(manifest.assets)) {
      this.load.image(key, `/assets/${entry.path}`);
    }

    this.load.once("complete", () => {
      this.destroyProgressBar();
      // Guarantee every manifest key has a texture: anything that failed to
      // load (or was never registered) gets a deterministic placeholder under
      // the same key. World must never start with a missing texture.
      let placeholderCount = 0;
      for (const [key, entry] of Object.entries(manifest.assets)) {
        if (!this.textures.exists(key) && createPlaceholder(this, key, entry.placeholder)) {
          placeholderCount++;
        }
      }
      // Item icons are data-driven rather than one manifest entry per item, so
      // a new item works without touching the asset manifest.
      for (const item of ITEMS) {
        if (this.textures.exists(item.iconKey)) {
          continue;
        }
        if (
          createPlaceholder(this, item.iconKey, {
            kind: "icon",
            rarity: item.rarity,
            label: item.name.slice(0, 2).toUpperCase(),
          })
        ) {
          placeholderCount++;
        }
      }
      for (const key of TILESET_TEXTURE_KEYS) {
        ensureTilesetFrames(this, key);
      }
      this.game.registry.set("placeholderCount", placeholderCount);
      this.scene.start("World");
    });
  }

  private buildProgressBar(): void {
    const width = Math.min(320, this.scale.width - 48);
    const x = (this.scale.width - width) / 2;
    const y = this.scale.height / 2 - 14;
    this.progressBox = this.add.graphics();
    this.progressBox.fillStyle(0x101413, 0.85);
    this.progressBox.fillRect(x - 4, y - 4, width + 8, 36);
    this.progressBar = this.add.graphics();
    this.tip = this.add
      .text(
        this.scale.width / 2,
        y + 46,
        `Tip: ${TIPS[Math.floor(Math.random() * TIPS.length)]}`,
        {
          fontFamily: "system-ui, sans-serif",
          fontSize: "12px",
          color: "#7d8a84",
        },
      )
      .setOrigin(0.5, 0);
    this.progressHandler = (value: number) => {
      this.progressBar?.clear();
      this.progressBar?.fillStyle(0x5da88f, 1);
      this.progressBar?.fillRect(x, y, width * value, 28);
    };
    this.load.on("progress", this.progressHandler);
  }

  private destroyProgressBar(): void {
    this.progressBar?.destroy();
    this.tip?.destroy();
    this.tip = null;
    this.progressBox?.destroy();
    if (this.progressHandler) {
      this.load.off("progress", this.progressHandler);
      this.progressHandler = null;
    }
    this.progressBar = null;
    this.progressBox = null;
  }
}

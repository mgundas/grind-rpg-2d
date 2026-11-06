import Phaser from "phaser";
import type { AssetManifest } from "../assets/manifest";
import { createPlaceholder } from "../assets/placeholders";

/**
 * Loads every manifest entry; files that exist win, files that 404 get a
 * procedural placeholder under the same key (GAME_DESIGN.md §2.1). Offers a
 * progress bar while loading.
 */
export class PreloadScene extends Phaser.Scene {
  private progressBar: Phaser.GameObjects.Graphics | null = null;
  private progressBox: Phaser.GameObjects.Graphics | null = null;
  private progressHandler: ((value: number) => void) | null = null;

  constructor() {
    super({ key: "Preload" });
  }

  preload(): void {
    const manifest = this.game.registry.get("manifest") as AssetManifest | undefined;
    if (!manifest) {
      this.scene.start("Boot");
      return;
    }

    this.buildProgressBar();

    const failed = new Set<string>();
    const onLoadError = (file: Phaser.Loader.File) => {
      failed.add(file.key);
    };
    this.load.on("loaderror", onLoadError);

    for (const [key, entry] of Object.entries(manifest.assets)) {
      this.load.image(key, `/assets/${entry.path}`);
    }

    this.load.once("complete", () => {
      // The loader's listeners survive scene restarts; drop the one this
      // scene installed so a re-run can never accumulate duplicates.
      this.load.off("loaderror", onLoadError);
      this.destroyProgressBar();
      let placeholderCount = 0;
      for (const key of failed) {
        const entry = manifest.assets[key];
        if (entry && createPlaceholder(this, key, entry.placeholder)) {
          placeholderCount++;
        }
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
    this.progressHandler = (value: number) => {
      this.progressBar?.clear();
      this.progressBar?.fillStyle(0x5da88f, 1);
      this.progressBar?.fillRect(x, y, width * value, 28);
    };
    this.load.on("progress", this.progressHandler);
  }

  private destroyProgressBar(): void {
    this.progressBar?.destroy();
    this.progressBox?.destroy();
    if (this.progressHandler) {
      this.load.off("progress", this.progressHandler);
      this.progressHandler = null;
    }
    this.progressBar = null;
    this.progressBox = null;
  }
}

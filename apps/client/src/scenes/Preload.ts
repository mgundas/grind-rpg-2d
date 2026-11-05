import Phaser from "phaser";

/** Asset pipeline lives in the manifest/placeholder task; stub for now. */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: "Preload" });
  }

  create(): void {
    this.scene.start("World");
  }
}

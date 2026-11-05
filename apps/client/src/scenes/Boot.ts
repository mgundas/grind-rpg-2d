import Phaser from "phaser";

/**
 * Boot: log the engine version (phase-0 acceptance evidence) and continue to
 * the asset pipeline. Manifest loading arrives with the placeholder system.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "Boot" });
  }

  create(): void {
    console.info(`Jade Throne — Phaser ${Phaser.VERSION}`);
    this.scene.start("Preload");
  }
}

import Phaser from "phaser";

/** Demonstration world scene: the placeholder character lands next task. */
export class WorldScene extends Phaser.Scene {
  constructor() {
    super({ key: "World" });
  }

  create(): void {
    this.add.text(16, 16, "Jade Throne — Phase 0", {
      fontFamily: "monospace",
      fontSize: "16px",
      color: "#cfd8d3",
    });
  }
}

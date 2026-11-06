import Phaser from "phaser";
import { GAME_NAME } from "@jadethrone/shared";
import { BootScene } from "./scenes/Boot";
import { PreloadScene } from "./scenes/Preload";
import { WorldScene } from "./scenes/World";

/** Create and start the Phaser game. One instance per page lifecycle. */
export function startGame(): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    title: GAME_NAME,
    version: "0.1.0-phase1",
    pixelArt: true,
    backgroundColor: "#141a17",
    scale: {
      mode: Phaser.Scale.RESIZE,
      parent: "game-container",
      width: "100%",
      height: "100%",
    },
    scene: [BootScene, PreloadScene, WorldScene],
  });
}

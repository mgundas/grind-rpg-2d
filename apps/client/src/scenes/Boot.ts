import Phaser from "phaser";
import { GAME_NAME } from "@jadethrone/shared";
import { fetchAssetManifest } from "../assets/manifest";
import { EMPTY_AUDIO_MANIFEST, fetchAudioManifest } from "../assets/audioManifest";
import { audio } from "../audio/service";

/**
 * Boot: log the engine version (phase-0 acceptance evidence), fetch the
 * asset manifest into the game registry, continue to the load pipeline.
 * A broken manifest shows a readable error instead of a black screen.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "Boot" });
  }

  async create(): Promise<void> {
    console.info(`${GAME_NAME} — Phaser ${Phaser.VERSION}`);
    try {
      const manifest = await fetchAssetManifest();
      this.game.registry.set("manifest", manifest);
      const audioManifest = await fetchAudioManifest().catch((error: unknown) => {
        console.warn(`Audio manifest unavailable; running silent: ${String(error)}`);
        return EMPTY_AUDIO_MANIFEST;
      });
      this.game.registry.set("audioManifest", audioManifest);
      audio.setManifest(audioManifest);
      this.scene.start("Preload");
    } catch (error) {
      this.add
        .text(24, 24, `${GAME_NAME} could not start.\n\n${String(error)}`, {
          fontFamily: "monospace",
          fontSize: "14px",
          color: "#ff9a8a",
          wordWrap: { width: this.scale.width - 48 },
        })
        .setOrigin(0);
    }
  }
}

import type Phaser from "phaser";
import {
  CHARACTER_FRAME_SIZE,
  characterTextureKey,
  drawCharacter,
  type CharacterLook,
} from "./characterArt";

/**
 * Register (or reuse) a procedural character texture under the appearance key.
 * Real LPC art would use the same key from the manifest, so game code does not
 * change when art arrives.
 */
export function ensureCharacterTexture(scene: Phaser.Scene, look: CharacterLook): string {
  const key = characterTextureKey(look);
  if (scene.textures.exists(key)) {
    return key;
  }
  const canvas = document.createElement("canvas");
  canvas.width = CHARACTER_FRAME_SIZE;
  canvas.height = CHARACTER_FRAME_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return key;
  }
  drawCharacter(ctx, look);
  scene.textures.addCanvas(key, canvas);
  return key;
}

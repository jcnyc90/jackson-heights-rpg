import Phaser from 'phaser';
import { DIRECTIONS, FONT, PLAYER_FRAME, RIDER_FRAME, TEXTURES } from '../config';
import { generatePlaceholderTextures } from '../systems/placeholderArt';
import { generatePropTextures, generateRiderTexture } from '../systems/worldArt';
import { registerFont } from '../systems/font';
import { MAP_LIST, validateLinks } from '../systems/maps';

/** Loads data and the font, generates placeholder textures, registers animations, then starts the map. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    // Bundled maps go through Phaser's Tiled loader (it accepts parsed JSON). The world map is
    // external and already decoded (main.ts, mapLoader.ts); WorldView draws it.
    for (const map of MAP_LIST) if (!map.world) this.load.tilemapTiledJSON(map.id, map.data);
    // Spleen 6x12 atlas (bundled with the game, never hotlinked; see src/systems/font.ts).
    this.load.image(FONT.key, FONT.atlas);
    // Real art goes here, e.g.:
    // this.load.spritesheet(TEXTURES.player, 'assets/sprites/player.png',
    //   { frameWidth: PLAYER_FRAME.width, frameHeight: PLAYER_FRAME.height });
  }

  create(): void {
    generatePlaceholderTextures(this);
    generatePropTextures(this);
    generateRiderTexture(this);
    registerFont(this);

    // Walk cycle per direction: step A, stand, step B, stand (frame = row * columns + col).
    DIRECTIONS.forEach((dir, row) => {
      const base = row * PLAYER_FRAME.columns;
      this.anims.create({
        key: `player-walk-${dir}`,
        frames: this.anims.generateFrameNumbers(TEXTURES.player, { frames: [1, 0, 2, 0].map((c) => base + c) }),
        frameRate: 8,
        repeat: -1,
      });
      // Riding (session 6f): pedal A, coast, pedal B, coast.
      const rbase = row * RIDER_FRAME.columns;
      this.anims.create({
        key: `rider-ride-${dir}`,
        frames: this.anims.generateFrameNumbers(TEXTURES.rider, { frames: [1, 0, 2, 0].map((c) => rbase + c) }),
        frameRate: 8,
        repeat: -1,
      });
    });

    // Dev builds check every warp link up front, so a typo fails at boot, not mid-game.
    if (import.meta.env.DEV) validateLinks();
    this.scene.start('Title');
  }
}

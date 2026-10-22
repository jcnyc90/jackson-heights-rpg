import Phaser from 'phaser';
import testMap from '../data/maps/test-map.json';
import { DIRECTIONS, MAPS, PLAYER_FRAME, TEXTURES } from '../config';
import { generatePlaceholderTextures } from '../systems/placeholderArt';
import { generatePlaceholderFont } from '../systems/placeholderFont';

/** Loads data, generates placeholder textures and font, registers animations, then starts the map. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    // The map is bundled with the code; the loader accepts parsed Tiled JSON directly.
    this.load.tilemapTiledJSON(MAPS.test, testMap);
    // Real art goes here, e.g.:
    // this.load.spritesheet(TEXTURES.player, 'assets/sprites/player.png',
    //   { frameWidth: PLAYER_FRAME.width, frameHeight: PLAYER_FRAME.height });
  }

  create(): void {
    generatePlaceholderTextures(this);
    generatePlaceholderFont(this);

    // Walk cycle per direction: step A, stand, step B, stand (frame = row * columns + col).
    DIRECTIONS.forEach((dir, row) => {
      const base = row * PLAYER_FRAME.columns;
      this.anims.create({
        key: `player-walk-${dir}`,
        frames: this.anims.generateFrameNumbers(TEXTURES.player, { frames: [1, 0, 2, 0].map((c) => base + c) }),
        frameRate: 8,
        repeat: -1,
      });
    });

    this.scene.start('TestMap');
  }
}

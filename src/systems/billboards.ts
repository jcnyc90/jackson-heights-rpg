import Phaser from 'phaser';
import { FONT, TILE_SIZE } from '../config';
import worldData from '../data/world/jackson-heights.json';

export class BillboardManager {
  private scene: Phaser.Scene;
  private player: Phaser.GameObjects.Sprite;
  private billboards: { container: Phaser.GameObjects.Container; x: number; y: number }[] = [];

  constructor(scene: Phaser.Scene, player: Phaser.GameObjects.Sprite, _infoData: any) {
    this.scene = scene;
    this.player = player;

    if (worldData && worldData.businesses) {
      for (const bz of worldData.businesses) {
        if (!bz.name || !bz.tile) continue;

        const bx = bz.tile[0] * TILE_SIZE;
        const by = bz.tile[1] * TILE_SIZE - 36;

        const container = this.scene.add.container(bx, by);

        const textStr = bz.name;
        const text = this.scene.add.bitmapText(0, 0, FONT.key, textStr);
        const bounds = text.getTextBounds().local;

        const padX = 4;
        const padY = 2;
        const bg = this.scene.add.rectangle(
          bounds.width / 2,
          bounds.height / 2,
          bounds.width + padX * 2,
          bounds.height + padY * 2,
          0x000000,
          0.7
        );

        text.setOrigin(0.5);
        text.setPosition(bounds.width / 2, bounds.height / 2);

        container.add([bg, text]);
        container.setDepth(by + 100);
        container.setAlpha(0);

        this.billboards.push({ container, x: bx, y: by });
      }
    }
  }

  update() {
    const px = this.player.x;
    const py = this.player.y;
    const radius = 4 * TILE_SIZE;

    for (const b of this.billboards) {
      const dist = Phaser.Math.Distance.Between(px, py, b.x, b.y);
      if (dist <= radius) {
        b.container.setAlpha(Phaser.Math.Linear(b.container.alpha, 1, 0.1));
      } else {
        b.container.setAlpha(Phaser.Math.Linear(b.container.alpha, 0, 0.1));
      }
    }
  }
}

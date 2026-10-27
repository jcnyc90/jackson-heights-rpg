import Phaser from 'phaser';
import { BG_COLOR, FONT, GAME_WIDTH, TEXTURES } from '../config';
import { t } from '../systems/strings';
import { gameState } from '../systems/gameState';

export class TitleScene extends Phaser.Scene {
  private selection = 0;
  private options: string[] = [];
  private menuBox!: Phaser.GameObjects.Rectangle;
  // @ts-ignore
  private menuText!: Phaser.GameObjects.BitmapText;
  private cursor!: Phaser.GameObjects.Sprite;
  private skip = false;

  constructor() {
    super('Title');
  }

  init() {
    const skipParam = new URLSearchParams(location.search).has('skipTitle');
    const isTest = location.pathname.includes('/tests/browser/');
    this.skip = skipParam || isTest || (import.meta.env.DEV && new URLSearchParams(location.search).get('skipTitle') === '1');
  }

  create(): void {
    if (this.skip) {
      this.scene.start('Map');
      return;
    }

    const canContinue = gameState.load();
    this.options = canContinue ? ['Continue', 'New Game'] : ['New Game'];
    this.selection = 0;

    this.cameras.main.setBackgroundColor(BG_COLOR);

    const titleText = t('app.title');
    this.add.bitmapText(GAME_WIDTH / 2, 60, FONT.key, titleText).setOrigin(0.5);

    const boxW = 90;
    const boxH = this.options.length * FONT.lineHeight + 16;
    const boxX = (GAME_WIDTH - boxW) / 2;
    const boxY = 120;

    this.menuBox = this.add.rectangle(boxX, boxY, boxW, boxH, 0x2a1f3d).setOrigin(0);
    this.menuBox.setStrokeStyle(2, 0xfbf1c7);

    const textStr = this.options.map(opt => `  ${opt}`).join('\n');
    this.menuText = this.add.bitmapText(boxX + 10, boxY + 8, FONT.key, textStr).setOrigin(0);

    this.cursor = this.add.sprite(boxX + 10, boxY + 8 + this.selection * FONT.lineHeight, TEXTURES.textCursor).setOrigin(0);

    this.input.keyboard?.on('keydown-ArrowUp', () => this.moveSelection(-1));
    this.input.keyboard?.on('keydown-ArrowDown', () => this.moveSelection(1));
    this.input.keyboard?.on('keydown-Space', () => this.selectCurrent());
    this.input.keyboard?.on('keydown-Enter', () => this.selectCurrent());

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.x >= boxX && pointer.x <= boxX + boxW && pointer.y >= boxY && pointer.y <= boxY + boxH) {
        const index = Math.floor((pointer.y - boxY - 8) / FONT.lineHeight);
        if (index >= 0 && index < this.options.length) {
          this.selection = index;
          this.updateCursor();
          this.selectCurrent();
        }
      }
    });
  }

  private moveSelection(delta: number) {
    this.selection = (this.selection + delta + this.options.length) % this.options.length;
    this.updateCursor();
  }

  private updateCursor() {
    this.cursor.y = 120 + 8 + this.selection * FONT.lineHeight;
  }

  private selectCurrent() {
    const selected = this.options[this.selection];
    if (selected === 'New Game') {
      if (this.options.includes('Continue')) {
        const confirm = window.confirm('Overwrite existing save?');
        if (!confirm) return;
      }
      gameState.reset();
      gameState.save();
    }

    this.scene.start('Map');
  }
}

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
  private confirming = false;
  private confirmSelection = 1;

  private confirmBox!: Phaser.GameObjects.Rectangle;
  private confirmText!: Phaser.GameObjects.BitmapText;
  private confirmCursor!: Phaser.GameObjects.Sprite;

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


    const confirmW = 120;
    const confirmH = 2 * FONT.lineHeight + 16 + 12;
    const confirmX = (GAME_WIDTH - confirmW) / 2;
    const confirmY = boxY + 20;

    this.confirmBox = this.add.rectangle(confirmX, confirmY, confirmW, confirmH, 0x2a1f3d).setOrigin(0).setVisible(false);
    this.confirmBox.setStrokeStyle(2, 0xfbf1c7);

    const cTextStr = 'Overwrite?\n  Yes\n  No';
    this.confirmText = this.add.bitmapText(confirmX + 10, confirmY + 8, FONT.key, cTextStr).setOrigin(0).setVisible(false);
    this.confirmCursor = this.add.sprite(confirmX + 10, confirmY + 8 + FONT.lineHeight * (this.confirmSelection + 1), TEXTURES.textCursor).setOrigin(0).setVisible(false);

    this.input.keyboard?.on('keydown-ArrowUp', () => this.moveSelection(-1));
    this.input.keyboard?.on('keydown-ArrowDown', () => this.moveSelection(1));
    this.input.keyboard?.on('keydown-Space', () => this.selectCurrent());
    this.input.keyboard?.on('keydown-Enter', () => this.selectCurrent());

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.confirming) {
        // ... handle confirmation clicks
        const confirmW = 120;
        const confirmH = 2 * FONT.lineHeight + 16 + 12;
        const confirmX = (GAME_WIDTH - confirmW) / 2;
        const confirmY = 120 + 20;

        if (pointer.x >= confirmX && pointer.x <= confirmX + confirmW && pointer.y >= confirmY && pointer.y <= confirmY + confirmH) {
           const index = Math.floor((pointer.y - confirmY - 8 - FONT.lineHeight) / FONT.lineHeight);
           if (index >= 0 && index <= 1) {
             this.confirmSelection = index;
             this.updateCursor();
             this.selectCurrent();
           }
        }
        return;
      }
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
    if (this.confirming) {
      this.confirmSelection = (this.confirmSelection + delta + 2) % 2;
      this.updateCursor();
      return;
    }
    this.selection = (this.selection + delta + this.options.length) % this.options.length;
    this.updateCursor();
  }

  private updateCursor() {
    if (this.confirming) {
       this.confirmCursor.y = 140 + 8 + (this.confirmSelection + 1) * FONT.lineHeight;
       return;
    }
    this.cursor.y = 120 + 8 + this.selection * FONT.lineHeight;
  }

  private selectCurrent() {
    if (this.confirming) {
      if (this.confirmSelection === 0) {
        gameState.reset();
        gameState.save();
        this.scene.start('Map');
      } else {
        this.confirming = false;
        this.confirmBox.setVisible(false);
        this.confirmText.setVisible(false);
        this.confirmCursor.setVisible(false);
      }
      return;
    }
    const selected = this.options[this.selection];
    if (selected === 'New Game') {
      if (this.options.includes('Continue')) {
        this.confirming = true;
        this.confirmSelection = 1;
        this.updateCursor();
        this.confirmBox.setVisible(true);
        this.confirmText.setVisible(true);
        this.confirmCursor.setVisible(true);
        return;
      }
      gameState.reset();
      gameState.save();
    }

    this.scene.start('Map');
  }
}

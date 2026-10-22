import Phaser from 'phaser';
import { FONT, GAME_HEIGHT, GAME_WIDTH, TEXT_CHARS_PER_SECOND, TEXT_WINDOW, TEXTURES } from '../config';
import { paginate } from '../systems/textLayout';

export interface DialogueData {
  /** Already-localized text, one entry per page or more (long entries continue on the next page). */
  entries: string[];
  /** Show the window at the bottom of the screen instead of the top. */
  atBottom?: boolean;
  /** Font metrics; defaults to FONT. Lets a font preview reuse the window as-is. */
  font?: { key: string; charWidth: number; lineHeight: number };
}

/** What a press of Action did. */
export type AdvanceResult = 'completed-page' | 'next-page' | 'closed';

const CURSOR_BLINK_MS = 250;

/**
 * EarthBound-style text window with typewriter text, launched over the map scene.
 * It reads no input itself: the map scene owns Controls and forwards Action presses
 * to advance(), so one press is never seen by two scenes.
 */
export class DialogueScene extends Phaser.Scene {
  private pages: string[] = [];
  private page = 0;
  private pageMs = 0;
  private shown = 0;
  private text!: Phaser.GameObjects.BitmapText;
  private cursor!: Phaser.GameObjects.Image;

  constructor() {
    super('Dialogue');
  }

  init(data: DialogueData): void {
    const font = data.font ?? FONT;
    const charsPerLine = Math.floor((TEXT_WINDOW.width - 2 * TEXT_WINDOW.padX) / font.charWidth);
    const linesPerPage = Math.floor((TEXT_WINDOW.height - 2 * TEXT_WINDOW.padY) / font.lineHeight);
    this.pages = paginate(data.entries, charsPerLine, linesPerPage);
    if (this.pages.length === 0) this.pages = [''];
    this.page = 0;
    this.pageMs = 0;
    this.shown = 0;
  }

  create(data: DialogueData): void {
    const { margin, width, height, padX, padY } = TEXT_WINDOW;
    const x = (GAME_WIDTH - width) / 2;
    const y = data.atBottom ? GAME_HEIGHT - margin - height : margin;
    this.add.image(x, y, TEXTURES.textWindow).setOrigin(0);
    this.text = this.add.bitmapText(x + padX, y + padY, (data.font ?? FONT).key, '');
    const cursorFrame = this.textures.getFrame(TEXTURES.textCursor);
    this.cursor = this.add
      .image(x + width / 2, y + height - 4 - cursorFrame.height, TEXTURES.textCursor)
      .setOrigin(0.5, 0)
      .setVisible(false);
  }

  update(_time: number, delta: number): void {
    // Page time: drives the typewriter while typing, then the cursor blink.
    this.pageMs += delta;
    if (!this.pageComplete()) {
      const full = this.pages[this.page];
      this.shown = Math.min(full.length, Math.floor((this.pageMs * TEXT_CHARS_PER_SECOND) / 1000));
      this.text.setText(full.slice(0, this.shown));
      if (this.pageComplete()) this.pageMs = 0;
    }
    // Blink the "more" cursor once the page is fully typed.
    this.cursor.setVisible(this.pageComplete() && Math.floor(this.pageMs / CURSOR_BLINK_MS) % 2 === 0);
  }

  /** Action: finish typing the page, else turn the page, else report that the window should close. */
  advance(): AdvanceResult {
    if (!this.pageComplete()) {
      this.shown = this.pages[this.page].length;
      this.text.setText(this.pages[this.page]);
      this.pageMs = 0;
      return 'completed-page';
    }
    if (this.page < this.pages.length - 1) {
      this.page++;
      this.shown = 0;
      this.pageMs = 0;
      this.text.setText('');
      this.cursor.setVisible(false);
      return 'next-page';
    }
    return 'closed';
  }

  pageComplete(): boolean {
    return this.shown >= this.pages[this.page].length;
  }
}

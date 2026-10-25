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
  /**
   * Answers to pick from once the last page is fully shown (session 6f: "Yes" / "No"), already localized. They
   * stack in a small box at the window's right end, the first one selected; the map scene moves the selection
   * (moveChoice) and reads `choice` when Action closes the window.
   */
  choices?: string[];
}

/** What a press of Action did. */
export type AdvanceResult = 'completed-page' | 'next-page' | 'closed';

const CURSOR_BLINK_MS = 250;
/** The choice box: padding, the selection mark's width (">" and a space), gap to the text window. */
const CHOICE = { pad: 3, mark: 12, gap: 2 } as const;
// The text window's colours (placeholderArt drawWindow): dark fill, light border.
const CHOICE_COLOURS = { fill: 0x2a1f3d, border: 0xfffaf0 } as const;

/**
 * EarthBound-style text window with typewriter text, launched over the map scene.
 * It reads no input itself: the map scene owns Controls and forwards Action presses
 * to advance() (and, for a question, direction presses to moveChoice()), so one press
 * is never seen by two scenes.
 */
export class DialogueScene extends Phaser.Scene {
  private pages: string[] = [];
  private page = 0;
  private pageMs = 0;
  private shown = 0;
  private text!: Phaser.GameObjects.BitmapText;
  private cursor!: Phaser.GameObjects.Image;
  private choices: string[] = [];
  private choiceBox: (Phaser.GameObjects.Rectangle | Phaser.GameObjects.BitmapText)[] = [];
  private choiceLines: Phaser.GameObjects.BitmapText[] = [];
  private choiceMark: Phaser.GameObjects.BitmapText | null = null;
  /** The selected answer (index into DialogueData.choices). */
  choice = 0;

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
    this.choices = data.choices ?? [];
    this.choice = 0;
    this.choiceBox = [];
    this.choiceLines = [];
    this.choiceMark = null;
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
    if (this.choices.length) this.addChoiceBox(x + width, data.atBottom ? y - CHOICE.gap : y + height + CHOICE.gap, !data.atBottom, data.font ?? FONT);
  }

  /** The answers, right-aligned at `right`, above `edge` (or below it when `below`); hidden until the last page is shown. */
  private addChoiceBox(right: number, edge: number, below: boolean, font: { key: string; charWidth: number; lineHeight: number }): void {
    const w = Math.max(...this.choices.map((c) => [...c].length)) * font.charWidth + CHOICE.mark + 2 * CHOICE.pad + 2;
    const h = this.choices.length * font.lineHeight + 2 * CHOICE.pad + 2;
    const bx = right - w;
    const by = below ? edge : edge - h;
    const border = this.add.rectangle(bx, by, w, h, CHOICE_COLOURS.border).setOrigin(0);
    const fill = this.add.rectangle(bx + 1, by + 1, w - 2, h - 2, CHOICE_COLOURS.fill).setOrigin(0);
    this.choiceLines = this.choices.map((c, i) => this.add.bitmapText(bx + 1 + CHOICE.pad + CHOICE.mark, by + 1 + CHOICE.pad + i * font.lineHeight, font.key, c));
    this.choiceMark = this.add.bitmapText(bx + 1 + CHOICE.pad, by + 1 + CHOICE.pad, font.key, '>');
    this.choiceBox = [border, fill, ...this.choiceLines, this.choiceMark];
    for (const o of this.choiceBox) o.setVisible(false);
  }

  /** True while the answers are showing (the last page is fully typed). */
  choosing(): boolean {
    return this.choices.length > 0 && this.page === this.pages.length - 1 && this.pageComplete();
  }

  /** Moves the selection by `delta` answers (wraps); only while the answers show. */
  moveChoice(delta: number): void {
    if (!this.choosing() || !this.choiceMark) return;
    const n = this.choices.length;
    this.choice = (((this.choice + delta) % n) + n) % n;
    this.choiceMark.setY(this.choiceLines[this.choice].y);
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
    // Blink the "more" cursor once the page is fully typed; on a question's last page show the answers instead.
    const choosing = this.choosing();
    for (const o of this.choiceBox) o.setVisible(choosing);
    this.cursor.setVisible(!choosing && this.pageComplete() && Math.floor(this.pageMs / CURSOR_BLINK_MS) % 2 === 0);
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

import Phaser from 'phaser';
import { FONT } from '../config';

// The game font: Spleen 6x12 (BSD-2-Clause, third_party/spleen-2.2.0/), loaded from a
// fixed-cell PNG atlas that scripts/build-font-atlas.mjs generates pixel-for-pixel from
// the BDF. Glyphs sit in FONT.charWidth x FONT.lineHeight cells, CHARS_PER_ROW per row,
// in FONT_CHARS order.

/** Code point ranges in the atlas: printable ASCII, then printable Latin-1 (NBSP to ÿ). */
const FONT_RANGES: [number, number][] = [
  [0x20, 0x7e],
  [0xa0, 0xff],
];

/** Every character the font can draw, in atlas order. */
export const FONT_CHARS = FONT_RANGES.map(([a, b]) => String.fromCharCode(...Array.from({ length: b - a + 1 }, (_, i) => a + i))).join('');

export const CHARS_PER_ROW = 16;

/** Registers the loaded atlas texture (key FONT.key) as a bitmap font under the same key. */
export function registerFont(scene: Phaser.Scene): void {
  if (!scene.textures.exists(FONT.key)) throw new Error(`Font texture "${FONT.key}" not loaded`);
  registerRetroFont(scene, FONT.key, FONT.charWidth, FONT.lineHeight, CHARS_PER_ROW);
}

/** Registers a fixed-cell font texture (laid out in FONT_CHARS order) as a bitmap font. */
export function registerRetroFont(scene: Phaser.Scene, key: string, width: number, height: number, charsPerRow: number): void {
  // Parse returns the whole cache entry ({ data, texture, frame }), although Phaser's
  // typings (4.2.1) declare only the font data.
  const entry: unknown = Phaser.GameObjects.RetroFont.Parse(scene, {
    image: key,
    width,
    height,
    chars: FONT_CHARS,
    charsPerRow,
    'offset.x': 0,
    'offset.y': 0,
    'spacing.x': 0,
    'spacing.y': 0,
    lineSpacing: 0,
  });
  scene.cache.bitmapFont.add(key, entry);
}

/** True if every character of `text` (ignoring newlines) has a glyph in the font. */
export function isRenderable(text: string): boolean {
  return [...text].every((ch) => ch === '\n' || FONT_CHARS.includes(ch));
}

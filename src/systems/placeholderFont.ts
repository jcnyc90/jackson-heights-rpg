import Phaser from 'phaser';
import { FONT } from '../config';

// Placeholder bitmap font, drawn at boot like the placeholder art. Original 5x9 glyphs
// (rows 0-6 cap height, rows 7-8 descenders) in a FONT.charWidth x FONT.lineHeight cell.
// Throwaway: a licensed pixel font replaces it under the same key (DESIGN.md 2.3).

/** Printable ASCII, space through tilde: the order glyphs are laid out in the texture. */
export const FONT_CHARS = Phaser.GameObjects.RetroFont.TEXT_SET1;

const FONT_COLOR = '#fffaf0';
const CHARS_PER_ROW = 16;

// One entry per glyph: rows top to bottom separated by spaces, '#' = lit pixel.
// Trailing blank rows are omitted.
const GLYPHS: Record<string, string> = {
  ' ': '',
  '!': '..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..',
  '"': '.#.#. .#.#.',
  '#': '..... .#.#. ##### .#.#. ##### .#.#.',
  $: '..#.. .#### #.#.. .###. ..#.# ####. ..#..',
  '%': '##... ##..# ...#. ..#.. .#... #..## ...##',
  '&': '.##.. #..#. #.#.. .#... #.#.# #..#. .##.#',
  "'": '..#.. ..#..',
  '(': '...#. ..#.. .#... .#... .#... ..#.. ...#.',
  ')': '.#... ..#.. ...#. ...#. ...#. ..#.. .#...',
  '*': '..... ..#.. #.#.# .###. #.#.# ..#..',
  '+': '..... ..#.. ..#.. ##### ..#.. ..#..',
  ',': '..... ..... ..... ..... ..... .##.. ..#.. .#...',
  '-': '..... ..... ..... #####',
  '.': '..... ..... ..... ..... ..... .##.. .##..',
  '/': '....# ....# ...#. ..#.. .#... #.... #....',
  '0': '.###. #...# #..## #.#.# ##..# #...# .###.',
  '1': '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
  '2': '.###. #...# ....# ...#. ..#.. .#... #####',
  '3': '##### ...#. ..#.. ...#. ....# #...# .###.',
  '4': '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
  '5': '##### #.... ####. ....# ....# #...# .###.',
  '6': '..##. .#... #.... ####. #...# #...# .###.',
  '7': '##### ....# ...#. ..#.. .#... .#... .#...',
  '8': '.###. #...# #...# .###. #...# #...# .###.',
  '9': '.###. #...# #...# .#### ....# ...#. .##..',
  ':': '..... .##.. .##.. ..... .##.. .##..',
  ';': '..... .##.. .##.. ..... .##.. .##.. ..#.. .#...',
  '<': '...#. ..#.. .#... #.... .#... ..#.. ...#.',
  '=': '..... ..... ##### ..... #####',
  '>': '.#... ..#.. ...#. ....# ...#. ..#.. .#...',
  '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
  '@': '.###. #...# ....# .##.# #.#.# #.#.# .###.',
  A: '.###. #...# #...# ##### #...# #...# #...#',
  B: '####. #...# #...# ####. #...# #...# ####.',
  C: '.###. #...# #.... #.... #.... #...# .###.',
  D: '###.. #..#. #...# #...# #...# #..#. ###..',
  E: '##### #.... #.... ####. #.... #.... #####',
  F: '##### #.... #.... ####. #.... #.... #....',
  G: '.###. #...# #.... #.### #...# #...# .####',
  H: '#...# #...# #...# ##### #...# #...# #...#',
  I: '.###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
  J: '..### ...#. ...#. ...#. ...#. #..#. .##..',
  K: '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
  L: '#.... #.... #.... #.... #.... #.... #####',
  M: '#...# ##.## #.#.# #.#.# #...# #...# #...#',
  N: '#...# #...# ##..# #.#.# #..## #...# #...#',
  O: '.###. #...# #...# #...# #...# #...# .###.',
  P: '####. #...# #...# ####. #.... #.... #....',
  Q: '.###. #...# #...# #...# #.#.# #..#. .##.#',
  R: '####. #...# #...# ####. #.#.. #..#. #...#',
  S: '.#### #.... #.... .###. ....# ....# ####.',
  T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  U: '#...# #...# #...# #...# #...# #...# .###.',
  V: '#...# #...# #...# #...# #...# .#.#. ..#..',
  W: '#...# #...# #...# #.#.# #.#.# #.#.# .#.#.',
  X: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
  Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
  Z: '##### ....# ...#. ..#.. .#... #.... #####',
  '[': '.###. .#... .#... .#... .#... .#... .###.',
  '\\': '#.... #.... .#... ..#.. ...#. ....# ....#',
  ']': '.###. ...#. ...#. ...#. ...#. ...#. .###.',
  '^': '..#.. .#.#. #...#',
  _: '..... ..... ..... ..... ..... ..... ..... #####',
  '`': '.#... ..#..',
  a: '..... ..... .###. ....# .#### #...# .####',
  b: '#.... #.... #.##. ##..# #...# #...# ####.',
  c: '..... ..... .###. #.... #.... #...# .###.',
  d: '....# ....# .##.# #..## #...# #...# .####',
  e: '..... ..... .###. #...# ##### #.... .###.',
  f: '..##. .#..# .#... ###.. .#... .#... .#...',
  g: '..... ..... .#### #...# #...# #...# .#### ....# .###.',
  h: '#.... #.... #.##. ##..# #...# #...# #...#',
  i: '..#.. ..... .##.. ..#.. ..#.. ..#.. .###.',
  j: '...#. ..... ..##. ...#. ...#. ...#. ...#. #..#. .##..',
  k: '#.... #.... #..#. #.#.. ##... #.#.. #..#.',
  l: '.##.. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
  m: '..... ..... ##.#. #.#.# #.#.# #.#.# #.#.#',
  n: '..... ..... #.##. ##..# #...# #...# #...#',
  o: '..... ..... .###. #...# #...# #...# .###.',
  p: '..... ..... ####. #...# #...# #...# ####. #.... #....',
  q: '..... ..... .#### #...# #...# #...# .#### ....# ....#',
  r: '..... ..... #.##. ##..# #.... #.... #....',
  s: '..... ..... .#### #.... .###. ....# ####.',
  t: '.#... .#... ###.. .#... .#... .#..# ..##.',
  u: '..... ..... #...# #...# #...# #..## .##.#',
  v: '..... ..... #...# #...# #...# .#.#. ..#..',
  w: '..... ..... #...# #...# #.#.# #.#.# .#.#.',
  x: '..... ..... #...# .#.#. ..#.. .#.#. #...#',
  y: '..... ..... #...# #...# #...# #...# .#### ....# .###.',
  z: '..... ..... ##### ...#. ..#.. .#... #####',
  '{': '...## ..#.. ..#.. .#... ..#.. ..#.. ...##',
  '|': '..#.. ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  '}': '##... ..#.. ..#.. ...#. ..#.. ..#.. ##...',
  '~': '..... ..... .#... #.#.# ...#.',
};

/**
 * Draws the placeholder font texture and registers it as a bitmap font under FONT.key.
 * Skipped if the key already exists, so a real font loaded in BootScene.preload wins.
 */
export function generatePlaceholderFont(scene: Phaser.Scene): void {
  if (scene.textures.exists(FONT.key)) return;
  const { charWidth: w, lineHeight: h } = FONT;
  const rows = Math.ceil(FONT_CHARS.length / CHARS_PER_ROW);
  const tex = scene.textures.createCanvas(FONT.key, w * CHARS_PER_ROW, h * rows);
  if (!tex) throw new Error(`Could not create canvas texture "${FONT.key}"`);
  const ctx = tex.getContext();
  ctx.fillStyle = FONT_COLOR;
  [...FONT_CHARS].forEach((ch, i) => {
    const glyph = GLYPHS[ch];
    if (glyph === undefined) throw new Error(`Placeholder font has no glyph for "${ch}"`);
    const ox = (i % CHARS_PER_ROW) * w;
    const oy = Math.floor(i / CHARS_PER_ROW) * h;
    glyph.split(' ').forEach((row, y) => {
      [...row].forEach((px, x) => {
        if (px === '#') ctx.fillRect(ox + x, oy + y, 1, 1);
      });
    });
  });
  tex.refresh();
  registerRetroFont(scene, FONT.key, w, h, CHARS_PER_ROW);
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

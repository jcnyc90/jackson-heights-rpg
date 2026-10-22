// Converts the Spleen 6x12 BDF into the fixed-cell PNG atlas the game loads as its font.
// Pixel-exact: every BDF bit becomes one opaque pixel, nothing is rasterized or smoothed.
// Run after changing the character ranges (keep them in sync with FONT_RANGES in
// src/systems/font.ts; regression check N2 fails if the atlas and the BDF disagree):
//   node scripts/build-font-atlas.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

const BDF = 'third_party/spleen-2.2.0/spleen-6x12.bdf';
const OUT = 'public/assets/fonts/spleen-6x12.png';
// Printable ASCII, then the printable Latin-1 Supplement (NBSP through ÿ).
const RANGES = [[0x20, 0x7e], [0xa0, 0xff]];
const CHARS_PER_ROW = 16;
const COLOR = [0xff, 0xfa, 0xf0]; // the window's text colour (#fffaf0)

const text = readFileSync(BDF, 'utf8');
const [cellW, cellH, , cellYOff] = text.match(/FONTBOUNDINGBOX (\d+) (\d+) (-?\d+) (-?\d+)/).slice(1).map(Number);
const ascent = cellH + cellYOff;
const glyphs = new Map();
for (const m of text.matchAll(/ENCODING (\d+)[\s\S]*?BBX (\d+) (\d+) (-?\d+) (-?\d+)\s+BITMAP\s+([\s\S]*?)ENDCHAR/g)) {
  glyphs.set(Number(m[1]), { w: +m[2], h: +m[3], xo: +m[4], yo: +m[5], rows: m[6].trim().split(/\s+/) });
}

const codes = RANGES.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i));
const width = cellW * CHARS_PER_ROW;
const height = cellH * Math.ceil(codes.length / CHARS_PER_ROW);
const rgba = Buffer.alloc(width * height * 4);
codes.forEach((code, i) => {
  const g = glyphs.get(code);
  if (!g) throw new Error(`${BDF} has no glyph U+${code.toString(16).padStart(4, '0')}`);
  const ox = (i % CHARS_PER_ROW) * cellW + g.xo;
  const oy = Math.floor(i / CHARS_PER_ROW) * cellH + ascent - g.h - g.yo;
  g.rows.forEach((hex, y) => {
    const bits = BigInt(`0x${hex}`);
    const n = BigInt(hex.length * 4);
    for (let x = 0; x < g.w; x++) {
      if (!((bits >> (n - 1n - BigInt(x))) & 1n)) continue;
      const p = ((oy + y) * width + ox + x) * 4;
      rgba.set([...COLOR, 0xff], p);
    }
  });
});

// Minimal PNG writer: 8-bit RGBA, filter 0 on every row.
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr.set([8, 6, 0, 0, 0], 8);
const raw = Buffer.alloc((width * 4 + 1) * height);
for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(OUT, png);
console.log(`${OUT}: ${codes.length} glyphs, ${width}x${height}, ${png.length} bytes`);

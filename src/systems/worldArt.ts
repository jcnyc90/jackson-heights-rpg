import type Phaser from 'phaser';
import { TILE_SIZE } from '../config';
import { C, PILLAR, PLANTER, SIGNAL, pixelMap, rect, type Ctx } from './placeholderArt';
import type { WorldBuilding } from './mapLoader';

// Placeholder art for the world map (session 6e): street furniture sprites and hybrid oblique
// buildings (owner's decision 1: a tall front face, a shaded side face, a thin roof strip). All
// original, drawn with Canvas 2D from the game's palette; EarthBound is a style reference only.

/** Prop sprites, one 32x48 frame each, foot at the bottom centre; frame order = the "p-" tile names. */
export const PROP_FRAME = { width: 32, height: 48 } as const;
export const PROP_NAMES = ['p-tree', 'p-bush', 'p-lamp', 'p-hydrant', 'p-trash', 'p-bench', 'p-signal', 'p-barricade', 'p-pillar', 'p-stairs', 'p-planter', 'signpost'] as const;
export const PROPS_TEXTURE = 'props';

function disc(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, fill: string, outline: string): void {
  for (let y = -ry - 1; y <= ry + 1; y++) {
    for (let x = -rx - 1; x <= rx + 1; x++) {
      const d = (x * x) / (rx * rx) + (y * y) / (ry * ry);
      const o = (x * x) / ((rx + 1) * (rx + 1)) + (y * y) / ((ry + 1) * (ry + 1));
      if (d <= 1) rect(ctx, fill, cx + x, cy + y);
      else if (o <= 1) rect(ctx, outline, cx + x, cy + y);
    }
  }
}

const PROP_PAINTERS: Record<(typeof PROP_NAMES)[number], (ctx: Ctx) => void> = {
  'p-tree': (ctx) => {
    rect(ctx, C.outline, 13, 28, 6, 19);
    rect(ctx, C.trunk, 14, 28, 4, 18);
    disc(ctx, 16, 17, 13, 12, C.leaf, C.outline);
    disc(ctx, 12, 13, 5, 4, C.grass, C.leaf);
    for (const [x, y] of [[20, 20], [9, 21], [17, 9], [23, 14]]) rect(ctx, C.leafDark, x, y, 2, 2);
    rect(ctx, C.leafDark, 6, 26, 20, 2);
  },
  'p-bush': (ctx) => {
    disc(ctx, 16, 40, 8, 6, C.leafDark, C.outline);
    disc(ctx, 13, 38, 3, 2, C.leaf, C.leafDark);
  },
  'p-lamp': (ctx) => {
    rect(ctx, C.outline, 14, 9, 4, 38);
    rect(ctx, C.slateDark, 15, 9, 2, 37);
    rect(ctx, C.outline, 12, 43, 8, 4);
    rect(ctx, C.outline, 10, 3, 12, 7);
    rect(ctx, C.flowerYellow, 11, 6, 10, 3);
    rect(ctx, C.slateDark, 11, 4, 10, 2);
  },
  'p-hydrant': (ctx) => {
    rect(ctx, C.outline, 11, 34, 10, 13);
    rect(ctx, C.signalRed, 12, 35, 8, 11);
    rect(ctx, C.outline, 9, 38, 14, 4);
    rect(ctx, C.signalRed, 10, 39, 12, 2);
    rect(ctx, C.outline, 13, 31, 6, 4);
    rect(ctx, C.white, 13, 36, 2, 2);
  },
  'p-trash': (ctx) => {
    rect(ctx, C.outline, 10, 32, 12, 15);
    rect(ctx, C.leafDark, 11, 34, 10, 12);
    for (const x of [13, 16, 19]) rect(ctx, C.station, x, 35, 1, 10);
    rect(ctx, C.outline, 9, 31, 14, 3);
  },
  'p-bench': (ctx) => {
    rect(ctx, C.outline, 2, 32, 28, 4);
    rect(ctx, C.trunk, 3, 33, 26, 2);
    rect(ctx, C.outline, 2, 38, 28, 4);
    rect(ctx, C.trunk, 3, 39, 26, 2);
    for (const x of [4, 26]) rect(ctx, C.outline, x, 42, 2, 5);
  },
  'p-signal': (ctx) => {
    rect(ctx, C.outline, 14, 20, 4, 27);
    rect(ctx, C.slateDark, 15, 20, 2, 26);
    pixelMap(ctx, 8, 2, SIGNAL.slice(0, 10), { o: C.outline, R: C.signalRed, G: C.signalGreen });
    rect(ctx, C.outline, 12, 44, 8, 3);
  },
  'p-barricade': (ctx) => {
    rect(ctx, C.outline, 1, 33, 30, 8);
    for (let x = 2; x < 30; x++) rect(ctx, ((x >> 2) & 1) === 0 ? C.awning : C.white, x, 34, 1, 6);
    for (const x of [4, 26]) rect(ctx, C.outline, x, 41, 2, 6);
  },
  'p-pillar': (ctx) => {
    pixelMap(ctx, 8, 32, PILLAR, { o: C.outline, S: C.steelLight, s: C.steel });
    for (let y = 0; y < 32; y += 16) pixelMap(ctx, 8, y, PILLAR, { o: C.outline, S: C.steelLight, s: C.steel });
  },
  'p-stairs': (ctx) => {
    rect(ctx, C.outline, 2, 26, 28, 21);
    rect(ctx, C.station, 3, 27, 26, 4);
    rect(ctx, C.elShadowDark, 6, 31, 20, 15);
    for (let y = 33; y < 46; y += 3) rect(ctx, C.elShadow, 7, y, 18, 1);
    for (const x of [2, 27]) {
      rect(ctx, C.outline, x, 14, 3, 13);
      disc(ctx, x + 1, 12, 2, 2, C.signalGreen, C.outline);
    }
  },
  'p-planter': (ctx) => pixelMap(ctx, 8, 32, PLANTER, { o: C.outline, L: C.planter, l: C.planterDark, P: C.flowerPink, Y: C.flowerYellow, G: C.leafDark }),
  signpost: (ctx) => {
    rect(ctx, C.outline, 14, 6, 4, 41);
    rect(ctx, C.steelLight, 15, 6, 2, 40);
    rect(ctx, C.outline, 12, 44, 8, 3);
  },
};

/** Paints the prop sheet (texture PROPS_TEXTURE, one numbered frame per PROP_NAMES entry). */
export function generatePropTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists(PROPS_TEXTURE)) return;
  const { width: fw, height: fh } = PROP_FRAME;
  const tex = scene.textures.createCanvas(PROPS_TEXTURE, fw * PROP_NAMES.length, fh);
  if (!tex) throw new Error('Could not create the props texture');
  const ctx = tex.getContext();
  PROP_NAMES.forEach((name, i) => {
    ctx.save();
    ctx.translate(i * fw, 0);
    PROP_PAINTERS[name](ctx);
    ctx.restore();
    tex.add(i, 0, i * fw, 0, fw, fh);
  });
  tex.refresh();
}

// ---------------------------------------------------------------------------
// Buildings. Image = the building's rectangle in tiles. Fronting south: roof rows, then the front
// face. Fronting north (seen from behind): a 1-row lip (the north wall at a steep angle, with the
// door), the roof, then the plain back wall. Fronting west or east: roof, south face, and the street
// side as the shaded side face with the door. Corner buildings show a shaded side face too.
// ---------------------------------------------------------------------------

interface Style {
  wall: string;
  seam: string;
  shade: string;
  trim: string;
  roof: string;
  roofSeam: string;
}
const BRICK: Style = { wall: C.brick, seam: C.mortar, shade: C.mortar, trim: C.white, roof: C.roof, roofSeam: C.roofSeam };
const SIDING: Style = { wall: C.siding, seam: C.sidingSeam, shade: C.sidingSeam, trim: C.white, roof: C.roof, roofSeam: C.roofSeam };
const SLATE: Style = { wall: C.slate, seam: C.slateDark, shade: C.slateDark, trim: C.white, roof: C.roofSeam, roofSeam: C.outline };
const PEACH: Style = { wall: C.sidewalk, seam: C.sidewalkSeam, shade: C.sidewalkSeam, trim: C.white, roof: C.roof, roofSeam: C.roofSeam };
const STONE: Style = { wall: C.stone, seam: C.stoneShade, shade: C.stoneShade, trim: C.white, roof: C.elShadow, roofSeam: C.elShadowDark };
const STYLES: Record<string, Style[]> = {
  storefront: [BRICK, SIDING, PEACH, SLATE],
  walkup: [BRICK, SIDING, SLATE, PEACH],
  coop: [BRICK, BRICK, PEACH, BRICK],
  house: [SIDING, PEACH, SIDING, SLATE],
  civic: [STONE, STONE, STONE, STONE],
};
const AWNINGS = [C.awning, C.jacket, C.planter, C.marking];

/** Texture key for a building's look (shared by every building that looks the same). */
export function buildingKey(b: WorldBuilding): string {
  return `bld:${b.kind}:${b.w}x${b.h}:${b.front}${b.roof}${b.side}${b.door}:${b.deliver ? 1 : 0}:${b.variant}`;
}

/** The building's texture, painted on first use. */
export function buildingTexture(scene: Phaser.Scene, b: WorldBuilding): string {
  const key = buildingKey(b);
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, b.w * TILE_SIZE, b.h * TILE_SIZE);
  if (!tex) throw new Error(`Could not create building texture ${key}`);
  paintBuilding(tex.getContext(), b);
  tex.refresh();
  return key;
}

/** Where a storefront's sign panel is, in image pixels (the game writes its word on it), or null. */
export function signPanel(b: WorldBuilding): { x: number; y: number; width: number; height: number } | null {
  if (b.kind !== 'storefront' || b.front !== 's' || b.h - b.roof < 3) return null;
  const T = TILE_SIZE;
  const sx = b.side === 'w' ? T : 0;
  const sw = b.w * T - (b.side === '-' ? 0 : T);
  return { x: sx + 2, y: (b.h - 2) * T + 1, width: sw - 4, height: 12 };
}

function paintBuilding(ctx: Ctx, b: WorldBuilding): void {
  const T = TILE_SIZE;
  const W = b.w * T;
  const H = b.h * T;
  const st = (STYLES[b.kind] ?? STYLES.walkup)[b.variant % 4];
  const awning = AWNINGS[b.variant % AWNINGS.length];
  const door = (x: number, y: number, w = 8, h = 13) => {
    rect(ctx, C.outline, x - 1, y - 1, w + 2, h + 1);
    rect(ctx, b.deliver ? C.awning : C.trunk, x, y, w, h);
    if (b.deliver) {
      rect(ctx, C.bag, x + 1, y + 1, w - 2, h - 2);
      rect(ctx, C.outline, x + 2, y + 3, w - 4, 3);
      rect(ctx, C.white, x + 3, y + 4, w - 6, 1);
    } else rect(ctx, C.skinDark, x + w - 3, y + 6, 1, 2);
  };
  const window = (x: number, y: number, w = 6, h = 7) => {
    rect(ctx, C.outline, x - 1, y - 1, w + 2, h + 2);
    rect(ctx, C.glass, x, y, w, h);
    rect(ctx, C.white, x, y, 2, 1);
    rect(ctx, st.trim, x - 1, y + h + 1, w + 2, 1);
  };
  const roofBand = (y: number, rows: number) => {
    rect(ctx, st.roof, 0, y, W, rows * T);
    for (let ry = y + 4; ry < y + rows * T; ry += 8) rect(ctx, st.roofSeam, 0, ry, W, 1);
    if (b.kind === 'house') {
      // A pitched roof: ridge line and shingle rows.
      rect(ctx, st.roofSeam, 0, y + Math.floor((rows * T) / 2), W, 1);
      for (let ry = y + 2; ry < y + rows * T; ry += 4) for (let rx = (ry >> 2) % 2 ? 0 : 4; rx < W; rx += 8) rect(ctx, st.roofSeam, rx, ry, 1, 1);
    } else {
      // Flat roof: parapet along the edges, a vent or two.
      rect(ctx, st.roofSeam, 0, y, W, 2);
      for (let vx = 12 + (b.variant % 3) * 10; vx < W - 8; vx += 37) rect(ctx, C.outline, vx, y + 6, 5, 4);
    }
    rect(ctx, C.outline, 0, y + rows * T - 2, W, 2); // cornice
  };
  const faceWall = (y: number, h: number, colour = st.wall) => {
    rect(ctx, colour, 0, y, W, h);
    for (let ry = y + 7; ry < y + h; ry += 8) rect(ctx, st.seam, 0, ry, W, 1);
  };
  const sideFace = (x: number, y: number, h: number) => {
    rect(ctx, st.shade, x, y, T, h);
    rect(ctx, C.outline, x === 0 ? T - 1 : x, y, 1, h);
  };

  if (b.front === 's' || b.front === 'w' || b.front === 'e') {
    const fy = b.roof * T;
    const fh = H - fy;
    roofBand(0, b.roof);
    faceWall(fy, fh);
    const cols = [...Array(b.w).keys()].filter((c) => !(b.side === 'w' && c === 0) && !(b.side === 'e' && c === b.w - 1));
    const floors = Math.floor(fh / T);
    if (b.front === 's') {
      // Upper floors: a window per column.
      for (let f = 0; f < floors - 1; f++) {
        if (b.kind === 'storefront' && f === floors - 2) continue; // the sign panel row
        for (const c of cols) window(c * T + 5, fy + f * T + 4);
      }
      const gy = H - T; // ground floor
      if (b.kind === 'storefront') {
        const p = signPanel(b);
        if (p) { rect(ctx, C.outline, p.x - 1, p.y - 1, p.width + 2, p.height + 2); rect(ctx, C.signPlate, p.x, p.y, p.width, p.height); }
        // Striped awning over the shop window.
        for (const c of cols) for (let x = 0; x < T; x += 4) rect(ctx, x % 8 ? C.white : awning, c * T + x, gy - 2, 4, 5);
        rect(ctx, C.outline, cols[0] * T, gy + 3, cols.length * T, 1);
        for (const c of cols) if (c !== b.door) { rect(ctx, C.outline, c * T + 1, gy + 5, 14, 11); rect(ctx, C.glass, c * T + 2, gy + 6, 12, 9); rect(ctx, C.white, c * T + 2, gy + 6, 3, 1); }
      } else if (b.kind === 'civic') {
        // Pilasters and wide steps, no name.
        for (let x = 4; x < W - 4; x += 12) rect(ctx, C.white, x, fy + 3, 3, fh - 8);
        rect(ctx, C.stoneShade, 0, H - 4, W, 4);
        for (const c of cols) if (Math.abs(c - b.door) > 0) window(c * T + 5, gy + 3);
      } else {
        for (const c of cols) if (c !== b.door) window(c * T + 5, gy + 3);
        if (b.kind !== 'house') rect(ctx, st.trim, b.door * T + 2, H - 3, 12, 3); // stoop
      }
      if (b.door >= 0) door(b.door * T + 4, H - 14);
    } else {
      for (let f = 0; f < floors; f++) for (const c of cols) if (f > 0 || b.kind !== 'storefront') window(c * T + 5, fy + f * T + 4);
    }
    // The side face: shaded; it is the frontage (door, awning) when the building fronts that street.
    for (const s of ['w', 'e'] as const) {
      if (b.side !== s) continue;
      const x = s === 'w' ? 0 : W - T;
      sideFace(x, fy, fh);
      if (b.front === s) {
        for (let f = 0; f < floors - 1; f++) window(x + 5, fy + f * T + 4, 6, 6);
        if (b.kind === 'storefront') for (let y = fy; y < H; y += 4) rect(ctx, (y >> 2) % 2 ? C.white : awning, s === 'w' ? 0 : W - 3, y, 3, 4);
        if (b.door >= 0) door(x + 4, Math.min(H - 14, (b.door + 1) * T - 14));
      } else for (let f = 0; f < floors; f++) window(x + 6, fy + f * T + 5, 4, 5);
    }
  } else {
    // Fronting north, seen from behind: lip with the door, roof, back wall.
    faceWall(0, T, st.wall);
    rect(ctx, C.outline, 0, 0, W, 1);
    if (b.kind === 'storefront') for (let x = 0; x < W; x += 4) rect(ctx, x % 8 ? C.white : awning, x, 12, 4, 3);
    for (let c = 0; c < b.w; c++) if (c !== b.door) rect(ctx, C.glass, c * T + 5, 4, 6, 5);
    if (b.door >= 0) door(b.door * T + 4, 2, 8, 12);
    roofBand(T, b.roof);
    const by = (1 + b.roof) * T;
    faceWall(by, H - by, st.shade);
    for (let f = 0; f < Math.floor((H - by) / T); f++) for (let c = 0; c < b.w; c++) rect(ctx, C.elShadowDark, c * T + 6, by + f * T + 5, 4, 5);
    for (const s of ['w', 'e'] as const) if (b.side === s) sideFace(s === 'w' ? 0 : W - T, by, H - by);
  }
  // Outline around the whole image.
  rect(ctx, C.outline, 0, 0, 1, H);
  rect(ctx, C.outline, W - 1, 0, 1, H);
  rect(ctx, C.outline, 0, H - 1, W, 1);
}

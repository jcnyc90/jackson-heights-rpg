import type Phaser from 'phaser';
import tileIds from '../data/tiles.json';
import { DIRECTIONS, NPC_FRAME, PLAYER_FRAME, TEXT_WINDOW, TEXTURES, TILE_SIZE, type Direction } from '../config';

// Placeholder art drawn with Canvas 2D at boot. Throwaway by design: real art replaces
// it by loading files under the same texture keys (see generatePlaceholderTextures).

export type Ctx = CanvasRenderingContext2D;

// EarthBound-ish pastels with a chunky dark outline colour.
export const C = {
  outline: '#2a1f3d',
  grass: '#a6e3a1',
  grassDark: '#7fc98a',
  sidewalk: '#f6dccb',
  sidewalkSeam: '#dcb9a8',
  // Light grey asphalt (session 6d), with darker specks; curbs and lines on top.
  road: '#c9c9cf',
  roadDark: '#b3b3bb',
  curb: '#8f8794',
  curbLight: '#fff4ea',
  marking: '#ffd46e',
  elShadow: '#a7a6b3',
  elShadowDark: '#97969f',
  steel: '#6f8aa0',
  steelLight: '#9fb8cb',
  plaza: '#f3dfb6',
  plazaSeam: '#ddc394',
  paseo: '#e7d9f2',
  paseoSeam: '#cdb8de',
  roof: '#a99bc4',
  roofSeam: '#9384b0',
  awning: '#ff8f7a',
  siding: '#f6e3a8',
  sidingSeam: '#dcc483',
  signalRed: '#ff5d5d',
  signalGreen: '#7ee08a',
  station: '#58b07f',
  brick: '#ef9f95',
  mortar: '#cf7f7a',
  glass: '#b5e3f5',
  leaf: '#7dd3a0',
  leafDark: '#58b07f',
  trunk: '#b07c62',
  planter: '#c7a6e6',
  planterDark: '#a585c6',
  flowerPink: '#ff9fc6',
  flowerYellow: '#ffe28a',
  water: '#94d8f5',
  waterLight: '#e0f6ff',
  white: '#fffaf0',
  skin: '#c98d63',
  skinLight: '#f0c39a',
  skinDark: '#8a5a3c',
  hair: '#3b2a2a',
  cap: '#ff8f7a',
  jacket: '#6fcfc4',
  pants: '#6a76b8',
  bag: '#ffd46e',
  slate: '#9a98c2',
  slateDark: '#86849f',
  // Session 6e: civic stone (also the HUD's light grey and el grey).
  stone: '#d9d9df',
  stoneShade: '#9f9fb4',
  signPlate: '#2f6b4f',
} as const;

export function rect(ctx: Ctx, color: string, x: number, y: number, w = 1, h = 1): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** One string per row, one char per pixel; chars missing from the palette are transparent. */
export function pixelMap(ctx: Ctx, ox: number, oy: number, rows: string[], palette: Record<string, string>): void {
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const color = palette[ch];
      if (color) rect(ctx, color, ox + x, oy + y);
    });
  });
}

// ---------------------------------------------------------------------------
// Tileset: 16x16 tiles, TILESET_COLUMNS wide. Index = Tiled tile id (gid - firstgid), in the
// order of src/data/tiles.json, which also lists the tiles that collide (the generator copies
// that into each map's tileset). Ids 0-7 are the session 1 set the test map uses:
//   0 grass   1 sidewalk   2 road    3 road marking
//   4 wall    5 tree       6 planter 7 water
// Session 6d appends the street set (curbs, lane lines, crosswalks, the el, signals, plazas,
// roofs and building fronts). Adding a tile? Add its name to tiles.json and a painter here,
// then re-export public/assets/tilesets/tiles.png (DESIGN.md 2.4).
//
// Overhead tileset (texture `overhead`, Tiled tileset "overhead"): tiles that draw over
// sprites, used only in a map's "above" layer and never colliding.
//   0 tree canopy (top half of TREE)
// ---------------------------------------------------------------------------

const TILESET_COLUMNS = 4;

// A tree is two tiles tall: the top half is the canopy, drawn in the "above" layer over
// sprites (overhead tile 0); the bottom half is tile 5 in "obstacles" (lower crown + trunk).
const TREE = [
  '................',
  '................',
  '.....oooooo.....',
  '...ooGGGGGGoo...',
  '..oGGGGgGGGGGo..',
  '.oGGgGGGGGGgGGo.',
  '.oGGGGGGGgGGGGo.',
  'oGGGGGgGGGGGGGGo',
  'oGgGGGGGGGGGgGGo',
  'oGGGGGGGGgGGGGgo',
  'oGGGgGGGGGGGGGGo',
  'oGGGGGGGgGGGgGGo',
  'oGgGGGGGGGGGGGGo',
  'oGGGGGgGGGGgGGGo',
  'oGGGGGGGGGGGGGgo',
  'oGgGGGGgGGGGGGGo',
  // ---- tile boundary: canopy above, trunk tile below
  'oGGGGGGGGGgGGGGo',
  'oGGgGGGGGGGGGgGo',
  '.oGGGGGgGGGGGGo.',
  '.ogGGGGGGGGgGgo.',
  '..oggGGGGGGggo..',
  '...ooggggggoo...',
  '.....ooTToo.....',
  '......oTTo......',
  '......oTTo......',
  '......oTTo......',
  '......oTTo......',
  '......oTTo......',
  '......oTTo......',
  '......oTTo......',
  '.....oTTTTo.....',
  '.....oooooo.....',
];
const TREE_COLORS = { o: C.outline, G: C.leaf, g: C.leafDark, T: C.trunk };

export const PLANTER = [
  '................',
  '................',
  '................',
  '...oo..oo..oo...',
  '..oPPooYYooPPo..',
  '..oPPGoYYGoPPo..',
  '..ooGGGGGGGGoo..',
  '.oooooooooooooo.',
  '.oLLLLLLLLLLLLo.',
  '.oLllllllllllLo.',
  '.oLLLLLLLLLLLLo.',
  '.oLllllllllllLo.',
  '.oLLLLLLLLLLLLo.',
  '.oooooooooooooo.',
  '................',
  '................',
];

const EMOTE = [
  '.oooooooo.',
  'oWWWooWWWo',
  'oWWWooWWWo',
  'oWWWooWWWo',
  'oWWWooWWWo',
  'oWWWWWWWWo',
  'oWWWooWWWo',
  '.oooooooo.',
  '...oWo....',
  '...oo.....',
];

// A traffic signal on the corner: a dark pole, its head with a red and a green lamp.
export const SIGNAL = [
  '................',
  '......oooo......',
  '.....oRRRRo.....',
  '.....oRooRo.....',
  '.....oRRRRo.....',
  '.....oGGGGo.....',
  '.....oGooGo.....',
  '.....oGGGGo.....',
  '......oooo......',
  '.......oo.......',
  '.......oo.......',
  '.......oo.......',
  '.......oo.......',
  '......oooo......',
  '.....oooooo.....',
  '................',
];

// Steel column of the elevated 7, on the shadowed roadway.
export const PILLAR = [
  '...oooooooooo...',
  '...oSSssssSSo...',
  '....oSssssSo....',
  '....oSssssSo....',
  '....oSssssSo....',
  '....oSssssSo....',
  '....oSssssSo....',
  '....oSssssSo....',
  '....oSssssSo....',
  '....oSssssSo....',
  '....oSssssSo....',
  '....oSssssSo....',
  '...oSSssssSSo...',
  '..oSSSSSSSSSSo..',
  '..oooooooooooo..',
  '................',
];

// Subway stairs under a green station globe (a plain placeholder: stairs, no signage text).
const STATION = [
  'oooooooooooooooo',
  'oWWWWWWWWWWWWWWo',
  'oWooooooooooooWo',
  'oWoGGGGGGGGGGoWo',
  'oWoGGGGGGGGGGoWo',
  'oWooooooooooooWo',
  'oWWWWWWWWWWWWWWo',
  'oossssssssssssoo',
  'ooSSSSSSSSSSSSoo',
  'oossssssssssssoo',
  'ooSSSSSSSSSSSSoo',
  'oossssssssssssoo',
  'ooSSSSSSSSSSSSoo',
  'oossssssssssssoo',
  'ooSSSSSSSSSSSSoo',
  'oooooooooooooooo',
];

type Painter = (ctx: Ctx, x: number, y: number) => void;

/** Sidewalk paving with a curb on each named side (the side that meets the road). */
function curb(...sides: ('n' | 's' | 'e' | 'w')[]): Painter {
  return (ctx, x, y) => {
    paintSidewalk(ctx, x, y);
    for (const side of sides) {
      // A 2px dark curb face with a 1px light lip on the sidewalk side.
      if (side === 'n') { rect(ctx, C.curb, x, y, 16, 2); rect(ctx, C.curbLight, x, y + 2, 16, 1); }
      if (side === 's') { rect(ctx, C.curb, x, y + 14, 16, 2); rect(ctx, C.curbLight, x, y + 13, 16, 1); }
      if (side === 'w') { rect(ctx, C.curb, x, y, 2, 16); rect(ctx, C.curbLight, x + 2, y, 1, 16); }
      if (side === 'e') { rect(ctx, C.curb, x + 14, y, 2, 16); rect(ctx, C.curbLight, x + 13, y, 1, 16); }
    }
    // Where two curbs meet, the corner pixels stay curb.
    if (sides.includes('n') && sides.includes('w')) rect(ctx, C.curb, x, y, 3, 3);
    if (sides.includes('n') && sides.includes('e')) rect(ctx, C.curb, x + 13, y, 3, 3);
    if (sides.includes('s') && sides.includes('w')) rect(ctx, C.curb, x, y + 13, 3, 3);
    if (sides.includes('s') && sides.includes('e')) rect(ctx, C.curb, x + 13, y + 13, 3, 3);
  };
}

const TILE_PAINTERS: Record<string, Painter> = {
  grass: (ctx, x, y) => {
    rect(ctx, C.grass, x, y, 16, 16);
    for (const [tx, ty] of [[3, 4], [10, 10], [12, 2], [2, 12]]) {
      rect(ctx, C.grassDark, x + tx, y + ty);
      rect(ctx, C.grassDark, x + tx + 1, y + ty - 1);
      rect(ctx, C.grassDark, x + tx + 2, y + ty);
    }
  },
  sidewalk: (ctx, x, y) => paintSidewalk(ctx, x, y),
  road: (ctx, x, y) => paintRoad(ctx, x, y),
  'road-marking': (ctx, x, y) => {
    paintRoad(ctx, x, y);
    rect(ctx, C.white, x + 2, y + 7, 12, 2);
  },
  // Brick facade with a window.
  wall: (ctx, x, y) => {
    rect(ctx, C.brick, x, y, 16, 16);
    for (const row of [3, 7, 11, 15]) rect(ctx, C.mortar, x, y + row, 16, 1);
    for (const [mx, my] of [[7, 0], [3, 4], [11, 4], [7, 8], [3, 12], [11, 12]]) {
      rect(ctx, C.mortar, x + mx, y + my, 1, 3);
    }
    rect(ctx, C.outline, x + 4, y + 4, 8, 7);
    rect(ctx, C.glass, x + 5, y + 5, 6, 5);
    rect(ctx, C.white, x + 5, y + 5, 2, 1);
  },
  // Trunk and lower crown; the canopy is overhead tile 0.
  tree: (ctx, x, y) => pixelMap(ctx, x, y, TREE.slice(TILE_SIZE), TREE_COLORS),
  planter: (ctx, x, y) =>
    pixelMap(ctx, x, y, PLANTER, { o: C.outline, L: C.planter, l: C.planterDark, P: C.flowerPink, Y: C.flowerYellow, G: C.leafDark }),
  water: (ctx, x, y) => {
    rect(ctx, C.water, x, y, 16, 16);
    rect(ctx, C.waterLight, x + 2, y + 3, 4, 1);
    rect(ctx, C.waterLight, x + 9, y + 8, 5, 1);
    rect(ctx, C.waterLight, x + 4, y + 12, 4, 1);
  },
  'curb-n': curb('n'),
  'curb-s': curb('s'),
  'curb-e': curb('e'),
  'curb-w': curb('w'),
  'curb-ne': curb('n', 'e'),
  'curb-nw': curb('n', 'w'),
  'curb-se': curb('s', 'e'),
  'curb-sw': curb('s', 'w'),
  // Double yellow centre line along the tile's north or south edge (the centre of an avenue
  // falls on a tile boundary, so each half is drawn on the tile beside it).
  'center-line-n': (ctx, x, y) => { paintRoad(ctx, x, y); rect(ctx, C.marking, x, y, 16, 1); rect(ctx, C.marking, x, y + 2, 16, 1); },
  'center-line-s': (ctx, x, y) => { paintRoad(ctx, x, y); rect(ctx, C.marking, x, y + 13, 16, 1); rect(ctx, C.marking, x, y + 15, 16, 1); },
  // White lane dashes (8px on, 8px off) along the north or south edge.
  'lane-dash-n': (ctx, x, y) => { paintRoad(ctx, x, y); rect(ctx, C.white, x + 4, y, 8, 1); },
  'lane-dash-s': (ctx, x, y) => { paintRoad(ctx, x, y); rect(ctx, C.white, x + 4, y + 15, 8, 1); },
  // Zebra stripes run along the traffic: walking north-south across an east-west road you
  // cross horizontal bars; walking east-west across a north-south road, vertical bars.
  'crosswalk-ns': (ctx, x, y) => { paintRoad(ctx, x, y); for (const by of [1, 6, 11]) rect(ctx, C.white, x + 1, y + by, 14, 3); },
  'crosswalk-ew': (ctx, x, y) => { paintRoad(ctx, x, y); for (const bx of [1, 6, 11]) rect(ctx, C.white, x + bx, y + 1, 3, 14); },
  // Roadway in the shadow of the elevated tracks: darker, with the cross-ties' shadow.
  'el-shadow': (ctx, x, y) => {
    rect(ctx, C.elShadow, x, y, 16, 16);
    for (const ty of [2, 7, 12]) rect(ctx, C.elShadowDark, x, y + ty, 16, 2);
  },
  'el-pillar': (ctx, x, y) => {
    rect(ctx, C.elShadow, x, y, 16, 16);
    for (const ty of [2, 7, 12]) rect(ctx, C.elShadowDark, x, y + ty, 16, 2);
    pixelMap(ctx, x, y, PILLAR, { o: C.outline, S: C.steelLight, s: C.steel });
  },
  signal: (ctx, x, y) => {
    paintSidewalk(ctx, x, y);
    pixelMap(ctx, x, y, SIGNAL, { o: C.outline, R: C.signalRed, G: C.signalGreen });
  },
  // Plaza pavers (Diversity Plaza, the 78th Street Plaza): a warm checker, no curb.
  plaza: (ctx, x, y) => {
    rect(ctx, C.plaza, x, y, 16, 16);
    rect(ctx, C.plazaSeam, x, y + 7, 16, 1);
    rect(ctx, C.plazaSeam, x, y + 15, 16, 1);
    rect(ctx, C.plazaSeam, x + 7, y, 1, 8);
    rect(ctx, C.plazaSeam, x + 15, y + 8, 1, 8);
  },
  // Roof of a building block, seen from above.
  roof: (ctx, x, y) => {
    rect(ctx, C.roof, x, y, 16, 16);
    for (const ry of [4, 12]) rect(ctx, C.roofSeam, x, y + ry, 16, 1);
    rect(ctx, C.roofSeam, x + 8, y + 2, 1, 1);
    rect(ctx, C.roofSeam, x + 3, y + 9, 1, 1);
  },
  station: (ctx, x, y) => pixelMap(ctx, x, y, STATION, { o: C.outline, W: C.white, G: C.station, S: C.elShadow, s: C.elShadowDark }),
  // Shop front: striped awning over a window and a door.
  storefront: (ctx, x, y) => {
    rect(ctx, C.brick, x, y, 16, 16);
    for (let i = 0; i < 16; i += 4) rect(ctx, C.awning, x + i, y, 2, 5);
    for (let i = 2; i < 16; i += 4) rect(ctx, C.white, x + i, y, 2, 5);
    rect(ctx, C.outline, x, y + 5, 16, 1);
    rect(ctx, C.outline, x + 1, y + 7, 9, 8);
    rect(ctx, C.glass, x + 2, y + 8, 7, 6);
    rect(ctx, C.white, x + 2, y + 8, 2, 1);
    rect(ctx, C.outline, x + 11, y + 7, 4, 9);
    rect(ctx, C.trunk, x + 12, y + 8, 2, 8);
  },
  // Generic residential front (siding and two windows). No house numbers, ever.
  house: (ctx, x, y) => {
    rect(ctx, C.siding, x, y, 16, 16);
    for (const ry of [3, 7, 11, 15]) rect(ctx, C.sidingSeam, x, y + ry, 16, 1);
    for (const wx of [2, 9]) {
      rect(ctx, C.outline, x + wx, y + 4, 5, 6);
      rect(ctx, C.glass, x + wx + 1, y + 5, 3, 4);
    }
  },
  // Roof whose edge faces a street to the north (3/4 view: the front shows on the south side).
  'roof-edge': (ctx, x, y) => {
    rect(ctx, C.roof, x, y, 16, 16);
    rect(ctx, C.outline, x, y, 16, 2);
    rect(ctx, C.roofSeam, x, y + 2, 16, 1);
    rect(ctx, C.roofSeam, x, y + 10, 16, 1);
  },
  // Paseo Park (the 34th Avenue Open Street): lavender pavers in a running bond.
  paseo: (ctx, x, y) => {
    rect(ctx, C.paseo, x, y, 16, 16);
    rect(ctx, C.paseoSeam, x, y + 7, 16, 1);
    rect(ctx, C.paseoSeam, x, y + 15, 16, 1);
    rect(ctx, C.paseoSeam, x + 3, y, 1, 7);
    rect(ctx, C.paseoSeam, x + 11, y + 8, 1, 7);
  },
  // ---- session 6e: parks, the grassy paseo, lots, yards; collision; prop markers (Tiled view only) ----
  lawn: (ctx, x, y) => paintLawn(ctx, x, y, C.grass, C.grassDark),
  'lawn-dark': (ctx, x, y) => paintLawn(ctx, x, y, C.grassDark, C.leafDark),
  // Owner's decision 9: the paseo is grass (a game deviation: it is asphalt with planters).
  'paseo-grass': (ctx, x, y) => {
    paintLawn(ctx, x, y, C.grass, C.grassDark);
    rect(ctx, C.leaf, x + 7, y + 7, 2, 2);
  },
  // Green painted bike lane with a white edge line every other tile and a chevron.
  'bike-lane': (ctx, x, y) => {
    rect(ctx, C.leafDark, x, y, 16, 16);
    rect(ctx, C.station, x + 2, y + 3, 1, 1);
    rect(ctx, C.white, x + 6, y + 6, 4, 1);
    rect(ctx, C.white, x + 7, y + 7, 2, 1);
  },
  'park-path': (ctx, x, y) => {
    rect(ctx, C.plaza, x, y, 16, 16);
    for (const [px, py] of [[3, 3], [11, 6], [6, 12], [13, 13]]) rect(ctx, C.plazaSeam, x + px, y + py);
  },
  // Parking lot asphalt, and the same with a white stall line.
  lot: (ctx, x, y) => {
    rect(ctx, C.roadDark, x, y, 16, 16);
    for (const [px, py] of [[4, 5], [11, 12], [13, 3], [1, 14]]) rect(ctx, C.slate, x + px, y + py);
  },
  'lot-stall': (ctx, x, y) => {
    rect(ctx, C.roadDark, x, y, 16, 16);
    rect(ctx, C.white, x, y, 1, 16);
  },
  // A fenced back yard (seen over the fence: dark grass) and a private garden (co-ops).
  yard: (ctx, x, y) => paintLawn(ctx, x, y, C.grassDark, C.leafDark),
  garden: (ctx, x, y) => {
    paintLawn(ctx, x, y, C.leaf, C.leafDark);
  },
  flowers: (ctx, x, y) => {
    paintLawn(ctx, x, y, C.grass, C.grassDark);
    for (const [px, py, c] of [[3, 3, C.flowerPink], [10, 5, C.flowerYellow], [6, 10, C.flowerYellow], [12, 12, C.flowerPink]] as const) {
      rect(ctx, c, x + px, y + py, 2, 2);
      rect(ctx, C.outline, x + px, y + py + 2, 2, 1);
    }
  },
  manhole: (ctx, x, y) => {
    paintRoad(ctx, x, y);
    rect(ctx, C.curb, x + 4, y + 5, 8, 6);
    rect(ctx, C.curb, x + 5, y + 4, 6, 8);
    for (const py of [6, 8]) rect(ctx, C.roadDark, x + 5, y + py, 6, 1);
  },
  // The world map's collision layer (hidden in the game); a hatch so it reads in Tiled.
  solid: (ctx, x, y) => {
    for (let i = 0; i < 16; i++) rect(ctx, C.signalRed, x + i, y + i);
    for (let i = 0; i < 16; i++) rect(ctx, C.signalRed, x + 15 - i, y + i);
  },
  'p-tree': marker(C.leafDark),
  'p-bush': marker(C.grassDark),
  'p-lamp': marker(C.slate),
  'p-hydrant': marker(C.signalRed),
  'p-trash': marker(C.steel),
  'p-bench': marker(C.trunk),
  'p-signal': marker(C.signalGreen),
  'p-barricade': marker(C.awning),
  'p-pillar': marker(C.steelLight),
  'p-stairs': marker(C.station),
  'p-planter': marker(C.planter),
  'p-dock': marker(C.marking),
  playground: (ctx, x, y) => {
    rect(ctx, C.awning, x, y, 16, 16);
    for (const [px, py] of [[2, 3], [9, 7], [5, 12], [13, 13]]) rect(ctx, C.brick, x + px, y + py, 2, 2);
  },
};

/** A prop marker for the props layer in Tiled: a coloured dot on transparency (the game draws a sprite instead). */
function marker(color: string): Painter {
  return (ctx, x, y) => {
    rect(ctx, C.outline, x + 4, y + 4, 8, 8);
    rect(ctx, color, x + 5, y + 5, 6, 6);
  };
}

function paintLawn(ctx: Ctx, x: number, y: number, base: string, blade: string): void {
  rect(ctx, base, x, y, 16, 16);
  for (const [tx, ty] of [[3, 4], [10, 10], [12, 2], [2, 12]]) {
    rect(ctx, blade, x + tx, y + ty);
    rect(ctx, blade, x + tx + 1, y + ty - 1);
  }
}

const OVERHEAD_PAINTERS: Record<string, Painter> = {
  canopy: (ctx, x, y) => pixelMap(ctx, x, y, TREE.slice(0, TILE_SIZE), TREE_COLORS),
};

/** Painters in tile-id order (src/data/tiles.json); a name without a painter fails at boot. */
function inOrder(names: string[], painters: Record<string, Painter>): Painter[] {
  return names.map((name) => {
    const paint = painters[name];
    if (!paint) throw new Error(`No placeholder painter for tile "${name}" (src/data/tiles.json)`);
    return paint;
  });
}

function paintSidewalk(ctx: Ctx, x: number, y: number): void {
  rect(ctx, C.sidewalk, x, y, 16, 16);
  rect(ctx, C.sidewalkSeam, x + 15, y, 1, 16);
  rect(ctx, C.sidewalkSeam, x, y + 15, 16, 1);
}

function paintRoad(ctx: Ctx, x: number, y: number): void {
  rect(ctx, C.road, x, y, 16, 16);
  for (const [sx, sy] of [[4, 5], [11, 12], [13, 3], [1, 14]]) rect(ctx, C.roadDark, x + sx, y + sy);
}

// ---------------------------------------------------------------------------
// People, 16x24 per frame. The player is a delivery worker with a cap and an
// insulated bag; NPCs are the same body with other colours and no cap or bag.
// Drawn as rectangles: an outline pass (each part grown by 1px) then a fill pass,
// which gives one chunky silhouette outline.
// ---------------------------------------------------------------------------

interface Look {
  skin: string;
  hair: string;
  top: string;
  pants: string;
  cap?: string;
  bag?: string;
}

const PLAYER_LOOK: Look = { skin: C.skin, hair: C.hair, top: C.jacket, pants: C.pants, cap: C.cap, bag: C.bag };

/** One per row of the NPC sheet (NPC_FRAME.looks). Placeholder people, not real ones. */
const NPC_LOOKS: Look[] = [
  { skin: C.skinLight, hair: C.trunk, top: C.planter, pants: C.slate },
  { skin: C.skinDark, hair: C.hair, top: C.flowerPink, pants: C.pants },
  { skin: C.skin, hair: C.mortar, top: C.flowerYellow, pants: C.leafDark },
];

interface Part {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  outline: boolean;
}

/** step: 0 = stand, 1 = left foot forward, 2 = right foot forward. */
function drawPerson(ctx: Ctx, ox: number, oy: number, dir: Direction, step: number, look: Look): void {
  const parts: Part[] = [];
  const add = (x: number, y: number, w: number, h: number, color: string, outline = true) =>
    parts.push({ x, y, w, h, color, outline });
  const side = dir === 'left' || dir === 'right';
  const swing = step === 0 ? 0 : step === 1 ? 1 : -1;

  // Bag behind the body in front/side views.
  if (look.bag) {
    if (dir === 'down') add(3, 9, 10, 4, look.bag);
    if (dir === 'left') add(10, 10, 5, 7, look.bag);
    if (dir === 'right') add(1, 10, 5, 7, look.bag);
  }

  // Legs: the stepping leg is lifted 1px; in side view the legs also spread apart.
  const [lx, rx] = side && step === 0 ? [6, 7] : [5, 8];
  add(lx, 18, 3, step === 1 ? 4 : 5, look.pants);
  add(rx, 18, 3, step === 2 ? 4 : 5, look.pants);

  add(4, 11, 8, 8, look.top); // torso

  if (side) {
    add(7 + swing, 12, 2, 6, look.top);
    add(7 + swing, 17, 2, 1, look.skin, false);
  } else {
    add(2, 12 + swing, 2, 6, look.top);
    add(12, 12 - swing, 2, 6, look.top);
    add(2, 17 + swing, 2, 1, look.skin, false);
    add(12, 17 - swing, 2, 1, look.skin, false);
  }

  if (dir === 'up' && look.bag) add(3, 10, 10, 8, look.bag); // back view: bag covers the back

  add(4, 3, 8, 8, look.skin); // head
  if (dir === 'up') add(4, 4, 8, 6, look.hair, false);
  if (dir === 'left') add(9, 5, 3, 4, look.hair, false);
  if (dir === 'right') add(4, 5, 3, 4, look.hair, false);

  if (look.cap) {
    add(4, 1, 8, 4, look.cap);
    if (dir === 'down') add(3, 5, 10, 1, look.cap);
    if (dir === 'left') add(1, 4, 4, 2, look.cap);
    if (dir === 'right') add(11, 4, 4, 2, look.cap);
  } else {
    // Bare head: hair on top (and the back of the head in the back view).
    add(4, 3, 8, dir === 'up' ? 7 : 2, look.hair, false);
  }

  if (dir === 'down') {
    add(6, 7, 1, 2, C.outline, false);
    add(9, 7, 1, 2, C.outline, false);
  }
  if (dir === 'left') add(5, 7, 1, 2, C.outline, false);
  if (dir === 'right') add(10, 7, 1, 2, C.outline, false);

  for (const p of parts) if (p.outline) rect(ctx, C.outline, ox + p.x - 1, oy + p.y - 1, p.w + 2, p.h + 2);
  for (const p of parts) rect(ctx, p.color, ox + p.x, oy + p.y, p.w, p.h);
}

// ---------------------------------------------------------------------------

/**
 * Creates every placeholder texture. Keys that already exist are skipped, so real art
 * loaded in BootScene.preload under the same key automatically wins.
 */
export function generatePlaceholderTextures(scene: Phaser.Scene): void {
  const make = (key: string, width: number, height: number, draw: (ctx: Ctx) => void) => {
    if (scene.textures.exists(key)) return null;
    const tex = scene.textures.createCanvas(key, width, height);
    if (!tex) throw new Error(`Could not create canvas texture "${key}"`);
    draw(tex.getContext());
    tex.refresh();
    return tex;
  };

  const tilePainters = inOrder(tileIds.tiles, TILE_PAINTERS);
  const tileRows = Math.ceil(tilePainters.length / TILESET_COLUMNS);
  make(TEXTURES.tiles, TILE_SIZE * TILESET_COLUMNS, TILE_SIZE * tileRows, (ctx) => {
    tilePainters.forEach((paint, i) =>
      paint(ctx, (i % TILESET_COLUMNS) * TILE_SIZE, Math.floor(i / TILESET_COLUMNS) * TILE_SIZE),
    );
  });

  const overheadPainters = inOrder(tileIds.overhead, OVERHEAD_PAINTERS);
  make(TEXTURES.overhead, TILE_SIZE * overheadPainters.length, TILE_SIZE, (ctx) => {
    overheadPainters.forEach((paint, i) => paint(ctx, i * TILE_SIZE, 0));
  });

  const { width: fw, height: fh, columns } = PLAYER_FRAME;
  const sheet = make(TEXTURES.player, fw * columns, fh * DIRECTIONS.length, (ctx) => {
    DIRECTIONS.forEach((dir, row) => {
      for (let col = 0; col < columns; col++) drawPerson(ctx, col * fw, row * fh, dir, col, PLAYER_LOOK);
    });
  });
  // Numbered frames, same as a spritesheet loaded with this.load.spritesheet().
  if (sheet) {
    for (let i = 0; i < columns * DIRECTIONS.length; i++) {
      sheet.add(i, 0, (i % columns) * fw, Math.floor(i / columns) * fh, fw, fh);
    }
  }

  make(TEXTURES.emote, EMOTE[0].length, EMOTE.length, (ctx) => pixelMap(ctx, 0, 0, EMOTE, { o: C.outline, W: C.white }));

  // NPCs: row = look, column = standing frame per direction (frame = look * 4 + direction).
  const { width: nw, height: nh, looks } = NPC_FRAME;
  const npcs = make(TEXTURES.npc, nw * DIRECTIONS.length, nh * looks, (ctx) => {
    NPC_LOOKS.forEach((look, row) => DIRECTIONS.forEach((dir, col) => drawPerson(ctx, col * nw, row * nh, dir, 0, look)));
  });
  if (npcs) {
    for (let i = 0; i < DIRECTIONS.length * looks; i++) {
      npcs.add(i, 0, (i % DIRECTIONS.length) * nw, Math.floor(i / DIRECTIONS.length) * nh, nw, nh);
    }
  }

  make(TEXTURES.textWindow, TEXT_WINDOW.width, TEXT_WINDOW.height, (ctx) => drawWindow(ctx, TEXT_WINDOW.width, TEXT_WINDOW.height));
  make(TEXTURES.textCursor, CURSOR[0].length, CURSOR.length, (ctx) => pixelMap(ctx, 0, 0, CURSOR, { W: C.white }));
  make(TEXTURES.deliveryPoint, DELIVERY_POINT[0].length, DELIVERY_POINT.length, (ctx) =>
    pixelMap(ctx, 0, 0, DELIVERY_POINT, { o: C.outline, D: C.awning, d: C.bag, W: C.white }),
  );

  // Edge arrow toward an off-screen target: one frame per direction in DIRECTIONS_8 order
  // (pre-drawn, so the sprite is never rotated; DESIGN.md 2.2).
  const arrow = make(TEXTURES.targetArrow, ARROW_SIZE * ARROWS.length, ARROW_SIZE, (ctx) => {
    ARROWS.forEach((rows, i) => pixelMap(ctx, i * ARROW_SIZE, 0, rows, { o: C.outline, Y: C.bag }));
  });
  if (arrow) ARROWS.forEach((_, i) => arrow.add(i, 0, i * ARROW_SIZE, 0, ARROW_SIZE, ARROW_SIZE));
  make(TEXTURES.beacon, BEACON[0].length, BEACON.length, (ctx) => pixelMap(ctx, 0, 0, BEACON, { o: C.outline, Y: C.bag, W: C.white }));
}

// Delivery point marker (16x16): a bright door with a parcel sign, drawn over a building's
// front. Orange and yellow stand out against every facade colour, so doors read from afar.
const DELIVERY_POINT = [
  '................',
  '.oooooooooooooo.',
  '.oDDDDDDDDDDDDo.',
  '.oDDoooooooDDDo.',
  '.oDdoWWWWWodDDo.',
  '.oDdoWoooWodDDo.',
  '.oDdoWWWWWodDDo.',
  '.oDdooooooodDDo.',
  '.oDdddddddddDDo.',
  '.oDdddddddooDDo.',
  '.oDdddddddddDDo.',
  '.oDdddddddddDDo.',
  '.oDdddddddddDDo.',
  '.oDdddddddddDDo.',
  '.oDDDDDDDDDDDDo.',
  '.oooooooooooooo.',
];

// Bobbing marker over the active order's door: a parcel tag pointing down.
const BEACON = [
  '.ooooooo.',
  'oYYYYYYYo',
  'oYoooooYo',
  'oYoWWWoYo',
  'oYoooooYo',
  'oYYYYYYYo',
  '.oYYYYYo.',
  '..oYYYo..',
  '...oYo...',
  '....o....',
];

// 11x11 arrows, in DIRECTIONS_8 order: up, up-right, right, down-right, down, down-left, left, up-left.
const ARROW_SIZE = 11;
const ARROW_UP = [
  '.....o.....',
  '....oYo....',
  '...oYYYo...',
  '..oYYYYYo..',
  '.oYYYYYYYo.',
  'ooooYYYoooo',
  '...oYYYo...',
  '...oYYYo...',
  '...oYYYo...',
  '...oYYYo...',
  '...ooooo...',
];
const ARROW_UP_RIGHT = [
  '...ooooooo.',
  '...oYYYYYo.',
  '....oYYYYo.',
  '...oYYYYYo.',
  '..oYYYoYYo.',
  '.oYYYo.oYo.',
  'oYYYo...oo.',
  'oYYo.......',
  '.oo........',
  '...........',
  '...........',
];
/** Rotate a square pixel map a quarter turn clockwise. */
const turn = (rows: string[]): string[] => rows.map((_, y) => rows.map((r) => r[y]).reverse().join(''));
const ARROWS: string[][] = [];
for (let q = 0, up = ARROW_UP, ur = ARROW_UP_RIGHT; q < 4; q++, up = turn(up), ur = turn(ur)) ARROWS.push(up, ur);

// ---------------------------------------------------------------------------
// Text window: dark panel, light 2px frame, outline, rounded corners.
// ---------------------------------------------------------------------------

const CURSOR = ['WWWWW', '.WWW.', '..W..'];

function drawWindow(ctx: Ctx, w: number, h: number): void {
  // Outline and panel, with the four corner pixels cut to round it off.
  rect(ctx, C.outline, 1, 0, w - 2, h);
  rect(ctx, C.outline, 0, 1, w, h - 2);
  // Light frame ring, 2px thick, inset 1px, with rounded corners.
  rect(ctx, C.white, 3, 1, w - 6, 2);
  rect(ctx, C.white, 3, h - 3, w - 6, 2);
  rect(ctx, C.white, 1, 3, 2, h - 6);
  rect(ctx, C.white, w - 3, 3, 2, h - 6);
  for (const [cx, cy] of [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]]) rect(ctx, C.white, cx, cy);
}

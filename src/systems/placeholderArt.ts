import type Phaser from 'phaser';
import { DIRECTIONS, NPC_FRAME, PLAYER_FRAME, TEXT_WINDOW, TEXTURES, TILE_SIZE, type Direction } from '../config';

// Placeholder art drawn with Canvas 2D at boot. Throwaway by design: real art replaces
// it by loading files under the same texture keys (see generatePlaceholderTextures).

type Ctx = CanvasRenderingContext2D;

// EarthBound-ish pastels with a chunky dark outline colour.
const C = {
  outline: '#2a1f3d',
  grass: '#a6e3a1',
  grassDark: '#7fc98a',
  sidewalk: '#f6dccb',
  sidewalkSeam: '#dcb9a8',
  road: '#9a98c2',
  roadDark: '#86849f',
  marking: '#fff1a6',
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
} as const;

function rect(ctx: Ctx, color: string, x: number, y: number, w = 1, h = 1): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** One string per row, one char per pixel; chars missing from the palette are transparent. */
function pixelMap(ctx: Ctx, ox: number, oy: number, rows: string[], palette: Record<string, string>): void {
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const color = palette[ch];
      if (color) rect(ctx, color, ox + x, oy + y);
    });
  });
}

// ---------------------------------------------------------------------------
// Tileset: 16x16 tiles, TILESET_COLUMNS wide. Index = Tiled tile id (gid - firstgid).
//   0 grass   1 sidewalk   2 road    3 road marking
//   4 wall    5 tree       6 planter 7 water          (4-7 collide; set in the map JSON)
// Adding a tile? Also update the map JSON tileset's tilecount/imageheight.
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

const PLANTER = [
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

const TILE_PAINTERS: ((ctx: Ctx, x: number, y: number) => void)[] = [
  // 0 grass
  (ctx, x, y) => {
    rect(ctx, C.grass, x, y, 16, 16);
    for (const [tx, ty] of [[3, 4], [10, 10], [12, 2], [2, 12]]) {
      rect(ctx, C.grassDark, x + tx, y + ty);
      rect(ctx, C.grassDark, x + tx + 1, y + ty - 1);
      rect(ctx, C.grassDark, x + tx + 2, y + ty);
    }
  },
  // 1 sidewalk
  (ctx, x, y) => {
    rect(ctx, C.sidewalk, x, y, 16, 16);
    rect(ctx, C.sidewalkSeam, x + 15, y, 1, 16);
    rect(ctx, C.sidewalkSeam, x, y + 15, 16, 1);
  },
  // 2 road
  (ctx, x, y) => paintRoad(ctx, x, y),
  // 3 road marking
  (ctx, x, y) => {
    paintRoad(ctx, x, y);
    rect(ctx, C.marking, x + 2, y + 7, 12, 2);
  },
  // 4 wall: brick facade with a window
  (ctx, x, y) => {
    rect(ctx, C.brick, x, y, 16, 16);
    for (const row of [3, 7, 11, 15]) rect(ctx, C.mortar, x, y + row, 16, 1);
    for (const [mx, my] of [[7, 0], [3, 4], [11, 4], [7, 8], [3, 12], [11, 12]]) {
      rect(ctx, C.mortar, x + mx, y + my, 1, 3);
    }
    rect(ctx, C.outline, x + 4, y + 4, 8, 7);
    rect(ctx, C.glass, x + 5, y + 5, 6, 5);
    rect(ctx, C.white, x + 5, y + 5, 2, 1);
  },
  // 5 tree (trunk and lower crown; the canopy is overhead tile 0)
  (ctx, x, y) => pixelMap(ctx, x, y, TREE.slice(TILE_SIZE), TREE_COLORS),
  // 6 planter
  (ctx, x, y) =>
    pixelMap(ctx, x, y, PLANTER, {
      o: C.outline,
      L: C.planter,
      l: C.planterDark,
      P: C.flowerPink,
      Y: C.flowerYellow,
      G: C.leafDark,
    }),
  // 7 water
  (ctx, x, y) => {
    rect(ctx, C.water, x, y, 16, 16);
    rect(ctx, C.waterLight, x + 2, y + 3, 4, 1);
    rect(ctx, C.waterLight, x + 9, y + 8, 5, 1);
    rect(ctx, C.waterLight, x + 4, y + 12, 4, 1);
  },
];

const OVERHEAD_PAINTERS: ((ctx: Ctx, x: number, y: number) => void)[] = [
  // 0 tree canopy
  (ctx, x, y) => pixelMap(ctx, x, y, TREE.slice(0, TILE_SIZE), TREE_COLORS),
];

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
  { skin: C.skinLight, hair: C.trunk, top: C.planter, pants: C.road },
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

  const tileRows = Math.ceil(TILE_PAINTERS.length / TILESET_COLUMNS);
  make(TEXTURES.tiles, TILE_SIZE * TILESET_COLUMNS, TILE_SIZE * tileRows, (ctx) => {
    TILE_PAINTERS.forEach((paint, i) =>
      paint(ctx, (i % TILESET_COLUMNS) * TILE_SIZE, Math.floor(i / TILESET_COLUMNS) * TILE_SIZE),
    );
  });

  make(TEXTURES.overhead, TILE_SIZE * OVERHEAD_PAINTERS.length, TILE_SIZE, (ctx) => {
    OVERHEAD_PAINTERS.forEach((paint, i) => paint(ctx, i * TILE_SIZE, 0));
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
    pixelMap(ctx, 0, 0, DELIVERY_POINT, { o: C.outline, D: C.trunk, d: C.bag, W: C.white }),
  );
}

// Delivery point marker (16x16): a door with a parcel sign, drawn over a wall tile.
const DELIVERY_POINT = [
  '................',
  '..oooooooooooo..',
  '..oDDDDDDDDDDo..',
  '..oDddddddddDo..',
  '..oDdoooooodDo..',
  '..oDdoWWWWodDo..',
  '..oDdoWooWodDo..',
  '..oDdoWWWWodDo..',
  '..oDdoooooodDo..',
  '..oDddddddddDo..',
  '..oDdddddddoDo..',
  '..oDddddddddDo..',
  '..oDddddddddDo..',
  '..oDddddddddDo..',
  '..oDDDDDDDDDDo..',
  '..oooooooooooo..',
];

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

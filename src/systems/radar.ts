import Phaser from 'phaser';
import tileIds from '../data/tiles.json';
import { DIRECTIONS_8, RADAR, TILE_SIZE, type Direction8 } from '../config';
import type { WorldData } from './mapLoader';
import type { Rect } from './maps';

// Circular radar (session 6e, owner's decision 8): top-left, north up, centred on the player, about
// two blocks of radius. White roads, dark blocks, green parks and paseo, warm plazas; the walkable
// area's edge as a hard line. Player arrow (direction of travel), target blip, clamped to the rim
// when the target is off the radar. Redrawn into a small canvas texture only when something changes.

const COLOURS = { block: '#2a1f3d', road: '#fffaf0', green: '#7dd3a0', plaza: '#f3dfb6', outside: '#1b1528', outsideRoad: '#86849f', edge: '#ff5d5d', ring: '#fffaf0', player: '#ff6f61', target: '#ffd46e', outline: '#2a1f3d' } as const;
const ROAD = /^(road|sidewalk|curb-|center-line-|lane-dash-|crosswalk-|el-shadow|manhole)/;
const GREEN = new Set(['lawn', 'lawn-dark', 'paseo-grass', 'bike-lane', 'playground', 'park-path', 'flowers']);
const KEY = 'radar';

// 5x5 arrows, up and up-right; the rest are quarter turns.
const ARROW_UP = ['..o..', '.ooo.', 'ooooo', '.ooo.', '.ooo.'];
const ARROW_UR = ['.oooo', '..ooo', '.oooo', 'ooo.o', 'oo...'];
const turn = (rows: string[]) => rows.map((_, y) => rows.map((r) => r[y]).reverse().join(''));
const ARROWS: string[][] = [];
for (let q = 0, u = ARROW_UP, r = ARROW_UR; q < 4; q++, u = turn(u), r = turn(r)) ARROWS.push(u, r);
const GLYPH_N = ['o...o', 'oo..o', 'o.o.o', 'o..oo', 'o...o'];

export interface RadarState {
  /** The player's overview pixel (centre of the radar). */
  cx: number;
  cy: number;
  /** Where the target blip is drawn (radar pixels from the centre), and whether it sits on the rim. */
  target: { dx: number; dy: number; onRim: boolean } | null;
}

export class Radar {
  readonly image: Phaser.GameObjects.Image;
  /** Outer size in game pixels (diameter + the 1 px ring on each side). */
  readonly size: number;
  state: RadarState = { cx: 0, cy: 0, target: null };
  private readonly overview: HTMLCanvasElement;
  private readonly mask: HTMLCanvasElement;
  private readonly tex: Phaser.Textures.CanvasTexture;
  private last = '';

  constructor(scene: Phaser.Scene, world: WorldData, walk: Rect, x: number, y: number, depth: number) {
    const R = RADAR.radius;
    this.size = 2 * R + 3;
    this.overview = buildOverview(world, walk);
    this.mask = document.createElement('canvas');
    this.mask.width = this.mask.height = this.size;
    const m = this.mask.getContext('2d')!;
    m.fillStyle = '#000';
    const c = R + 1;
    for (let py = 0; py < this.size; py++) for (let px = 0; px < this.size; px++) if ((px - c) ** 2 + (py - c) ** 2 <= (R + 0.5) ** 2) m.fillRect(px, py, 1, 1);
    const existing = scene.textures.exists(KEY) ? (scene.textures.get(KEY) as Phaser.Textures.CanvasTexture) : null;
    const tex = existing ?? scene.textures.createCanvas(KEY, this.size, this.size);
    if (!tex) throw new Error('Could not create the radar texture');
    this.tex = tex;
    this.image = scene.add.image(x, y, KEY).setOrigin(0).setScrollFactor(0).setDepth(depth);
  }

  /** Redraws for the player at (px, py) map pixels heading `dir`, and the target (map pixels) if any. */
  update(px: number, py: number, dir: Direction8, target: { x: number; y: number } | null, blinkOn: boolean): void {
    const R = RADAR.radius;
    const per = RADAR.tilesPerPixel * TILE_SIZE;
    const cx = Math.floor(px / per);
    const cy = Math.floor(py / per);
    let tgt: RadarState['target'] = null;
    if (target) {
      let dx = Math.floor(target.x / per) - cx;
      let dy = Math.floor(target.y / per) - cy;
      const d = Math.hypot(dx, dy);
      const onRim = d > R - 2;
      if (onRim) {
        dx = Math.round(((R - 2) * dx) / d);
        dy = Math.round(((R - 2) * dy) / d);
      }
      tgt = { dx, dy, onRim };
    }
    this.state = { cx, cy, target: tgt };
    const sig = `${cx},${cy},${dir},${tgt ? `${tgt.dx},${tgt.dy},${blinkOn || !tgt.onRim}` : '-'}`;
    if (sig === this.last) return;
    this.last = sig;
    const ctx = this.tex.getContext();
    const S = this.size;
    const c = R + 1;
    ctx.clearRect(0, 0, S, S);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = COLOURS.outside;
    ctx.fillRect(0, 0, S, S);
    ctx.drawImage(this.overview, cx - c, cy - c, S, S, 0, 0, S, S);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(this.mask, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    // Ring, 1 px, with the N marker at the top.
    ctx.fillStyle = COLOURS.ring;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const d2 = (x - c) ** 2 + (y - c) ** 2;
      if (d2 > (R + 0.5) ** 2 && d2 <= (R + 1.5) ** 2) ctx.fillRect(x, y, 1, 1);
    }
    pixels(ctx, c - 3, 0, ['.......', ...GLYPH_N.map((r) => `.${r}.`), '.......'], { '.': COLOURS.outline, o: COLOURS.ring });
    // Target blip: steady inside the radar, blinking on the rim.
    if (tgt && (blinkOn || !tgt.onRim)) {
      ctx.fillStyle = COLOURS.outline;
      ctx.fillRect(c + tgt.dx - 2, c + tgt.dy - 2, 5, 5);
      ctx.fillStyle = COLOURS.target;
      ctx.fillRect(c + tgt.dx - 1, c + tgt.dy - 1, 3, 3);
    }
    pixels(ctx, c - 2, c - 2, ARROWS[DIRECTIONS_8.indexOf(dir)], { o: COLOURS.player });
    this.tex.refresh();
  }

  setVisible(v: boolean): void {
    this.image.setVisible(v);
  }

  destroy(): void {
    this.image.destroy();
  }
}

function pixels(ctx: CanvasRenderingContext2D, ox: number, oy: number, rows: string[], pal: Record<string, string>): void {
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (!pal[ch]) return;
    ctx.fillStyle = pal[ch];
    ctx.fillRect(ox + x, oy + y, 1, 1);
  }));
}

/** One pixel per RADAR.tilesPerPixel tiles square: road beats plaza beats green beats block; outside the walkable area dimmed, its edge a red line. */
function buildOverview(world: WorldData, walk: Rect): HTMLCanvasElement {
  const n = RADAR.tilesPerPixel;
  const W = Math.ceil(world.width / n);
  const H = Math.ceil(world.height / n);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  const kind = (k: number) => {
    const name = tileIds.tiles[world.ground[k]] ?? '';
    if (ROAD.test(name)) return 3;
    if (name === 'plaza') return 2;
    if (GREEN.has(name) && (!world.solid[k] || world.props[k] >= 0)) return 1;
    return 0;
  };
  const wx0 = walk.x / TILE_SIZE, wy0 = walk.y / TILE_SIZE, wx1 = (walk.x + walk.width) / TILE_SIZE, wy1 = (walk.y + walk.height) / TILE_SIZE;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let best = 0;
      for (let j = y * n; j < Math.min(world.height, y * n + n); j++) for (let i = x * n; i < Math.min(world.width, x * n + n); i++) best = Math.max(best, kind(j * world.width + i));
      const inside = x * n + n / 2 >= wx0 && x * n + n / 2 < wx1 && y * n + n / 2 >= wy0 && y * n + n / 2 < wy1;
      ctx.fillStyle = inside ? [COLOURS.block, COLOURS.green, COLOURS.plaza, COLOURS.road][best] : best === 3 ? COLOURS.outsideRoad : COLOURS.outside;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // The edge: a hard 1 px line just outside the walkable area.
  ctx.fillStyle = COLOURS.edge;
  const ex0 = Math.floor(wx0 / n) - 1, ey0 = Math.floor(wy0 / n) - 1, ex1 = Math.ceil(wx1 / n), ey1 = Math.ceil(wy1 / n);
  ctx.fillRect(ex0, ey0, ex1 - ex0 + 1, 1);
  ctx.fillRect(ex0, ey1, ex1 - ex0 + 1, 1);
  ctx.fillRect(ex0, ey0, 1, ey1 - ey0 + 1);
  ctx.fillRect(ex1, ey0, 1, ey1 - ey0 + 1);
  return cv;
}

import Phaser from 'phaser';
import tileIds from '../data/tiles.json';
import { FONT, GAME_HEIGHT, GAME_WIDTH, TEXTURES, TILE_SIZE } from '../config';
import type { WorldBuilding, WorldData } from './mapLoader';
import type { DockRect, MapInfo, StreetSign } from './maps';
import { t } from './strings';
import { PROP_FRAME, PROP_NAMES, PROPS_TEXTURE, buildingTexture, signPanel } from './worldArt';

// Draws the world map (session 6e) without a Phaser tile object per cell: the map is 554 x 436
// tiles, and three full tile layers would be ~700k Tile objects (too much memory on a phone).
// - Ground and collision: one tilemap "window" of WINDOW tiles around the camera, refilled from the
//   decoded arrays whenever the camera nears its edge. The collision layer is invisible; the player
//   collides with it (Arcade), so walls never have seams between chunks.
// - Buildings, props, signs and bike-share docks (6f): sprites created per BIN x BIN-tile bin near the camera, destroyed
//   once it's far away. Depth = their foot's y, like characters, so the player passes in front of
//   and behind them (owner's decision 1).

const WINDOW = { width: 48, height: 40 } as const;
/** Re-anchor the window when the camera's view gets this close to its edge (tiles). */
const WINDOW_SLACK = 4;
const BIN = 32;
/** Bins within this many tiles of the view are built; beyond DROP they're destroyed. */
const BUILD_MARGIN = 24;
const DROP_MARGIN = 48;
const SIGN_PAD = 2;
/** Bins built per frame beyond the visible ones (spreads texture painting over frames). */
const BINS_PER_FRAME = 1;
/** Building textures kept painted at most (529 looks on the map, ~22 MB if all were kept); least recently used go first. */
const MAX_BUILDING_TEXTURES = 160;
const SOLID_ID = tileIds.tiles.indexOf('solid');
// Props-layer tile id -> frame of the props sheet (the sheet's extra frames, like the sign post, aren't map tiles).
const PROP_FRAME_OF = new Map<number, number>(PROP_NAMES.flatMap((name, i) => (tileIds.tiles.includes(name) ? [[tileIds.tiles.indexOf(name), i] as [number, number]] : [])));

export const SIGN_COLOURS = { blade: 0x2f6b4f, edge: 0xff5d5d } as const;

/** Painted building texture keys by last use (shared by every WorldView: textures outlive a scene restart). */
const textureUse = new Map<string, number>();
let frameCounter = 0;

interface Bin {
  buildings: WorldBuilding[];
  props: number[];
  signs: StreetSign[];
  docks: DockRect[];
}

export class WorldView {
  readonly map: Phaser.Tilemaps.Tilemap;
  readonly ground: Phaser.Tilemaps.TilemapLayer;
  readonly collision: Phaser.Tilemaps.TilemapLayer;
  /** The window's top-left, in tiles. */
  private anchor = { x: Number.NaN, y: Number.NaN };
  private readonly bins: Bin[] = [];
  private readonly binCols: number;
  private readonly live = new Map<number, Phaser.GameObjects.GameObject[]>();
  private frame = 0;
  /** The docked-bike sprites of every live dock, by dock id (redrawn when a count changes). */
  private readonly dockBikes = new Map<string, Phaser.GameObjects.Image[]>();
  /** How many times the window was refilled (the browser checks read it). */
  refills = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    info: MapInfo,
    private readonly world: WorldData,
    depths: { ground: number; collision: number },
    /** Bikes docked at a dock right now (session 6f: gameState). */
    private readonly bikesAt: (dockId: string) => number = () => 0,
  ) {
    this.map = scene.make.tilemap({ tileWidth: TILE_SIZE, tileHeight: TILE_SIZE, width: WINDOW.width, height: WINDOW.height });
    const tiles = this.map.addTilesetImage(TEXTURES.tiles, TEXTURES.tiles, TILE_SIZE, TILE_SIZE, 0, 0, 0);
    if (!tiles) throw new Error('No texture loaded for tileset "tiles"');
    const ground = this.map.createBlankLayer('ground', tiles, 0, 0, WINDOW.width, WINDOW.height);
    const collision = this.map.createBlankLayer('collision', tiles, 0, 0, WINDOW.width, WINDOW.height);
    if (!ground || !collision) throw new Error('Could not create the world map window');
    this.ground = ground.setDepth(depths.ground);
    this.collision = collision.setDepth(depths.collision).setVisible(false);

    // Bins: every building (by its image's bottom centre), prop and sign (by their foot).
    this.binCols = Math.ceil(world.width / BIN);
    const rows = Math.ceil(world.height / BIN);
    for (let i = 0; i < this.binCols * rows; i++) this.bins.push({ buildings: [], props: [], signs: [], docks: [] });
    const binOf = (tx: number, ty: number) => Math.floor(Phaser.Math.Clamp(ty, 0, world.height - 1) / BIN) * this.binCols + Math.floor(Phaser.Math.Clamp(tx, 0, world.width - 1) / BIN);
    for (const b of world.buildings) this.bins[binOf(b.x + b.w / 2, b.y + b.h - 1)].buildings.push(b);
    for (let k = 0; k < world.props.length; k++) if (PROP_FRAME_OF.has(world.props[k])) this.bins[binOf(k % world.width, Math.floor(k / world.width))].props.push(k);
    for (const s of info.signs) this.bins[binOf(s.x / TILE_SIZE, s.y / TILE_SIZE - 1)].signs.push(s);
    for (const d of info.docks) this.bins[binOf(d.x / TILE_SIZE, d.y / TILE_SIZE)].docks.push(d);
  }

  /**
   * Keeps the window and the sprite bins around the view centred on (x, y) map pixels (the player:
   * the camera follows them). Call every frame; it's cheap when nothing changes.
   */
  update(x: number, y: number, force = false): void {
    const v = { x0: (x - GAME_WIDTH / 2) / TILE_SIZE, y0: (y - GAME_HEIGHT / 2) / TILE_SIZE, x1: (x + GAME_WIDTH / 2) / TILE_SIZE, y1: (y + GAME_HEIGHT / 2) / TILE_SIZE };
    const a = this.anchor;
    // A side only needs slack where the window doesn't already reach the map's edge there.
    const W = this.world.width, H = this.world.height;
    const ok =
      (a.x <= 0 || v.x0 >= a.x + WINDOW_SLACK) &&
      (a.y <= 0 || v.y0 >= a.y + WINDOW_SLACK) &&
      (a.x + WINDOW.width >= W || v.x1 <= a.x + WINDOW.width - WINDOW_SLACK) &&
      (a.y + WINDOW.height >= H || v.y1 <= a.y + WINDOW.height - WINDOW_SLACK);
    if (force || Number.isNaN(a.x) || !ok) {
      const cx = Math.floor((v.x0 + v.x1) / 2);
      const cy = Math.floor((v.y0 + v.y1) / 2);
      this.fill(Phaser.Math.Clamp(cx - WINDOW.width / 2, 0, Math.max(0, this.world.width - WINDOW.width)), Phaser.Math.Clamp(cy - WINDOW.height / 2, 0, Math.max(0, this.world.height - WINDOW.height)));
    }
    this.updateBins(v);
  }

  /** Refills both window layers from the map arrays, with the window's top-left at tile (ax, ay). */
  private fill(ax: number, ay: number): void {
    this.anchor = { x: ax, y: ay };
    const w = this.world;
    const g: number[][] = [];
    const c: number[][] = [];
    for (let j = 0; j < WINDOW.height; j++) {
      const gr: number[] = [];
      const cr: number[] = [];
      const row = (ay + j) * w.width;
      for (let i = 0; i < WINDOW.width; i++) {
        const k = row + ax + i;
        const inside = ax + i < w.width && ay + j < w.height;
        gr.push(inside ? w.ground[k] : -1);
        cr.push(inside && w.solid[k] ? SOLID_ID : -1);
      }
      g.push(gr);
      c.push(cr);
    }
    this.ground.putTilesAt(g, 0, 0, false);
    this.collision.putTilesAt(c, 0, 0, false);
    this.ground.setPosition(ax * TILE_SIZE, ay * TILE_SIZE);
    this.collision.setPosition(ax * TILE_SIZE, ay * TILE_SIZE);
    this.collision.setCollision(SOLID_ID, true, true);
    this.refills++;
  }

  private updateBins(v: { x0: number; y0: number; x1: number; y1: number }): void {
    const range = (m: number) => ({
      bx0: Math.max(0, Math.floor((v.x0 - m) / BIN)), by0: Math.max(0, Math.floor((v.y0 - m) / BIN)),
      bx1: Math.min(this.binCols - 1, Math.floor((v.x1 + m) / BIN)), by1: Math.min(Math.ceil(this.world.height / BIN) - 1, Math.floor((v.y1 + m) / BIN)),
    });
    this.frame = ++frameCounter;
    // Bins the view touches (plus a few tiles) are built now; the rest of the margin one a frame.
    const now = range(4);
    const build = range(BUILD_MARGIN);
    let budget = BINS_PER_FRAME;
    for (let by = build.by0; by <= build.by1; by++) for (let bx = build.bx0; bx <= build.bx1; bx++) {
      const id = by * this.binCols + bx;
      if (this.live.has(id)) continue;
      const urgent = bx >= now.bx0 && bx <= now.bx1 && by >= now.by0 && by <= now.by1;
      if (!urgent && budget <= 0) continue;
      if (!urgent) budget--;
      this.live.set(id, this.buildBin(this.bins[id]));
    }
    const keep = range(DROP_MARGIN);
    let dropped = false;
    for (const [id, objs] of this.live) {
      const bx = id % this.binCols, by = Math.floor(id / this.binCols);
      if (bx < keep.bx0 || bx > keep.bx1 || by < keep.by0 || by > keep.by1) {
        for (const o of objs) o.destroy();
        for (const d of this.bins[id].docks) this.dockBikes.delete(d.dockId);
        this.live.delete(id);
        dropped = true;
      }
    }
    if (dropped) this.evictTextures();
  }

  /** Forgets the least recently used building textures no live sprite shows, beyond MAX_BUILDING_TEXTURES. */
  private evictTextures(): void {
    if (textureUse.size <= MAX_BUILDING_TEXTURES) return;
    const inUse = new Set<string>();
    for (const objs of this.live.values()) for (const o of objs) if (o instanceof Phaser.GameObjects.Image && o.texture.key.startsWith('bld:')) inUse.add(o.texture.key);
    const old = [...textureUse].filter(([k]) => !inUse.has(k)).sort((a, b) => a[1] - b[1]);
    for (const [key] of old.slice(0, textureUse.size - MAX_BUILDING_TEXTURES)) {
      this.scene.textures.remove(key);
      textureUse.delete(key);
    }
  }

  /** Building textures currently painted (the browser checks read it). */
  paintedTextures(): number {
    return textureUse.size;
  }

  private buildBin(bin: Bin): Phaser.GameObjects.GameObject[] {
    const s = this.scene;
    const T = TILE_SIZE;
    const out: Phaser.GameObjects.GameObject[] = [];
    for (const b of bin.buildings) {
      const depth = (b.y + b.h) * T;
      const key = buildingTexture(s, b);
      textureUse.set(key, this.frame);
      out.push(s.add.image(b.x * T, b.y * T, key).setOrigin(0).setDepth(depth));
      const p = signPanel(b);
      if (p && b.sign) {
        // The whole word or nothing (a blank panel), never a cut-off word.
        const word = t(`shop.${b.sign}`);
        const len = [...word].length * FONT.charWidth;
        if (len <= p.width - 2) out.push(s.add.bitmapText(b.x * T + p.x + Math.floor((p.width - len) / 2), b.y * T + p.y, FONT.key, word).setDepth(depth + 0.01));
      }
    }
    for (const k of bin.props) {
      const i = k % this.world.width, j = Math.floor(k / this.world.width);
      out.push(s.add.image(i * T + T / 2, (j + 1) * T, PROPS_TEXTURE, PROP_FRAME_OF.get(this.world.props[k])).setOrigin(0.5, 1).setDepth((j + 1) * T));
    }
    for (const sign of bin.signs) out.push(...this.addSign(sign));
    for (const d of bin.docks) out.push(...this.addDock(d));
    return out;
  }

  /**
   * A bike-share dock (session 6f): the kiosk on its first tile (west or north end), a rack slot on each
   * other tile, and a docked bike in the first slots, as many as it holds. Each sprite sorts by its own
   * tile's foot y, like props.
   */
  private addDock(d: DockRect): Phaser.GameObjects.GameObject[] {
    const s = this.scene;
    const T = TILE_SIZE;
    const across = d.width > d.height;
    const tile = (n: number) => ({ x: d.x + (across ? n * T : 0) + T / 2, y: d.y + (across ? 0 : n * T) + T });
    const out: Phaser.GameObjects.GameObject[] = [];
    const k = tile(0);
    out.push(s.add.image(k.x, k.y, PROPS_TEXTURE, PROP_NAMES.indexOf('dock-kiosk')).setOrigin(0.5, 1).setDepth(k.y));
    for (let n = 1; n <= d.slots; n++) {
      const p = tile(n);
      out.push(s.add.image(p.x, p.y, PROPS_TEXTURE, PROP_NAMES.indexOf(across ? 'dock-rack-h' : 'dock-rack-v')).setOrigin(0.5, 1).setDepth(p.y));
    }
    const bikes: Phaser.GameObjects.Image[] = [];
    for (let n = 1; n <= d.slots; n++) {
      const p = tile(n);
      bikes.push(s.add.image(p.x, p.y, PROPS_TEXTURE, PROP_NAMES.indexOf(across ? 'bike-h' : 'bike-v')).setOrigin(0.5, 1).setDepth(p.y + 0.01));
    }
    this.dockBikes.set(d.dockId, bikes);
    this.refreshDock(d.dockId);
    return [...out, ...bikes];
  }

  /** Shows as many docked bikes as the dock holds now (call after renting or returning one). */
  refreshDock(dockId: string): void {
    const bikes = this.dockBikes.get(dockId);
    if (!bikes) return;
    const n = this.bikesAt(dockId);
    bikes.forEach((b, i) => b.setVisible(i < n));
  }

  /** How many docked bikes are drawn at a dock (null when its bin isn't built). The browser checks read it. */
  bikesShown(dockId: string): number | null {
    const bikes = this.dockBikes.get(dockId);
    return bikes ? bikes.filter((b) => b.visible).length : null;
  }

  /**
   * A sign on a post. Street: two green blades (the north-south street, then the cross street) at the
   * top of the post (owner's decision 6). Edge: a red plate, "End of delivery zone" (decision 7).
   */
  private addSign(sign: StreetSign): Phaser.GameObjects.GameObject[] {
    const s = this.scene;
    const out: Phaser.GameObjects.GameObject[] = [];
    const depth = sign.y;
    const lines = sign.kind === 'street' ? [t(sign.street!), t(sign.cross!)] : wrap(t(sign.text!), 13);
    const colour = sign.kind === 'street' ? SIGN_COLOURS.blade : SIGN_COLOURS.edge;
    const post = s.add.image(sign.x, sign.y, PROPS_TEXTURE, PROP_NAMES.indexOf('signpost')).setOrigin(0.5, 1).setDepth(depth);
    out.push(post);
    const h = FONT.lineHeight + 2;
    const top = sign.y - PROP_FRAME.height + 6 - lines.length * h + (sign.kind === 'street' ? 8 : 0);
    lines.forEach((line, n) => {
      const w = [...line].length * FONT.charWidth + 2 * SIGN_PAD;
      // Street blades stick out east of the post, over the sidewalk corner and the street (posts stand on
      // the NW corner, so west would cover the corner building); edge plates are centred.
      const x = sign.kind === 'street' ? sign.x - 2 : Math.round(sign.x - w / 2);
      const y = top + n * h;
      out.push(s.add.rectangle(x - 1, y - 1, w + 2, h, 0x2a1f3d).setOrigin(0).setDepth(depth + 0.01));
      out.push(s.add.rectangle(x, y, w, h - 2, colour).setOrigin(0).setDepth(depth + 0.02));
      out.push(s.add.bitmapText(x + SIGN_PAD, y, FONT.key, line).setDepth(depth + 0.03));
    });
    return out;
  }

  /** Live sprites (the browser checks count them). */
  liveObjects(): number {
    let n = 0;
    for (const objs of this.live.values()) n += objs.length;
    return n;
  }

  destroy(): void {
    for (const objs of this.live.values()) for (const o of objs) o.destroy();
    this.live.clear();
    this.dockBikes.clear();
    this.map.destroy();
  }
}

/** Greedy word wrap at `max` characters per line. */
export function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && [...line].length + 1 + [...word].length > max) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

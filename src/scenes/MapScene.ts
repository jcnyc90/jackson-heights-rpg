import Phaser from 'phaser';
import tileIds from '../data/tiles.json';
import {
  DIRECTIONS,
  FONT,
  GAME_HEIGHT,
  GAME_WIDTH,
  MINIMAP,
  ORDER_TICKET,
  PLAYER_FEET,
  PLAYER_FRAME,
  PLAYER_SPEED,
  STEP,
  TALK_RANGE,
  TARGET_ARROW,
  TEXTURES,
  TILE_SIZE,
  WARP_FADE_MS,
  ZONE_CARD,
  type Direction,
  type Direction8,
} from '../config';
import { Controls } from '../systems/controls';
import { gameState } from '../systems/gameState';
import { insideWarp, resolveDestination, START, type DeliveryPoint, type MapInfo, type Warp } from '../systems/maps';
import { DIALOGUE, readNpcSpawns, type NpcSpawn } from '../systems/npcs';
import { orderParams, placeName } from '../systems/orders';
import { t } from '../systems/strings';
import type { DialogueData, DialogueScene } from './DialogueScene';

const VELOCITY: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITE: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };

const EMOTE_MS = 500;
const NAME_CARD_MS = ZONE_CARD.showMs;
/** Whole pixels per 60 Hz physics step at walking speed (PLAYER_SPEED / 60). */
const STEP_PX = PLAYER_SPEED / 60;
// Sprites sort by feet y (their depth). "ground" and "obstacles" stay below them, street signs just
// above those; "above" (tree canopies, awnings) draws over every sprite, then the HUD.
const DEPTH = { ground: -2, obstacles: -1, signs: -0.5, above: 5e5, emote: 1e6, arrow: 1.4e6, ticket: 1.5e6, minimap: 1.6e6, nameCard: 2e6 } as const;
// HUD colours (EarthBound-ish pastels on the dark outline colour).
const HUD = { box: 0x2a1f3d, sign: 0x2f6b4f, mapBlock: 0x2a1f3d, mapRoad: 0xd9d9df, mapEl: 0x9f9fb4, mapPlaza: 0xf3dfb6, mapFrame: 0xfffaf0, player: 0xff6f61, target: 0xffd46e, dispatcher: 0x6fcfc4 } as const;
const SIGN_PAD = 2;

interface Npc {
  spawn: NpcSpawn;
  sprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
}

/** Where the player is headed next: the active order's door, or the Dispatcher while no order is active. */
interface Target {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where to put the player when the scene (re)starts. */
export interface MapSceneData {
  mapId?: string;
  spawnId?: string;
  /** Arriving through a warp: fade in with input locked, then show the map's name. */
  viaWarp?: boolean;
}

/**
 * Plays any map from the registry (src/data/maps/index.json). Map conventions (Tiled, see
 * DESIGN.md 2.4 and 2.12): tile layers "ground" and "obstacles" (tiles with the bool property
 * `collides`), an optional tile layer "above" drawn over sprites, an object layer "objects"
 * with spawn points, warps and delivery points, and an optional object layer "npcs" (see readNpcSpawns).
 * Generated maps (2.15) add street signs, zone areas and a walkable area (see readExtras).
 *
 * Movement (session 6d): eight directions at 2 px per physics step; diagonals step each axis by
 * 1 or 2 px so their speed averages the same, and slide along walls at full speed.
 *
 * A warp fades out, restarts this scene on the target map, and fades in. Input is locked
 * from the step onto the warp until the fade-in ends, and presses held across it go stale.
 *
 * Delivery orders (DESIGN.md 2.13): talking to a dispatcher NPC assigns the next order, and
 * Action at a delivery point picks it up or delivers it. Order state lives in gameState, which
 * survives the restart; the order ticket is rebuilt from it on every map. Wayfinding (6d): a
 * minimap, an edge arrow toward an off-screen target, a beacon over it, and zone name cards.
 */
export class MapScene extends Phaser.Scene {
  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private emote!: Phaser.GameObjects.Image;
  private ticketBox!: Phaser.GameObjects.Rectangle;
  private ticketText!: Phaser.GameObjects.BitmapText;
  /** The game state that survives warps (exposed here for the browser checks). */
  readonly state = gameState;
  private controls!: Controls;
  private npcs: Npc[] = [];
  private info!: MapInfo;
  private facing: Direction = 'down';
  /** The direction held this frame (null when standing). */
  private moveDir: Direction8 | null = null;
  /** Sub-pixel progress per axis, and the whole pixels planned for the next physics step. */
  private acc = { x: 0, y: 0 };
  private planned = { x: 0, y: 0 };
  private emoteHideAt = 0;
  /** True from the Action press that opens the text window until the press that closes it. */
  private talking = false;
  /** True from stepping onto a warp until the next map has faded in. */
  private warping = false;
  /** Warps fire only after the player has stood off every warp (so arrival can't bounce back). */
  private warpArmed = false;
  // Wayfinding (absent on maps without a walkable area, like the test map).
  private minimap: { image: Phaser.GameObjects.Image; ox: number; oy: number; width: number; height: number; player: Phaser.GameObjects.Rectangle; target: Phaser.GameObjects.Rectangle; dispatcher: Phaser.GameObjects.Rectangle } | null = null;
  private arrow!: Phaser.GameObjects.Sprite;
  private beacon!: Phaser.GameObjects.Image;
  /** Zone index + 1 per tile (0 = none), from the map's zone areas; the map's width in tiles. */
  private zoneGrid: Uint8Array = new Uint8Array(0);
  private mapWidth = 0;
  private zoneIds: string[] = [];
  private zoneShown: string | null = null;
  private zoneSeen: { id: string | null; since: number } = { id: null, since: 0 };
  private nameCard: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('Map');
  }

  create(data: MapSceneData): void {
    // Reset per-run state (class fields survive scene.restart()).
    this.emoteHideAt = 0;
    this.talking = false;
    this.warping = false;
    this.moveDir = null;
    this.acc = { x: 0, y: 0 };
    this.planned = { x: 0, y: 0 };
    this.minimap = null;
    this.zoneShown = null;
    this.zoneSeen = { id: null, since: 0 };
    this.nameCard = [];

    const { map: info, spawn } = data.mapId
      ? resolveDestination(data.mapId, data.spawnId ?? '')
      : START;
    this.info = info;
    this.facing = spawn.facing;

    const map = this.make.tilemap({ key: info.id });
    // Phaser drops external (.tsx/.tsj) tilesets with only a console warning.
    if (map.tilesets.length === 0) throw new Error(`Map "${info.id}" has no embedded tileset (embed it in Tiled)`);
    // Convention: each Tiled tileset is named after the texture key that draws it.
    const tilesets = map.tilesets.map((ts) => {
      const tileset = map.addTilesetImage(ts.name);
      if (!tileset) throw new Error(`No texture loaded for tileset "${ts.name}"`);
      return tileset;
    });
    const ground = map.createLayer('ground', tilesets);
    const obstacles = map.createLayer('obstacles', tilesets);
    if (!ground || !obstacles) throw new Error(`Map "${info.id}" needs "ground" and "obstacles" tile layers`);
    ground.setDepth(DEPTH.ground);
    obstacles.setDepth(DEPTH.obstacles);
    obstacles.setCollisionByProperty({ collides: true });
    // Optional; never collides (collision lives in "obstacles").
    if (map.getLayerIndex('above') !== null) map.createLayer('above', tilesets)?.setDepth(DEPTH.above);

    this.player = this.addCharacter(spawn.x, spawn.y, TEXTURES.player, this.standFrame());
    this.player.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, obstacles);

    this.npcs = readNpcSpawns(map).map((npcSpawn) => {
      const sprite = this.addCharacter(npcSpawn.x, npcSpawn.y, TEXTURES.npc, this.npcFrame(npcSpawn, npcSpawn.facing));
      // NPCs never move: the player stops against them and can't push them.
      sprite.body.setImmovable(true);
      sprite.body.pushable = false;
      return { spawn: npcSpawn, sprite };
    });
    this.physics.add.collider(
      this.player,
      this.npcs.map((npc) => npc.sprite),
    );

    // Delivery point markers sit on their rectangle's bottom edge and sort like sprites.
    for (const p of info.deliveryPoints) {
      this.add.image(p.x + p.width / 2, p.y + p.height, TEXTURES.deliveryPoint).setOrigin(0.5, 1).setDepth(p.y + p.height);
    }
    this.addStreetSigns();

    this.emote = this.add.image(0, 0, TEXTURES.emote).setOrigin(0.5, 1).setVisible(false).setDepth(DEPTH.emote);
    this.beacon = this.add.image(0, 0, TEXTURES.beacon).setOrigin(0.5, 1).setVisible(false).setDepth(DEPTH.emote - 1);
    this.arrow = this.add.sprite(0, 0, TEXTURES.targetArrow, 0).setOrigin(0).setScrollFactor(0).setVisible(false).setDepth(DEPTH.arrow);
    this.ticketBox = this.add.rectangle(0, 0, 0, 0, HUD.box).setOrigin(0).setScrollFactor(0).setDepth(DEPTH.ticket);
    this.ticketText = this.add.bitmapText(0, 0, FONT.key, '').setScrollFactor(0).setDepth(DEPTH.ticket + 1);
    this.refreshTicket();

    // The player walks inside the map's walkable area; the camera sees the whole map. On generated
    // maps the area is at least half a screen inside every edge, so the camera never stops scrolling.
    const { walk } = info;
    this.physics.world.setBounds(walk.x, walk.y, walk.width, walk.height);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.startFollow(this.player, true);
    if (walk.width < map.widthInPixels || walk.height < map.heightInPixels) this.buildMinimap(map);
    this.buildZoneGrid(map);

    // Each physics step consumes the planned step; plan the next one right after it.
    // (Keep the world: by SHUTDOWN, this.physics.world has already been cleared.)
    const world = this.physics.world;
    world.on(Phaser.Physics.Arcade.Events.WORLD_STEP, this.onWorldStep, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => world.off(Phaser.Physics.Arcade.Events.WORLD_STEP, this.onWorldStep, this));

    this.controls = new Controls(this);
    this.warpArmed = !this.warpUnderFeet();

    if (data.viaWarp) {
      this.warping = true;
      this.controls.setLocked(true);
      this.cameras.main.fadeIn(WARP_FADE_MS, 0, 0, 0);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_IN_COMPLETE, () => {
        this.warping = false;
        this.controls.setLocked(false);
        // Maps with zones name the zone once the player is in one (see updateZone).
        if (this.zoneIds.length === 0) this.showNameCard(t(this.info.nameId));
      });
    }
  }

  update(time: number): void {
    // Read input every frame, even while locked, so presses made during a fade are swallowed.
    const action = this.controls.actionPressed();
    const dir = this.controls.direction();

    if (this.warping) {
      this.stopWalking();
    } else if (this.talking) {
      // Movement is locked while the text window is open; Action drives the window.
      this.stopWalking();
      if (action) this.advanceDialogue();
    } else {
      const warp = this.warpUnderFeet();
      if (!warp) this.warpArmed = true;
      else if (this.warpArmed) {
        this.startWarp(warp);
        return;
      }

      if (dir) {
        this.facing = this.facingFor(dir);
        if (dir !== this.moveDir) {
          this.moveDir = dir;
          this.planStep();
        }
        this.player.anims.play(`player-walk-${this.facing}`, true);
      } else {
        this.stopWalking();
      }

      if (action) {
        const npc = this.npcInFront();
        const point = npc ? undefined : this.pointInFront();
        if (npc) this.startDialogue(npc);
        else if (point) this.useDeliveryPoint(point);
        else {
          // Nobody to talk to: a "!" bubble confirms the input works.
          this.emote.setVisible(true);
          this.emoteHideAt = time + EMOTE_MS;
        }
      }
    }

    // The physics body already holds this frame's position (the sprite syncs to it
    // after update), so read the body to avoid trailing the player by a frame.
    const { body } = this.player;
    this.player.setDepth(body.bottom);
    if (this.emote.visible) {
      this.emote.setPosition(body.center.x, body.bottom - PLAYER_FRAME.height - 1);
      if (time >= this.emoteHideAt) this.emote.setVisible(false);
    }
    if (this.ticketBox.visible) this.placeTicket();
    this.updateWayfinding(time);
    this.updateZone(time);
  }

  /**
   * Facing on a diagonal reuses a cardinal frame (Claude's choice, no diagonal sprites): keep the
   * current facing if it's one of the diagonal's two directions, else face sideways.
   */
  private facingFor(dir: Direction8): Direction {
    if ((DIRECTIONS as readonly string[]).includes(dir)) return dir as Direction;
    const [vertical, horizontal] = dir.split('-') as [Direction, Direction];
    return this.facing === vertical || this.facing === horizontal ? this.facing : horizontal;
  }

  /**
   * Sets the velocity for the next physics step in whole pixels per axis. Straight: STEP_PX.
   * Diagonal: STEP_PX / sqrt(2) per axis, accumulated, so each axis moves 1 or 2 px a step and
   * the diagonal speed averages STEP_PX. While a wall blocks one axis, the other moves at full
   * speed (sliding along the wall instead of crawling).
   */
  private planStep(): void {
    const step = this.moveDir ? STEP[this.moveDir] : { x: 0, y: 0 };
    const b = this.player.body.blocked;
    const blockedX = (step.x < 0 && b.left) || (step.x > 0 && b.right);
    const blockedY = (step.y < 0 && b.up) || (step.y > 0 && b.down);
    const diagonal = step.x !== 0 && step.y !== 0;
    const speed = (axis: 'x' | 'y', otherBlocked: boolean) => (step[axis] === 0 ? 0 : diagonal && !otherBlocked ? STEP_PX / Math.SQRT2 : STEP_PX);
    for (const axis of ['x', 'y'] as const) {
      const s = speed(axis, axis === 'x' ? blockedY : blockedX);
      this.planned[axis] = Math.floor(this.acc[axis] + s + 1e-9);
    }
    this.player.setVelocity(step.x * this.planned.x * 60, step.y * this.planned.y * 60);
  }

  /** After each physics step: keep the leftover sub-pixel progress, then plan the next step. */
  private onWorldStep(): void {
    if (!this.moveDir) return;
    const step = STEP[this.moveDir];
    const b = this.player.body.blocked;
    const blockedX = (step.x < 0 && b.left) || (step.x > 0 && b.right);
    const blockedY = (step.y < 0 && b.up) || (step.y > 0 && b.down);
    const diagonal = step.x !== 0 && step.y !== 0;
    for (const axis of ['x', 'y'] as const) {
      if (step[axis] === 0) continue;
      const s = diagonal && !(axis === 'x' ? blockedY : blockedX) ? STEP_PX / Math.SQRT2 : STEP_PX;
      this.acc[axis] = Math.max(0, this.acc[axis] + s - this.planned[axis]);
    }
    this.planStep();
  }

  /** The warp whose rectangle contains the centre of the player's feet box, if any. */
  private warpUnderFeet(): Warp | undefined {
    const { center } = this.player.body;
    return this.info.warps.find((w) => insideWarp(w, center.x, center.y));
  }

  /** Fade out with input locked, then restart this scene on the target map. */
  private startWarp(warp: Warp): void {
    // Resolve now, so a broken link throws (dev) before the screen goes dark.
    const dest = resolveDestination(warp.targetMap, warp.targetSpawn);
    this.warping = true;
    this.controls.setLocked(true);
    this.stopWalking();
    this.emote.setVisible(false);
    this.cameras.main.fadeOut(WARP_FADE_MS, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      const next: MapSceneData = { mapId: dest.map.id, spawnId: dest.spawn.spawnId, viaWarp: true };
      this.scene.restart(next);
    });
  }

  /** A name (a map's or a zone's) in the top-left corner for a moment. */
  private showNameCard(name: string): void {
    for (const o of this.nameCard) o.destroy();
    const pad = 3;
    const text = this.add
      .bitmapText(4 + pad, 4 + pad, FONT.key, name)
      .setScrollFactor(0)
      .setDepth(DEPTH.nameCard + 1);
    const box = this.add
      .rectangle(4, 4, [...name].length * FONT.charWidth + 2 * pad, FONT.lineHeight + 2 * pad, HUD.box)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(DEPTH.nameCard);
    this.nameCard = [text, box];
    this.time.delayedCall(NAME_CARD_MS, () => {
      text.destroy();
      box.destroy();
    });
  }

  /** Street-name signs at intersections: two lines on a dark green plate, one corner at the sign's point. */
  private addStreetSigns(): void {
    for (const sign of this.info.signs) {
      const lines = [t(sign.street), t(sign.cross)];
      const width = Math.max(...lines.map((l) => [...l].length)) * FONT.charWidth + 2 * SIGN_PAD;
      const height = lines.length * FONT.lineHeight + 2 * SIGN_PAD;
      const x = sign.align.endsWith('e') ? sign.x - width : sign.x;
      const y = sign.align.startsWith('s') ? sign.y - height : sign.y;
      this.add.rectangle(x, y, width, height, HUD.sign).setOrigin(0).setDepth(DEPTH.signs);
      this.add.bitmapText(x + SIGN_PAD, y + SIGN_PAD, FONT.key, lines.join('\n')).setDepth(DEPTH.signs + 0.01);
    }
  }

  /**
   * The minimap: every walkable tile of the map's walkable area, MINIMAP.pixelsPer px per
   * MINIMAP.tilesPer tiles (one short block = 3 px), drawn once into a canvas texture. Streets
   * light, blocks dark; plazas and the el in their own colours.
   */
  private buildMinimap(map: Phaser.Tilemaps.Tilemap): void {
    const { walk } = this.info;
    const tw = map.tileWidth;
    // One tile in from the walkable area's corner, so the 4-tile streets fall on single pixel columns.
    const ox = walk.x / tw + 1;
    const oy = walk.y / tw + 1;
    const mm = (tile: number, o: number) => Math.floor(((tile + 0.5 - o) * MINIMAP.pixelsPer) / MINIMAP.tilesPer);
    const width = mm(walk.x / tw + walk.width / tw - 1, ox) + 1;
    const height = mm(walk.y / tw + walk.height / tw - 1, oy) + 1;
    const key = `${TEXTURES.minimap}-${this.info.id}`;
    if (!this.textures.exists(key)) {
      const tex = this.textures.createCanvas(key, width + 2, height + 2);
      if (!tex) throw new Error('Could not create the minimap texture');
      const ctx = tex.getContext();
      const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
      ctx.fillStyle = hex(HUD.mapFrame);
      ctx.fillRect(0, 0, width + 2, height + 2);
      ctx.fillStyle = hex(HUD.mapBlock);
      ctx.fillRect(1, 1, width, height);
      const first = map.tilesets.find((ts) => ts.name === TEXTURES.tiles)?.firstgid ?? 1;
      // Buildings stand on sidewalk ground tiles; their obstacle tile marks them as blocks.
      const BUILDING = new Set(['wall', 'roof', 'roof-edge', 'storefront', 'house', 'station']);
      const kind = (groundGid: number, obstacleGid: number) => {
        if (BUILDING.has(tileIds.tiles[obstacleGid - first])) return 0;
        const name = tileIds.tiles[groundGid - first];
        if (name === 'plaza' || name === 'paseo') return 3;
        if (name === 'el-shadow') return 2;
        return name === 'road' || name === 'sidewalk' || name?.startsWith('curb') || name?.startsWith('center-line') || name?.startsWith('lane-dash') || name?.startsWith('crosswalk') ? 1 : 0;
      };
      const best = new Uint8Array(width * height);
      const groundData = map.getLayer('ground')?.data ?? [];
      const obstacleData = map.getLayer('obstacles')?.data ?? [];
      for (let ty = walk.y / tw; ty < (walk.y + walk.height) / tw; ty++) {
        for (let tx = walk.x / tw; tx < (walk.x + walk.width) / tw; tx++) {
          const k = kind(groundData[ty]?.[tx]?.index ?? 0, obstacleData[ty]?.[tx]?.index ?? 0);
          const px = Math.max(0, mm(tx, ox));
          const py = Math.max(0, mm(ty, oy));
          if (k > best[py * width + px]) best[py * width + px] = k;
        }
      }
      const colours = [0, HUD.mapRoad, HUD.mapEl, HUD.mapPlaza];
      best.forEach((k, i) => {
        if (!k) return;
        ctx.fillStyle = hex(colours[k]);
        ctx.fillRect(1 + (i % width), 1 + Math.floor(i / width), 1, 1);
      });
      tex.refresh();
    }
    const x = GAME_WIDTH - MINIMAP.margin - (width + 2);
    const image = this.add.image(x, MINIMAP.margin, key).setOrigin(0).setScrollFactor(0).setDepth(DEPTH.minimap);
    const marker = (colour: number, depth: number) => this.add.rectangle(0, 0, MINIMAP.marker, MINIMAP.marker, colour).setOrigin(0).setScrollFactor(0).setDepth(DEPTH.minimap + depth);
    this.minimap = { image, ox, oy, width, height, dispatcher: marker(HUD.dispatcher, 1), target: marker(HUD.target, 2), player: marker(HUD.player, 3) };
  }

  /** The minimap pixel (relative to its inner top-left) of a map position, clamped to the minimap. */
  minimapPixel(x: number, y: number): [number, number] {
    const m = this.minimap;
    if (!m) return [0, 0];
    const px = Math.floor(((x / TILE_SIZE - m.ox) * MINIMAP.pixelsPer) / MINIMAP.tilesPer);
    const py = Math.floor(((y / TILE_SIZE - m.oy) * MINIMAP.pixelsPer) / MINIMAP.tilesPer);
    return [Phaser.Math.Clamp(px, 0, m.width - 1), Phaser.Math.Clamp(py, 0, m.height - 1)];
  }

  /** Zone index + 1 per tile, first area first; crossings are in no area, so they keep the last zone. */
  private buildZoneGrid(map: Phaser.Tilemaps.Tilemap): void {
    const w = map.width;
    this.mapWidth = w;
    this.zoneIds = [...new Set(this.info.zones.map((z) => z.zoneId))];
    this.zoneGrid = new Uint8Array(w * map.height);
    for (const z of this.info.zones) {
      const n = this.zoneIds.indexOf(z.zoneId) + 1;
      for (let ty = z.y / TILE_SIZE; ty < (z.y + z.height) / TILE_SIZE; ty++) {
        for (let tx = z.x / TILE_SIZE; tx < (z.x + z.width) / TILE_SIZE; tx++) if (!this.zoneGrid[ty * w + tx]) this.zoneGrid[ty * w + tx] = n;
      }
    }
  }

  /** The zone under the player's feet, or null (a crossing or an unnamed street). */
  zoneAt(x: number, y: number): string | null {
    const n = this.zoneGrid[Math.floor((y - 1) / TILE_SIZE) * this.mapWidth + Math.floor(x / TILE_SIZE)];
    return n ? this.zoneIds[n - 1] : null;
  }

  /** Name card when the player has been in a new zone for ZONE_CARD.settleMs (so crossings don't flash). */
  private updateZone(time: number): void {
    if (this.zoneIds.length === 0 || this.warping) return;
    const zone = this.zoneAt(this.player.x, this.player.y);
    if (zone === null || zone === this.zoneShown) {
      this.zoneSeen = { id: zone, since: time };
      return;
    }
    if (this.zoneSeen.id !== zone) this.zoneSeen = { id: zone, since: time };
    else if (time - this.zoneSeen.since >= ZONE_CARD.settleMs) {
      this.zoneShown = zone;
      this.showNameCard(t(`zone.${zone}.name`));
    }
  }

  /** Where to go next: the active order's door, or the Dispatcher while no order is active and some remain. */
  private target(): Target | null {
    const active = this.state.active;
    if (active) {
      const stop = active.status === 'assigned' ? active.order.pickup : active.order.dropoff;
      if (stop.map !== this.info.id) return null;
      return this.info.deliveryPoints.find((p) => p.pointId === stop.pointId) ?? null;
    }
    if (this.state.orders.every((o) => this.state.completed.includes(o.id))) return null;
    const d = this.npcs.find((n) => n.spawn.role === 'dispatcher');
    return d ? { x: d.sprite.x - PLAYER_FRAME.width / 2, y: d.sprite.y - PLAYER_FRAME.height, width: PLAYER_FRAME.width, height: PLAYER_FRAME.height } : null;
  }

  /** Minimap markers, the beacon over the target, and the edge arrow while the target is off-screen. */
  private updateWayfinding(time: number): void {
    const target = this.target();
    const blinkOn = Math.floor(time / MINIMAP.blinkMs) % 2 === 0;
    // Beacon: bobs 1 px every 250 ms above the target (whole pixels).
    this.beacon.setVisible(!!target && !this.talking);
    if (target) this.beacon.setPosition(Math.round(target.x + target.width / 2), target.y - 2 - (Math.floor(time / 250) % 2));

    const m = this.minimap;
    if (m) {
      const shown = !this.talking;
      const place = (r: Phaser.GameObjects.Rectangle, x: number, y: number) => {
        const [px, py] = this.minimapPixel(x, y);
        r.setPosition(m.image.x + 1 + px - 1, m.image.y + 1 + py - 1);
      };
      m.image.setVisible(shown);
      place(m.player, this.player.x, this.player.y - 1);
      m.player.setVisible(shown);
      const d = this.npcs.find((n) => n.spawn.role === 'dispatcher');
      m.dispatcher.setVisible(shown && !!d);
      if (d) place(m.dispatcher, d.sprite.x, d.sprite.y - 1);
      const active = !!this.state.active && !!target;
      m.target.setVisible(shown && active && blinkOn);
      if (active && target) place(m.target, target.x + target.width / 2, target.y + target.height - 1);
    }

    // Edge arrow: only on maps with a minimap (the world map), toward a target that's off-screen.
    const cam = this.cameras.main;
    const view = new Phaser.Geom.Rectangle(cam.scrollX, cam.scrollY, GAME_WIDTH, GAME_HEIGHT);
    const offScreen = !!target && !Phaser.Geom.Rectangle.Overlaps(view, new Phaser.Geom.Rectangle(target.x, target.y, target.width, target.height));
    this.arrow.setVisible(!!m && offScreen && !this.talking);
    if (!this.arrow.visible || !target) return;
    const [x, y, frame] = this.arrowPlacement(target);
    this.arrow.setFrame(frame).setPosition(x, y);
  }

  /**
   * The edge arrow's top-left and frame: on the screen edge (TARGET_ARROW.inset inside it) where
   * the line from the player to the target leaves the screen, pointing along that line, and moved
   * off the minimap and the order ticket if it lands on them.
   */
  arrowPlacement(target: Target): [number, number, number] {
    const cam = this.cameras.main;
    const { size, inset } = TARGET_ARROW;
    const sx = this.player.x - cam.scrollX;
    const sy = this.player.y - PLAYER_FRAME.height / 2 - cam.scrollY;
    const dx = target.x + target.width / 2 - cam.scrollX - sx;
    const dy = target.y + target.height / 2 - cam.scrollY - sy;
    // Eight sectors clockwise from up, like the thumbstick (DIRECTIONS_8 order = the arrow's frames).
    const frame = ((Math.round((Math.atan2(dx, -dy) / (2 * Math.PI)) * 8) % 8) + 8) % 8;
    const [x0, y0, x1, y1] = [inset, inset, GAME_WIDTH - inset - size, GAME_HEIGHT - inset - size];
    const k = Math.min(dx > 0 ? (x1 + size / 2 - sx) / dx : dx < 0 ? (x0 + size / 2 - sx) / dx : Infinity, dy > 0 ? (y1 + size / 2 - sy) / dy : dy < 0 ? (y0 + size / 2 - sy) / dy : Infinity);
    let x = Phaser.Math.Clamp(Math.round(sx + dx * k - size / 2), x0, x1);
    let y = Phaser.Math.Clamp(Math.round(sy + dy * k - size / 2), y0, y1);
    const hits = (o: Phaser.GameObjects.Components.GetBounds & { visible: boolean }) => {
      if (!o.visible) return null;
      const b = o.getBounds();
      return x < b.right && x + size > b.x && y < b.bottom && y + size > b.y ? b : null;
    };
    const mm = this.minimap && hits(this.minimap.image);
    if (mm) y = Math.ceil(mm.bottom) + 1;
    const tk = hits(this.ticketBox);
    if (tk) y = tk.y < GAME_HEIGHT / 2 ? Math.ceil(tk.bottom) + 1 : Math.floor(tk.y) - size - 1;
    return [x, y, frame];
  }

  /**
   * The order ticket: the active order's item and status, and where to go next (the pickup's
   * intersection until it's picked up, then the dropoff's). Hidden with no active order.
   */
  private refreshTicket(): void {
    const active = this.state.active;
    this.ticketBox.setVisible(!!active);
    this.ticketText.setVisible(!!active);
    if (!active) return;
    const { order, status } = active;
    const stop = status === 'assigned' ? order.pickup : order.dropoff;
    const lines = [t(`hud.order.${status}`, { item: t(order.text.item) }), t(`hud.go.${status}`, { place: placeName(stop) })];
    this.ticketText.setText(lines.join('\n'));
    const { pad } = ORDER_TICKET;
    this.ticketBox.setSize(Math.max(...lines.map((l) => [...l].length)) * FONT.charWidth + 2 * pad, lines.length * FONT.lineHeight + 2 * pad);
    this.placeTicket();
  }

  /** Centred at the bottom, or at the top while it would cover the player's sprite; whole pixels. */
  private placeTicket(): void {
    const { top, margin, pad } = ORDER_TICKET;
    const { width, height } = this.ticketBox;
    const x = Math.floor((GAME_WIDTH - width) / 2);
    const cam = this.cameras.main;
    const { body } = this.player;
    const left = body.center.x - PLAYER_FRAME.width / 2 - cam.scrollX;
    const feet = body.bottom - cam.scrollY;
    const bottomY = GAME_HEIGHT - margin - height;
    const covered = left < x + width && left + PLAYER_FRAME.width > x && feet - PLAYER_FRAME.height < bottomY + height && feet > bottomY;
    const y = covered ? top : bottomY;
    this.ticketBox.setPosition(x, y);
    this.ticketText.setPosition(x + pad, y + pad);
  }

  /** A sprite with a feet-sized physics body; position = feet, depth = feet y. */
  private addCharacter(x: number, y: number, texture: string, frame: number) {
    const sprite = this.physics.add.sprite(x, y, texture, frame).setOrigin(0.5, 1).setDepth(y);
    const { width, height } = sprite.frame;
    // Collide with the feet only, so the head can overlap things "behind" the character.
    sprite.body
      .setSize(PLAYER_FEET.width, PLAYER_FEET.height, false)
      .setOffset((width - PLAYER_FEET.width) / 2, height - PLAYER_FEET.height);
    return sprite;
  }

  private stopWalking(): void {
    this.moveDir = null;
    this.acc = { x: 0, y: 0 };
    this.planned = { x: 0, y: 0 };
    this.player.setVelocity(0, 0);
    if (this.player.anims.isPlaying) {
      this.player.anims.stop();
      this.player.setFrame(this.standFrame());
    }
  }

  /** The strip of TALK_RANGE px directly in front of the player's feet box, in the facing direction. */
  private talkProbe(): Phaser.Geom.Rectangle {
    const b = this.player.body;
    const v = VELOCITY[this.facing];
    return new Phaser.Geom.Rectangle(
      v.x > 0 ? b.right : v.x < 0 ? b.x - TALK_RANGE : b.x,
      v.y > 0 ? b.bottom : v.y < 0 ? b.y - TALK_RANGE : b.y,
      v.x !== 0 ? TALK_RANGE : b.width,
      v.y !== 0 ? TALK_RANGE : b.height,
    );
  }

  /** The nearest delivery point whose rectangle overlaps the talk probe. */
  private pointInFront(): DeliveryPoint | undefined {
    const probe = this.talkProbe();
    const { center } = this.player.body;
    const dist = (p: DeliveryPoint) => Phaser.Math.Distance.Between(center.x, center.y, p.x + p.width / 2, p.y + p.height / 2);
    return this.info.deliveryPoints
      .filter((p) => Phaser.Geom.Rectangle.Overlaps(probe, new Phaser.Geom.Rectangle(p.x, p.y, p.width, p.height)))
      .sort((a, b) => dist(a) - dist(b))[0];
  }

  /** The nearest NPC whose feet box overlaps the talk probe. */
  private npcInFront(): Npc | null {
    const b = this.player.body;
    const probe = this.talkProbe();
    let best: Npc | null = null;
    let bestDist = Infinity;
    for (const npc of this.npcs) {
      const nb = npc.sprite.body;
      if (!Phaser.Geom.Rectangle.Overlaps(probe, new Phaser.Geom.Rectangle(nb.x, nb.y, nb.width, nb.height))) continue;
      const dist = Phaser.Math.Distance.Between(b.center.x, b.center.y, nb.center.x, nb.center.y);
      if (dist < bestDist) {
        best = npc;
        bestDist = dist;
      }
    }
    return best;
  }

  private startDialogue(npc: Npc): void {
    const name = t(`npc.${npc.spawn.npcId}.name`);
    const entries = DIALOGUE[npc.spawn.dialogueId].map((id) => t(id, { name }));
    if (npc.spawn.role === 'dispatcher') entries.push(this.dispatch());
    // The NPC turns to face the player.
    npc.sprite.setFrame(this.npcFrame(npc.spawn, OPPOSITE[this.facing]));
    this.openDialogue(entries);
  }

  /** The dispatcher assigns the next order (or says why not); returns their line. */
  private dispatch(): string {
    const result = this.state.assignNext();
    this.refreshTicket();
    if (result.kind === 'none-left') return t('dispatcher.none-left');
    if (result.kind === 'busy') return t(`dispatcher.busy.${result.active.status}`, orderParams(result.active.order));
    return t(result.order.text.assign, orderParams(result.order));
  }

  /** Action at a delivery point: pick up or deliver the active order, else a short "nothing here". */
  private useDeliveryPoint(point: DeliveryPoint): void {
    const result = this.state.interact(this.info.id, point.pointId);
    this.refreshTicket();
    const line =
      result.kind === 'nothing'
        ? t('delivery.nothing')
        : result.kind === 'not-picked-up'
          ? t('delivery.not-picked-up', orderParams(result.order))
          : t(result.kind === 'picked-up' ? result.order.text.pickedUp : result.order.text.delivered, orderParams(result.order));
    this.openDialogue([line]);
  }

  private openDialogue(entries: string[]): void {
    const data: DialogueData = {
      entries,
      // Near the top edge of the map the camera stops scrolling, so the player can be in
      // the top half of the screen; move the window out of the way then.
      atBottom: this.player.y - this.cameras.main.scrollY < GAME_HEIGHT / 2,
    };
    this.emote.setVisible(false);
    this.talking = true;
    this.scene.launch('Dialogue', data);
  }

  private advanceDialogue(): void {
    const dialogue = this.scene.get('Dialogue') as DialogueScene;
    if (!this.scene.isActive('Dialogue')) return; // launch is queued until the next step
    if (dialogue.advance() === 'closed') {
      this.scene.stop('Dialogue');
      this.talking = false;
    }
  }

  private npcFrame(spawn: NpcSpawn, dir: Direction): number {
    return spawn.look * DIRECTIONS.length + DIRECTIONS.indexOf(dir);
  }

  private standFrame(): number {
    return DIRECTIONS.indexOf(this.facing) * PLAYER_FRAME.columns;
  }
}

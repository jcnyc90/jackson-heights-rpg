import Phaser from 'phaser';
import {
  DIRECTIONS,
  FEATURES,
  FONT,
  GAME_HEIGHT,
  GAME_WIDTH,
  HUD_BOX,
  ORDER_TICKET,
  PLAYER_FEET,
  PLAYER_FRAME,
  PLAYER_SPEED,
  RADAR,
  RIDE_SPEED,
  RIDER_FRAME,
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
import { insideWarp, resolveDestination, START, type DeliveryPoint, type DockRect, type MapInfo, type Warp } from '../systems/maps';
import { DIALOGUE, readNpcSpawns, type NpcSpawn } from '../systems/npcs';
import { orderParams, placeName } from '../systems/orders';
import { Radar } from '../systems/radar';
import { showSpeed } from '../systems/touchControls';
import { t } from '../systems/strings';
import { WorldView } from '../systems/worldView';
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
/**
 * Pixels per physics step: 2.5 at every speed (whole pixels via the accumulator, 2 and 3 alternately; 4 for the one
 * step where a diagonal starts sliding along a wall, carrying the diagonal's leftover). Walking at PLAYER_SPEED the
 * physics runs at 60 Hz; faster (riding, the speed setting: session 6f) it runs proportionally more steps a second,
 * so no step moves more than 4 px and the player can't pass through a wall (16 px), a prop or an NPC's feet (8 px).
 */
const STEP_PX = PLAYER_SPEED / 60;
// Sprites sort by feet y (their depth): characters, and on the world map buildings, trees, posts
// and signs too. "ground" and "obstacles" stay below them; "above" (tree canopies on the test map)
// draws over every sprite, then the HUD.
const DEPTH = { ground: -2, obstacles: -1, above: 5e5, emote: 1e6, arrow: 1.4e6, ticket: 1.5e6, radar: 1.6e6, corner: 1.7e6, nameCard: 2e6 } as const;
// HUD colours (EarthBound-ish pastels on the dark outline colour).
const HUD = { box: 0x2a1f3d } as const;

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
 * Movement (session 6d, 150 px/s since 6e): eight directions at 2.5 px per physics step in whole
 * pixels (2 or 3); diagonals step each axis by 1 or 2 px so their speed averages the same, and slide
 * along walls at full speed.
 *
 * A warp fades out, restarts this scene on the target map, and fades in. Input is locked
 * from the step onto the warp until the fade-in ends, and presses held across it go stale.
 *
 * Delivery orders (DESIGN.md 2.13): talking to a dispatcher NPC assigns the next order, and
 * Action at a delivery point picks it up or delivers it. Order state lives in gameState, which
 * survives the restart; the order ticket is rebuilt from it on every map. Wayfinding (6e): a
 * radar, the corner name at crossings, an edge arrow toward an off-screen target, a beacon over
 * it, and zone name cards. The world map draws through WorldView (chunked; see worldView.ts).
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
  /** For a question (session 6f): what to do with the answer when the window closes. */
  private onChoice: ((choice: number) => void) | null = null;
  /** The direction held last frame while talking (a new press moves a question's selection). */
  private talkDir: Direction8 | null = null;
  /** True from stepping onto a warp until the next map has faded in. */
  private warping = false;
  /** Warps fire only after the player has stood off every warp (so arrival can't bounce back). */
  private warpArmed = false;
  /** The world map's renderer (null on bundled maps like the test map). */
  world: WorldView | null = null;
  // Wayfinding (world map only): the radar, the corner name at crossings.
  radar: Radar | null = null;
  private cornerBox: Phaser.GameObjects.Rectangle | null = null;
  private cornerText: Phaser.GameObjects.BitmapText | null = null;
  /** The crossing the player stands in, as shown by the corner HUD ("78th St & 37th Ave"), or null. */
  cornerShown: string | null = null;
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
    this.onChoice = null;
    this.talkDir = null;
    this.warping = false;
    this.moveDir = null;
    this.acc = { x: 0, y: 0 };
    this.planned = { x: 0, y: 0 };
    this.world = null;
    this.radar = null;
    this.cornerBox = null;
    this.cornerText = null;
    this.cornerShown = null;
    this.zoneShown = null;
    this.zoneSeen = { id: null, since: 0 };
    this.nameCard = [];

    const { map: info, spawn } = data.mapId
      ? resolveDestination(data.mapId, data.spawnId ?? '')
      : START;
    this.info = info;
    this.facing = spawn.facing;

    // The world map (external, decoded at startup) draws through WorldView; bundled maps through
    // Phaser's Tiled loader. Either way the player collides with one tile layer.
    let map: Phaser.Tilemaps.Tilemap;
    let obstacles: Phaser.Tilemaps.TilemapLayer;
    if (info.world) {
      this.world = new WorldView(this, info, info.world, { ground: DEPTH.ground, collision: DEPTH.obstacles }, (id) => this.state.bikesAt(id));
      map = this.world.map;
      obstacles = this.world.collision;
    } else {
      map = this.make.tilemap({ key: info.id });
      // Phaser drops external (.tsx/.tsj) tilesets with only a console warning.
      if (map.tilesets.length === 0) throw new Error(`Map "${info.id}" has no embedded tileset (embed it in Tiled)`);
      // Convention: each Tiled tileset is named after the texture key that draws it.
      const tilesets = map.tilesets.map((ts) => {
        const tileset = map.addTilesetImage(ts.name);
        if (!tileset) throw new Error(`No texture loaded for tileset "${ts.name}"`);
        return tileset;
      });
      const ground = map.createLayer('ground', tilesets);
      const obs = map.createLayer('obstacles', tilesets);
      if (!ground || !obs) throw new Error(`Map "${info.id}" needs "ground" and "obstacles" tile layers`);
      ground.setDepth(DEPTH.ground);
      obs.setDepth(DEPTH.obstacles);
      obs.setCollisionByProperty({ collides: true });
      obstacles = obs as Phaser.Tilemaps.TilemapLayer;
      // Optional; never collides (collision lives in "obstacles").
      if (map.getLayerIndex('above') !== null) map.createLayer('above', tilesets)?.setDepth(DEPTH.above);
    }
    const mapWidth = info.world ? info.world.width * TILE_SIZE : map.widthInPixels;
    const mapHeight = info.world ? info.world.height * TILE_SIZE : map.heightInPixels;

    this.player = this.addCharacter(spawn.x, spawn.y, TEXTURES.player, this.standFrame());
    this.player.setCollideWorldBounds(true);
    // A bike rented before a restart is still being ridden; the speed setting holds too.
    this.applyRider();
    this.physics.add.collider(this.player, obstacles);

    this.npcs = readNpcSpawns(info.world ? (info.data as Parameters<typeof readNpcSpawns>[0]) : map).map((npcSpawn) => {
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

    // Delivery point markers sit on their rectangle's bottom edge and sort like sprites. On the world
    // map the door belongs to a building sprite: the marker draws just over that building.
    for (const p of info.deliveryPoints) {
      const b = info.world?.buildings.find((x) => p.x >= x.x * TILE_SIZE && p.x < (x.x + x.w) * TILE_SIZE && p.y >= x.y * TILE_SIZE && p.y < (x.y + x.h) * TILE_SIZE);
      const depth = b ? (b.y + b.h) * TILE_SIZE + 0.5 : p.y + p.height;
      this.add.image(p.x + p.width / 2, p.y + p.height, TEXTURES.deliveryPoint).setOrigin(0.5, 1).setDepth(depth);
    }

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
    this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);
    this.cameras.main.startFollow(this.player, true);
    if (info.world) {
      this.world?.update(spawn.x, spawn.y, true);
      this.radar = new Radar(this, info.world, walk, RADAR.margin, RADAR.margin, DEPTH.radar, info.docks);
      this.cornerBox = this.add.rectangle(0, 0, 0, 0, HUD.box).setOrigin(0).setScrollFactor(0).setDepth(DEPTH.corner).setVisible(false);
      this.cornerText = this.add.bitmapText(0, 0, FONT.key, '').setScrollFactor(0).setDepth(DEPTH.corner + 1).setVisible(false);
    }
    this.buildZoneGrid(mapWidth / TILE_SIZE, mapHeight / TILE_SIZE);

    // Each physics step consumes the planned step; plan the next one right after it.
    // (Keep the world: by SHUTDOWN, this.physics.world has already been cleared.)
    const world = this.physics.world;
    world.on(Phaser.Physics.Arcade.Events.WORLD_STEP, this.onWorldStep, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => world.off(Phaser.Physics.Arcade.Events.WORLD_STEP, this.onWorldStep, this));

    this.controls = new Controls(this);
    this.warpArmed = !this.warpUnderFeet();
    showSpeed(this.state.speedLevel);

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
    const speedLevel = this.controls.speedPressed();
    if (speedLevel !== null && speedLevel !== this.state.speedLevel) this.setSpeedLevel(speedLevel);

    if (this.warping) {
      this.stopWalking();
    } else if (this.talking) {
      // Movement is locked while the text window is open; Action drives the window, and a new direction press
      // moves a question's selection (up/left: previous answer, down/right: next).
      this.stopWalking();
      if (dir && dir !== this.talkDir && this.scene.isActive('Dialogue')) (this.scene.get('Dialogue') as DialogueScene).moveChoice(STEP[dir].y || STEP[dir].x);
      this.talkDir = dir;
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
        this.player.anims.play(`${this.state.riding ? 'rider-ride' : 'player-walk'}-${this.facing}`, true);
      } else {
        this.stopWalking();
      }

      if (action) {
        const npc = this.npcInFront();
        const point = npc ? undefined : this.pointInFront();
        const dock = npc || point || !FEATURES.riding ? undefined : this.dockInFront();
        if (npc) this.startDialogue(npc);
        else if (point) this.useDeliveryPoint(point);
        else if (dock) this.useDock(dock);
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
    this.world?.update(body.center.x, body.bottom, false, this.speed());
    if (this.emote.visible) {
      this.emote.setPosition(body.center.x, body.bottom - PLAYER_FRAME.height - 1);
      if (time >= this.emoteHideAt) this.emote.setVisible(false);
    }
    if (this.ticketBox.visible) this.placeTicket();
    this.updateWayfinding(time);
    this.updateCorner();
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
    const fps = this.physics.world.fps;
    this.player.setVelocity(step.x * this.planned.x * fps, step.y * this.planned.y * fps);
  }

  /** The player's speed now, px/s: walking or riding, times the speed setting (2 ** level; session 6f). */
  speed(): number {
    return (this.state.riding ? RIDE_SPEED : PLAYER_SPEED) * 2 ** this.state.speedLevel;
  }

  /** Physics steps a second for the current speed, so every step stays STEP_PX (60 Hz walking at x1, up to 960 Hz). */
  private applySpeed(): void {
    const fps = (60 * this.speed()) / PLAYER_SPEED;
    if (this.physics.world.fps === fps) return;
    this.physics.world.setFPS(fps);
    if (this.moveDir) this.planStep(); // the velocity of the planned step follows the new step rate
  }

  /** The speed buttons and keys 0-3 (owner's decision 5): x1, x2, x4, x8 of the current base speed; held until changed. */
  private setSpeedLevel(level: number): void {
    this.state.speedLevel = level;
    this.applySpeed();
    showSpeed(level);
  }

  /**
   * Shows the player walking or on a bike (gameState.riding) and sets the speed. The rider sheet is larger; the
   * feet box stays PLAYER_FEET at the bottom centre, so the feet (and collision) don't move.
   */
  private applyRider(): void {
    const riding = this.state.riding;
    const key = riding ? TEXTURES.rider : TEXTURES.player;
    if (this.player.texture.key !== key) {
      this.player.anims.stop();
      this.player.setTexture(key, this.standFrame());
      const f = riding ? RIDER_FRAME : PLAYER_FRAME;
      this.player.body.setOffset((f.width - PLAYER_FEET.width) / 2, f.height - PLAYER_FEET.height);
      this.player.body.reset(this.player.x, this.player.y);
    }
    this.applySpeed();
  }

  /**
   * After each physics step: keep the collision window around the player (session 6f: at high speed a long frame
   * runs many steps), keep the leftover sub-pixel progress, then plan the next step.
   */
  private onWorldStep(): void {
    if (!this.moveDir) return;
    this.world?.keepWindow(this.player.body.center.x, this.player.body.bottom);
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

  /** A HUD box at the top right, `row` boxes down (0 = the corner name, 1 = the zone card). */
  private hudBoxAt(row: number, text: string): { x: number; y: number; width: number; height: number } {
    const { margin, pad, gap } = HUD_BOX;
    const width = [...text].length * FONT.charWidth + 2 * pad;
    const height = FONT.lineHeight + 2 * pad;
    return { x: GAME_WIDTH - margin - width, y: margin + row * (height + gap), width, height };
  }

  /** A name (a map's or a zone's) at the top right, under the corner name, for a moment. */
  private showNameCard(name: string): void {
    for (const o of this.nameCard) o.destroy();
    const r = this.hudBoxAt(this.radar ? 1 : 0, name);
    const text = this.add
      .bitmapText(r.x + HUD_BOX.pad, r.y + HUD_BOX.pad, FONT.key, name)
      .setScrollFactor(0)
      .setDepth(DEPTH.nameCard + 1);
    const box = this.add.rectangle(r.x, r.y, r.width, r.height, HUD.box).setOrigin(0).setScrollFactor(0).setDepth(DEPTH.nameCard);
    this.nameCard = [text, box];
    this.time.delayedCall(NAME_CARD_MS, () => {
      text.destroy();
      box.destroy();
    });
  }

  /** Corner name (owner's decision 6): "78th St & 37th Ave" at the top right while the player stands in a crossing. */
  private updateCorner(): void {
    if (!this.cornerBox || !this.cornerText) return;
    const { center, bottom } = this.player.body;
    const c = this.talking ? undefined : this.info.corners.find((r) => center.x >= r.x && center.x < r.x + r.width && bottom - 1 >= r.y && bottom - 1 < r.y + r.height);
    const name = c ? t('place.corner', { street: t(c.street), cross: t(c.cross) }) : null;
    if (name === this.cornerShown) return;
    this.cornerShown = name;
    this.cornerBox.setVisible(!!name);
    this.cornerText.setVisible(!!name);
    if (!name) return;
    const r = this.hudBoxAt(0, name);
    this.cornerBox.setPosition(r.x, r.y).setSize(r.width, r.height);
    this.cornerText.setText(name).setPosition(r.x + HUD_BOX.pad, r.y + HUD_BOX.pad);
  }

  /** Zone index + 1 per tile, first area first; crossings are in no area, so they keep the last zone. */
  private buildZoneGrid(w: number, h: number): void {
    this.mapWidth = w;
    this.zoneIds = [...new Set(this.info.zones.map((z) => z.zoneId))];
    this.zoneGrid = new Uint8Array(w * h);
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

  /** The radar, the beacon over the target, and the edge arrow while the target is off-screen. */
  private updateWayfinding(time: number): void {
    const target = this.target();
    const blinkOn = Math.floor(time / RADAR.blinkMs) % 2 === 0;
    // Beacon: bobs 1 px every 250 ms above the target (whole pixels).
    this.beacon.setVisible(!!target && !this.talking);
    if (target) this.beacon.setPosition(Math.round(target.x + target.width / 2), target.y - 2 - (Math.floor(time / 250) % 2));

    if (this.radar) {
      this.radar.setVisible(!this.talking);
      const { center, bottom } = this.player.body;
      const dir = this.moveDir ?? this.facing;
      this.radar.update(center.x, bottom - 1, dir, target ? { x: target.x + target.width / 2, y: target.y + target.height / 2 } : null, blinkOn);
    }

    // Edge arrow: only on the world map, toward a target that's off-screen.
    const cam = this.cameras.main;
    const view = new Phaser.Geom.Rectangle(cam.scrollX, cam.scrollY, GAME_WIDTH, GAME_HEIGHT);
    const offScreen = !!target && !Phaser.Geom.Rectangle.Overlaps(view, new Phaser.Geom.Rectangle(target.x, target.y, target.width, target.height));
    this.arrow.setVisible(!!this.radar && offScreen && !this.talking);
    if (!this.arrow.visible || !target) return;
    const [x, y, frame] = this.arrowPlacement(target);
    this.arrow.setFrame(frame).setPosition(x, y);
  }

  /**
   * The edge arrow's top-left and frame: on the screen edge (TARGET_ARROW.inset inside it) where
   * the line from the player to the target leaves the screen, pointing along that line, and moved
   * off the radar, the corner name and the order ticket if it lands on them.
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
    const rd = this.radar && hits(this.radar.image);
    if (rd) {
      // Off the radar: below it on the left edge, else to its right on the top edge.
      if (x <= rd.right && y < rd.bottom && x <= x0) y = Math.ceil(rd.bottom) + 1;
      else x = Math.ceil(rd.right) + 1;
    }
    const cb = this.cornerBox && hits(this.cornerBox);
    if (cb) y = Math.ceil(cb.bottom) + 1;
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

  /** The nearest bike-share dock whose rectangle overlaps the talk probe (session 6f). */
  private dockInFront(): DockRect | undefined {
    const probe = this.talkProbe();
    const { center } = this.player.body;
    const dist = (d: DockRect) => Phaser.Math.Distance.Between(center.x, center.y, Phaser.Math.Clamp(center.x, d.x, d.x + d.width), Phaser.Math.Clamp(center.y, d.y, d.y + d.height));
    return this.info.docks.filter((d) => Phaser.Geom.Rectangle.Overlaps(probe, new Phaser.Geom.Rectangle(d.x, d.y, d.width, d.height))).sort((a, b) => dist(a) - dist(b))[0];
  }

  /**
   * Action at a dock (owner's decision 4; the return rule is Claude's choice): on foot, if it has a bike, a
   * question rents one ("Yes" = riding); riding, if it has a free slot, a question returns the bike there. An
   * empty dock (on foot) or a full one (riding) just says so.
   */
  private useDock(dock: DockRect): void {
    const name = t('bike.name');
    const bikes = this.state.bikesAt(dock.dockId);
    const yesNo = [t('choice.yes'), t('choice.no')];
    if (!this.state.riding) {
      if (bikes === 0) return this.openDialogue([t('bike.empty', { name })]);
      this.openDialogue([t('bike.rent.ask', { name, count: bikes })], yesNo, (c) => {
        if (c === 0 && this.state.rent(dock.dockId)) this.afterDock(dock);
      });
    } else {
      if (bikes >= dock.slots) return this.openDialogue([t('bike.full', { name })]);
      this.openDialogue([t('bike.return.ask', { name })], yesNo, (c) => {
        if (c === 0 && this.state.giveBack(dock.dockId, dock.slots)) this.afterDock(dock);
      });
    }
  }

  /** After renting or returning: the dock's bikes, the player's sprite and speed. */
  private afterDock(dock: DockRect): void {
    this.world?.refreshDock(dock.dockId);
    this.applyRider();
  }

  private openDialogue(entries: string[], choices?: string[], onChoice?: (choice: number) => void): void {
    this.onChoice = onChoice ?? null;
    this.talkDir = this.controls.direction();
    const data: DialogueData = {
      entries,
      ...(choices ? { choices } : {}),
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
      const answer = this.onChoice;
      const choice = dialogue.choice;
      this.onChoice = null;
      this.scene.stop('Dialogue');
      this.talking = false;
      answer?.(choice);
    }
  }

  private npcFrame(spawn: NpcSpawn, dir: Direction): number {
    return spawn.look * DIRECTIONS.length + DIRECTIONS.indexOf(dir);
  }

  private standFrame(): number {
    return DIRECTIONS.indexOf(this.facing) * (this.state.riding ? RIDER_FRAME.columns : PLAYER_FRAME.columns);
  }
}

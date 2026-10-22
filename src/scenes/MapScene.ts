import Phaser from 'phaser';
import {
  DIRECTIONS,
  FONT,
  GAME_HEIGHT,
  PLAYER_FEET,
  PLAYER_FRAME,
  PLAYER_SPEED,
  TALK_RANGE,
  TEXTURES,
  WARP_FADE_MS,
  type Direction,
} from '../config';
import { Controls } from '../systems/controls';
import { insideWarp, resolveDestination, START, type MapInfo, type Warp } from '../systems/maps';
import { DIALOGUE, readNpcSpawns, type NpcSpawn } from '../systems/npcs';
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
const NAME_CARD_MS = 1500;
// Sprites sort by feet y (their depth). "ground" and "obstacles" stay below them; "above"
// (tree canopies, awnings) draws over every sprite, and the emote and name card over that.
const DEPTH = { ground: -2, obstacles: -1, above: 5e5, emote: 1e6, nameCard: 2e6 } as const;

interface Npc {
  spawn: NpcSpawn;
  sprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
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
 * with spawn points and warps, and an optional object layer "npcs" (see readNpcSpawns).
 *
 * A warp fades out, restarts this scene on the target map, and fades in. Input is locked
 * from the step onto the warp until the fade-in ends, and presses held across it go stale.
 */
export class MapScene extends Phaser.Scene {
  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private emote!: Phaser.GameObjects.Image;
  private controls!: Controls;
  private npcs: Npc[] = [];
  private info!: MapInfo;
  private facing: Direction = 'down';
  private emoteHideAt = 0;
  /** True from the Action press that opens the text window until the press that closes it. */
  private talking = false;
  /** True from stepping onto a warp until the next map has faded in. */
  private warping = false;
  /** Warps fire only after the player has stood off every warp (so arrival can't bounce back). */
  private warpArmed = false;

  constructor() {
    super('Map');
  }

  create(data: MapSceneData): void {
    // Reset per-run state (class fields survive scene.restart()).
    this.emoteHideAt = 0;
    this.talking = false;
    this.warping = false;

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

    this.emote = this.add.image(0, 0, TEXTURES.emote).setOrigin(0.5, 1).setVisible(false).setDepth(DEPTH.emote);

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.startFollow(this.player, true);

    this.controls = new Controls(this);
    this.warpArmed = !this.warpUnderFeet();

    if (data.viaWarp) {
      this.warping = true;
      this.controls.setLocked(true);
      this.cameras.main.fadeIn(WARP_FADE_MS, 0, 0, 0);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_IN_COMPLETE, () => {
        this.warping = false;
        this.controls.setLocked(false);
        this.showNameCard();
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
        this.facing = dir;
        this.player.setVelocity(VELOCITY[dir].x * PLAYER_SPEED, VELOCITY[dir].y * PLAYER_SPEED);
        this.player.anims.play(`player-walk-${dir}`, true);
      } else {
        this.stopWalking();
      }

      if (action) {
        const npc = this.npcInFront();
        if (npc) this.startDialogue(npc);
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

  /** The map's display name in the top-left corner for a moment after arriving. */
  private showNameCard(): void {
    const name = t(this.info.nameId);
    const pad = 3;
    const text = this.add
      .bitmapText(4 + pad, 4 + pad, FONT.key, name)
      .setScrollFactor(0)
      .setDepth(DEPTH.nameCard + 1);
    const box = this.add
      .rectangle(4, 4, name.length * FONT.charWidth + 2 * pad, FONT.lineHeight + 2 * pad, 0x2a1f3d)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(DEPTH.nameCard);
    this.time.delayedCall(NAME_CARD_MS, () => {
      text.destroy();
      box.destroy();
    });
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
    this.player.setVelocity(0, 0);
    if (this.player.anims.isPlaying) {
      this.player.anims.stop();
      this.player.setFrame(this.standFrame());
    }
  }

  /**
   * The nearest NPC whose feet box overlaps the strip of TALK_RANGE px directly in
   * front of the player's feet box, in the facing direction.
   */
  private npcInFront(): Npc | null {
    const b = this.player.body;
    const v = VELOCITY[this.facing];
    const probe = new Phaser.Geom.Rectangle(
      v.x > 0 ? b.right : v.x < 0 ? b.x - TALK_RANGE : b.x,
      v.y > 0 ? b.bottom : v.y < 0 ? b.y - TALK_RANGE : b.y,
      v.x !== 0 ? TALK_RANGE : b.width,
      v.y !== 0 ? TALK_RANGE : b.height,
    );
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
    const data: DialogueData = {
      entries: DIALOGUE[npc.spawn.dialogueId].map((id) => t(id, { name })),
      // Near the top edge of the map the camera stops scrolling, so the player can be in
      // the top half of the screen; move the window out of the way then.
      atBottom: this.player.y - this.cameras.main.scrollY < GAME_HEIGHT / 2,
    };
    // The NPC turns to face the player.
    npc.sprite.setFrame(this.npcFrame(npc.spawn, OPPOSITE[this.facing]));
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

import Phaser from 'phaser';
import {
  DIRECTIONS,
  GAME_HEIGHT,
  MAPS,
  PLAYER_FEET,
  PLAYER_FRAME,
  PLAYER_SPEED,
  TALK_RANGE,
  TEXTURES,
  type Direction,
} from '../config';
import { Controls } from '../systems/controls';
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
// Sprites sort by feet y (their depth); the tile layers stay below them and the emote above.
const DEPTH = { ground: -2, obstacles: -1, emote: 1e6 } as const;

interface Npc {
  spawn: NpcSpawn;
  sprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
}

/**
 * Walkable test map. Map conventions (Tiled): tile layers "ground" and "obstacles",
 * tiles with the bool property `collides`, an object layer "objects" holding a point
 * named "player-spawn" (the player's feet), and an object layer "npcs" (see readNpcSpawns).
 */
export class TestMapScene extends Phaser.Scene {
  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private emote!: Phaser.GameObjects.Image;
  private controls!: Controls;
  private npcs: Npc[] = [];
  private facing: Direction = 'down';
  private emoteHideAt = 0;
  /** True from the Action press that opens the text window until the press that closes it. */
  private talking = false;

  constructor() {
    super('TestMap');
  }

  create(): void {
    // Reset per-run state (class fields survive scene.restart()).
    this.facing = 'down';
    this.emoteHideAt = 0;
    this.talking = false;

    const map = this.make.tilemap({ key: MAPS.test });
    // Phaser drops external (.tsx/.tsj) tilesets with only a console warning.
    if (map.tilesets.length === 0) throw new Error('Map has no embedded tileset (embed it in Tiled)');
    // Convention: each Tiled tileset is named after the texture key that draws it.
    const tilesets = map.tilesets.map((ts) => {
      const tileset = map.addTilesetImage(ts.name);
      if (!tileset) throw new Error(`No texture loaded for tileset "${ts.name}"`);
      return tileset;
    });
    const ground = map.createLayer('ground', tilesets);
    const obstacles = map.createLayer('obstacles', tilesets);
    if (!ground || !obstacles) throw new Error('Map needs "ground" and "obstacles" tile layers');
    ground.setDepth(DEPTH.ground);
    obstacles.setDepth(DEPTH.obstacles);
    obstacles.setCollisionByProperty({ collides: true });

    const spawn = map.findObject('objects', (obj) => obj.name === 'player-spawn');
    if (spawn?.x === undefined || spawn.y === undefined) throw new Error('Map needs a "player-spawn" point');

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
  }

  update(time: number): void {
    const action = this.controls.actionPressed();

    if (this.talking) {
      // Movement is locked while the text window is open; Action drives the window.
      this.stopWalking();
      if (action) this.advanceDialogue();
    } else {
      const dir = this.controls.direction();
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

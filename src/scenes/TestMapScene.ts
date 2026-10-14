import Phaser from 'phaser';
import { DIRECTIONS, MAPS, PLAYER_FEET, PLAYER_FRAME, PLAYER_SPEED, TEXTURES, type Direction } from '../config';
import { Controls } from '../systems/controls';

const VELOCITY: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const EMOTE_MS = 500;

/**
 * Walkable test map. Map conventions (Tiled): tile layers "ground" and "obstacles",
 * tiles with the bool property `collides`, and an object layer "objects" holding a
 * point named "player-spawn" (the player's feet).
 */
export class TestMapScene extends Phaser.Scene {
  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private emote!: Phaser.GameObjects.Image;
  private controls!: Controls;
  private facing: Direction = 'down';
  private emoteHideAt = 0;

  constructor() {
    super('TestMap');
  }

  create(): void {
    // Reset per-run state (class fields survive scene.restart()).
    this.facing = 'down';
    this.emoteHideAt = 0;

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
    obstacles.setCollisionByProperty({ collides: true });

    const spawn = map.findObject('objects', (obj) => obj.name === 'player-spawn');
    if (spawn?.x === undefined || spawn.y === undefined) throw new Error('Map needs a "player-spawn" point');

    this.player = this.physics.add.sprite(spawn.x, spawn.y, TEXTURES.player, this.standFrame());
    this.player.setOrigin(0.5, 1); // position = feet
    // Collide with the feet only, so the head can overlap things "behind" the player.
    this.player.body
      .setSize(PLAYER_FEET.width, PLAYER_FEET.height, false)
      .setOffset((PLAYER_FRAME.width - PLAYER_FEET.width) / 2, PLAYER_FRAME.height - PLAYER_FEET.height);
    this.player.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, obstacles);

    this.emote = this.add.image(0, 0, TEXTURES.emote).setOrigin(0.5, 1).setVisible(false);

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.startFollow(this.player, true);

    this.controls = new Controls(this);
  }

  update(time: number): void {
    const dir = this.controls.direction();
    if (dir) {
      this.facing = dir;
      this.player.setVelocity(VELOCITY[dir].x * PLAYER_SPEED, VELOCITY[dir].y * PLAYER_SPEED);
      this.player.anims.play(`player-walk-${dir}`, true);
    } else {
      this.player.setVelocity(0, 0);
      if (this.player.anims.isPlaying) {
        this.player.anims.stop();
        this.player.setFrame(this.standFrame());
      }
    }

    // Action has no gameplay yet; a "!" bubble confirms the input works.
    if (this.controls.actionPressed()) {
      this.emote.setVisible(true);
      this.emoteHideAt = time + EMOTE_MS;
    }
    if (this.emote.visible) {
      // The physics body already holds this frame's position (the sprite syncs to it
      // after update), so anchor to the body to avoid trailing the player by a frame.
      const { body } = this.player;
      this.emote.setPosition(body.center.x, body.bottom - PLAYER_FRAME.height - 1);
      if (time >= this.emoteHideAt) this.emote.setVisible(false);
    }
  }

  private standFrame(): number {
    return DIRECTIONS.indexOf(this.facing) * PLAYER_FRAME.columns;
  }
}

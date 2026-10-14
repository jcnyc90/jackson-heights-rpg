import Phaser from 'phaser';
import type { Direction } from '../config';
import { touchState } from './touchControls';

const { KeyCodes } = Phaser.Input.Keyboard;

const DIRECTION_KEYS: Record<Direction, number[]> = {
  up: [KeyCodes.UP, KeyCodes.W],
  down: [KeyCodes.DOWN, KeyCodes.S],
  left: [KeyCodes.LEFT, KeyCodes.A],
  right: [KeyCodes.RIGHT, KeyCodes.D],
};
const ACTION_KEYS = [KeyCodes.SPACE, KeyCodes.ENTER, KeyCodes.Z];

/** Merges keyboard and on-screen touch input into one 4-way direction + action. */
export class Controls {
  private readonly directionKeys: [Direction, Phaser.Input.Keyboard.Key][] = [];
  private readonly actionKeys: Phaser.Input.Keyboard.Key[];

  constructor(scene: Phaser.Scene) {
    const keyboard = scene.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input is disabled in the game config');

    for (const [dir, codes] of Object.entries(DIRECTION_KEYS) as [Direction, number[]][]) {
      for (const code of codes) this.directionKeys.push([dir, keyboard.addKey(code)]);
    }
    this.actionKeys = ACTION_KEYS.map((code) => keyboard.addKey(code));
  }

  /**
   * The touch D-pad wins; otherwise the most recently pressed direction key still held.
   * Keys pressed with Cmd held are ignored: macOS browsers never send their keyup, so
   * Cmd+A / Cmd+D would otherwise leave the player walking forever.
   */
  direction(): Direction | null {
    if (touchState.direction) return touchState.direction;
    let latest: Direction | null = null;
    let latestTime = -Infinity;
    for (const [dir, key] of this.directionKeys) {
      if (key.isDown && !key.metaKey && key.timeDown > latestTime) {
        latest = dir;
        latestTime = key.timeDown;
      }
    }
    return latest;
  }

  /** True once per press of any action input. */
  actionPressed(): boolean {
    let pressed = touchState.takeAction();
    for (const key of this.actionKeys) if (Phaser.Input.Keyboard.JustDown(key) && !key.metaKey) pressed = true;
    return pressed;
  }
}

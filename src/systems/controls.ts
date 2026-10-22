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

/**
 * Merges keyboard and on-screen touch input into one 4-way direction + action.
 *
 * Can be locked (e.g. during a map fade). While locked it reports nothing, and every press
 * that exists during the lock goes stale: a stale key or D-pad press is ignored until it is
 * released, so a hold never carries over into the next map. Auto-repeat keydowns are stale
 * too: Phaser recreates its Key objects when a scene restarts, and a held key's next repeat
 * would otherwise look like a fresh press.
 */
export class Controls {
  private readonly directionKeys: [Direction, Phaser.Input.Keyboard.Key][] = [];
  private readonly actionKeys: Phaser.Input.Keyboard.Key[];
  private readonly staleKeys = new Set<Phaser.Input.Keyboard.Key>();
  /** D-pad presses up to this count are stale (see touchState.dpadPresses). */
  private staleDpadPresses = -1;
  private locked = false;

  constructor(scene: Phaser.Scene) {
    const keyboard = scene.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input is disabled in the game config');

    for (const [dir, codes] of Object.entries(DIRECTION_KEYS) as [Direction, number[]][]) {
      for (const code of codes) this.directionKeys.push([dir, keyboard.addKey(code)]);
    }
    this.actionKeys = ACTION_KEYS.map((code) => keyboard.addKey(code));
    for (const key of this.allKeys()) {
      key.on(Phaser.Input.Keyboard.Events.DOWN, (_key: unknown, event: KeyboardEvent) => {
        if (this.locked || event.repeat) this.staleKeys.add(key);
        else this.staleKeys.delete(key);
      });
      key.on(Phaser.Input.Keyboard.Events.UP, () => this.staleKeys.delete(key));
    }

    // Release held keys when the window loses focus. Phaser's own blur listener isn't enough:
    // KeyboardPlugin.shutdown() (v3 and v4) removes every scene's listener because it calls
    // off() without a context, so stopping any other scene would leave keys stuck after
    // alt-tab. A listener with its own function reference survives that.
    const releaseKeys = () => keyboard.resetKeys();
    scene.game.events.on(Phaser.Core.Events.BLUR, releaseKeys);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.game.events.off(Phaser.Core.Events.BLUR, releaseKeys));
  }

  /**
   * The touch D-pad wins; otherwise the most recently pressed direction key still held.
   * Keys pressed with Cmd held are ignored: macOS browsers never send their keyup, so
   * Cmd+A / Cmd+D would otherwise leave the player walking forever.
   */
  direction(): Direction | null {
    if (this.locked) {
      this.staleDpadPresses = touchState.dpadPresses;
      return null;
    }
    if (touchState.direction && touchState.dpadPresses > this.staleDpadPresses) return touchState.direction;
    let latest: Direction | null = null;
    let latestTime = -Infinity;
    for (const [dir, key] of this.directionKeys) {
      if (key.isDown && !key.metaKey && !this.staleKeys.has(key) && key.timeDown > latestTime) {
        latest = dir;
        latestTime = key.timeDown;
      }
    }
    return latest;
  }

  /** True once per press of any action input. Presses made while locked are swallowed. */
  actionPressed(): boolean {
    let pressed = touchState.takeAction();
    for (const key of this.actionKeys) {
      if (Phaser.Input.Keyboard.JustDown(key) && !key.metaKey && !this.staleKeys.has(key)) pressed = true;
    }
    return pressed && !this.locked;
  }

  /** Locking makes every key and D-pad press held right now stale (ignored until released). */
  setLocked(locked: boolean): void {
    this.locked = locked;
    if (!locked) return;
    for (const key of this.allKeys()) if (key.isDown) this.staleKeys.add(key);
    this.staleDpadPresses = touchState.dpadPresses;
  }

  isLocked(): boolean {
    return this.locked;
  }

  private allKeys(): Phaser.Input.Keyboard.Key[] {
    return [...this.directionKeys.map(([, key]) => key), ...this.actionKeys];
  }
}

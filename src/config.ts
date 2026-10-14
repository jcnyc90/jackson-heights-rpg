// Internal render resolution (EarthBound's 256x224). The canvas is scaled to fit the
// screen with nearest-neighbour filtering, so pixels stay crisp at any size.
export const GAME_WIDTH = 256;
export const GAME_HEIGHT = 224;

export const TILE_SIZE = 16;
// 60 px/s = exactly 1 px per 60 Hz physics step, so the map scrolls evenly (80 would
// alternate 1/1/2 px steps and shimmer). Use whole multiples of 60 for other speeds.
export const PLAYER_SPEED = 60;
export const BG_COLOR = '#1b1528';

/**
 * Texture keys. Placeholder art is generated under these keys in BootScene; real art
 * drops in by loading a file under the same key with the same frame size and layout.
 * A Tiled tileset's name must equal its texture key (see TestMapScene).
 */
export const TEXTURES = {
  tiles: 'tiles',
  player: 'player',
  emote: 'emote',
} as const;

export const MAPS = {
  test: 'test-map',
} as const;

/** Row order of the player spritesheet. */
export const DIRECTIONS = ['down', 'left', 'right', 'up'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** Player sheet: one row per direction, columns = [stand, step A, step B]. */
export const PLAYER_FRAME = { width: 16, height: 24, columns: 3 } as const;

/** Player collision box, centred at the bottom of the frame (feet). */
export const PLAYER_FEET = { width: 10, height: 8 } as const;

// Internal render resolution (EarthBound's 256x224). The canvas is scaled to fit the
// screen with nearest-neighbour filtering, so pixels stay crisp at any size.
export const GAME_WIDTH = 256;
export const GAME_HEIGHT = 224;

export const TILE_SIZE = 16;
// Walking speed in px/s. Session 6e: 150 (owner's decision 4) = 2.5 px per 60 Hz physics step, so
// the player moves whole pixels, 2 and 3 alternately, through a sub-pixel accumulator (see
// MapScene.planStep); diagonals move each axis by 1 or 2 px a step so their speed averages the same.
// (6d: 120 = 2 px a step.)
export const PLAYER_SPEED = 150;
export const BG_COLOR = '#1b1528';

/**
 * Texture keys. Placeholder art is generated under these keys in BootScene; real art
 * drops in by loading a file under the same key with the same frame size and layout.
 * A Tiled tileset's name must equal its texture key (see MapScene).
 */
export const TEXTURES = {
  tiles: 'tiles',
  overhead: 'overhead',
  player: 'player',
  emote: 'emote',
  npc: 'npc',
  font: 'font',
  textWindow: 'text-window',
  textCursor: 'text-cursor',
  deliveryPoint: 'delivery-point',
  targetArrow: 'target-arrow',
  beacon: 'target-beacon',
} as const;

/** Each half of a warp's fade (out, then in on the next map). Input is locked throughout. */
export const WARP_FADE_MS = 250;

/** Row order of the player spritesheet. */
export const DIRECTIONS = ['down', 'left', 'right', 'up'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** The eight ways the player can move (session 6d), clockwise from up. Facing stays one of DIRECTIONS. */
export const DIRECTIONS_8 = ['up', 'up-right', 'right', 'down-right', 'down', 'down-left', 'left', 'up-left'] as const;
export type Direction8 = (typeof DIRECTIONS_8)[number];
/** Unit steps per direction (y grows downward). */
export const STEP: Record<Direction8, { x: -1 | 0 | 1; y: -1 | 0 | 1 }> = {
  up: { x: 0, y: -1 },
  'up-right': { x: 1, y: -1 },
  right: { x: 1, y: 0 },
  'down-right': { x: 1, y: 1 },
  down: { x: 0, y: 1 },
  'down-left': { x: -1, y: 1 },
  left: { x: -1, y: 0 },
  'up-left': { x: -1, y: -1 },
};

/** Player sheet: one row per direction, columns = [stand, step A, step B]. */
export const PLAYER_FRAME = { width: 16, height: 24, columns: 3 } as const;

/** Player collision box, centred at the bottom of the frame (feet). NPCs use the same box. */
export const PLAYER_FEET = { width: 10, height: 8 } as const;

/** NPC sheet: one row per look, columns = standing frame per direction in DIRECTIONS order. */
export const NPC_FRAME = { width: 16, height: 24, looks: 3 } as const;

/** Action reaches an NPC whose feet box is less than this far in front of the player's. */
export const TALK_RANGE = TILE_SIZE;

/**
 * Bitmap font (Spleen 6x12): fixed-width cells. `charWidth` is the advance (glyph + spacing)
 * and `lineHeight` the distance between baselines. `atlas` is relative to the page, so it
 * works under any base path. Another font drops in under the same key with its own metrics
 * (see DESIGN.md 2.3).
 */
export const FONT = { key: TEXTURES.font, atlas: 'assets/fonts/spleen-6x12.png', charWidth: 6, lineHeight: 12 } as const;

/**
 * Dialogue window, in screen pixels. It sits `margin` px from the top of the screen, or
 * from the bottom when the player is in the top half (so it never covers who's talking).
 * Text starts `padX`/`padY` inside the frame.
 */
export const TEXT_WINDOW = { margin: 8, width: 240, height: 56, padX: 10, padY: 8 } as const;

/**
 * Order ticket, centred horizontally, in screen pixels: `margin` px from the bottom, or `top` px from
 * the top while the player is under it (only on maps where the camera can stop scrolling, like the
 * test map: on the world map the player always stays mid-screen). Text starts `pad` px inside the box.
 * The touch controls never cover it in either place (touch-check.js checks every order's ticket).
 */
export const ORDER_TICKET = { top: 24, margin: 4, pad: 3 } as const;

/**
 * Radar (session 6e, owner's decision 8): circular, top-left, `margin` px from the edges, north up,
 * centred on the player. One radar pixel = `tilesPerPixel` tiles square; `radius` px (60 tiles = two
 * short blocks). The target blip blinks every `blinkMs` while clamped to the rim. Hidden during dialogue.
 */
export const RADAR = { margin: 4, radius: 20, tilesPerPixel: 3, blinkMs: 400 } as const;

/** HUD boxes at the top right: the corner name (`corner`, at every crossing) above the zone name card. */
export const HUD_BOX = { margin: 4, pad: 3, gap: 2 } as const;

/** Edge arrow toward an off-screen order target: kept `inset` px inside the screen edge. */
export const TARGET_ARROW = { size: 11, inset: 4 } as const;

/** Zone name card: shown once the player has stayed `settleMs` in a newly entered zone. */
export const ZONE_CARD = { settleMs: 300, showMs: 1500 } as const;

/** Typewriter speed. 30 chars/s = one character every 2 frames at 60 fps. */
export const TEXT_CHARS_PER_SECOND = 30;

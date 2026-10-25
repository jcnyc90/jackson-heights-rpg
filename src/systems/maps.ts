import registry from '../data/maps/index.json';
import { DIRECTIONS, PLAYER_FEET, type Direction } from '../config';
import { externalMap, type WorldData } from './mapLoader';

// Map registry (src/data/maps/index.json) plus the spawn points and warps read from each
// map's Tiled "objects" layer. See DESIGN.md 2.12.

/** Every map JSON next to the registry, bundled with the code (the world map is external: see mapLoader). */
const FILES = import.meta.glob<object>('../data/maps/*.json', { eager: true, import: 'default' });

export interface Spawn {
  spawnId: string;
  facing: Direction;
  /** Feet position. */
  x: number;
  y: number;
}

/** A rectangle that sends the player to `targetSpawn` in `targetMap` when their feet step into it. */
export interface Warp {
  objectId: number;
  targetMap: string;
  targetSpawn: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A rectangle the player can face and press Action at, e.g. a door; orders name it by pointId. */
export interface DeliveryPoint {
  objectId: number;
  pointId: string;
  /** String IDs of the nearest intersection's two streets (the order ticket's "74th St & 37th Rd"), if the map gives them. */
  street?: string;
  cross?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A sign on a post (layer "labels", session 6e): a corner-post blade sign naming the two streets of a
 * crossing (class "streetSign"), or an "End of delivery zone" sign at the map edge (class "edgeSign",
 * string id `text`). x, y = the foot of the post.
 */
export interface StreetSign {
  kind: 'street' | 'edge';
  street?: string;
  cross?: string;
  text?: string;
  x: number;
  y: number;
}

/** A crossing's box (layer "corners"): while the player stands in it, the HUD names the corner. */
export interface CornerRect {
  street: string;
  cross: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A named area of a map (layer "zones"): the zone's name card shows when the player walks in. */
export interface ZoneRect {
  zoneId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A bike-share dock (layer "docks", session 6f): a kiosk at the west (or north) end and `slots` bike slots in a
 * row, x/y/width/height in map pixels. `open` is the side the dock is used from (n, s, w or e: the sidewalk).
 */
export interface DockRect {
  dockId: string;
  open: 'n' | 's' | 'w' | 'e';
  slots: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A rectangle in map pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MapInfo {
  id: string;
  /** String ID of the display name (t()). */
  nameId: string;
  /** Parsed Tiled JSON, as handed to the loader. */
  data: object;
  /** In map order; the first one is the fallback for an unknown spawn ID. */
  spawns: Spawn[];
  warps: Warp[];
  deliveryPoints: DeliveryPoint[];
  /** Signs (layer "labels"), crossings (layer "corners") and zone areas (layer "zones"); empty on maps without them. */
  signs: StreetSign[];
  corners: CornerRect[];
  zones: ZoneRect[];
  /** Bike-share docks (layer "docks"); empty on maps without them. */
  docks: DockRect[];
  /** Where the player can walk, in map pixels (map properties walkX/Y/Width/Height, in tiles); the whole map if not set. */
  walk: Rect;
  /** External maps (the world map): the decoded tile layers and buildings, drawn by WorldView. */
  world?: WorldData;
}

export interface Destination {
  map: MapInfo;
  spawn: Spawn;
}

interface TiledProperty {
  name: string;
  value: unknown;
}

interface TiledMap {
  width?: number;
  height?: number;
  tilewidth?: number;
  tileheight?: number;
  properties?: TiledProperty[];
  layers?: { name: string; type: string; objects?: TiledObject[] }[];
}

interface TiledObject {
  id: number;
  name?: string;
  type?: string;
  point?: boolean;
  x: number;
  y: number;
  width?: number;
  height?: number;
  properties?: { name: string; value: unknown }[];
}

export const OBJECT_LAYER = 'objects';

/**
 * Reads spawns, warps and delivery points from the "objects" layer. Objects are told apart
 * by class (`type` in Tiled JSON): "spawn" points carry spawnId and facing, "warp" rectangles
 * carry targetMap and targetSpawn, "deliveryPoint" rectangles carry pointId. Malformed objects
 * throw in every build, like NPCs do; a broken map should never ship.
 */
export function readObjects(mapId: string, data: TiledMap) {
  const layer = data.layers?.find((l) => l.name === OBJECT_LAYER && l.type === 'objectgroup');
  if (!layer?.objects) throw new Error(`Map "${mapId}" needs an object layer "${OBJECT_LAYER}"`);
  const spawns: Spawn[] = [];
  const warps: Warp[] = [];
  const deliveryPoints: DeliveryPoint[] = [];
  for (const obj of layer.objects) {
    const where = `Map "${mapId}", object ${obj.id} ("${obj.name ?? ''}")`;
    const props = new Map((obj.properties ?? []).map((p) => [p.name, p.value]));
    const str = (name: string): string => {
      const v = props.get(name);
      if (typeof v !== 'string' || v === '') throw new Error(`${where}: needs string property "${name}"`);
      return v;
    };
    if (obj.type === 'spawn') {
      const spawnId = str('spawnId');
      const facing = str('facing') as Direction;
      if (!obj.point) throw new Error(`${where}: a spawn must be a point`);
      if (!DIRECTIONS.includes(facing)) throw new Error(`${where}: facing must be one of ${DIRECTIONS.join('/')}`);
      if (spawns.some((s) => s.spawnId === spawnId)) throw new Error(`${where}: duplicate spawnId "${spawnId}"`);
      spawns.push({ spawnId, facing, x: obj.x, y: obj.y });
    } else if (obj.type === 'warp') {
      const { width = 0, height = 0 } = obj;
      if (obj.point || width <= 0 || height <= 0) throw new Error(`${where}: a warp must be a rectangle`);
      warps.push({ objectId: obj.id, targetMap: str('targetMap'), targetSpawn: str('targetSpawn'), x: obj.x, y: obj.y, width, height });
    } else if (obj.type === 'deliveryPoint') {
      const { width = 0, height = 0 } = obj;
      const pointId = str('pointId');
      if (obj.point || width <= 0 || height <= 0) throw new Error(`${where}: a delivery point must be a rectangle`);
      if (deliveryPoints.some((p) => p.pointId === pointId)) throw new Error(`${where}: duplicate pointId "${pointId}"`);
      // The nearest intersection, as two street-name string IDs: both or neither.
      const named = props.has('street') || props.has('cross');
      deliveryPoints.push({ objectId: obj.id, pointId, ...(named ? { street: str('street'), cross: str('cross') } : {}), x: obj.x, y: obj.y, width, height });
    } else {
      throw new Error(`${where}: class must be "spawn", "warp" or "deliveryPoint", not "${obj.type ?? ''}"`);
    }
  }
  if (spawns.length === 0) throw new Error(`Map "${mapId}" needs at least one spawn point`);
  return { spawns, warps, deliveryPoints };
}

/**
 * Reads the optional layers of a generated map: signs ("labels": points of class "streetSign" with
 * string properties street and cross, or "edgeSign" with text), crossings ("corners": rectangles
 * with street and cross), zone areas ("zones": rectangles of class "zone" with string property
 * zoneId), bike-share docks ("docks": rectangles of class "dock" with dockId, open, slots), and the walkable area (int map properties walkX, walkY, walkWidth, walkHeight, in
 * tiles). Malformed entries throw, like objects.
 */
export function readExtras(mapId: string, data: TiledMap) {
  const tw = data.tilewidth ?? 16;
  const th = data.tileheight ?? 16;
  const objectsOf = (name: string) => data.layers?.find((l) => l.name === name && l.type === 'objectgroup')?.objects ?? [];
  const props = (obj: TiledObject) => new Map((obj.properties ?? []).map((p) => [p.name, p.value]));
  const str = (where: string, map: Map<string, unknown>, name: string): string => {
    const v = map.get(name);
    if (typeof v !== 'string' || v === '') throw new Error(`${where}: needs string property "${name}"`);
    return v;
  };
  const signs: StreetSign[] = objectsOf('labels').map((obj) => {
    const where = `Map "${mapId}", sign ${obj.id} ("${obj.name ?? ''}")`;
    const p = props(obj);
    if (!obj.point) throw new Error(`${where}: must be a point`);
    if (obj.type === 'streetSign') return { kind: 'street', street: str(where, p, 'street'), cross: str(where, p, 'cross'), x: obj.x, y: obj.y };
    if (obj.type === 'edgeSign') return { kind: 'edge', text: str(where, p, 'text'), x: obj.x, y: obj.y };
    throw new Error(`${where}: class must be "streetSign" or "edgeSign"`);
  });
  const corners: CornerRect[] = objectsOf('corners').map((obj) => {
    const where = `Map "${mapId}", corner ${obj.id} ("${obj.name ?? ''}")`;
    const { width = 0, height = 0 } = obj;
    if (obj.type !== 'corner' || obj.point || width <= 0 || height <= 0) throw new Error(`${where}: must be a rectangle of class "corner"`);
    const p = props(obj);
    return { street: str(where, p, 'street'), cross: str(where, p, 'cross'), x: obj.x, y: obj.y, width, height };
  });
  const zones: ZoneRect[] = objectsOf('zones').map((obj) => {
    const where = `Map "${mapId}", zone area ${obj.id} ("${obj.name ?? ''}")`;
    const { width = 0, height = 0 } = obj;
    if (obj.type !== 'zone' || obj.point || width <= 0 || height <= 0) throw new Error(`${where}: must be a rectangle of class "zone"`);
    return { zoneId: str(where, props(obj), 'zoneId'), x: obj.x, y: obj.y, width, height };
  });
  const docks: DockRect[] = objectsOf('docks').map((obj) => {
    const where = `Map "${mapId}", dock ${obj.id} ("${obj.name ?? ''}")`;
    const { width = 0, height = 0 } = obj;
    if (obj.type !== 'dock' || obj.point || width <= 0 || height <= 0) throw new Error(`${where}: must be a rectangle of class "dock"`);
    const p = props(obj);
    const open = str(where, p, 'open');
    const slots = p.get('slots');
    if (!['n', 's', 'w', 'e'].includes(open)) throw new Error(`${where}: open must be n, s, w or e`);
    if (!Number.isInteger(slots) || (slots as number) + 1 !== Math.max(width / tw, height / th)) throw new Error(`${where}: slots must be an int, one less than its length in tiles`);
    return { dockId: str(where, p, 'dockId'), open: open as DockRect['open'], slots: slots as number, x: obj.x, y: obj.y, width, height };
  });
  const mp = new Map((data.properties ?? []).map((p) => [p.name, p.value]));
  const keys = ['walkX', 'walkY', 'walkWidth', 'walkHeight'];
  const full: Rect = { x: 0, y: 0, width: (data.width ?? 0) * tw, height: (data.height ?? 0) * th };
  let walk = full;
  if (keys.some((k) => mp.has(k))) {
    const [x, y, w, h] = keys.map((k) => mp.get(k));
    if (![x, y, w, h].every((v) => Number.isInteger(v))) throw new Error(`Map "${mapId}": walkX, walkY, walkWidth and walkHeight must all be int properties`);
    walk = { x: (x as number) * tw, y: (y as number) * th, width: (w as number) * tw, height: (h as number) * th };
  }
  return { signs, corners, zones, docks, walk };
}

const MAPS = new Map<string, MapInfo>();
for (const entry of registry.maps as { id: string; name: string; file?: string; url?: string }[]) {
  // Bundled maps have a `file` next to the registry; external ones a `url`, fetched before the game loads.
  const ext = entry.url ? externalMap(entry.id) : undefined;
  const data = entry.url ? ext?.data : FILES[`../data/maps/${entry.file}`];
  if (!data) throw new Error(`Map registry: "${entry.id}" points at missing ${entry.url ? `external map "${entry.url}" (not loaded)` : `file "${entry.file}"`}`);
  if (MAPS.has(entry.id)) throw new Error(`Map registry: duplicate id "${entry.id}"`);
  MAPS.set(entry.id, { id: entry.id, nameId: entry.name, data, ...readObjects(entry.id, data), ...readExtras(entry.id, data), ...(ext ? { world: ext.world } : {}) });
}

export const MAP_LIST: readonly MapInfo[] = [...MAPS.values()];

/** The registered map with this ID, if any. */
export function getMap(mapId: string): MapInfo | undefined {
  return MAPS.get(mapId);
}

/** True if the point (e.g. the player's feet centre) is inside the warp's rectangle. */
export function insideWarp(warp: Warp, x: number, y: number): boolean {
  return x >= warp.x && x < warp.x + warp.width && y >= warp.y && y < warp.y + warp.height;
}

/**
 * Looks up a map and spawn. An unknown ID throws when `strict` (dev builds), so a broken
 * link fails loudly; in production it logs a warning and falls back: an unknown spawn to
 * the map's first spawn, an unknown map to the game's start point.
 */
export function resolveDestination(mapId: string, spawnId: string, strict: boolean = import.meta.env.DEV): Destination {
  const map = MAPS.get(mapId);
  if (!map) {
    if (strict) throw new Error(`Unknown map "${mapId}"`);
    console.warn(`[maps] unknown map "${mapId}"; going to the start point`);
    return START;
  }
  const spawn = map.spawns.find((s) => s.spawnId === spawnId);
  if (!spawn) {
    if (strict) throw new Error(`Map "${mapId}" has no spawn "${spawnId}"`);
    console.warn(`[maps] map "${mapId}" has no spawn "${spawnId}"; using "${map.spawns[0].spawnId}"`);
    return { map, spawn: map.spawns[0] };
  }
  return { map, spawn };
}

/** Where a new game starts. Always strict: there's nothing to fall back to. */
export const START: Destination = resolveDestination(registry.start.map, registry.start.spawn, true);

/**
 * Checks every warp's target, and that no spawn sits inside a warp (arriving there would
 * bounce the player straight back). Throws on the first problem; BootScene runs it in dev.
 */
export function validateLinks(): void {
  for (const map of MAP_LIST) {
    for (const warp of map.warps) {
      try {
        resolveDestination(warp.targetMap, warp.targetSpawn, true);
      } catch (e) {
        throw new Error(`Map "${map.id}", warp object ${warp.objectId}: ${(e as Error).message}`);
      }
    }
    for (const spawn of map.spawns) {
      // Warps test the centre of the feet box, which sits half its height above the spawn point.
      const warp = map.warps.find((w) => insideWarp(w, spawn.x, spawn.y - PLAYER_FEET.height / 2));
      if (warp) throw new Error(`Map "${map.id}": spawn "${spawn.spawnId}" is inside warp object ${warp.objectId}`);
    }
  }
}

import registry from '../data/maps/index.json';

// External maps (session 6e): the world map is a Tiled JSON file under public/assets/maps, fetched
// at startup instead of being bundled. Its tile layers are base64 + zlib (Tiled's encoding), which
// Phaser's Tiled parser can't read, so they're inflated here (DecompressionStream) into plain
// arrays. main.ts awaits loadExternalMaps() before it imports the game, so src/systems/maps.ts can
// register these maps synchronously, like the bundled ones.

/** A building on the world map (layer "buildings"), in tiles: its image rectangle and how to draw it. */
export interface WorldBuilding {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: string;
  /** Which way it fronts: s (its facade faces the viewer), n (seen from behind), w or e (its side faces a street). */
  front: 's' | 'n' | 'w' | 'e';
  /** Roof rows at the top of the image (after the 1-row lip when it fronts north). */
  roof: number;
  /** The shaded side face's column: w, e, or - for none. */
  side: 'w' | 'e' | '-';
  /** The door: a column offset (fronts s/n) or a row offset (fronts w/e); -1 for none. */
  door: number;
  /** A delivery door (bright orange and yellow). */
  deliver: boolean;
  variant: number;
  /** Generic category word on the sign panel (string id shop.<word>), or ''. */
  sign: string;
}

/** The decoded tile layers and buildings of an external map. Arrays are row-major, width * height. */
export interface WorldData {
  width: number;
  height: number;
  /** Tile ids (gid - 1) of the "tiles" tileset; -1 = empty. */
  ground: Int16Array;
  /** 1 where the "collision" layer has a tile. */
  solid: Uint8Array;
  /** Prop marker tile ids (gid - 1), -1 = none. */
  props: Int16Array;
  buildings: WorldBuilding[];
}

export interface ExternalMap {
  data: object;
  world: WorldData;
}

const EXTERNAL = new Map<string, ExternalMap>();

/** The external maps fetched by loadExternalMaps, by map id. */
export function externalMap(id: string): ExternalMap | undefined {
  return EXTERNAL.get(id);
}

interface TiledLayer {
  name: string;
  type: string;
  data?: string | number[];
  encoding?: string;
  compression?: string;
  objects?: { type?: string; class?: string; x: number; y: number; width?: number; height?: number; properties?: { name: string; value: unknown }[] }[];
}

async function inflate(b64: string, compression: string | undefined): Promise<Uint32Array> {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (!compression) return new Uint32Array(bin.buffer);
  const format = compression === 'gzip' ? 'gzip' : 'deflate'; // Tiled's "zlib" is the deflate stream format
  const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint32Array(await new Response(stream).arrayBuffer());
}

/** Decodes one Tiled tile layer to gids (plain arrays, base64, base64 + zlib or gzip). */
export async function layerGids(layer: TiledLayer): Promise<Uint32Array> {
  if (Array.isArray(layer.data)) return Uint32Array.from(layer.data);
  if (layer.encoding !== 'base64' || typeof layer.data !== 'string') throw new Error(`Layer "${layer.name}": unsupported encoding "${layer.encoding}"`);
  return inflate(layer.data, layer.compression);
}

/** Parses a building's "spec" property: front,roof,side,door,deliver,variant,sign. */
export function parseBuilding(o: NonNullable<TiledLayer['objects']>[number], tile: number): WorldBuilding {
  const spec = String(o.properties?.find((p) => p.name === 'spec')?.value ?? '');
  const [front, roof, side, door, deliver, variant, sign = ''] = spec.split(',');
  if (!['s', 'n', 'w', 'e'].includes(front) || !['w', 'e', '-'].includes(side)) throw new Error(`Building at ${o.x},${o.y}: bad spec "${spec}"`);
  return {
    x: o.x / tile, y: o.y / tile, w: (o.width ?? 0) / tile, h: (o.height ?? 0) / tile, kind: o.type ?? o.class ?? '',
    front: front as WorldBuilding['front'], roof: Number(roof), side: side as WorldBuilding['side'], door: Number(door), deliver: deliver === '1', variant: Number(variant), sign,
  };
}

/** Decodes a fetched Tiled map into WorldData. */
export async function decodeWorld(data: { width: number; height: number; tilewidth: number; layers: TiledLayer[] }): Promise<WorldData> {
  const layer = (name: string) => {
    const l = data.layers.find((x) => x.name === name);
    if (!l) throw new Error(`World map needs a layer "${name}"`);
    return l;
  };
  const [g, c, p] = await Promise.all(['ground', 'collision', 'props'].map((n) => layerGids(layer(n))));
  const n = data.width * data.height;
  if (g.length !== n || c.length !== n || p.length !== n) throw new Error('World map: a tile layer has the wrong size');
  const ground = new Int16Array(n);
  const props = new Int16Array(n);
  const solid = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    ground[k] = g[k] - 1;
    props[k] = p[k] - 1;
    solid[k] = c[k] ? 1 : 0;
  }
  const buildings = (layer('buildings').objects ?? []).map((o) => parseBuilding(o, data.tilewidth));
  return { width: data.width, height: data.height, ground, solid, props, buildings };
}

/** Fetches and decodes every registry map that has a `url` (relative to the page). */
export async function loadExternalMaps(): Promise<void> {
  for (const entry of registry.maps as { id: string; url?: string }[]) {
    if (!entry.url) continue;
    const res = await fetch(entry.url);
    if (!res.ok) throw new Error(`Map "${entry.id}": ${entry.url} returned ${res.status}`);
    const data = await res.json();
    EXTERNAL.set(entry.id, { data, world: await decodeWorld(data) });
  }
}

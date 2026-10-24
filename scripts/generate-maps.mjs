// Generates the world's Tiled map from the world dataset (DESIGN.md 2.14, 2.15; session 6e).
// Usage:
//   node scripts/generate-maps.mjs           write public/assets/maps/<id>.json
//   node scripts/generate-maps.mjs --check   regenerate next to the map and fail (exit 1) on any byte diff
// The map is an external asset the game fetches at runtime (not bundled). Tile layers are base64 +
// zlib (Tiled's own encoding); the file is written raw, then normalized with Tiled's own writer
// (`tiled --export-map json`, run in the map's folder so the relative tileset path stays put), so the
// committed file is exactly what Tiled saves. Set TILED to use another Tiled binary.
// No dependencies. buildMaps() is exported for tests/world/generate-maps.test.mjs.
//
// Session 6e layout (owner's decisions 1-13): 30 tiles per short block, corridors 6d x 3, hybrid
// oblique buildings as objects (front face, shaded side face, roof strip) chosen per block face from
// PLUTO land use, Parks outlines as walkable lawns, the grassy paseo with green bike lanes, street
// trees from the 2015 census, street furniture, corner-post signs, intersection names for the HUD,
// and barricades wherever the walkable area ends. Everything not stated as the owner's decision is
// Claude's choice (see the report).

import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { deflateSync, inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { halfWidthOf, mapBoxes, tileOf } from './world-layout.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORLD_FILE = join(ROOT, 'src/data/world/jackson-heights.json');
const TILES_FILE = join(ROOT, 'src/data/tiles.json');
export const MAPS_DIR = join(ROOT, 'public/assets/maps');
const T = 16;

// Tile ids come from src/data/tiles.json (the placeholder painters use the same list).
const TILE_IDS = JSON.parse(readFileSync(TILES_FILE, 'utf8'));
const GID = Object.fromEntries(TILE_IDS.tiles.map((name, i) => [name, i + 1]));
export const TILESETS = [
  {
    columns: 4, firstgid: 1, image: '../tilesets/tiles.png', imageheight: Math.ceil(TILE_IDS.tiles.length / 4) * T, imagewidth: 4 * T, margin: 0, name: 'tiles', spacing: 0,
    tilecount: TILE_IDS.tiles.length, tileheight: T,
    tiles: TILE_IDS.collides.map((name) => TILE_IDS.tiles.indexOf(name)).sort((a, b) => a - b).map((id) => ({ id, properties: [{ name: 'collides', type: 'bool', value: true }] })),
    tilewidth: T,
  },
];

// Where a new game starts (Claude's choice): on Roosevelt Ave 74th-75th St as in 6c-6d, now on the
// north sidewalk a few tiles from the Dispatcher (at 30 tiles a block the middle of the road shows
// only the el's shadow), facing them.
const START = { fromDispatcher: [3, 2], facing: 'left' };
const COMPASS = { N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1] };
// Cell classes. Corridors: the widest covering corridor decides a cell (ties go to the road).
const NONE = 0, SIDEWALK = 1, PLAZA = 2, ROAD = 3, PARK = 4, OPEN = 5; // OPEN: walkable ground inside a block (yards, lots, lawns)
const SIDEWALK_W = 3; // 6d's 1-tile sidewalk x 3
// Elevated-7 pillars every this many tiles along Roosevelt Ave (6d's 5 x 3), two rows inside the roadway.
const PILLAR_EVERY = 15;
const LAMP_EVERY = 12; // Claude's choice
const TREE_GAP = 4;
// Generic category words a storefront's sign panel may show (t() keys shop.*); only on commercial faces.
export const SHOP_WORDS = ['bakery', 'grocery', 'pharmacy', 'laundry', 'deli', 'florist', 'hardware', 'salon', 'cafe', 'electronics'];
// Their English lengths: a sign panel takes a word only where it fits whole (worldView leaves the
// panel blank in a language whose word is longer).
const EN_STRINGS = JSON.parse(readFileSync(join(ROOT, 'src/data/strings/en.json'), 'utf8'));
const EN_LENGTHS = Object.fromEntries(SHOP_WORDS.map((w) => [w, [...EN_STRINGS[`shop.${w}`]].length]));
// Props that block movement (owner's decision 12: trees, posts and trash cans; Claude's choice for the rest).
const SOLID_PROPS = new Set(['p-tree', 'p-bush', 'p-lamp', 'p-hydrant', 'p-trash', 'p-bench', 'p-signal', 'p-barricade', 'p-pillar', 'p-stairs', 'p-planter']);

/** Deterministic integer hash of a few integers (layout variety without randomness). */
export function hash(...v) {
  let h = 2166136261;
  for (const x of v) {
    h ^= x & 0xffff;
    h = Math.imul(h, 16777619);
    h ^= (x >>> 16) & 0xffff;
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return (h ^ (h >>> 15)) >>> 0;
}

/** Tiled base64 + zlib encoding of a layer's gids (little-endian uint32). */
export function encodeLayer(data) {
  const buf = Buffer.alloc(data.length * 4);
  data.forEach((v, i) => buf.writeUInt32LE(v, i * 4));
  return deflateSync(buf).toString('base64');
}

/** Inverse of encodeLayer (tests and maps:check read layers back). */
export function decodeLayer(b64) {
  const buf = inflateSync(Buffer.from(b64, 'base64'));
  const out = new Array(buf.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = buf.readUInt32LE(i * 4);
  return out;
}

/**
 * Builds the dataset's one map. Returns [{ id, json, layers }], where json is a Tiled JSON map (not
 * yet normalized by Tiled) and layers holds the plain gid arrays of its tile layers. Throws on
 * anything it can't lay out.
 */
export function buildMaps(world, opts = {}) {
  const problems = [];
  const L = world.layout;
  const segments = new Map(world.segments.map((s) => [s.id, s]));
  const nodes = new Map(world.nodes.map((n) => [n.id, n]));
  const streets = new Map(world.streets.map((s) => [s.id, s]));
  const zoneOf = new Map(world.zones.flatMap((z) => z.segments.map((sid) => [sid, z.id])));
  const faceUse = new Map(world.blockFaces.map((f) => [`${f.segment}/${f.side}`, f.landUse]));
  const mapDef = world.maps[0];
  const { map: box, walk } = mapBoxes(L, world.nodes);
  const W = box.width;
  const H = box.height;
  if (mapDef.tiles[0] !== W || mapDef.tiles[1] !== H) throw new Error(`map "${mapDef.id}": dataset says ${mapDef.tiles.join('x')}, layout gives ${W}x${H}`);
  const local = ([x, y]) => [x - box.x0, y - box.y0];
  const at = (nid) => local(tileOf(L, nodes.get(nid).grid));
  const idx = (i, j) => j * W + i;
  const inMap = (i, j) => i >= 0 && j >= 0 && i < W && j < H;
  const WALK = { x0: walk.x0 - box.x0, y0: walk.y0 - box.y0, x1: walk.x0 - box.x0 + walk.width, y1: walk.y0 - box.y0 + walk.height };
  const inWalk = (i, j) => i >= WALK.x0 && j >= WALK.y0 && i < WALK.x1 && j < WALK.y1;

  // ---- corridors: every segment, plus every street end that runs on past the bounds ----
  const geos = [];
  for (const s of world.segments) {
    const o = streets.get(s.street).orientation;
    const [ax, ay] = at(s.from);
    const [bx, by] = at(s.to);
    geos.push({ id: s.id, street: s.street, hw: halfWidthOf(L, s.street), ax, ay, bx, by, ew: o === 'ew', ns: o === 'ns', ends: [s.from, s.to], plaza: s.use === 'plaza', el: s.overhead !== undefined, zone: zoneOf.get(s.id) ?? null, segment: s });
  }
  for (const n of world.nodes) {
    for (const c of n.continues ?? []) {
      const [ax, ay] = at(n.id);
      const [dx, dy] = COMPASS[c.dir];
      const far = W + H; // well past the map edge; painting clips to the map
      const axis = dx === 0 || dy === 0;
      const own = world.segments.filter((s) => s.street === c.street && (s.from === n.id || s.to === n.id));
      geos.push({
        id: `run-${n.id}-${c.street}`, street: c.street, hw: halfWidthOf(L, c.street), ax, ay, bx: ax + dx * far, by: ay + dy * far, ew: axis && dy === 0, ns: axis && dx === 0, ends: [n.id],
        plaza: own.length > 0 && own.every((s) => s.use === 'plaza'), el: own.some((s) => s.overhead !== undefined), zone: null, run: true, from: own[0] ?? null,
      });
    }
  }
  const atNode = new Map();
  for (const geo of geos) for (const nid of geo.ends) atNode.set(nid, [...(atNode.get(nid) ?? []), geo]);

  const cls = new Uint8Array(W * H);
  const owner = new Int32Array(W * H).fill(-1);
  const bestHw = new Uint8Array(W * H);
  const cover = new Uint8Array(W * H);
  const across = new Float32Array(W * H); // signed distance from the owner's centre line
  const under = new Uint8Array(W * H); // under the elevated line's deck
  geos.forEach((geo, gi) => {
    const { hw, ax, ay, bx, by } = geo;
    const dead = (nid) => (geo.run ? false : (atNode.get(nid) ?? []).length === 1);
    const capA = dead(geo.ends[0]) ? hw : 0;
    const capB = geo.ends[1] !== undefined && dead(geo.ends[1]) ? hw : 0;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - hw - 1));
    const x1 = Math.min(W, Math.ceil(Math.max(ax, bx) + hw + 1));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - hw - 1));
    const y1 = Math.min(H, Math.ceil(Math.max(ay, by) + hw + 1));
    for (let j = y0; j < y1; j++) {
      for (let i = x0; i < x1; i++) {
        const cx = i + 0.5;
        const cy = j + 0.5;
        let inside, edge, acr;
        if (geo.ew || geo.ns) {
          const [p, q, c] = geo.ew ? [cx, cy, ay] : [cy, cx, ax];
          const [pa, pb] = geo.ew ? [ax, bx] : [ay, by];
          const [lo, hi] = [Math.min(pa, pb), Math.max(pa, pb)];
          const [capLo, capHi] = pa < pb ? [capA, capB] : [capB, capA];
          acr = q - c;
          const past = Math.max(0, lo - p, p - hi);
          inside = p > lo - capLo && p < hi + capHi && Math.abs(acr) < hw;
          edge = Math.abs(acr) > hw - SIDEWALK_W || past > hw - SIDEWALK_W;
        } else {
          const vx = bx - ax, vy = by - ay;
          const d = distToSegment(cx, cy, ax, ay, bx, by);
          inside = d < hw;
          edge = d > hw - SIDEWALK_W;
          acr = ((cx - ax) * vy - (cy - ay) * vx) / Math.hypot(vx, vy);
        }
        if (!inside) continue;
        const k = idx(i, j);
        cover[k]++;
        const c = geo.plaza ? PLAZA : edge ? SIDEWALK : ROAD;
        if (c === SIDEWALK) {
          if (cls[k] === NONE) {
            cls[k] = SIDEWALK;
            owner[k] = gi;
            across[k] = acr;
          }
        } else if (cls[k] <= SIDEWALK || hw > bestHw[k] || (hw === bestHw[k] && c > cls[k])) {
          cls[k] = c;
          owner[k] = gi;
          bestHw[k] = hw;
          across[k] = acr;
        }
        if (geo.el && geo.ew && Math.abs(acr) < hw - SIDEWALK_W - 1) under[k] = 1;
      }
    }
  });

  // ---- parks (Parks Properties outlines; malls are medians, already corridors): walkable lawns ----
  const parkOf = new Int16Array(W * H).fill(-1);
  const parks = world.parks.filter((p) => p.category !== 'Mall');
  parks.forEach((p, pi) => {
    const rings = p.outline.map((r) => r.map((pt) => local(tileOfF(L, pt))));
    const xs = rings.flat().map((q) => q[0]), ys = rings.flat().map((q) => q[1]);
    for (let j = Math.max(0, Math.floor(Math.min(...ys))); j <= Math.min(H - 1, Math.ceil(Math.max(...ys))); j++) {
      for (let i = Math.max(0, Math.floor(Math.min(...xs))); i <= Math.min(W - 1, Math.ceil(Math.max(...xs))); i++) {
        if (!rings.some((r) => inRing(i + 0.5, j + 0.5, r))) continue;
        parkOf[idx(i, j)] = pi;
        if (cls[idx(i, j)] === NONE) cls[idx(i, j)] = PARK;
      }
    }
  });
  const isCorridor = (i, j) => inMap(i, j) && cls[idx(i, j)] >= SIDEWALK && cls[idx(i, j)] <= ROAD;
  const walkableCls = (i, j) => inMap(i, j) && cls[idx(i, j)] !== NONE;

  // ---- layers ----
  const ground = new Array(W * H).fill(GID.roof);
  const solid = new Uint8Array(W * H);
  const props = new Array(W * H).fill(0);
  const reserved = new Uint8Array(W * H);
  const crossing = new Uint8Array(W * H); // crossing boxes: no trees or furniture (doors may face them)
  const buildings = [];
  const isRoad = (i, j) => inMap(i, j) && cls[idx(i, j)] === ROAD;
  const CURB = { n: 'curb-n', s: 'curb-s', e: 'curb-e', w: 'curb-w', ne: 'curb-ne', nw: 'curb-nw', se: 'curb-se', sw: 'curb-sw' };
  const paseo = (k) => cls[k] === PLAZA && geos[owner[k]].street === 'ave-34';
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = idx(i, j);
      if (cls[k] === ROAD) ground[k] = GID[under[k] ? 'el-shadow' : 'road'];
      else if (cls[k] === PLAZA) {
        if (paseo(k)) {
          // Owner's decision 9: grass, a green bike lane along both sides, sidewalks on the outside.
          const a = Math.abs(across[k]), hw = geos[owner[k]].hw;
          ground[k] = GID[a > hw - SIDEWALK_W ? 'sidewalk' : a > hw - SIDEWALK_W - 2 ? 'bike-lane' : 'paseo-grass'];
        } else ground[k] = GID.plaza;
      } else if (cls[k] === SIDEWALK) {
        const n = isRoad(i, j - 1), s = isRoad(i, j + 1), e = isRoad(i + 1, j), w = isRoad(i - 1, j);
        const key = (n ? 'n' : s ? 's' : '') + (e ? 'e' : w ? 'w' : '');
        ground[k] = GID[CURB[key] ?? 'sidewalk'];
      } else if (cls[k] === PARK) ground[k] = GID[hash(i, j, 7) % 5 === 0 ? 'lawn-dark' : 'lawn'];
    }
  }

  // Markings on cells only one corridor covers: double yellow centre lines on avenues, lane dashes on
  // the widest roads, manholes; the el's pillars on Roosevelt Ave.
  const single = (i, j, gi) => inMap(i, j) && cover[idx(i, j)] === 1 && owner[idx(i, j)] === gi && cls[idx(i, j)] === ROAD;
  const putProp = (i, j, name) => {
    const k = idx(i, j);
    props[k] = GID[name];
    if (SOLID_PROPS.has(name)) solid[k] = 1;
    reserved[k] = 1;
  };
  geos.forEach((geo, gi) => {
    if (geo.plaza || !(geo.ew || geo.ns)) return;
    const c = geo.ew ? geo.ay : geo.ax;
    const [pa, pb] = geo.ew ? [geo.ax, geo.bx] : [geo.ay, geo.by];
    const lim = geo.ew ? W : H;
    const [lo, hi] = [Math.max(0, Math.min(pa, pb)), Math.min(lim, Math.max(pa, pb))];
    const cell = (p, q) => (geo.ew ? [p, q] : [q, p]);
    for (let p = lo; p < hi; p++) {
      const g0 = p + (geo.ew ? box.x0 : box.y0); // global position, so patterns don't depend on the map's origin
      if (geo.el) {
        if (((g0 % PILLAR_EVERY) + PILLAR_EVERY) % PILLAR_EVERY === 7) for (const q of [c - 6, c + 5]) if (single(...cell(p, q), gi)) putProp(...cell(p, q), 'p-pillar');
        continue;
      }
      if (geo.ew && geo.hw >= 9) {
        if (single(p, c - 1, gi)) ground[idx(p, c - 1)] = GID['center-line-s'];
        if (single(p, c, gi)) ground[idx(p, c)] = GID['center-line-n'];
      }
      if (geo.ew && geo.hw >= 12) {
        if (single(p, c - 5, gi)) ground[idx(p, c - 5)] = GID['lane-dash-n'];
        if (single(p, c + 4, gi)) ground[idx(p, c + 4)] = GID['lane-dash-s'];
      }
      const mq = c + (geo.hw >= 9 ? 3 : 1);
      if (((g0 % 23) + 23) % 23 === 11 && single(...cell(p, mq), gi)) ground[idx(...cell(p, mq))] = GID.manhole;
    }
  });

  // Crossings: crosswalks continue each sidewalk across the other street; signals on two opposite
  // corners (NW, SE), a blade sign post next to the NW signal, a trash can on the SE corner; every
  // crossing (paseo included) gets a corner rectangle for the HUD's corner name.
  const placeName = (nid) => {
    const sts = nodes.get(nid).streets;
    const order = (sid) => ({ ns: 0, ew: 1, diagonal: 2 })[streets.get(sid).orientation];
    const [a, b] = [...sts].sort((x, y) => order(x) - order(y) || sts.indexOf(x) - sts.indexOf(y));
    return [`street.${a}`, `street.${b}`];
  };
  const prop = (name, value, type = 'string') => ({ name, type, value });
  const signs = [];
  const corners = [];
  for (const [nid, here] of atNode) {
    const nsG = here.filter((g) => g.ns);
    const ewG = here.filter((g) => !g.ns);
    const [C, R] = at(nid);
    const hs = Math.max(0, ...nsG.map((g) => g.hw)) || Math.max(...here.map((g) => g.hw));
    const ha = Math.max(0, ...ewG.map((g) => g.hw)) || hs;
    const [street, cross] = placeName(nid);
    if (insideBox(walk, [C + box.x0, R + box.y0]) && new Set(here.map((g) => g.street)).size >= 2) {
      corners.push({ name: `corner-${nid}`, type: 'corner', x: (C - hs) * T, y: (R - ha) * T, width: 2 * hs * T, height: 2 * ha * T, properties: [prop('cross', cross), prop('street', street)] });
    }
    // Reserve the crossing box (paseo crossings too), so furniture never blocks a crosswalk.
    for (let j = R - ha; j < R + ha; j++) for (let i = C - hs; i < C + hs; i++) if (inMap(i, j) && cls[idx(i, j)] !== NONE) crossing[idx(i, j)] = 1;
    const nsRoad = nsG.filter((g) => !g.plaza), ewRoad = ewG.filter((g) => !g.plaza && g.ew);
    if (!nsRoad.length || !ewRoad.length) continue;
    const arms = new Set(here.flatMap((g) => (g.ns ? [Math.min(g.ay, g.by) < R ? 'N' : 'S'] : g.ew ? [Math.min(g.ax, g.bx) < C ? 'W' : 'E'] : [])));
    for (let j = R - ha; j < R + ha; j++) for (let i = C - hs; i < C + hs; i++) {
      if (!isRoad(i, j) || under[idx(i, j)]) continue;
      // The two sidewalk rows/columns nearest the road carry the zebra (2 tiles wide, Claude's choice).
      const inAveSidewalk = (j >= R - ha + 1 && j < R - ha + SIDEWALK_W) || (j >= R + ha - SIDEWALK_W && j < R + ha - 1);
      const inStSidewalk = (i >= C - hs + 1 && i < C - hs + SIDEWALK_W) || (i >= C + hs - SIDEWALK_W && i < C + hs - 1);
      if (inAveSidewalk && !inStSidewalk) ground[idx(i, j)] = GID['crosswalk-ns'];
      else if (inStSidewalk && !inAveSidewalk) ground[idx(i, j)] = GID['crosswalk-ew'];
    }
    // Corner squares: [x, y] of the curb corner (nearest the road), the two arms it needs.
    const sq = {
      NW: [C - hs + SIDEWALK_W - 1, R - ha + SIDEWALK_W - 1, 'N', 'W', -1, -1],
      SE: [C + hs - SIDEWALK_W, R + ha - SIDEWALK_W, 'S', 'E', 1, 1],
      NE: [C + hs - SIDEWALK_W, R - ha + SIDEWALK_W - 1, 'N', 'E', 1, -1],
      SW: [C - hs + SIDEWALK_W - 1, R + ha - SIDEWALK_W, 'S', 'W', -1, 1],
    };
    const ok = (n) => { const [i, j, a, b] = sq[n]; return arms.has(a) && arms.has(b) && inMap(i, j) && cls[idx(i, j)] === SIDEWALK && !props[idx(i, j)]; };
    const pick = ['NW', 'SE'].filter(ok);
    for (const n of pick.length ? pick : ['NE', 'SW'].filter(ok)) {
      const [i, j, , , dx, dy] = sq[n];
      putProp(i, j, 'p-signal');
      if (n === pick[0] || (!pick.length && n === 'NE')) {
        // Owner's decision 6: a blade sign on its own post next to the signal pole, never on a building.
        const pi = i + dx, pj = j;
        if (inMap(pi, pj) && cls[idx(pi, pj)] === SIDEWALK && !props[idx(pi, pj)] && !solid[idx(pi, pj)] && insideBox(walk, [C + box.x0, R + box.y0])) {
          solid[idx(pi, pj)] = 1;
          reserved[idx(pi, pj)] = 1;
          signs.push({ name: `sign-${nid}`, type: 'streetSign', point: true, x: pi * T + 8, y: (pj + 1) * T, properties: [prop('cross', cross), prop('street', street)] });
        }
      } else {
        const ti = i + dx * 2, tj = j + dy * 2; // trash can on the inner corner of the square
        if (inMap(ti, tj) && cls[idx(ti, tj)] === SIDEWALK && !props[idx(ti, tj)]) putProp(ti, tj, 'p-trash');
      }
    }
  }

  // Station stairs on two free corners of each entrance node.
  for (const st of world.transit.filter((x) => x.kind === 'station')) {
    for (const nid of st.entrances) {
      const here = atNode.get(nid) ?? [];
      const [C, R] = at(nid);
      const hs = Math.max(0, ...here.filter((g) => g.ns).map((g) => g.hw)) || 6;
      const ha = Math.max(0, ...here.filter((g) => !g.ns).map((g) => g.hw)) || 6;
      for (const [i, j] of [[C + hs, R - ha - 2], [C - hs - 1, R + ha + 1]]) {
        // Just outside the crossing, on the street's sidewalk (inner column), so the curb stays clear.
        if (inMap(i, j) && cls[idx(i, j)] === SIDEWALK) {
          const k = idx(i, j);
          props[k] = GID['p-stairs'];
          solid[k] = 1;
          reserved[k] = 1;
        }
      }
    }
  }

  // ---- objects that need free tiles: start ----
  const objects = [];
  const npcs = [];
  const feet = ([i, j]) => [i * T + 8, j * T + 12];
  const segGeo = new Map(geos.filter((g) => g.segment).map((g) => [g.id, g]));
  const pointOn = (geo, t) => [geo.ax + (geo.bx - geo.ax) * t, geo.ay + (geo.by - geo.ay) * t];
  // ---- blocks: maximal rectangles of the non-walkable regions, filled from the land use of their faces ----
  // A face's land use: the block face of the corridor it fronts (a run past the bounds uses its street's
  // segment at the node where it starts).
  const SIDE_OF_BLOCK = { S: 'north', N: 'south', W: 'east', E: 'west' }; // block on this side of the corridor
  const useOf = (gi, side) => {
    const geo = geos[gi];
    const seg = geo.segment ?? geo.from;
    if (!seg) return 'walkup';
    const s = SIDE_OF_BLOCK[side];
    return faceUse.get(`${seg.id}/${s}`) ?? faceUse.get(`${seg.id}/${s === 'north' || s === 'south' ? 'east' : 'north'}`) ?? 'walkup';
  };
  const done = new Uint8Array(W * H);
  const regionCells = [];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (cls[idx(i, j)] === NONE) regionCells.push(idx(i, j));
  // Greedy maximal rectangles over all non-corridor cells (regular blocks are one rectangle each).
  const free = new Uint8Array(W * H);
  for (const k of regionCells) free[k] = 1;
  const rects = maximalRects(free, W, H, 4, 16);
  for (const r of rects) {
    for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) done[idx(i, j)] = 1;
  }
  // Leftovers (slivers along diagonals, tiny gaps): flat roofs, solid.
  for (const k of regionCells) if (!done[k]) { ground[k] = GID.roof; solid[k] = 1; }

  const addBuilding = (b) => {
    // b: { x, y, w, h (tiles), kind, front: s|n|w|e, roof, side: w|e|-, door: offset or -1, front geo gi, variant, sign }
    buildings.push(b);
  };
  const fillSolid = (x, y, w, h, tile = 'roof') => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { ground[idx(i, j)] = GID[tile]; solid[idx(i, j)] = 1; }
  };
  const fillOpen = (x, y, w, h, tile) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { const k = idx(i, j); ground[k] = GID[typeof tile === 'function' ? tile(i, j) : tile]; solid[k] = 0; cls[k] = OPEN; }
  };
  // Band depths in tiles: image rows of a building fronting south (roof + front face), fronting north (+1 lip row).
  const SOUTH = { commercial: [5, 2], walkup: [6, 2], 'garden-coop': [6, 2], civic: [7, 2], house: [7, 2], parking: [8, 0], park: [8, 0] };
  const widthFor = (use, i, j) => {
    const r = hash(i, j, 3);
    if (use === 'commercial') return 4 + (r % 3);
    if (use === 'walkup' || use === 'garden-coop') return 6 + (r % 3);
    if (use === 'civic') return 12 + (r % 5);
    return 6;
  };
  const kindOf = (use) => ({ commercial: 'storefront', walkup: 'walkup', 'garden-coop': 'coop', civic: 'civic', house: 'house' })[use] ?? 'walkup';
  // A word only where it fits the panel whole (6 px a letter; the panel spans the front minus a side face); else blank.
  const signFor = (use, i, j, w, side) => {
    if (use !== 'commercial' || hash(i, j, 11) % 3 !== 0) return '';
    const word = SHOP_WORDS[hash(i, j, 13) % SHOP_WORDS.length];
    const span = (w - (side === '-' ? 0 : 1)) * T - 6;
    return EN_LENGTHS[word] * 6 <= span ? word : '';
  };

  /** A row of buildings along a band (front s or n), x from x0 to x1, image rows [y, y + h). */
  const bandRow = (front, use, gi, x0, x1, y, h, roof, sideW, sideE) => {
    if (use === 'parking' || use === 'park') {
      fillOpen(x0, y, x1 - x0, h, use === 'parking' ? (i, j) => ((i - x0) % 3 === 0 && (front === 's' ? j < y + 3 : j >= y + h - 3) ? 'lot-stall' : 'lot') : (i, j) => (hash(i, j, 5) % 6 ? 'lawn' : 'lawn-dark'));
      // A fence (solid edge) on the block side.
      const fj = front === 's' ? y : y + h - 1;
      for (let i = x0; i < x1; i++) { solid[idx(i, fj)] = 1; ground[idx(i, fj)] = GID.yard; cls[idx(i, fj)] = NONE; }
      if (use === 'park') for (let i = x0 + 2; i < x1 - 1; i += 5) { const j = front === 's' ? y + 2 : y + h - 3; if (!reserved[idx(i, j)]) putProp(i, j, 'p-tree'); }
      return;
    }
    if (use === 'house') {
      // Detached houses with a front yard (2 rows) and walkable lawn between them (owner's decision 11).
      const yard = 2;
      const hy = front === 's' ? y : y + yard;
      const hh = h - yard;
      fillOpen(x0, front === 's' ? y + hh : y, x1 - x0, yard, (i, j) => (hash(i, j, 9) % 7 ? 'yard' : 'flowers'));
      let x = x0;
      while (x < x1) {
        const w = Math.min(6, x1 - x);
        if (w < 4) { fillOpen(x, hy, x1 - x, hh, 'lawn'); break; }
        const gap = Math.min(2, x1 - x - w);
        const door = Math.floor(w / 2);
        if (front === 's') {
          // The image: roof 2 rows, front face 3; only the footprint (bottom roof-deep rows) blocks.
          fillOpen(x, hy, w, hh, 'lawn');
          fillSolid(x, hy + hh - 2, w, 2, 'roof');
          addBuilding({ x, y: hy, w, h: hh, kind: 'house', front, roof: 2, side: '-', door, gi, variant: hash(x, hy, 21) % 4, sign: '' });
        } else {
          fillSolid(x, hy, w, hh, 'roof');
          addBuilding({ x, y: hy, w, h: hh, kind: 'house', front, roof: 2, side: '-', door, gi, variant: hash(x, hy, 21) % 4, sign: '' });
        }
        if (gap > 0) fillOpen(x + w, hy, gap, hh, 'lawn');
        x += w + gap;
      }
      return;
    }
    const kind = kindOf(use);
    let x = x0;
    while (x < x1) {
      let w = widthFor(use, x, y);
      if (x1 - x - w < 3) w = x1 - x; // no slivers: the last building takes the rest
      const side = x === x0 && sideW ? 'w' : x + w === x1 && sideE ? 'e' : '-';
      fillSolid(x, y, w, h);
      addBuilding({ x, y, w, h, kind, front, roof, side, door: Math.floor(w / 2) - (hash(x, y, 4) % 2), gi, variant: hash(x, y, 21) % 4, sign: front === 's' ? signFor(use, x, y, w, side) : '' });
      x += w;
    }
  };

  /** A column of buildings along a north-south street (front w or e), image columns [x, x + d), rows y0 to y1. */
  const columnRow = (front, use, gi, x, d, y0, y1) => {
    if (use === 'parking' || use === 'park') {
      fillOpen(x, y0, d, y1 - y0, use === 'parking' ? (i, j) => ((j - y0) % 3 === 0 && (front === 'w' ? i < x + 3 : i >= x + d - 3) ? 'lot-stall' : 'lot') : (i, j) => (hash(i, j, 5) % 6 ? 'lawn' : 'lawn-dark'));
      const fi = front === 'w' ? x + d - 1 : x;
      for (let j = y0; j < y1; j++) { solid[idx(fi, j)] = 1; ground[idx(fi, j)] = GID.yard; cls[idx(fi, j)] = NONE; }
      if (use === 'park') for (let j = y0 + 2; j < y1 - 1; j += 5) { const i = front === 'w' ? x + 2 : x + d - 3; if (!reserved[idx(i, j)]) putProp(i, j, 'p-tree'); }
      return;
    }
    if (use === 'house') {
      // Detached houses stacked along the street: a front yard on the street side, a lawn north of
      // each house (the player can walk behind it), the footprint (bottom 2 rows) blocks.
      const yard = 3;
      const hx = front === 'w' ? x + yard : x;
      const hw = d - yard;
      fillOpen(front === 'w' ? x : x + hw, y0, yard, y1 - y0, (i, j) => (hash(i, j, 9) % 9 ? 'yard' : 'flowers'));
      let y = y0;
      while (y < y1) {
        const lot = Math.min(8, y1 - y);
        if (lot < 6 || hw < 4) { fillOpen(hx, y, hw, y1 - y, 'lawn'); break; }
        const hh = 5;
        fillOpen(hx, y, hw, lot, 'lawn');
        const top = y + lot - hh;
        fillSolid(hx, top + hh - 2, hw, 2, 'roof');
        addBuilding({ x: hx, y: top, w: hw, h: hh, kind: 'house', front, roof: 2, side: front === 'w' ? 'w' : 'e', door: hh - 1, gi, variant: hash(hx, top, 21) % 4, sign: '' });
        y += lot;
      }
      // A hedge between the two halves of the block keeps the walkable lawns from joining up.
      const back = front === 'w' ? x + d - 1 : x;
      for (let j = y0; j < y1; j++) if (cls[idx(back, j)] === OPEN) { const k = idx(back, j); solid[k] = 1; props[k] = hash(back, j, 2) % 3 ? 0 : GID['p-bush']; ground[k] = GID.yard; cls[k] = NONE; }
      return;
    }
    const kind = kindOf(use);
    const span = use === 'commercial' ? 5 : use === 'civic' ? 12 : 7;
    let y = y0;
    while (y < y1) {
      let h = span + (hash(x, y, 8) % 2);
      if (y1 - y - h < 4) h = y1 - y;
      fillSolid(x, y, d, h);
      addBuilding({ x, y, w: d, h, kind, front, roof: 2, side: front === 'w' ? 'w' : 'e', door: h - 1, gi, variant: hash(x, y, 21) % 4, sign: '' });
      y += h;
    }
  };

  for (const r of rects) {
    const { x: x0, y: y0, w, h } = r;
    const x1 = x0 + w, y1 = y0 + h;
    // Which sides front a corridor (at least half their length), and the corridor (majority owner).
    const sideInfo = (cells) => {
      const owners = cells.filter(([i, j]) => isCorridor(i, j)).map(([i, j]) => owner[idx(i, j)]);
      if (owners.length * 2 < cells.length) return null;
      const counts = new Map();
      for (const o of owners) counts.set(o, (counts.get(o) ?? 0) + 1);
      return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    };
    const range = (a, b) => Array.from({ length: b - a }, (_, k) => a + k);
    const S = sideInfo(range(x0, x1).map((i) => [i, y1]));
    const N = sideInfo(range(x0, x1).map((i) => [i, y0 - 1]));
    const Wg = sideInfo(range(y0, y1).map((j) => [x0 - 1, j]));
    const Eg = sideInfo(range(y0, y1).map((j) => [x1, j]));
    const uses = { S: S !== null ? useOf(S, 'S') : null, N: N !== null ? useOf(N, 'N') : null, W: Wg !== null ? useOf(Wg, 'W') : null, E: Eg !== null ? useOf(Eg, 'E') : null };
    // Owner's decision 11: Historic District garden co-ops are buildings around an interior garden.
    const coopFaces = Object.values(uses).filter((u) => u === 'garden-coop').length;
    const garden = coopFaces >= 2 && w >= 16 && h >= 16;
    const u = (k) => (garden && uses[k] && uses[k] !== 'commercial' ? 'garden-coop' : uses[k]);
    let bandS = uses.S ? SOUTH[u('S')][0] : 0;
    let bandN = uses.N ? SOUTH[u('N')][0] + (['parking', 'park'].includes(u('N')) ? 0 : 1) : 0;
    if (garden) { bandS = bandS || 6; bandN = bandN || 7; }
    if (bandS + bandN > h) {
      // Short blocks (37th Rd to Roosevelt): the busier face keeps its band.
      const rank = (x) => ['commercial', 'civic', 'walkup', 'garden-coop', 'house', 'parking', 'park'].indexOf(x ?? 'park');
      if (rank(uses.S) <= rank(uses.N)) { bandS = Math.min(bandS, h); bandN = Math.max(0, h - bandS); }
      else { bandN = Math.min(bandN, h); bandS = Math.max(0, h - bandN); }
      if (bandN > 0 && bandN < 4) { bandS += bandN; bandN = 0; }
      if (bandS > 0 && bandS < 4) { bandN += bandS; bandS = 0; }
    }
    if (w < 4 || h < 4) { fillSolid(x0, y0, w, h); continue; }
    // Middle rows: columns along the north-south streets, backyards between.
    const my0 = y0 + bandN, my1 = y1 - bandS;
    if (bandS) {
      const use = u('S') ?? 'walkup';
      const roof = SOUTH[use][1];
      bandRow('s', use, S ?? Wg ?? Eg, x0, x1, y1 - bandS, bandS, roof, Wg !== null, Eg !== null);
    }
    if (bandN) {
      const use = u('N') ?? 'walkup';
      bandRow('n', use, N ?? Wg ?? Eg, x0, x1, y0, bandN, 2, Wg !== null, Eg !== null);
    }
    if (my1 > my0) {
      const both = Wg !== null && Eg !== null;
      const dW = Wg !== null ? (both ? Math.floor(w / 2) : Math.min(w, 9)) : 0;
      const dE = Eg !== null ? (both ? w - dW : Math.min(w, 9)) : 0;
      if (garden) {
        const ring = Math.min(7, Math.floor(w / 3));
        columnRow('w', 'garden-coop', Wg ?? N ?? S, x0, ring, my0, my1);
        columnRow('e', 'garden-coop', Eg ?? N ?? S, x1 - ring, ring, my0, my1);
        // The interior garden: lawn, paths and trees; private, so it stays solid.
        for (let j = my0; j < my1; j++) for (let i = x0 + ring; i < x1 - ring; i++) {
          const k = idx(i, j);
          ground[k] = GID[(i - x0 - ring) % 6 === 3 || (j - my0) % 8 === 4 ? 'park-path' : hash(i, j, 6) % 9 ? 'garden' : 'flowers'];
          solid[k] = 1;
          if ((i + j) % 5 === 0 && hash(i, j, 1) % 2 === 0 && ground[k] === GID.garden) props[k] = GID['p-tree'];
        }
      } else {
        if (dW) columnRow('w', uses.W, Wg, x0, Math.min(dW, 9), my0, my1);
        if (dE) columnRow('e', uses.E, Eg, x1 - Math.min(dE, 9), Math.min(dE, 9), my0, my1);
        const bx0 = x0 + (dW ? Math.min(dW, 9) : 0), bx1 = x1 - (dE ? Math.min(dE, 9) : 0);
        if (bx1 > bx0) for (let j = my0; j < my1; j++) for (let i = bx0; i < bx1; i++) { const k = idx(i, j); ground[k] = GID.yard; solid[k] = 1; if (hash(i, j, 12) % 11 === 0) props[k] = GID['p-bush']; }
      }
    }
  }

  // ---- parks: paths, trees, benches, a fence where a park meets buildings (Travers Park etc.) ----
  parks.forEach((p, pi) => {
    const cells = [];
    for (let k = 0; k < W * H; k++) if (parkOf[k] === pi && cls[k] === PARK) cells.push(k);
    if (!cells.length) return;
    const xs = cells.map((k) => k % W), ys = cells.map((k) => Math.floor(k / W));
    const cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2), cy = Math.round((Math.min(...ys) + Math.max(...ys)) / 2);
    for (const k of cells) {
      const i = k % W, j = Math.floor(k / W);
      if (Math.abs(i - cx) <= 1 || Math.abs(j - cy) <= 1) ground[k] = GID['park-path'];
      // A playground patch south-west of the centre.
      else if (i < cx - 3 && i > cx - 10 && j > cy + 3 && j < cy + 9) ground[k] = GID.playground;
    }
    for (const k of cells) {
      const i = k % W, j = Math.floor(k / W);
      const nextToBuilding = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inMap(i + dx, j + dy) && cls[idx(i + dx, j + dy)] === NONE);
      if (nextToBuilding) { solid[k] = 1; ground[k] = GID['lawn-dark']; props[k] = hash(i, j, 3) % 2 ? GID['p-bush'] : 0; reserved[k] = 1; continue; }
      if (ground[k] === GID['park-path'] || ground[k] === GID.playground || reserved[k]) continue;
      if (hash(i, j, pi) % 23 === 0) putProp(i, j, 'p-tree');
      else if ((Math.abs(i - cx) === 2 || Math.abs(j - cy) === 2) && hash(i, j, 17) % 9 === 0) putProp(i, j, 'p-bench');
    }
  });

  // ---- doors: every building has one; anchors turn the nearest suitable one into a delivery door ----
  const doorOf = (b) => {
    if (b.front === 's') return [[b.x + b.door, b.y + b.h - (b.kind === 'house' ? 1 : 1)], [b.x + b.door, b.y + b.h]];
    if (b.front === 'n') return [[b.x + b.door, b.y], [b.x + b.door, b.y - 1]];
    if (b.front === 'w') return [[b.x, b.y + b.door], [b.x - 1, b.y + b.door]];
    return [[b.x + b.w - 1, b.y + b.door], [b.x + b.w, b.y + b.door]];
  };
  // House doors: the south face's bottom row is the footprint's; the stand tile is the lawn below it.
  const standOk = (c) => inMap(...c) && (walkableCls(...c) || cls[idx(...c)] === OPEN) && !solid[idx(...c)];
  // Street furniture a door may never displace: signals, sign posts, barricades, the el, station stairs.
  const KEEP = new Set(['p-signal', 'p-barricade', 'p-pillar', 'p-stairs'].map((n) => GID[n]));
  const keeps = (c) => inMap(...c) && (KEEP.has(props[idx(...c)]) || (solid[idx(...c)] && !props[idx(...c)] && isCorridor(...c)));
  const FRONT_FOR_SIDE = { north: 's', south: 'n', east: 'w', west: 'e' };
  for (const a of world.anchors) {
    const geo = segGeo.get(a.segment);
    const gi = geos.indexOf(geo);
    const [px, py] = pointOn(geo, a.t);
    const want = FRONT_FOR_SIDE[a.side];
    // A door on this corridor's frontage: the building fronts the anchor's side and its stand tile is
    // the corridor's own (or, for houses, a yard reached from it); along diagonals any front will do.
    const onCorridor = (b, d) => b.gi === gi || (inMap(...d[1]) && owner[idx(...d[1])] === gi);
    const byDist = (p, q) => Math.hypot(p.d[0][0] - px, p.d[0][1] - py) - Math.hypot(q.d[0][0] - px, q.d[0][1] - py);
    const outOf = (d) => [2 * d[1][0] - d[0][0], 2 * d[1][1] - d[0][1]];
    const usable = buildings.filter((b) => !b.deliver && !b.dispatch).map((b) => ({ b, d: doorOf(b) })).filter(({ b, d }) => onCorridor(b, d) && standOk(d[1]) && !reserved[idx(...d[1])] && !keeps(outOf(d)));
    let cands = usable.filter(({ b }) => b.front === want).sort(byDist);
    if (!cands.length && !(geo.ew || geo.ns)) {
      // Along a diagonal, blocks are stair-stepped: take any building edge cell next to this
      // corridor's walkable tiles, and turn the building to front that way.
      const edges = [];
      for (const b of buildings) {
        if (b.deliver || b.dispatch || Math.hypot(b.x + b.w / 2 - px, b.y + b.h / 2 - py) > 40) continue;
        for (let k = 0; k < b.w; k++) edges.push({ b, front: 's', door: k, d: [[b.x + k, b.y + b.h - 1], [b.x + k, b.y + b.h]] }, { b, front: 'n', door: k, d: [[b.x + k, b.y], [b.x + k, b.y - 1]] });
        for (let k = 0; k < b.h; k++) edges.push({ b, front: 'w', door: k, d: [[b.x, b.y + k], [b.x - 1, b.y + k]] }, { b, front: 'e', door: k, d: [[b.x + b.w - 1, b.y + k], [b.x + b.w, b.y + k]] });
      }
      cands = edges.filter(({ d }) => inMap(...d[1]) && owner[idx(...d[1])] === gi && isCorridor(...d[1]) && standOk(d[1]) && !reserved[idx(...d[1])] && solid[idx(...d[0])]).sort(byDist);
      if (cands.length) {
        const c = cands[0];
        c.b.front = c.front;
        c.b.door = c.door;
        if (c.front === 'w' || c.front === 'e') c.b.side = c.front;
      }
    }
    if (!cands.length) {
      const msg = `anchor "${a.id}": no building with a reachable door on the ${a.side} side of "${a.segment}"`;
      if (!opts.lenient) throw new Error(msg);
      problems.push(msg);
      continue;
    }
    const { b, d } = cands[0];
    const [door, stand] = d;
    reserved[idx(...stand)] = 1;
    // Keep the stand tile and the next tile out clear of furniture.
    const out = [2 * stand[0] - door[0], 2 * stand[1] - door[1]];
    for (const c of [stand, out]) if (inMap(...c)) { props[idx(...c)] = 0; solid[idx(...c)] = 0; reserved[idx(...c)] = 1; }
    // No tree or post right beside the door either (they'd hide it, or the Dispatcher).
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const c of [stand, out]) if (inMap(c[0] + dx, c[1] + dy)) crossing[idx(c[0] + dx, c[1] + dy)] = 1;
    if (a.uses.includes('dispatcher')) {
      b.dispatch = true;
      // The Dispatcher's tile blocks like a wall: separating from their immovable body alone could push
      // the player into the facade behind them.
      solid[idx(...stand)] = 1;
      if (!standOk(out)) throw new Error(`anchor "${a.id}": no walkable tile in front of the Dispatcher`);
      const [fx, fy] = feet(stand);
      npcs.push({
        name: 'dispatcher', type: 'npc', point: true, x: fx, y: fy,
        properties: [prop('dialogueId', 'dispatcher.hello'), prop('facing', { s: 'down', n: 'up', w: 'left', e: 'right' }[b.front]), prop('look', 0, 'int'), prop('npcId', 'dispatcher'), prop('role', 'dispatcher')],
      });
    } else {
      b.deliver = true;
      const s = segments.get(a.segment);
      const [street, cross] = placeName(a.t <= 0.5 ? s.from : s.to);
      objects.push({ name: `point-${a.id}`, type: 'deliveryPoint', x: door[0] * T, y: door[1] * T, width: T, height: T, properties: [prop('cross', cross), prop('pointId', a.id), prop('street', street)] });
    }
  }

  // ---- the map edge (owner's decision 7): barricades wherever a walkable cell meets the walk boundary,
  // and an "End of delivery zone" sign at each opening ----
  const edgeSigns = [];
  const border = [];
  for (let i = WALK.x0; i < WALK.x1; i++) border.push([i, WALK.y0, 'N'], [i, WALK.y1 - 1, 'S']);
  for (let j = WALK.y0 + 1; j < WALK.y1 - 1; j++) border.push([WALK.x0, j, 'W'], [WALK.x1 - 1, j, 'E']);
  const opening = new Map();
  for (const [i, j, side] of border) {
    const k = idx(i, j);
    if (!(walkableCls(i, j) && !solid[k])) continue;
    props[k] = GID['p-barricade'];
    solid[k] = 1;
    reserved[k] = 1;
    const key = `${side}:${owner[k]}`;
    opening.set(key, [...(opening.get(key) ?? []), [i, j]]);
  }
  for (const [key, cells] of opening) {
    const side = key[0];
    // The sign stands one tile inside the barricades, facing the player: the free tile nearest the opening's middle.
    const inward = ([i, j]) => ({ N: [i, j + 1], S: [i, j - 1], W: [i + 1, j], E: [i - 1, j] })[side];
    const mid = Math.floor(cells.length / 2);
    const spot = [...cells].sort((p, q) => Math.abs(cells.indexOf(p) - mid) - Math.abs(cells.indexOf(q) - mid)).map(inward).find((c) => inMap(...c) && walkableCls(...c) && !solid[idx(...c)] && !props[idx(...c)]);
    if (!spot) continue;
    const [si, sj] = spot;
    reserved[idx(si, sj)] = 1;
    edgeSigns.push({ name: `edge-${side}-${si}-${sj}`, type: 'edgeSign', point: true, x: si * T + 8, y: (sj + 1) * T, properties: [prop('text', 'edge.end'), prop('side', side)] });
  }

  // ---- the start spawn, next to the Dispatcher ----
  {
    const d = npcs.find((n) => n.name === 'dispatcher');
    const [di, dj] = [Math.floor(d.x / T), Math.floor((d.y - 1) / T)];
    const c = [di + START.fromDispatcher[0], dj + START.fromDispatcher[1]];
    if (!walkableCls(...c) || solid[idx(...c)]) throw new Error(`start spawn: tile ${c} is not walkable`);
    // Keep the start's row clear two tiles each way (a new game can walk off in any direction).
    for (let dx = -3; dx <= 3; dx++) for (let dy = -1; dy <= 1; dy++) if (inMap(c[0] + dx, c[1] + dy)) crossing[idx(c[0] + dx, c[1] + dy)] = 1;
    const [fx, fy] = feet(c);
    objects.unshift({ name: 'start', type: 'spawn', point: true, x: fx, y: fy, properties: [prop('facing', START.facing), prop('spawnId', 'start')] });
  }

  // ---- street trees (2015 census, snapped to the nearest free curb, paseo or plaza edge cell) ----
  const treeOk = (i, j) => {
    if (!inMap(i, j) || reserved[idx(i, j)] || crossing[idx(i, j)] || solid[idx(i, j)] || props[idx(i, j)]) return false;
    const k = idx(i, j);
    const g = ground[k];
    const curb = cls[k] === SIDEWALK && g !== GID.sidewalk; // a curb tile: sidewalk next to the road
    const paseoEdge = g === GID['paseo-grass'] && [[0, 1], [0, -1]].some(([dx, dy]) => inMap(i + dx, j + dy) && ground[idx(i + dx, j + dy)] === GID['bike-lane']);
    const lawn = cls[k] === PARK && g !== GID['park-path'] && g !== GID.playground;
    return curb || paseoEdge || lawn;
  };
  const treeAt = new Set();
  const near = (i, j) => { for (let dx = 1 - TREE_GAP; dx < TREE_GAP; dx++) for (let dy = 1 - TREE_GAP; dy < TREE_GAP; dy++) if (treeAt.has(idx(i + dx, j + dy))) return true; return false; };
  let treesPlaced = 0;
  for (const [tx, ty] of world.trees.tiles) {
    const [ci, cj] = [tx - box.x0, ty - box.y0];
    let best = null;
    for (let r = 0; r <= 6 && !best; r++) {
      for (let dy = -r; dy <= r && !best; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const i = ci + dx, j = cj + dy;
        if (treeOk(i, j) && !near(i, j)) { best = [i, j]; break; }
      }
    }
    if (!best) continue;
    putProp(...best, 'p-tree');
    treeAt.add(idx(...best));
    treesPlaced++;
  }

  // ---- street furniture: lamps along every curb, a hydrant near each corner, benches and planters on plazas and the paseo ----
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = idx(i, j);
    if (reserved[k] || crossing[k] || solid[k] || props[k]) continue;
    const g = ground[k];
    const gx = i + box.x0, gy = j + box.y0;
    if (cls[k] === SIDEWALK && g !== GID.sidewalk) {
      const along = ['curb-n', 'curb-s'].includes(TILE_IDS.tiles[g - 1]) ? gx : gy;
      const m = ((along % LAMP_EVERY) + LAMP_EVERY) % LAMP_EVERY;
      if (m === 6 && !near(i, j)) putProp(i, j, 'p-lamp');
      else if (m === 2 && hash(gx, gy, 31) % 4 === 0) putProp(i, j, 'p-hydrant');
    } else if (g === GID['paseo-grass']) {
      const edge = [[0, 1], [0, -1]].some(([dx, dy]) => ground[idx(i, j + dy)] === GID['bike-lane']);
      const mid = Math.abs(across[k]) < 2; // the two centre rows stay clear end to end
      if (!edge && !mid && ((gx % 10) + 10) % 10 === 5 && hash(gx, gy, 41) % 3 === 0) putProp(i, j, 'p-bench');
      else if (!edge && ((gx % 7) + 7) % 7 === 3 && hash(gx, gy, 43) % 4 === 0) ground[k] = GID.flowers;
    } else if (g === GID.plaza) {
      const a = Math.abs(across[k]), hw = geos[owner[k]].hw;
      if (a > hw - 1 && ((gx + gy) % 5 + 5) % 5 === 0) putProp(i, j, 'p-planter');
      else if (a < 2 && ((gx + gy) % 9 + 9) % 9 === 4) putProp(i, j, 'p-bench');
    }
  }

  // Ground under open cells that ended up blocked (fences) stays yard; everything outside walk is scenery.
  // Corridors are walkable unless furniture stands there.
  for (let k = 0; k < W * H; k++) if (cls[k] === NONE && !solid[k]) solid[k] = 1;

  // ---- zones: one rectangle per zoned axis-aligned segment, its crossings left out ----
  const zoneRects = [];
  geos.forEach((geo) => {
    if (!geo.zone || !(geo.ew || geo.ns)) return;
    const crossHw = (nid) => Math.max(0, ...(atNode.get(nid) ?? []).filter((g) => g !== geo && g.street !== geo.street).map((g) => g.hw));
    const [pa, pb] = geo.ew ? [geo.ax, geo.bx] : [geo.ay, geo.by];
    const [na, nb] = pa < pb ? geo.ends : [geo.ends[1], geo.ends[0]];
    const lo = Math.min(pa, pb) + crossHw(na);
    const hi = Math.max(pa, pb) - crossHw(nb);
    if (hi <= lo) return;
    const c = geo.ew ? geo.ay : geo.ax;
    const [x0, y0, x1, y1] = geo.ew ? [lo, c - geo.hw, hi, c + geo.hw] : [c - geo.hw, lo, c + geo.hw, hi];
    zoneRects.push({ name: `zone-${geo.id}`, type: 'zone', x: x0 * T, y: y0 * T, width: (x1 - x0) * T, height: (y1 - y0) * T, properties: [prop('zoneId', geo.zone)] });
  });

  // ---- buildings as Tiled objects: class = kind, one compact "spec" string ----
  const spec = (b) => [b.front, b.roof, b.side, b.door, b.deliver ? 1 : 0, b.variant, b.sign].join(',');
  const buildingObjs = buildings.map((b) => ({ name: '', type: b.kind, x: b.x * T, y: b.y * T, width: b.w * T, height: b.h * T, properties: [prop('spec', spec(b))] }));

  let id = 1;
  const withIds = (list) =>
    list.map((o) => ({
      height: o.height ?? 0, id: id++, name: o.name, opacity: 1, ...(o.point ? { point: true } : {}),
      properties: [...o.properties].sort((a, b) => a.name.localeCompare(b.name)), rotation: 0, type: o.type, visible: true, width: o.width ?? 0, x: o.x, y: o.y,
    }));
  const objLayer = withIds(objects);
  const npcLayer = withIds(npcs);
  const bLayer = withIds(buildingObjs);
  const signLayer = withIds([...signs, ...edgeSigns]);
  const cornerLayer = withIds(corners);
  const zoneLayer = withIds(zoneRects);
  const collision = Array.from(solid, (v) => (v ? GID.solid : 0));
  const tileLayer = (lid, name, data, visible = true) => ({ compression: 'zlib', data: encodeLayer(data), encoding: 'base64', height: H, id: lid, name, opacity: 1, type: 'tilelayer', visible, width: W, x: 0, y: 0 });
  const objectGroup = (lid, name, objs) => ({ draworder: 'topdown', id: lid, name, objects: objs, opacity: 1, type: 'objectgroup', visible: true, x: 0, y: 0 });
  const json = {
    compressionlevel: -1, height: H, infinite: false,
    layers: [
      tileLayer(1, 'ground', ground), tileLayer(2, 'collision', collision, false), tileLayer(3, 'props', props),
      objectGroup(4, 'objects', objLayer), objectGroup(5, 'npcs', npcLayer), objectGroup(6, 'buildings', bLayer), objectGroup(7, 'labels', signLayer), objectGroup(8, 'corners', cornerLayer), objectGroup(9, 'zones', zoneLayer),
    ],
    nextlayerid: 10, nextobjectid: id, orientation: 'orthogonal',
    properties: [
      prop('generatedBy', 'scripts/generate-maps.mjs from src/data/world/jackson-heights.json; regenerate, do not edit by hand'),
      prop('walkHeight', walk.height, 'int'), prop('walkWidth', walk.width, 'int'), prop('walkX', WALK.x0, 'int'), prop('walkY', WALK.y0, 'int'),
    ],
    renderorder: 'right-down', tiledversion: '1.12.2', tileheight: T, tilesets: TILESETS, tilewidth: T, type: 'map', version: '1.10', width: W,
  };
  const stats = { buildings: buildings.length, kinds: count(buildings.map((b) => b.kind)), trees: treesPlaced, treesInData: world.trees.tiles.length, signs: signs.length, edgeSigns: edgeSigns.length, corners: corners.length, rects: rects.length };
  return [{ id: mapDef.id, json, layers: { ground, collision, props }, stats, problems, debug: { cls, owner, geos, box } }];
}

function count(list) {
  const m = {};
  for (const x of list) m[x] = (m[x] ?? 0) + 1;
  return m;
}

/** Like tileOf, unrounded (outlines keep their shape). */
function tileOfF(layout, [gx, gy]) {
  const rows = layout.rowsY;
  let seg = rows.findIndex((r, i) => i + 1 < rows.length && gy >= r[0] && gy <= rows[i + 1][0]);
  if (seg < 0) seg = gy < rows[0][0] ? 0 : rows.length - 2;
  const [g0, t0] = rows[seg], [g1, t1] = rows[seg + 1];
  return [gx * layout.tileX, t0 + ((gy - g0) / (g1 - g0)) * (t1 - t0)];
}

function inRing(x, y, ring) {
  let ins = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [x1, y1] = ring[a], [x2, y2] = ring[b];
    if (y1 > y !== y2 > y && x < x1 + ((y - y1) * (x2 - x1)) / (y2 - y1)) ins = !ins;
  }
  return ins;
}

/**
 * Greedy decomposition of a 0/1 grid into rectangles: repeatedly the largest rectangle of 1s
 * (histogram method) with both sides >= minSide and area >= minArea, until none is left.
 */
function maximalRects(mask, W, H, minSide, minArea) {
  const m = Uint8Array.from(mask);
  const out = [];
  for (;;) {
    let best = null;
    const hgt = new Int32Array(W);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) hgt[i] = m[j * W + i] ? hgt[i] + 1 : 0;
      const stack = [];
      for (let i = 0; i <= W; i++) {
        const hh = i < W ? hgt[i] : 0;
        let start = i;
        while (stack.length && stack[stack.length - 1][1] >= hh) {
          const [s, sh] = stack.pop();
          const w = i - s;
          if (sh >= minSide && w >= minSide && sh * w >= minArea && (!best || sh * w > best.w * best.h)) best = { x: s, y: j - sh + 1, w, h: sh };
          start = s;
        }
        stack.push([start, hh]);
      }
    }
    if (!best) break;
    for (let j = best.y; j < best.y + best.h; j++) for (let i = best.x; i < best.x + best.w; i++) m[j * W + i] = 0;
    out.push(best);
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

function insideBox(b, [x, y]) {
  return x >= b.x0 && y >= b.y0 && x <= b.x0 + b.width && y <= b.y0 + b.height;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - ax - t * vx, py - ay - t * vy);
}

/** Runs Tiled's JSON writer on `src` (a file in MAPS_DIR), writing `dest` (also in MAPS_DIR). */
function tiledExport(src, dest) {
  const bin = process.env.TILED ?? 'tiled';
  const r = spawnSync(bin, ['--export-map', 'json', src, dest], { cwd: MAPS_DIR, encoding: 'utf8' });
  if (r.error) throw new Error(`could not run Tiled ("${bin}"): ${r.error.message}`);
  if (r.status !== 0 || !existsSync(join(MAPS_DIR, dest))) throw new Error(`Tiled failed on ${src}: ${r.stderr || r.stdout}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const world = JSON.parse(readFileSync(WORLD_FILE, 'utf8'));
  const t0 = Date.now();
  const built = buildMaps(world);
  mkdirSync(MAPS_DIR, { recursive: true });
  const diffs = [];
  for (const { id, json, stats } of built) {
    const raw = `.gen-${id}.raw.json`;
    const out = check ? `.gen-${id}.check.json` : `${id}.json`;
    writeFileSync(join(MAPS_DIR, raw), JSON.stringify(json));
    try {
      tiledExport(raw, out);
    } finally {
      unlinkSync(join(MAPS_DIR, raw));
    }
    if (check) {
      const target = join(MAPS_DIR, `${id}.json`);
      const same = existsSync(target) && readFileSync(target).equals(readFileSync(join(MAPS_DIR, out)));
      unlinkSync(join(MAPS_DIR, out));
      if (!same) diffs.push(id);
      console.log(`[maps] ${id}: ${same ? 'no diff' : 'DIFFERS'}`);
    } else {
      const layer = (name) => json.layers.find((l) => l.name === name).objects;
      const countOf = (type) => layer('objects').filter((o) => o.type === type).length;
      console.log(`[maps] ${id}.json: ${json.width}x${json.height} tiles, ${countOf('spawn')} spawn, ${countOf('deliveryPoint')} delivery points, ${stats.buildings} buildings ${JSON.stringify(stats.kinds)}, ${stats.trees}/${stats.treesInData} trees placed, ${stats.signs} corner signs, ${stats.edgeSigns} edge signs, ${stats.corners} corners, ${layer('zones').length} zone areas (${Date.now() - t0} ms)`);
    }
  }
  if (check) {
    console.log(diffs.length ? `[maps] FAIL: ${diffs.length} map(s) differ from a fresh generation: ${diffs.join(', ')}` : `[maps] OK: ${built.length} map regenerates with no diff`);
    process.exit(diffs.length ? 1 : 0);
  }
}

// Generates the world's Tiled map from the world dataset (DESIGN.md 2.14, 2.15).
// Usage:
//   node scripts/generate-maps.mjs           write the map to src/data/maps/<id>.json
//   node scripts/generate-maps.mjs --check   regenerate next to the map and fail (exit 1) on any byte diff
// The map is written as raw JSON, then normalized with Tiled's own writer
// (`tiled --export-map json`, run in src/data/maps so relative tileset paths stay put), so the
// committed file is exactly what the Tiled GUI saves. Set TILED to use another Tiled binary.
// No dependencies. buildMaps() is exported for tests/world/generate-maps.test.mjs.

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { halfWidthOf, mapBoxes, tileOf } from './world-layout.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORLD_FILE = join(ROOT, 'src/data/world/jackson-heights.json');
const TILES_FILE = join(ROOT, 'src/data/tiles.json');
const MAPS_DIR = join(ROOT, 'src/data/maps');
const T = 16;

// Tile ids come from src/data/tiles.json (the placeholder painters use the same list).
const TILE_IDS = JSON.parse(readFileSync(TILES_FILE, 'utf8'));
const OVERHEAD_FIRSTGID = TILE_IDS.tiles.length + 1;
const GID = Object.fromEntries([...TILE_IDS.tiles.map((name, i) => [name, i + 1]), ...TILE_IDS.overhead.map((name, i) => [name, OVERHEAD_FIRSTGID + i])]);
export const TILESETS = [
  {
    columns: 4, firstgid: 1, image: '../../../public/assets/tilesets/tiles.png', imageheight: Math.ceil(TILE_IDS.tiles.length / 4) * T, imagewidth: 4 * T, margin: 0, name: 'tiles', spacing: 0,
    tilecount: TILE_IDS.tiles.length, tileheight: T,
    tiles: TILE_IDS.collides.map((name) => TILE_IDS.tiles.indexOf(name)).sort((a, b) => a - b).map((id) => ({ id, properties: [{ name: 'collides', type: 'bool', value: true }] })),
    tilewidth: T,
  },
  { columns: 1, firstgid: OVERHEAD_FIRSTGID, image: '../../../public/assets/tilesets/overhead.png', imageheight: T, imagewidth: T * TILE_IDS.overhead.length, margin: 0, name: 'overhead', spacing: 0, tilecount: TILE_IDS.overhead.length, tileheight: T, tilewidth: T },
];

// Where a new game starts (Claude's choice): mid-block on Roosevelt Ave 74th-75th St, near the Dispatcher.
const START = { segment: 'seg-roosevelt-74-75', t: 0.5, facing: 'up' };
// Blocks in these zones are garden courts (frontage wall, grass and trees behind it); the rest are buildings.
const GARDEN_ZONES = new Set(['historic-district']);
// Shop fronts face these streets (Claude's choice: the neighborhood's commercial corridors); other
// blocks get generic residential fronts. Placeholder art only: no real businesses.
const COMMERCIAL = new Set(['roosevelt', 'ave-37', 'northern', 'broadway', 'rd-37']);
// ...and these side streets inside these zones: 74th St and 82nd St between 37th Ave and Roosevelt Ave.
const COMMERCIAL_SIDE = { streets: new Set(['st-74', 'st-82']), zones: new Set(['diversity-plaza-74th', 'ave-37']) };
const COMPASS = { N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1] };
const SIDE_STEP = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const AWAY = { north: 'down', south: 'up', east: 'left', west: 'right' };
// Cell classes, in the order they win where corridors of equal width overlap.
const NONE = 0, SIDEWALK = 1, PLAZA = 2, ROAD = 3;
// Elevated-7 pillars every this many tiles along Roosevelt Ave (two rows inside the roadway).
const PILLAR_EVERY = 5;

/**
 * Builds the dataset's one map. Returns [{ id, json }], where json is a Tiled JSON map (not yet
 * normalized by Tiled). Throws on anything it can't lay out.
 */
export function buildMaps(world) {
  const L = world.layout;
  const segments = new Map(world.segments.map((s) => [s.id, s]));
  const nodes = new Map(world.nodes.map((n) => [n.id, n]));
  const streets = new Map(world.streets.map((s) => [s.id, s]));
  const zoneOf = new Map(world.zones.flatMap((z) => z.segments.map((sid) => [sid, z.id])));
  const mapDef = world.maps[0];
  const { map: box, walk } = mapBoxes(L, world.nodes);
  const W = box.width;
  const H = box.height;
  if (mapDef.tiles[0] !== W || mapDef.tiles[1] !== H) throw new Error(`map "${mapDef.id}": dataset says ${mapDef.tiles.join('x')}, layout gives ${W}x${H}`);
  const local = ([x, y]) => [x - box.x0, y - box.y0];
  const at = (nid) => local(tileOf(L, nodes.get(nid).grid));
  const idx = (i, j) => j * W + i;
  const inMap = (i, j) => i >= 0 && j >= 0 && i < W && j < H;

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
      // A run looks like the street it continues (34th Ave stays the paseo; Roosevelt keeps the el).
      const own = world.segments.filter((s) => s.street === c.street && (s.from === n.id || s.to === n.id));
      geos.push({
        id: `run-${n.id}-${c.street}`, street: c.street, hw: halfWidthOf(L, c.street), ax, ay, bx: ax + dx * far, by: ay + dy * far, ew: axis && dy === 0, ns: axis && dx === 0, ends: [n.id],
        plaza: own.length > 0 && own.every((s) => s.use === 'plaza'), el: own.some((s) => s.overhead !== undefined), zone: null, run: true,
      });
    }
  }
  // Per node: the corridors that touch it (a run touches only its start).
  const atNode = new Map();
  for (const geo of geos) for (const nid of geo.ends) atNode.set(nid, [...(atNode.get(nid) ?? []), geo]);

  // ---- paint: per cell, the widest road or plaza covering it wins (ties go to the road), else sidewalk ----
  const cls = new Uint8Array(W * H);
  const owner = new Int32Array(W * H).fill(-1); // geo index that decided the cell
  const bestHw = new Uint8Array(W * H);
  const cover = new Uint8Array(W * H);
  const under = new Uint8Array(W * H); // under the elevated line's deck (shadow rows)
  geos.forEach((geo, gi) => {
    const { hw, ax, ay, bx, by } = geo;
    // A segment end with nothing else at its node is a dead end: close it with the corridor's own width.
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
        let inside, edge, across;
        if (geo.ew || geo.ns) {
          const [p, q, c] = geo.ew ? [cx, cy, ay] : [cy, cx, ax];
          const [pa, pb] = geo.ew ? [ax, bx] : [ay, by];
          const [lo, hi] = [Math.min(pa, pb), Math.max(pa, pb)];
          const [capLo, capHi] = pa < pb ? [capA, capB] : [capB, capA];
          across = q - c;
          const past = Math.max(0, lo - p, p - hi); // into a dead end's cap
          inside = p > lo - capLo && p < hi + capHi && Math.abs(across) < hw;
          edge = Math.abs(across) > hw - 1 || past > hw - 1;
        } else {
          const d = distToSegment(cx, cy, ax, ay, bx, by);
          inside = d < hw;
          edge = d > hw - 1;
        }
        if (!inside) continue;
        const k = idx(i, j);
        cover[k]++;
        const c = geo.plaza ? PLAZA : edge ? SIDEWALK : ROAD;
        if (c === SIDEWALK) {
          if (cls[k] === NONE) {
            cls[k] = SIDEWALK;
            owner[k] = gi;
          }
        } else if (cls[k] <= SIDEWALK || hw > bestHw[k] || (hw === bestHw[k] && c > cls[k])) {
          cls[k] = c;
          owner[k] = gi;
          bestHw[k] = hw;
        }
        if (geo.el && geo.ew && across !== undefined && Math.abs(across) <= hw - 2) under[k] = 1;
      }
    }
  });
  const walkable = (i, j) => inMap(i, j) && cls[idx(i, j)] !== NONE;

  // ---- objects that need free tiles: start, Dispatcher, delivery points ----
  const reserved = new Uint8Array(W * H);
  const objects = [];
  const npcs = [];
  const prop = (name, value, type = 'string') => ({ name, type, value });
  const feet = ([i, j]) => [i * T + 8, j * T + 12];
  const segGeo = new Map(geos.filter((g) => g.segment).map((g) => [g.id, g]));
  const pointOn = (geo, t) => [geo.ax + (geo.bx - geo.ax) * t, geo.ay + (geo.by - geo.ay) * t];

  {
    const [px, py] = pointOn(segGeo.get(START.segment), START.t);
    const c = [Math.floor(px), Math.floor(py)];
    if (!walkable(...c)) throw new Error(`start spawn: tile ${c} is not walkable`);
    reserved[idx(...c)] = 1;
    const [fx, fy] = feet(c);
    objects.push({ name: 'start', type: 'spawn', point: true, x: fx, y: fy, properties: [prop('facing', START.facing), prop('spawnId', 'start')] });
  }

  // A node's name for the order ticket and street signs: its north-south street, then the street it crosses.
  const placeName = (nid) => {
    const sts = nodes.get(nid).streets;
    const order = (sid) => ({ ns: 0, ew: 1, diagonal: 2 })[streets.get(sid).orientation];
    const [a, b] = [...sts].sort((x, y) => order(x) - order(y) || sts.indexOf(x) - sts.indexOf(y));
    return [`street.${a}`, `street.${b}`];
  };

  // Anchors: walk from the centre line toward the anchor's side to the first building tile. That
  // tile gets the delivery point; the tile before it is where the player stands to face it. If
  // that spot is taken, the anchor slides along its segment to the nearest free one (same side).
  const placeAnchor = (a, geo, [sx, sy]) => {
    const [px, py] = pointOn(geo, a.t);
    const [ux, uy] = geo.ew ? [1, 0] : geo.ns ? [0, 1] : [Math.sign(geo.bx - geo.ax), 0];
    const span = Math.ceil(Math.hypot(geo.bx - geo.ax, geo.by - geo.ay));
    for (let n = 0; n <= 2 * span; n++) {
      const shift = n % 2 ? (n + 1) / 2 : -n / 2;
      let i = Math.floor(px) + ux * shift;
      let j = Math.floor(py) + uy * shift;
      if (geo.ew) j = a.side === 'north' ? geo.ay - 1 : geo.ay;
      if (geo.ns) i = a.side === 'west' ? geo.ax - 1 : geo.ax;
      if (!walkable(i, j)) continue;
      while (walkable(i + sx, j + sy)) {
        i += sx;
        j += sy;
      }
      const wallCell = [i + sx, j + sy];
      // The door must be on this corridor's own frontage: its standing tile belongs to this street
      // (so a walk that runs on into another street, e.g. Broadway into Roosevelt, slides instead).
      if (owner[idx(i, j)] !== geos.indexOf(geo)) continue;
      if (!reserved[idx(i, j)] && inMap(...wallCell) && !reserved[idx(...wallCell)]) return [[i, j], wallCell];
    }
    throw new Error(`anchor "${a.id}": no free building tile on its side of "${a.segment}"`);
  };
  for (const a of world.anchors) {
    const geo = segGeo.get(a.segment);
    const [sx, sy] = SIDE_STEP[a.side];
    const [stand, wallCell] = placeAnchor(a, geo, [sx, sy]);
    const [i, j] = stand;
    reserved[idx(...stand)] = 1;
    reserved[idx(...wallCell)] = 1;
    if (a.uses.includes('dispatcher')) {
      // The Dispatcher stands on the sidewalk in front of the building, facing the street;
      // the player talks to them from the next tile out.
      const front = [i - sx, j - sy];
      if (!walkable(...front)) throw new Error(`anchor "${a.id}": no walkable tile in front of the Dispatcher`);
      reserved[idx(...front)] = 1;
      const [fx, fy] = feet(stand);
      npcs.push({
        name: 'dispatcher', type: 'npc', point: true, x: fx, y: fy,
        properties: [prop('dialogueId', 'dispatcher.hello'), prop('facing', AWAY[a.side]), prop('look', 0, 'int'), prop('npcId', 'dispatcher'), prop('role', 'dispatcher')],
      });
    } else {
      const s = segments.get(a.segment);
      const [street, cross] = placeName(a.t <= 0.5 ? s.from : s.to);
      objects.push({ name: `point-${a.id}`, type: 'deliveryPoint', x: wallCell[0] * T, y: wallCell[1] * T, width: T, height: T, properties: [prop('cross', cross), prop('pointId', a.id), prop('street', street)] });
    }
  }

  // ---- tile layers ----
  const ground = new Array(W * H).fill(GID.sidewalk);
  const obstacles = new Array(W * H).fill(0);
  const above = new Array(W * H).fill(0);
  const isRoad = (i, j) => inMap(i, j) && cls[idx(i, j)] === ROAD;
  const CURB = { n: 'curb-n', s: 'curb-s', e: 'curb-e', w: 'curb-w', ne: 'curb-ne', nw: 'curb-nw', se: 'curb-se', sw: 'curb-sw' };
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = idx(i, j);
      if (cls[k] === ROAD) ground[k] = GID[under[k] ? 'el-shadow' : 'road'];
      else if (cls[k] === PLAZA) ground[k] = GID[geos[owner[k]].street === 'ave-34' ? 'paseo' : 'plaza'];
      else if (cls[k] === SIDEWALK) {
        // A curb on every side that meets the road (two adjacent sides at a corner).
        const n = isRoad(i, j - 1), s = isRoad(i, j + 1), e = isRoad(i + 1, j), w = isRoad(i - 1, j);
        const key = (n ? 'n' : s ? 's' : '') + (e ? 'e' : w ? 'w' : '');
        ground[k] = GID[CURB[key] ?? 'sidewalk'];
      }
    }
  }

  // Markings on cells only one corridor covers (never in a crossing): a double yellow centre line
  // on avenues, plus lane dashes on the widest roads; the el's shadow and pillars on Roosevelt Ave.
  const single = (i, j, gi) => inMap(i, j) && cover[idx(i, j)] === 1 && owner[idx(i, j)] === gi && cls[idx(i, j)] === ROAD && !reserved[idx(i, j)];
  geos.forEach((geo, gi) => {
    if (!geo.ew || geo.plaza) return;
    const c = geo.ay;
    const [lo, hi] = [Math.max(0, Math.min(geo.ax, geo.bx)), Math.min(W, Math.max(geo.ax, geo.bx))];
    for (let i = lo; i < hi; i++) {
      const gx = i + box.x0; // global column, so patterns don't depend on the map's origin
      if (geo.el) {
        if (((gx % PILLAR_EVERY) + PILLAR_EVERY) % PILLAR_EVERY === 2) for (const j of [c - 2, c + 1]) if (single(i, j, gi)) obstacles[idx(i, j)] = GID['el-pillar'];
        continue;
      }
      if (geo.hw >= 3) {
        if (single(i, c - 1, gi)) ground[idx(i, c - 1)] = GID['center-line-s'];
        if (single(i, c, gi)) ground[idx(i, c)] = GID['center-line-n'];
      }
      if (geo.hw >= 4) {
        if (single(i, c - 2, gi)) ground[idx(i, c - 2)] = GID['lane-dash-n'];
        if (single(i, c + 1, gi)) ground[idx(i, c + 1)] = GID['lane-dash-s'];
      }
    }
  });

  // Crossings of a north-south street and an east-west street: crosswalks continue each sidewalk
  // across the other street, and traffic signals stand on two opposite corners.
  const signs = [];
  for (const [nid, here] of atNode) {
    const ns = here.filter((g) => g.ns && !g.plaza);
    const ew = here.filter((g) => g.ew && !g.plaza);
    const [C, R] = at(nid);
    const arms = new Set(here.flatMap((g) => (g.ns ? [Math.min(g.ay, g.by) < R ? 'N' : 'S'] : g.ew ? [Math.min(g.ax, g.bx) < C ? 'W' : 'E'] : [])));
    if (ns.length && ew.length) {
      const hs = Math.max(...ns.map((g) => g.hw));
      const ha = Math.max(...ew.map((g) => g.hw));
      for (let j = R - ha + 1; j <= R + ha - 2; j++) for (const i of [C - hs, C + hs - 1]) if (isRoad(i, j) && !under[idx(i, j)]) ground[idx(i, j)] = GID['crosswalk-ns'];
      for (const j of [R - ha, R + ha - 1]) for (let i = C - hs + 1; i <= C + hs - 2; i++) if (isRoad(i, j)) ground[idx(i, j)] = GID['crosswalk-ew'];
      const corners = { NW: [C - hs, R - ha, 'N', 'W'], SE: [C + hs - 1, R + ha - 1, 'S', 'E'], NE: [C + hs - 1, R - ha, 'N', 'E'], SW: [C - hs, R + ha - 1, 'S', 'W'] };
      const ok = (name) => { const [i, j, a, b] = corners[name]; return arms.has(a) && arms.has(b) && inMap(i, j) && cls[idx(i, j)] === SIDEWALK && !reserved[idx(i, j)]; };
      const pick = ['NW', 'SE'].filter(ok);
      for (const name of pick.length ? pick : ['NE', 'SW'].filter(ok)) {
        const [i, j] = corners[name];
        obstacles[idx(i, j)] = GID.signal;
        reserved[idx(i, j)] = 1;
      }
    }
    // Street sign: on the corner building of the first free quadrant (NW, NE, SW, SE).
    const hs = Math.max(0, ...here.filter((g) => g.ns).map((g) => g.hw)) || Math.max(...here.map((g) => g.hw));
    const ha = Math.max(0, ...here.filter((g) => !g.ns).map((g) => g.hw)) || hs;
    const quads = [['NW', C - hs - 1, R - ha - 1, 'se', C - hs, R - ha], ['NE', C + hs, R - ha - 1, 'sw', C + hs, R - ha], ['SW', C - hs - 1, R + ha, 'ne', C - hs, R + ha], ['SE', C + hs, R + ha, 'nw', C + hs, R + ha]];
    const q = quads.find(([, i, j]) => inMap(i, j) && !walkable(i, j));
    if (q && insideBox(walk, [C + box.x0, R + box.y0])) {
      const [street, cross] = placeName(nid);
      signs.push({ nid, quad: q[0], obj: { name: `sign-${nid}`, type: 'streetSign', point: true, x: q[4] * T, y: q[5] * T, properties: [prop('align', q[3]), prop('cross', cross), prop('street', street)] } });
    }
  }

  // Station stairs on the corner buildings at each entrance node (not the sign's corner).
  for (const st of world.transit.filter((x) => x.kind === 'station')) {
    for (const nid of st.entrances) {
      const here = atNode.get(nid) ?? [];
      const [C, R] = at(nid);
      const hs = Math.max(0, ...here.filter((g) => g.ns).map((g) => g.hw)) || 2;
      const ha = Math.max(0, ...here.filter((g) => !g.ns).map((g) => g.hw)) || 2;
      const signQuad = signs.find((s) => s.nid === nid)?.quad;
      for (const [name, i, j] of [['NW', C - hs - 1, R - ha - 1], ['NE', C + hs, R - ha - 1], ['SW', C - hs - 1, R + ha], ['SE', C + hs, R + ha]]) {
        if (name === signQuad || !inMap(i, j) || walkable(i, j) || reserved[idx(i, j)]) continue;
        if (![[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dx, dy]) => walkable(i + dx, j + dy))) continue;
        obstacles[idx(i, j)] = GID.station;
        reserved[idx(i, j)] = 1;
      }
    }
  }

  // Blocks: each connected group of non-walkable tiles. Its zone is the most common zone of the
  // corridors along its edge; garden zones become garden courts, the rest roofs with fronts.
  const block = new Int32Array(W * H).fill(-1);
  const blocks = [];
  for (let j0 = 0; j0 < H; j0++) {
    for (let i0 = 0; i0 < W; i0++) {
      if (walkable(i0, j0) || block[idx(i0, j0)] >= 0) continue;
      const id = blocks.length;
      const votes = new Map();
      const stack = [[i0, j0]];
      block[idx(i0, j0)] = id;
      while (stack.length) {
        const [i, j] = stack.pop();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = i + dx, nj = j + dy;
          if (!inMap(ni, nj)) continue;
          const nk = idx(ni, nj);
          if (cls[nk] !== NONE) {
            const z = geos[owner[nk]].zone;
            votes.set(z, (votes.get(z) ?? 0) + 1);
          } else if (block[nk] < 0) {
            block[nk] = id;
            stack.push([ni, nj]);
          }
        }
      }
      const zone = [...votes].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] ?? null;
      blocks.push({ zone });
    }
  }
  const NEIGH8 = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = idx(i, j);
      if (walkable(i, j) || obstacles[k]) continue;
      const garden = GARDEN_ZONES.has(blocks[block[k]].zone);
      const frontage = NEIGH8.some(([dx, dy]) => walkable(i + dx, j + dy));
      const edgeOfMap = i === 0 || j === 0 || i === W - 1 || j === H - 1;
      if (garden && !frontage && !edgeOfMap) {
        ground[k] = GID.grass;
        const gx = i + box.x0, gy = j + box.y0;
        if (((gx % 4) + 4) % 4 === 2 && ((gy % 4) + 4) % 4 === 1 && !reserved[k]) {
          obstacles[k] = GID.tree;
          if (j > 0) above[idx(i, j - 1)] = GID.canopy;
        }
        continue;
      }
      if (!frontage) {
        obstacles[k] = GID.roof;
        continue;
      }
      // 3/4 view: a front shows on a block's south, east and west sides; its north side is roof edge.
      const faces = [[0, 1], [1, 0], [-1, 0]].find(([dx, dy]) => walkable(i + dx, j + dy));
      if (!faces) {
        obstacles[k] = GID[walkable(i, j - 1) ? 'roof-edge' : 'roof'];
        continue;
      }
      const { street, zone } = geos[owner[idx(i + faces[0], j + faces[1])]];
      const shops = COMMERCIAL.has(street) || (COMMERCIAL_SIDE.streets.has(street) && COMMERCIAL_SIDE.zones.has(zone));
      obstacles[k] = GID[garden ? 'wall' : shops ? 'storefront' : 'house'];
    }
  }

  // Plaza dressing on cells only the plaza covers: planters along the edges of narrow plazas,
  // trees (canopy one tile north, in "above") along wider ones.
  geos.forEach((geo, gi) => {
    if (!geo.plaza || !(geo.ew || geo.ns)) return;
    const c = geo.ew ? geo.ay : geo.ax;
    const [lo, hi] = geo.ew ? [Math.min(geo.ax, geo.bx), Math.max(geo.ax, geo.bx)] : [Math.min(geo.ay, geo.by), Math.max(geo.ay, geo.by)];
    const origin = geo.ew ? box.x0 : box.y0;
    for (let p = lo; p < hi; p++) {
      const g0 = p + origin;
      for (const off of [-geo.hw, geo.hw - 1]) {
        const [i, j] = geo.ew ? [p, c + off] : [c + off, p];
        if (!inMap(i, j) || cover[idx(i, j)] !== 1 || owner[idx(i, j)] !== gi || reserved[idx(i, j)]) continue;
        if (geo.hw >= 3 && ((g0 % 6) + 6) % 6 === 3) {
          obstacles[idx(i, j)] = GID.tree;
          if (j > 0) above[idx(i, j - 1)] = GID.canopy;
        } else if (geo.hw < 3 && ((g0 % 3) + 3) % 3 === 1) {
          obstacles[idx(i, j)] = GID.planter;
        }
      }
    }
  });

  // ---- zones: one rectangle per zoned axis-aligned segment, its crossings left out (no zone there) ----
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

  let id = 1;
  const withIds = (list) =>
    list.map((o) => ({
      height: o.height ?? 0, id: id++, name: o.name, opacity: 1, ...(o.point ? { point: true } : {}),
      properties: [...o.properties].sort((a, b) => a.name.localeCompare(b.name)), rotation: 0, type: o.type, visible: true, width: o.width ?? 0, x: o.x, y: o.y,
    }));
  const objLayer = withIds(objects);
  const npcLayer = withIds(npcs);
  const signLayer = withIds(signs.map((s) => s.obj));
  const zoneLayer = withIds(zoneRects);
  const tileLayer = (lid, name, data) => ({ data, height: H, id: lid, name, opacity: 1, type: 'tilelayer', visible: true, width: W, x: 0, y: 0 });
  const objectGroup = (lid, name, objs) => ({ draworder: 'topdown', id: lid, name, objects: objs, opacity: 1, type: 'objectgroup', visible: true, x: 0, y: 0 });
  const json = {
    compressionlevel: -1, height: H, infinite: false,
    layers: [
      tileLayer(1, 'ground', ground), tileLayer(2, 'obstacles', obstacles), tileLayer(3, 'above', above),
      objectGroup(4, 'objects', objLayer), objectGroup(5, 'npcs', npcLayer), objectGroup(6, 'labels', signLayer), objectGroup(7, 'zones', zoneLayer),
    ],
    nextlayerid: 8, nextobjectid: id, orientation: 'orthogonal',
    properties: [
      prop('generatedBy', 'scripts/generate-maps.mjs from src/data/world/jackson-heights.json; regenerate, do not edit by hand'),
      // Where the player can walk (tiles): the camera never reaches the map edge while they're inside.
      prop('walkHeight', walk.height, 'int'), prop('walkWidth', walk.width, 'int'), prop('walkX', walk.x0 - box.x0, 'int'), prop('walkY', walk.y0 - box.y0, 'int'),
    ],
    renderorder: 'right-down', tiledversion: '1.12.2', tileheight: T, tilesets: TILESETS, tilewidth: T, type: 'map', version: '1.10', width: W,
  };
  return [{ id: mapDef.id, json }];
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
  const built = buildMaps(world);
  const diffs = [];
  for (const { id, json } of built) {
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
      const count = (type) => layer('objects').filter((o) => o.type === type).length;
      console.log(`[maps] ${id}.json: ${json.width}x${json.height} tiles, ${count('spawn')} spawns, ${count('warp')} warps, ${count('deliveryPoint')} delivery points, ${layer('labels').length} street signs, ${layer('zones').length} zone areas`);
    }
  }
  if (check) {
    console.log(diffs.length ? `[maps] FAIL: ${diffs.length} map(s) differ from a fresh generation: ${diffs.join(', ')}` : `[maps] OK: ${built.length} map regenerates with no diff`);
    process.exit(diffs.length ? 1 : 0);
  }
}

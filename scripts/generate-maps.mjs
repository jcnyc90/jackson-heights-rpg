// Generates the world's Tiled maps from the world dataset (DESIGN.md 2.14, 2.15).
// Usage:
//   node scripts/generate-maps.mjs           write every map in the split to src/data/maps/<id>.json
//   node scripts/generate-maps.mjs --check   regenerate next to the maps and fail (exit 1) on any byte diff
// Each map is written as raw JSON, then normalized with Tiled's own writer
// (`tiled --export-map json`, run in src/data/maps so relative tileset paths stay put), so the
// committed files are exactly what the Tiled GUI saves. Set TILED to use another Tiled binary.
// No dependencies. buildMaps() is exported for tests/world/generate-maps.test.mjs.

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { halfWidthOf, mapBox, tileOf } from './world-layout.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORLD_FILE = join(ROOT, 'src/data/world/jackson-heights.json');
const MAPS_DIR = join(ROOT, 'src/data/maps');
const T = 16;

// Tile gids (tileset "tiles" starts at 1; "overhead" at 9). See src/systems/placeholderArt.ts.
const GID = { grass: 1, sidewalk: 2, road: 3, marking: 4, wall: 5, tree: 6, planter: 7, canopy: 9 };
const TILESETS = [
  {
    columns: 4, firstgid: 1, image: '../../../public/assets/tilesets/tiles.png', imageheight: 32, imagewidth: 64, margin: 0, name: 'tiles', spacing: 0, tilecount: 8, tileheight: 16,
    tiles: [4, 5, 6, 7].map((id) => ({ id, properties: [{ name: 'collides', type: 'bool', value: true }] })),
    tilewidth: 16,
  },
  { columns: 1, firstgid: 9, image: '../../../public/assets/tilesets/overhead.png', imageheight: 16, imagewidth: 16, margin: 0, name: 'overhead', spacing: 0, tilecount: 1, tileheight: 16, tilewidth: 16 },
];
// Where a new game starts (Claude's choice): mid-block on Roosevelt Ave 74th-75th St, near the Dispatcher.
const START = { map: 'roosevelt-ave', segment: 'seg-roosevelt-74-75', t: 0.5, facing: 'up' };
// Zones drawn as residential blocks (garden courts behind a frontage wall); the rest are solid buildings.
const GARDEN_ZONES = new Set(['historic-district']);
// Stub directions as unit steps; "facing" is the player's facing when arriving through the stub (toward the node).
const DIRS = {
  E: { dx: 1, dy: 0, facing: 'left' },
  W: { dx: -1, dy: 0, facing: 'right' },
  S: { dx: 0, dy: 1, facing: 'up' },
  N: { dx: 0, dy: -1, facing: 'down' },
};
const OPPOSITE = { E: 'W', W: 'E', N: 'S', S: 'N' };
const SIDE_STEP = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const AWAY = { north: 'down', south: 'up', east: 'left', west: 'right' };

/**
 * Builds every map of the dataset's split. Returns [{ id, json }] in dataset order, where json
 * is a Tiled JSON map (not yet normalized by Tiled). Throws on anything it can't lay out.
 */
export function buildMaps(world) {
  const L = world.layout;
  const segments = new Map(world.segments.map((s) => [s.id, s]));
  const nodes = new Map(world.nodes.map((n) => [n.id, n]));
  const streets = new Map(world.streets.map((s) => [s.id, s]));
  const zoneOfMap = new Map(world.maps.map((m) => [m.id, m.zone]));
  const at = (nid) => tileOf(L, nodes.get(nid).grid);

  // Per map: its tile box and, per node, the segments that touch it.
  const info = new Map();
  for (const m of world.maps) {
    const box = mapBox(L, m, segments, nodes);
    const byNode = new Map();
    for (const sid of m.segments) {
      const s = segments.get(sid);
      for (const nid of [s.from, s.to]) byNode.set(nid, [...(byNode.get(nid) ?? []), s]);
    }
    info.set(m.id, { map: m, box, byNode, links: [] });
  }
  const mapsTouching = (zone, nid) => world.maps.filter((m) => m.zone === zone && info.get(m.id).byNode.has(nid)).map((m) => m.id);

  // Links: a map connection joins its two maps at each listed node; an open zone connection joins
  // the first map of each zone (dataset order) that touches its node. Walls get nothing. Map
  // connections go first: a seam can only continue its own street, a zone link has more options.
  const links = [];
  for (const mc of world.mapConnections ?? []) for (const nid of mc.at) links.push({ node: nid, maps: mc.maps, source: mc.id });
  for (const c of world.connections) {
    if (c.kind !== 'open') continue;
    const [a, b] = c.zones.map((z) => mapsTouching(z, c.at)[0]);
    if (!a || !b) throw new Error(`connection "${c.id}": no map of each zone touches "${c.at}"`);
    links.push({ node: c.at, maps: [a, b], source: c.id });
  }

  const spawnIdFor = (fromMap, nid) => `from-${fromMap}-${nid}`;
  const dirOf = (nid, s) => {
    const [x0, y0] = at(nid);
    const [x1, y1] = at(s.from === nid ? s.to : s.from);
    const dx = x1 - x0;
    const dy = y1 - y0;
    return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : dy > 0 ? 'S' : 'N';
  };

  // Paint the corridors of every map first: stubs are placed against the painted grid.
  const grids = new Map();
  for (const [mid, mi] of info) grids.set(mid, paintCorridors(mi));

  for (const link of links) {
    for (let side = 0; side < 2; side++) {
      const mid = link.maps[side];
      const other = link.maps[1 - side];
      const mi = info.get(mid);
      const g = grids.get(mid);
      const own = mi.byNode.get(link.node) ?? [];
      const ownDirs = own.map((s) => dirOf(link.node, s));
      const linkedDirs = (info.get(other).byNode.get(link.node) ?? []).map((s) => dirOf(link.node, s));
      const contDirs = ownDirs.map((d) => OPPOSITE[d]);
      const used = new Set(mi.links.filter((l) => l.node === link.node).map((l) => l.dir));
      // Prefer the way the other map's street goes that also continues one of ours, then a
      // straight continuation of ours, then any way the other map's street goes.
      const order = [...linkedDirs.filter((d) => contDirs.includes(d)), ...contDirs, ...linkedDirs];
      const candidates = [...new Set(order)].filter((d) => !ownDirs.includes(d) && !used.has(d));
      const stub = candidates.map((d) => planStub(g, link.node, d)).find(Boolean);
      if (!stub) throw new Error(`map "${mid}": no room for a link stub to "${other}" at "${link.node}" (tried ${candidates.join(', ') || 'nothing'})`);
      paintStub(g, stub, own.every((s) => s.use === 'plaza') ? 'plaza' : 'road');
      mi.links.push({ node: link.node, dir: stub.dir, other, stub, spawnId: spawnIdFor(other, link.node), targetSpawn: spawnIdFor(mid, link.node) });
    }
  }

  return world.maps.map((m) => ({ id: m.id, json: finishMap(info.get(m.id), grids.get(m.id)) }));

  // ---- helpers (closures over the dataset) ----

  function paintCorridors(mi) {
    const { box, map } = mi;
    const w = box.width;
    const h = box.height;
    const g = {
      w, h, box,
      walk: new Uint8Array(w * h),
      cls: new Uint8Array(w * h), // 0 block, 1 sidewalk, 2 road past a segment's end, 3 plaza, 4 road (highest wins)
      cover: new Uint8Array(w * h), // how many segments cover the cell
      el: new Uint8Array(w * h), // under the elevated line
      reserved: new Uint8Array(w * h),
      stubCell: new Uint8Array(w * h),
      nodePts: [...mi.byNode.keys()].map((nid) => {
        const [x, y] = at(nid);
        return { x: x - box.x0, y: y - box.y0, hw: Math.max(...mi.byNode.get(nid).map((s) => halfWidthOf(L, s.street))) };
      }),
      segGeo: [],
    };
    for (const sid of map.segments) {
      const s = segments.get(sid);
      const hw = halfWidthOf(L, s.street);
      const [ax, ay] = at(s.from).map((v, i) => v - (i ? box.y0 : box.x0));
      const [bx, by] = at(s.to).map((v, i) => v - (i ? box.y0 : box.x0));
      // A segment end reaches past its node by the widest crossing street there (so crossings
      // fill in), not at all where only its own street continues, and by its own half-width at a
      // dead end.
      const cap = (nid) => {
        const others = mi.byNode.get(nid).filter((o) => o !== s);
        if (others.length === 0) return hw;
        const crossing = others.filter((o) => !(o.street === s.street && streets.get(o.street).orientation !== 'diagonal'));
        return crossing.length ? Math.max(...crossing.map((o) => halfWidthOf(L, o.street))) : 0;
      };
      const capA = cap(s.from);
      const capB = cap(s.to);
      const ew = ay === by;
      const ns = ax === bx;
      const geo = { s, hw, ax, ay, bx, by, ew, ns, plaza: s.use === 'plaza', el: s.overhead !== undefined };
      g.segGeo.push(geo);
      const minX = Math.floor(Math.min(ax, bx) - Math.max(capA, capB, hw)) - 1;
      const maxX = Math.ceil(Math.max(ax, bx) + Math.max(capA, capB, hw)) + 1;
      const minY = Math.floor(Math.min(ay, by) - Math.max(capA, capB, hw)) - 1;
      const maxY = Math.ceil(Math.max(ay, by) + Math.max(capA, capB, hw)) + 1;
      for (let j = Math.max(0, minY); j < Math.min(h, maxY); j++) {
        for (let i = Math.max(0, minX); i < Math.min(w, maxX); i++) {
          const cx = i + 0.5;
          const cy = j + 0.5;
          let inside;
          let edge;
          let pastEnd = false;
          if (ew || ns) {
            // Along the street: from each node minus its cap; across: the half-width. Sidewalk is
            // the outermost ring, so dead ends get a sidewalk row too.
            const [p, q, c, ca, cb] = ew ? [cx, cy, ay, ax < bx ? capA : capB, ax < bx ? capB : capA] : [cy, cx, ax, ay < by ? capA : capB, ay < by ? capB : capA];
            const lo = ew ? Math.min(ax, bx) : Math.min(ay, by);
            const hi = ew ? Math.max(ax, bx) : Math.max(ay, by);
            const across = Math.abs(q - c);
            inside = p > lo - ca && p < hi + cb && across < hw;
            // Past an end (a crossing or a dead end, not a joint where the street just continues).
            const out = Math.max(0, ca > 0 ? lo - p - (ca - hw) : 0, cb > 0 ? p - hi - (cb - hw) : 0);
            edge = Math.max(out, across) > hw - 1;
            pastEnd = p < lo || p > hi;
          } else {
            // Diagonal (Broadway): a capsule around the centre line.
            const d = distToSegment(cx, cy, ax, ay, bx, by);
            inside = d < hw;
            edge = d > hw - 1;
          }
          if (!inside) continue;
          const k = j * w + i;
          // A road's end reaching into a crossing plaza gives way to it (the 34th Ave paseo stays whole).
          const cls = geo.plaza ? 3 : edge ? 1 : pastEnd ? 2 : 4;
          g.walk[k] = 1;
          g.cls[k] = Math.max(g.cls[k], cls);
          g.cover[k]++;
          if (geo.el) g.el[k] = 1;
        }
      }
    }
    // Mouths of stub streets (only their mouth is in the bounds): a short dead-end notch.
    for (const nid of mi.byNode.keys()) {
      const stubStreets = nodes.get(nid).streets.filter((sid) => streets.get(sid)?.stub);
      if (stubStreets.length === 0 || stubStreets.includes('northern')) continue;
      // Drawn on the map of the avenue they meet (from the south), not on a connector's map.
      if (!mi.byNode.get(nid).some((s) => streets.get(s.street).orientation === 'ew')) continue;
      const hw0 = Math.max(...mi.byNode.get(nid).map((s) => halfWidthOf(L, s.street)));
      const [x, y] = at(nid).map((v, i) => v - (i ? box.y0 : box.x0));
      const cells = [];
      let ok = true;
      for (let k = hw0; k < hw0 + 3; k++) for (let a = -3; a < 3; a++) {
        const i = x + a;
        const j = y + k;
        if (i < 0 || j < 0 || i >= w || j >= h || g.walk[j * w + i]) ok = false;
        if (a >= -2 && a < 2 && k < hw0 + 2) cells.push([i, j, a === -2 || a === 1 || k === hw0 + 1]);
      }
      if (!ok) continue;
      for (const [i, j, edge] of cells) {
        const k = j * w + i;
        g.walk[k] = 1;
        g.cls[k] = edge ? 1 : 4;
        g.cover[k]++;
      }
    }
    return g;
  }

  /** Stub cells from node `nid` in direction d, or null if they'd touch other corridors or leave the map. */
  function planStub(g, nid, d) {
    const { dx, dy } = DIRS[d];
    const [nx, ny] = at(nid);
    const x = nx - g.box.x0;
    const y = ny - g.box.y0;
    // Cell k steps from the node line along d, at across offset a (-2..1 = the stub's 4 cells).
    const cell = (k, a) => (dx ? [dx > 0 ? x + k : x - 1 - k, y + a] : [x + a, dy > 0 ? y + k : y - 1 - k]);
    const inMap = ([i, j]) => i >= 0 && j >= 0 && i < g.w && j < g.h;
    let reach = 0;
    while (reach < 16 && inMap(cell(reach, 0)) && g.walk[cell(reach, 0)[1] * g.w + cell(reach, 0)[0]]) reach++;
    const len = L.stubLength;
    // The stub's own cells plus a one-cell border (the walls around it) must be empty.
    for (let k = reach; k <= reach + len; k++) {
      for (let a = -3; a < 3; a++) {
        const c = cell(k, a);
        if (!inMap(c)) return null;
        const idx = c[1] * g.w + c[0];
        if (g.walk[idx] || g.stubCell[idx]) return null;
      }
    }
    const cells = [];
    for (let k = 0; k < reach + len; k++) for (let a = -2; a < 2; a++) cells.push({ c: cell(k, a), k, a });
    return { dir: d, reach, cells, spawn: cell(reach, 0), warp: [-2, 1].map((a) => cell(reach + len - 1, a)) };
  }

  function paintStub(g, stub, style) {
    for (const { c: [i, j], k, a } of stub.cells) {
      const idx = j * g.w + i;
      if (k < stub.reach) continue; // inside the crossing street: already painted
      g.walk[idx] = 1;
      g.cls[idx] = style === 'plaza' ? 3 : a === -2 || a === 1 ? 1 : 4;
      g.cover[idx]++;
      g.stubCell[idx] = 1;
      g.reserved[idx] = 1;
    }
  }

  function finishMap(mi, g) {
    const { map, box } = mi;
    const { w, h } = g;
    const idx = (i, j) => j * w + i;
    const objects = [];
    const npcs = [];
    let nextId = 1;
    const prop = (name, value, type = 'string') => ({ name, type, value });
    const feet = ([i, j]) => [i * T + 8, j * T + 12];

    // Spawns and warps of the link stubs.
    for (const l of mi.links) {
      const [fx, fy] = feet(l.stub.spawn);
      g.reserved[idx(...l.stub.spawn)] = 1;
      objects.push({ name: l.spawnId, type: 'spawn', point: true, x: fx, y: fy, properties: [prop('facing', DIRS[l.dir].facing), prop('spawnId', l.spawnId)] });
      const [[i0, j0], [i1, j1]] = l.stub.warp;
      objects.push({
        name: `to-${l.other}-${l.node}`, type: 'warp', x: Math.min(i0, i1) * T, y: Math.min(j0, j1) * T, width: (Math.abs(i1 - i0) + 1) * T, height: (Math.abs(j1 - j0) + 1) * T,
        properties: [prop('targetMap', l.other), prop('targetSpawn', l.targetSpawn)],
      });
    }

    // A point on a segment's centre line at t (0-1), in local tile coordinates.
    const geoOf = (sid) => g.segGeo.find((x) => x.s.id === sid);
    const pointOn = (geo, t) => [geo.ax + (geo.bx - geo.ax) * t, geo.ay + (geo.by - geo.ay) * t];

    if (START.map === map.id) {
      const geo = geoOf(START.segment);
      const [px, py] = pointOn(geo, START.t);
      const c = [Math.floor(px), Math.floor(py)];
      if (!g.walk[idx(...c)]) throw new Error(`start spawn: tile ${c} is not walkable`);
      g.reserved[idx(...c)] = 1;
      const [fx, fy] = feet(c);
      objects.unshift({ name: 'start', type: 'spawn', point: true, x: fx, y: fy, properties: [prop('facing', START.facing), prop('spawnId', 'start')] });
    }

    // Anchors: walk from the centre line toward the anchor's side until the first building tile.
    // That tile gets the delivery point; the tile before it is where the player stands to face it.
    // If a link stub or spawn is in the way at t, the anchor slides along its segment to the
    // nearest free tile (same side), one tile at a time.
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
        if (i < 0 || j < 0 || i >= w || j >= h || !g.walk[idx(i, j)]) continue;
        while (g.walk[idx(i + sx, j + sy)]) {
          i += sx;
          j += sy;
        }
        const wallCell = [i + sx, j + sy];
        if (!g.reserved[idx(i, j)] && !g.stubCell[idx(...wallCell)] && !g.reserved[idx(...wallCell)]) return [[i, j], wallCell];
      }
      throw new Error(`anchor "${a.id}": no free building tile on its side of "${a.segment}"`);
    };
    for (const a of world.anchors) {
      if (!map.segments.includes(a.segment)) continue;
      const [sx, sy] = SIDE_STEP[a.side];
      const [stand, wallCell] = placeAnchor(a, geoOf(a.segment), [sx, sy]);
      const [i, j] = stand;
      g.reserved[idx(...stand)] = 1;
      g.reserved[idx(...wallCell)] = 1;
      if (a.uses.includes('dispatcher')) {
        // The Dispatcher stands on the sidewalk in front of the building, facing the street;
        // the player talks to them from the next tile out.
        const front = [i - sx, j - sy];
        if (!g.walk[idx(...front)]) throw new Error(`anchor "${a.id}": no walkable tile in front of the Dispatcher`);
        g.reserved[idx(...front)] = 1;
        const [fx, fy] = feet(stand);
        npcs.push({
          name: 'dispatcher', type: 'npc', point: true, x: fx, y: fy,
          properties: [prop('dialogueId', 'dispatcher.hello'), prop('facing', AWAY[a.side]), prop('look', 0, 'int'), prop('npcId', 'dispatcher'), prop('role', 'dispatcher')],
        });
      } else {
        objects.push({ name: `point-${a.id}`, type: 'deliveryPoint', x: wallCell[0] * T, y: wallCell[1] * T, width: T, height: T, properties: [prop('pointId', a.id)] });
      }
    }

    // Tile layers.
    const ground = new Array(w * h).fill(GID.sidewalk);
    const obstacles = new Array(w * h).fill(0);
    const above = new Array(w * h).fill(0);
    const garden = GARDEN_ZONES.has(zoneOfMap.get(map.id));
    const free = (i, j) => g.cover[idx(i, j)] === 1 && !g.reserved[idx(i, j)] && !g.stubCell[idx(i, j)];
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = idx(i, j);
        if (g.walk[k]) {
          ground[k] = g.cls[k] === 2 || g.cls[k] === 4 ? GID.road : GID.sidewalk;
          continue;
        }
        let frontage = false;
        for (let b = -1; b <= 1 && !frontage; b++) for (let a = -1; a <= 1; a++) {
          const ii = i + a;
          const jj = j + b;
          if (ii >= 0 && jj >= 0 && ii < w && jj < h && g.walk[idx(ii, jj)]) frontage = true;
        }
        if (!garden || frontage || i === 0 || j === 0 || i === w - 1 || j === h - 1) {
          obstacles[k] = GID.wall;
        } else {
          ground[k] = GID.grass;
          const gx = i + box.x0;
          const gy = j + box.y0;
          if (((gx % 4) + 4) % 4 === 2 && ((gy % 4) + 4) % 4 === 1) {
            obstacles[k] = GID.tree;
            if (j > 0) above[idx(i, j - 1)] = GID.canopy;
          }
        }
      }
    }
    // Street dressing on cells covered by exactly one segment (so never in a crossing), off stubs,
    // spawns and anchors.
    for (const geo of g.segGeo) {
      if (!geo.ew && !geo.ns) continue;
      const lo = geo.ew ? Math.min(geo.ax, geo.bx) : Math.min(geo.ay, geo.by);
      const hi = geo.ew ? Math.max(geo.ax, geo.bx) : Math.max(geo.ay, geo.by);
      const c = geo.ew ? geo.ay : geo.ax;
      const origin = geo.ew ? box.x0 : box.y0;
      for (let p = lo; p < hi; p++) {
        const g0 = p + origin; // global coordinate along the street, so patterns line up across maps
        const cellAt = (off) => (geo.ew ? [p, c + off] : [c + off, p]);
        const put = (off, fn) => {
          const [i, j] = cellAt(off);
          if (i < 0 || j < 0 || i >= w || j >= h) return;
          if (!free(i, j)) return;
          fn(i, j, idx(i, j));
        };
        if (geo.el && geo.ew) {
          // Pillars of the elevated 7, two rows inside the roadway.
          if (((g0 % 4) + 4) % 4 === 0) for (const off of [-2, 1]) put(off, (i, j, k) => (obstacles[k] = GID.wall));
        } else if (!geo.plaza && geo.ew && geo.hw >= 3) {
          if (((g0 % 2) + 2) % 2 === 0) put(0, (i, j, k) => (ground[k] = GID.marking));
        }
        if (geo.plaza) {
          for (const off of [-geo.hw, geo.hw - 1]) {
            if (geo.hw >= 3 && ((g0 % 6) + 6) % 6 === 3) {
              put(off, (i, j, k) => {
                obstacles[k] = GID.tree;
                if (j > 0) above[idx(i, j - 1)] = GID.canopy;
              });
            } else if (geo.hw < 3 && ((g0 % 3) + 3) % 3 === 1) {
              put(off, (i, j, k) => (obstacles[k] = GID.planter));
            }
          }
        }
      }
    }

    let id = 1;
    const withIds = (list) =>
      list.map((o) => ({
        height: o.height ?? 0, id: id++, name: o.name, opacity: 1, ...(o.point ? { point: true } : {}),
        properties: [...o.properties].sort((a, b) => a.name.localeCompare(b.name)), rotation: 0, type: o.type, visible: true, width: o.width ?? 0, x: o.x, y: o.y,
      }));
    const objLayer = withIds(objects);
    const npcLayer = withIds(npcs);
    const tileLayer = (lid, name, data) => ({ data, height: h, id: lid, name, opacity: 1, type: 'tilelayer', visible: true, width: w, x: 0, y: 0 });
    const objectGroup = (lid, name, objs) => ({ draworder: 'topdown', id: lid, name, objects: objs, opacity: 1, type: 'objectgroup', visible: true, x: 0, y: 0 });
    return {
      compressionlevel: -1, height: h, infinite: false,
      layers: [tileLayer(1, 'ground', ground), tileLayer(2, 'obstacles', obstacles), tileLayer(3, 'above', above), objectGroup(4, 'objects', objLayer), objectGroup(5, 'npcs', npcLayer)],
      nextlayerid: 6, nextobjectid: id, orientation: 'orthogonal',
      properties: [prop('generatedBy', 'scripts/generate-maps.mjs from src/data/world/jackson-heights.json; regenerate, do not edit by hand')],
      renderorder: 'right-down', tiledversion: '1.12.2', tileheight: T, tilesets: TILESETS, tilewidth: T, type: 'map', version: '1.10', width: w,
    };
  }
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
      const objs = json.layers.find((l) => l.name === 'objects').objects;
      const count = (type) => objs.filter((o) => o.type === type).length;
      console.log(`[maps] ${id}.json: ${json.width}x${json.height} tiles, ${count('spawn')} spawns, ${count('warp')} warps, ${count('deliveryPoint')} delivery points`);
    }
  }
  if (check) {
    console.log(diffs.length ? `[maps] FAIL: ${diffs.length} map(s) differ from a fresh generation: ${diffs.join(', ')}` : `[maps] OK: ${built.length} maps regenerate with no diff`);
    process.exit(diffs.length ? 1 : 0);
  }
}

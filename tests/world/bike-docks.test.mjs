// Session 6f: the bike-share docks on the generated map. Run: npm run test:world (node --test, no dependencies).
// Builds the map with docks on (buildMaps({ docks: true })) whatever src/data/features.json says, so these
// checks hold before the flag is switched on; the last test checks the flag itself against the committed map.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMaps, decodeLayer, DOCK_LEN, DOCK_SLOTS, FEATURES } from '../../scripts/generate-maps.mjs';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const world = read('../../src/data/world/jackson-heights.json');
const TILES = read('../../src/data/tiles.json');
const [{ json, layers, stats }] = buildMaps(world, { docks: true });
const [{ json: noDocks, layers: noDockLayers }] = buildMaps(world, { docks: false });
const layer = (name, j = json) => j.layers.find((l) => l.name === name);
const prop = (o, name) => o.properties.find((p) => p.name === name)?.value;
const W = json.width, H = json.height;
const k = (i, j) => j * W + i;
const nameAt = (data, i, j) => TILES.tiles[data[k(i, j)] - 1] ?? null;
const propAt = (i, j) => nameAt(layers.props, i, j);
const solid = (i, j) => layers.collision[k(i, j)] !== 0;
const P = Object.fromEntries(json.properties.map((x) => [x.name, x.value]));
const WALK = { x0: P.walkX, y0: P.walkY, x1: P.walkX + P.walkWidth, y1: P.walkY + P.walkHeight };
const inWalk = (i, j) => i >= WALK.x0 && j >= WALK.y0 && i < WALK.x1 && j < WALK.y1;
const free = (i, j) => inWalk(i, j) && !solid(i, j);
const docks = layer('docks').objects.map((o) => ({ id: prop(o, 'dockId'), open: prop(o, 'open'), slots: prop(o, 'slots'), x: o.x / 16, y: o.y / 16, w: o.width / 16, h: o.height / 16 }));
const cells = (d) => { const out = []; for (let j = d.y; j < d.y + d.h; j++) for (let i = d.x; i < d.x + d.w; i++) out.push([i, j]); return out; };
const OPEN = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };
const flood = (isFree) => {
  const start = layer('objects').objects.find((o) => o.type === 'spawn');
  const s = [Math.floor(start.x / 16), Math.floor((start.y - 1) / 16)];
  const reach = new Uint8Array(W * H);
  const q = [s];
  reach[k(...s)] = 1;
  while (q.length) {
    const [i, j] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + dx, nj = j + dy;
      if (isFree(ni, nj) && !reach[k(ni, nj)]) { reach[k(ni, nj)] = 1; q.push([ni, nj]); }
    }
  }
  return reach;
};
const reach = flood(free);

test('every dock of the dataset is on the map: one "docks" rectangle each, a kiosk plus slots in a row, every tile a solid p-dock marker', () => {
  assert.equal(stats.docks, world.bikeDocks.docks.length);
  assert.equal(docks.length, world.bikeDocks.docks.length);
  assert.equal(DOCK_SLOTS, world.bikeDocks.slots);
  const marked = new Set();
  docks.forEach((d, n) => {
    assert.equal(d.id, `dock-${n + 1}`);
    assert.equal(d.slots, DOCK_SLOTS);
    assert.ok((d.w === DOCK_LEN && d.h === 1) || (d.w === 1 && d.h === DOCK_LEN), `${d.id}: ${d.w}x${d.h}`);
    for (const [i, j] of cells(d)) {
      assert.equal(propAt(i, j), 'p-dock', `${d.id} at ${i},${j}`);
      assert.ok(solid(i, j), `${d.id} blocks like a prop at ${i},${j}`);
      marked.add(k(i, j));
    }
  });
  let markers = 0;
  for (let n = 0; n < W * H; n++) if (TILES.tiles[layers.props[n] - 1] === 'p-dock') { markers++; assert.ok(marked.has(n), `stray p-dock marker at ${n % W},${Math.floor(n / W)}`); }
  assert.equal(markers, docks.length * DOCK_LEN);
});

test('docks stand on a curb, along the paseo\'s bike lane or on a plaza edge, with the open side toward the sidewalk', () => {
  for (const d of docks) {
    const [ox, oy] = OPEN[d.open];
    assert.ok(d.w > 1 ? oy !== 0 : ox !== 0, `${d.id}: open side runs along the dock`);
    for (const [i, j] of cells(d)) {
      const g = nameAt(layers.ground, i, j);
      assert.ok(/^curb-[nsew]$/.test(g) || g === 'paseo-grass' || g === 'plaza', `${d.id}: on ${g} at ${i},${j}`);
      if (g.startsWith('curb-')) assert.deepEqual(OPEN[{ 'curb-s': 'n', 'curb-n': 's', 'curb-w': 'e', 'curb-e': 'w' }[g]], [ox, oy], `${d.id}: opens away from the road`);
    }
  }
});

test('every dock is reachable: each tile can be faced from a free tile on its open side that the start reaches', () => {
  for (const d of docks) {
    const [ox, oy] = OPEN[d.open];
    for (const [i, j] of cells(d)) assert.ok(free(i + ox, j + oy) && reach[k(i + ox, j + oy)], `${d.id}: tile ${i},${j} usable from ${i + ox},${j + oy}`);
  }
});

test('docks block no crossing, crosswalk, door, signal, sign post or stairs; doors, the Dispatcher and the streets stay reachable', () => {
  const corners = layer('corners').objects.map((c) => ({ x0: c.x / 16 - 1, y0: c.y / 16 - 1, x1: (c.x + c.width) / 16 + 1, y1: (c.y + c.height) / 16 + 1 }));
  const doors = layer('objects').objects.filter((o) => o.type === 'deliveryPoint').map((p) => [p.x / 16, p.y / 16]);
  for (const d of docks) {
    for (const [i, j] of cells(d)) {
      assert.ok(!corners.some((c) => i >= c.x0 && i < c.x1 && j >= c.y0 && j < c.y1), `${d.id}: in or next to a crossing at ${i},${j}`);
      assert.ok(!/^crosswalk/.test(nameAt(layers.ground, i, j)));
      for (const [di, dj] of doors) assert.ok(Math.max(Math.abs(di - i), Math.abs(dj - j)) > 2, `${d.id}: within 2 tiles of a delivery door at ${di},${dj}`);
    }
    for (let j = d.y - 1; j <= d.y + d.h; j++) for (let i = d.x - 1; i <= d.x + d.w; i++) {
      assert.ok(!['p-signal', 'p-stairs', 'p-barricade', 'p-pillar'].includes(propAt(i, j)), `${d.id}: next to ${propAt(i, j)} at ${i},${j}`);
    }
  }
  const signs = layer('labels').objects.map((s) => [Math.floor(s.x / 16), s.y / 16 - 1]);
  for (const d of docks) for (const [si, sj] of signs) assert.ok(!(si >= d.x - 1 && si <= d.x + d.w && sj >= d.y - 1 && sj <= d.y + d.h), `${d.id}: next to a sign post at ${si},${sj}`);
  // Doors and the Dispatcher: reachable with the docks in place, exactly as without them.
  for (const [i, j] of doors) assert.ok([[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => free(i + dx, j + dy) && reach[k(i + dx, j + dy)]), `door ${i},${j}`);
  const disp = layer('npcs').objects.find((o) => prop(o, 'role') === 'dispatcher');
  const [di, dj] = [Math.floor(disp.x / 16), Math.floor((disp.y - 1) / 16)];
  assert.ok([[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => reach[k(di + dx, dj + dy)]));
  // The docks cut nothing off: every tile free in both maps (trees shift around the docks) and reached without
  // docks is reached with them.
  const freeNo = (i, j) => inWalk(i, j) && noDockLayers.collision[k(i, j)] === 0;
  const reachNo = flood(freeNo);
  let lost = 0;
  for (let n = 0; n < W * H; n++) if (reachNo[n] && !reach[n] && layers.collision[n] === 0) lost++;
  assert.equal(lost, 0, `${lost} tiles cut off by docks`);
});

test('the feature flag: with docks off the map has no docks layer and no dock tiles; the committed map follows src/data/features.json', () => {
  assert.equal(noDocks.layers.some((l) => l.name === 'docks'), false);
  assert.ok(!noDockLayers.props.some((g) => TILES.tiles[g - 1] === 'p-dock'));
  const committed = read('../../public/assets/maps/jackson-heights.json');
  assert.equal(committed.layers.some((l) => l.name === 'docks'), FEATURES.bikeDocks);
  assert.equal(decodeLayer(committed.layers.find((l) => l.name === 'props').data).some((g) => TILES.tiles[g - 1] === 'p-dock'), FEATURES.bikeDocks);
});

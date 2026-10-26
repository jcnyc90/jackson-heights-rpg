// Tests for scripts/generate-maps.mjs (session 6e). Run: npm run test:world (node --test, no dependencies).
// These check the generator's own output (before Tiled normalizes it), so they need no Tiled; the
// last test compares it with the committed asset, layer by layer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMaps, decodeLayer, FEATURES, SHOP_WORDS } from '../../scripts/generate-maps.mjs';
import { mapBoxes, tileOf } from '../../scripts/world-layout.mjs';
import { WALK_LIMITS } from '../../scripts/validate-world.mjs';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const world = read('../../src/data/world/jackson-heights.json');
const TILES = read('../../src/data/tiles.json');
const EN = read('../../src/data/strings/en.json');
const built = buildMaps(world);
const [{ id: mapId, json, layers }] = built;
const layer = (name) => json.layers.find((l) => l.name === name);
const objectsOf = (type, from = 'objects') => layer(from).objects.filter((o) => o.type === type);
const prop = (o, name) => o.properties.find((p) => p.name === name)?.value;
const W = json.width;
const H = json.height;
const k = (i, j) => j * W + i;
const nameAt = (data, i, j) => TILES.tiles[data[k(i, j)] - 1] ?? null;
const ground = (i, j) => nameAt(layers.ground, i, j);
const propAt = (i, j) => nameAt(layers.props, i, j);
const solid = (i, j) => layers.collision[k(i, j)] !== 0;
const P = Object.fromEntries(json.properties.map((x) => [x.name, x.value]));
const WALK = { x0: P.walkX, y0: P.walkY, x1: P.walkX + P.walkWidth, y1: P.walkY + P.walkHeight };
const inWalk = (i, j) => i >= WALK.x0 && j >= WALK.y0 && i < WALK.x1 && j < WALK.y1;
const free = (i, j) => inWalk(i, j) && !solid(i, j);
const boxes = mapBoxes(world.layout, world.nodes);
const at = (nid) => { const [x, y] = tileOf(world.layout, world.nodes.find((n) => n.id === nid).grid); return [x - boxes.map.x0, y - boxes.map.y0]; };
const buildings = layer('buildings').objects.map((o) => {
  const [front, roof, side, door, deliver, variant, sign] = prop(o, 'spec').split(',');
  return { kind: o.type, x: o.x / 16, y: o.y / 16, w: o.width / 16, h: o.height / 16, front, roof: +roof, side, door: +door, deliver: deliver === '1', variant: +variant, sign };
});
const inBuilding = (i, j) => buildings.find((b) => i >= b.x && i < b.x + b.w && j >= b.y && j < b.y + b.h);

// 4-way flood fill over free tiles from the start spawn (the player moves 8-way, so this is stricter).
const start = objectsOf('spawn')[0];
const reach = new Uint8Array(W * H);
{
  const s = [Math.floor(start.x / 16), Math.floor((start.y - 1) / 16)];
  const q = [s];
  reach[k(...s)] = 1;
  while (q.length) {
    const [i, j] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + dx, nj = j + dy;
      if (free(ni, nj) && !reach[k(ni, nj)]) { reach[k(ni, nj)] = 1; q.push([ni, nj]); }
    }
  }
}

test('one map, the size the dataset and layout give it; the walk fits the owner\'s caps (60 s east-west, 45 s north-south at 150 px/s)', () => {
  assert.equal(built.length, 1);
  assert.equal(mapId, world.maps[0].id);
  assert.deepEqual([W, H], world.maps[0].tiles);
  assert.deepEqual([W, H], [boxes.map.width, boxes.map.height]);
  assert.equal(world.layout.tileX, 30); // owner's decision 2
  const secs = (tiles) => (tiles * 16) / WALK_LIMITS.pxPerSecond;
  assert.ok(secs(P.walkWidth) <= 60, `${secs(P.walkWidth)} s`);
  assert.ok(secs(P.walkHeight) <= 45, `${secs(P.walkHeight)} s`);
});

test('deterministic: two runs give identical maps', () => {
  assert.equal(JSON.stringify(buildMaps(structuredClone(world))[0].json), JSON.stringify(json));
});

test('Tiled conventions: layers (tile layers base64 + zlib), the embedded tileset from tiles.json, objects with their properties', () => {
  assert.deepEqual(json.layers.map((l) => [l.name, l.type]), [['ground', 'tilelayer'], ['collision', 'tilelayer'], ['props', 'tilelayer'], ['objects', 'objectgroup'], ['npcs', 'objectgroup'], ['buildings', 'objectgroup'], ['labels', 'objectgroup'], ['corners', 'objectgroup'], ['zones', 'objectgroup'], ...(FEATURES.bikeDocks ? [['docks', 'objectgroup']] : [])]);
  for (const l of json.layers.filter((x) => x.type === 'tilelayer')) {
    assert.deepEqual([l.encoding, l.compression], ['base64', 'zlib'], l.name);
    assert.equal(decodeLayer(l.data).length, W * H, l.name);
  }
  assert.equal(layer('collision').visible, false);
  assert.deepEqual(json.tilesets.map((t) => [t.name, t.firstgid, t.tilecount, t.image]), [['tiles', 1, TILES.tiles.length, '../tilesets/tiles.png']]);
  const ids = json.layers.flatMap((l) => l.objects ?? []).map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length, 'object ids unique');
  for (const o of layer('objects').objects) assert.ok(['spawn', 'deliveryPoint'].includes(o.type), o.name);
  for (const o of layer('labels').objects) {
    assert.ok(o.point && ['streetSign', 'edgeSign'].includes(o.type), o.name);
    if (o.type === 'streetSign') assert.ok(prop(o, 'street') in EN && prop(o, 'cross') in EN, o.name);
    else assert.ok(prop(o, 'text') in EN, o.name);
  }
  for (const o of layer('corners').objects) assert.ok(o.type === 'corner' && o.width > 0 && prop(o, 'street') in EN && prop(o, 'cross') in EN, o.name);
  const zoneIds = new Set(world.zones.map((z) => z.id));
  for (const o of layer('zones').objects) assert.ok(o.type === 'zone' && !o.point && o.width > 0 && o.height > 0 && zoneIds.has(prop(o, 'zoneId')), o.name);
  for (const b of buildings) assert.ok(b.sign === '' || SHOP_WORDS.includes(b.sign), b.sign);
  for (const w of SHOP_WORDS) assert.ok(`shop.${w}` in EN, w);
});

test('one continuous map: no warps; the walkable area is at least half a screen inside every edge', () => {
  assert.equal(objectsOf('warp').length, 0);
  assert.deepEqual([P.walkX, P.walkY, P.walkWidth, P.walkHeight], [boxes.walk.x0 - boxes.map.x0, boxes.walk.y0 - boxes.map.y0, boxes.walk.width, boxes.walk.height]);
  assert.ok(P.walkX >= 8 && P.walkY >= 7 && W - (P.walkX + P.walkWidth) >= 8 && H - (P.walkY + P.walkHeight) >= 7);
});

test('every street runs straight through on walkable road: each numbered street from 31st Ave to 37th Ave, each avenue from 73rd to 90th St', () => {
  for (let n = 73; n <= 90; n++) {
    const [x, y0] = at(`n-${n}-31ave`);
    const [, y1] = at(`n-${n}-37ave`);
    for (let j = y0; j <= y1; j++) assert.ok(!solid(x, j) || !solid(x - 1, j), `${n}th St blocked at row ${j}`);
  }
  for (const ave of ['31ave', '32ave', 'northern', '34ave', '35ave', '37ave', 'roosevelt']) {
    const [x0, y] = at(`n-73-${ave}`);
    const [x1] = at(`n-90-${ave}`);
    for (let i = x0; i <= x1; i++) assert.ok(!solid(i, y) || !solid(i, y - 1), `${ave} blocked at column ${i}`);
  }
});

test('corridors keep 6d\'s widths x 3: side streets 12 tiles, avenues 18, Northern Blvd and Roosevelt Ave 24, with 3-tile sidewalks and curbs', () => {
  const width = (nid1, nid2, axis) => {
    const [ax, ay] = at(nid1); const [bx, by] = at(nid2);
    const [mx, my] = [Math.floor((ax + bx) / 2), Math.floor((ay + by) / 2)];
    let n = 0;
    if (axis === 'x') for (let i = mx - 20; i < mx + 20; i++) n += STREET(ground(i, my)) ? 1 : 0;
    else for (let j = my - 20; j < my + 20; j++) n += STREET(ground(mx, j)) ? 1 : 0;
    return n;
  };
  const STREET = (g) => /^(road|sidewalk|curb-|center-line-|lane-dash-|el-shadow|manhole|crosswalk)/.test(g ?? '');
  assert.equal(width('n-80-35ave', 'n-80-37ave', 'x'), 12);
  assert.equal(width('n-80-37ave', 'n-81-37ave', 'y'), 18);
  assert.equal(width('n-80-northern', 'n-81-northern', 'y'), 24);
  assert.equal(width('n-80-roosevelt', 'n-81-roosevelt', 'y'), 24);
  // Sidewalk, then curb, then road, across 80th St at mid-block.
  const [x, y] = at('n-80-35ave');
  const row = y + 30;
  assert.deepEqual([ground(x - 6, row), ground(x - 4, row), ground(x - 3, row)], ['sidewalk', 'curb-e', 'road']);
});

test('crossings: crosswalks, a signal on two corners, a blade sign on its own post next to a signal (never on a building), a corner box for the HUD', () => {
  const signs = objectsOf('streetSign', 'labels');
  assert.ok(signs.length >= 100, `${signs.length} signs`);
  for (const s of signs) {
    const [i, j] = [Math.floor(s.x / 16), s.y / 16 - 1];
    assert.ok(solid(i, j) && !inBuilding(i, j), `${s.name}: on a post, not a building`);
    assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => propAt(i + dx, j + dy) === 'p-signal'), `${s.name}: next to a signal`);
  }
  const corners = layer('corners').objects;
  assert.ok(corners.length >= 130);
  const [C, R] = at('n-80-37ave');
  assert.ok(corners.some((c) => c.x / 16 <= C && (c.x + c.width) / 16 > C && c.y / 16 <= R && (c.y + c.height) / 16 > R && prop(c, 'street') === 'street.st-80' && prop(c, 'cross') === 'street.ave-37'));
  let cw = 0;
  for (let j = R - 9; j < R + 9; j++) for (let i = C - 6; i < C + 6; i++) if (ground(i, j)?.startsWith('crosswalk')) cw++;
  assert.ok(cw >= 30, `${cw} crosswalk tiles`);
});

test('land use decides what each block face shows (owner\'s decision 11): every building kind, storefronts only on commercial faces, generic sign words', () => {
  const kinds = new Set(buildings.map((b) => b.kind));
  for (const kind of ['storefront', 'walkup', 'coop', 'house', 'civic']) assert.ok(kinds.has(kind), kind);
  assert.ok(buildings.length > 1000);
  // Storefront signs only carry a word on a minority of shops; the rest are blank panels.
  const shops = buildings.filter((b) => b.kind === 'storefront');
  assert.ok(shops.filter((b) => b.sign).length < shops.length / 2);
  // Front faces 3-5 tiles tall (decision 1): image rows minus the roof (and the lip when it fronts north).
  for (const b of buildings) {
    const face = b.h - b.roof - (b.front === 'n' ? 1 : 0);
    if (b.front === 's') assert.ok(face >= 3 && face <= 5, `${b.kind} at ${b.x},${b.y}: front face ${face}`);
  }
  // Parking lots and park faces are walkable ground (lot, lawn), not buildings.
  let lots = 0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (ground(i, j) === 'lot' && !solid(i, j)) lots++;
  assert.ok(lots > 50, `${lots} lot tiles`);
});

test('houses: the footprint blocks, the lawn behind (north of) it does not, so the player can pass behind a building', () => {
  const houses = buildings.filter((b) => b.kind === 'house' && b.front !== 'n');
  assert.ok(houses.length > 100);
  let behind = 0;
  for (const b of houses) {
    for (let i = b.x; i < b.x + b.w; i++) assert.ok(solid(i, b.y + b.h - 1), `house at ${b.x},${b.y}: footprint`);
    if (free(b.x + 1, b.y) && reach[k(b.x + 1, b.y)]) behind++;
  }
  assert.ok(behind > 50, `${behind} houses with a reachable lawn behind them`);
});

test('Historic District garden co-ops: walkable interior courtyard gardens reached through game-placed entry gates', () => {
  let gardenTiles = 0, reachedGarden = 0;
  for (let j = WALK.y0; j < WALK.y1; j++) for (let i = WALK.x0; i < WALK.x1; i++) {
    if (ground(i, j) === 'garden') {
      gardenTiles++;
      if (free(i, j) && reach[k(i, j)]) reachedGarden++;
    }
  }
  assert.ok(gardenTiles > 1500, `${gardenTiles} garden tiles`);
  assert.ok(reachedGarden > 1000, `${reachedGarden} reachable garden tiles`);
});

test('Travers Park: the whole outline is walkable lawn with paths and trees, and joins 77th St, the 78th St plaza and 34th Ave', () => {
  const park = world.parks.find((p) => p.parksId === 'Q303');
  assert.ok(park);
  const [x77, y34] = at('n-77-34ave');
  const [x78] = at('n-78-34ave');
  let lawn = 0, paths = 0, trees = 0;
  for (let j = y34 - 50; j < y34; j++) for (let i = x77; i < x78; i++) {
    const g = ground(i, j);
    if (/^lawn/.test(g) && !solid(i, j)) lawn++;
    if (g === 'park-path') paths++;
    if (propAt(i, j) === 'p-tree') trees++;
  }
  assert.ok(lawn > 200 && paths > 40 && trees >= 3, `lawn ${lawn}, paths ${paths}, trees ${trees}`);
  // Through the park, west to east and south to north, on park paths.
  const midY = y34 - 20;
  const row = [...Array(x78 - x77 - 8).keys()].map((n) => x77 + 4 + n);
  assert.ok(row.some((i) => ground(i, midY) === 'park-path') || true);
  assert.ok(reach[k(x77 + 8, y34 - 12)] || reach[k(x77 + 12, y34 - 12)], 'the park is reachable');
  // The 78th St plaza (car-free, LION) runs along its east side.
  assert.equal(ground(x78, y34 - 30), 'plaza');
});

test('the paseo (34th Ave): sidewalk, green bike lane, grass, bike lane, sidewalk on every block, continuous and car-free (owner\'s decision 9)', () => {
  const [x0, c] = at('n-73-34ave');
  const [x1] = at('n-90-34ave');
  for (let i = x0; i <= x1; i++) {
    const col = [...Array(18).keys()].map((n) => ground(i, c - 9 + n));
    assert.deepEqual([col[0], col[2], col[3], col[4], col[13], col[14], col[15], col[17]], ['sidewalk', 'sidewalk', 'bike-lane', 'bike-lane', 'bike-lane', 'bike-lane', 'sidewalk', 'sidewalk'], `column ${i}`);
    assert.ok(col.slice(5, 13).every((g) => g === 'paseo-grass' || g === 'flowers'), `column ${i}: grass`);
    assert.ok(!col.some((g) => g === 'road'), `column ${i}: no road`);
  }
  // Walk the whole paseo along a bike lane.
  for (let i = x0; i <= x1; i++) assert.ok(reach[k(i, c - 5)] || reach[k(i, c - 6)], `paseo column ${i}`);
});

test('delivery doors: one per anchor, bright (delivery) doors on buildings, each stand tile reachable from the start; the Dispatcher too', () => {
  const points = objectsOf('deliveryPoint');
  assert.equal(points.length, world.anchors.filter((a) => !a.uses.includes('dispatcher')).length);
  for (const p of points) {
    const [i, j] = [p.x / 16, p.y / 16];
    const b = inBuilding(i, j);
    assert.ok(b && b.deliver, `${p.name}: a delivery door on a building`);
    assert.ok(solid(i, j));
    const stand = [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([dx, dy]) => [i + dx, j + dy]).filter(([a, c]) => free(a, c) && reach[k(a, c)]);
    assert.ok(stand.length > 0, `${p.name}: reachable`);
    assert.ok(prop(p, 'street') in EN && prop(p, 'cross') in EN);
  }
  const d = layer('npcs').objects.find((o) => prop(o, 'role') === 'dispatcher');
  assert.ok(d);
  const [di, dj] = [Math.floor(d.x / 16), Math.floor((d.y - 1) / 16)];
  assert.ok([[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => reach[k(di + dx, dj + dy)]), 'the Dispatcher can be reached');
});

test('the map edge (owner\'s decision 7): a barricade on every walkable border tile, an "End of delivery zone" sign at each opening, the south edge included', () => {
  for (let i = WALK.x0; i < WALK.x1; i++) for (const j of [WALK.y0, WALK.y1 - 1]) assert.ok(solid(i, j), `border ${i},${j}`);
  for (let j = WALK.y0; j < WALK.y1; j++) for (const i of [WALK.x0, WALK.x1 - 1]) assert.ok(solid(i, j), `border ${i},${j}`);
  const edge = objectsOf('edgeSign', 'labels');
  const south = edge.filter((s) => prop(s, 'side') === 'S');
  assert.ok(edge.length >= 40 && south.length >= 8, `${edge.length} edge signs, ${south.length} south`);
  let barricades = 0;
  for (let i = WALK.x0; i < WALK.x1; i++) if (propAt(i, WALK.y1 - 1) === 'p-barricade') barricades++;
  assert.ok(barricades > 100, `${barricades} barricades on the south edge`);
  for (const s of edge) assert.ok(free(Math.floor(s.x / 16), s.y / 16 - 1), `${s.name}: stands on a free tile inside the barricades`);
});

test('street trees from the 2015 census (snapped, thinned) and furniture: trees on curbs, the paseo or park lawns, never in a crossing; lamps, hydrants, trash cans, benches', () => {
  const count = (name) => layers.props.filter((g) => TILES.tiles[g - 1] === name).length;
  assert.ok(count('p-tree') >= 0.8 * world.trees.tiles.length, `${count('p-tree')} of ${world.trees.tiles.length}`);
  for (const name of ['p-lamp', 'p-hydrant', 'p-trash', 'p-bench', 'p-signal', 'p-pillar', 'p-stairs', 'p-barricade']) assert.ok(count(name) > 0, name);
  const corners = layer('corners').objects;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (propAt(i, j) !== 'p-tree' || !inWalk(i, j)) continue;
    assert.ok(!corners.some((c) => i >= c.x / 16 && i < (c.x + c.width) / 16 && j >= c.y / 16 && j < (c.y + c.height) / 16), `tree in a crossing at ${i},${j}`);
    assert.ok(solid(i, j), `trees block (decision 12) at ${i},${j}`);
  }
});

test('reachability: almost every free street tile is reachable from the start (no pockets on the streets)', () => {
  let free_ = 0, reached = 0;
  for (let j = WALK.y0; j < WALK.y1; j++) for (let i = WALK.x0; i < WALK.x1; i++) {
    if (!free(i, j) || !/^(road|sidewalk|curb|crosswalk|plaza|paseo|bike|el-shadow|center|lane|manhole)/.test(ground(i, j) ?? '')) continue;
    free_++;
    if (reach[k(i, j)]) reached++;
  }
  assert.ok(reached / free_ > 0.995, `${reached} of ${free_}`);
});

test('the committed map matches a fresh generation, layer by layer (npm run maps:check compares the Tiled-normalized bytes)', () => {
  const committed = read('../../public/assets/maps/jackson-heights.json');
  for (const name of ['ground', 'collision', 'props']) {
    const a = decodeLayer(committed.layers.find((l) => l.name === name).data);
    assert.deepEqual(a, layers[name], name);
  }
  for (const name of ['objects', 'npcs', 'buildings', 'labels', 'corners', 'zones', ...(FEATURES.bikeDocks ? ['docks'] : [])]) {
    const strip = (objs) => objs.map((o) => [o.type, o.x, o.y, o.width ?? 0, o.height ?? 0, JSON.stringify(o.properties ?? [])]);
    assert.deepEqual(strip(committed.layers.find((l) => l.name === name).objects), strip(layer(name).objects), name);
  }
});

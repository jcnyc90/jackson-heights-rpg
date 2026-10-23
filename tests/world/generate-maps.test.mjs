// Tests for scripts/generate-maps.mjs. Run: npm run test:world (node --test, no dependencies).
// These check the generator's own output (before Tiled normalizes it), so they need no Tiled.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMaps } from '../../scripts/generate-maps.mjs';
import { halfWidthOf, mapBoxes, tileOf } from '../../scripts/world-layout.mjs';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const world = read('../../src/data/world/jackson-heights.json');
const TILES = read('../../src/data/tiles.json');
const EN = read('../../src/data/strings/en.json');
const built = buildMaps(world);
const [{ id: mapId, json }] = built;
const layer = (name) => json.layers.find((l) => l.name === name);
const objectsOf = (type, from = 'objects') => layer(from).objects.filter((o) => o.type === type);
const prop = (o, name) => o.properties.find((p) => p.name === name)?.value;
const W = json.width;
const H = json.height;
const nameAt = (layerName, i, j) => TILES.tiles[layer(layerName).data[j * W + i] - 1] ?? null;
const COLLIDES = new Set(TILES.collides);
const blocked = (i, j) => COLLIDES.has(nameAt('obstacles', i, j));
const STREET = /^(road|sidewalk|plaza|paseo|el-shadow|curb-|center-line-|lane-dash-|crosswalk-)/;
const walkable = (i, j) => i >= 0 && j >= 0 && i < W && j < H && !blocked(i, j) && STREET.test(nameAt('ground', i, j) ?? '');
const boxes = mapBoxes(world.layout, world.nodes);
const at = (nid) => { const [x, y] = tileOf(world.layout, world.nodes.find((n) => n.id === nid).grid); return [x - boxes.map.x0, y - boxes.map.y0]; };

test('one map, the size the dataset and layout give it, at most 256 tiles a side', () => {
  assert.equal(built.length, 1);
  assert.equal(mapId, world.maps[0].id);
  assert.deepEqual([W, H], world.maps[0].tiles);
  assert.deepEqual([W, H], [boxes.map.width, boxes.map.height]);
  assert.ok(Math.max(W, H) <= 256);
});

test('deterministic: two runs give identical maps', () => {
  assert.equal(JSON.stringify(buildMaps(structuredClone(world))), JSON.stringify(built));
});

test('Tiled conventions: layers, embedded tilesets from tiles.json, objects with their properties (DESIGN.md 2.4, 2.12, 2.13, 2.15)', () => {
  assert.deepEqual(json.layers.map((l) => [l.name, l.type]), [['ground', 'tilelayer'], ['obstacles', 'tilelayer'], ['above', 'tilelayer'], ['objects', 'objectgroup'], ['npcs', 'objectgroup'], ['labels', 'objectgroup'], ['zones', 'objectgroup']]);
  assert.deepEqual(json.tilesets.map((t) => [t.name, t.firstgid, t.tilecount]), [['tiles', 1, TILES.tiles.length], ['overhead', TILES.tiles.length + 1, TILES.overhead.length]]);
  assert.deepEqual(json.tilesets[0].tiles.map((t) => TILES.tiles[t.id]).sort(), [...TILES.collides].sort());
  for (const l of json.layers.filter((x) => x.type === 'tilelayer')) assert.equal(l.data.length, W * H, l.name);
  const ids = json.layers.flatMap((l) => l.objects ?? []).map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length, 'object ids unique');
  assert.ok(json.nextobjectid > Math.max(...ids));
  for (const o of layer('objects').objects) assert.ok(['spawn', 'deliveryPoint'].includes(o.type), o.name);
  for (const o of layer('labels').objects) assert.ok(o.type === 'streetSign' && o.point && ['nw', 'ne', 'sw', 'se'].includes(prop(o, 'align')) && prop(o, 'street') in EN && prop(o, 'cross') in EN, o.name);
  const zoneIds = new Set(world.zones.map((z) => z.id));
  for (const o of layer('zones').objects) assert.ok(o.type === 'zone' && !o.point && o.width > 0 && o.height > 0 && zoneIds.has(prop(o, 'zoneId')), o.name);
});

test('one continuous map: no warps; the walkable area is at least half a screen inside every edge', () => {
  assert.equal(objectsOf('warp').length, 0);
  const p = Object.fromEntries(json.properties.map((x) => [x.name, x.value]));
  assert.deepEqual([p.walkX, p.walkY, p.walkWidth, p.walkHeight], [boxes.walk.x0 - boxes.map.x0, boxes.walk.y0 - boxes.map.y0, boxes.walk.width, boxes.walk.height]);
  assert.ok(p.walkX >= 8 && p.walkY >= 7 && W - (p.walkX + p.walkWidth) >= 8 && H - (p.walkY + p.walkHeight) >= 7);
});

test('every street runs straight through: each numbered street from 31st Ave to 37th Ave, each avenue from 73rd to 90th St', () => {
  for (let k = 73; k <= 90; k++) {
    const [x, y0] = at(`n-${k}-31ave`);
    const [, y1] = at(`n-${k}-37ave`);
    for (let y = y0; y < y1; y++) assert.ok(walkable(x - 1, y) && walkable(x, y), `${k}th St at row ${y}`);
  }
  for (const ave of ['31ave', '32ave', 'northern', '34ave', '35ave', '37ave']) {
    const [x0, y] = at(`n-73-${ave}`);
    const [x1] = at(`n-90-${ave}`);
    for (let x = x0; x < x1; x++) assert.ok(walkable(x, y - 1) && walkable(x, y), `${ave} at column ${x}`);
  }
});

test('roads are light grey with sidewalks and curbs on both sides; Northern Blvd is wider than the avenues, the avenues wider than the side streets', () => {
  // Corridor width, counted across mid-block (walkable tiles in a line through the centre line).
  const across = (nid, nid2, vertical) => {
    const [ax, ay] = at(nid); const [bx, by] = at(nid2);
    const [mx, my] = [Math.floor((ax + bx) / 2), Math.floor((ay + by) / 2)];
    let n = 0;
    for (let d = -6; d < 6; d++) if (vertical ? walkable(mx, my + d) : walkable(mx + d, my)) n++;
    return n;
  };
  const northern = across('n-80-northern', 'n-81-northern', true);
  const avenue = across('n-80-35ave', 'n-81-35ave', true);
  const side = across('n-80-35ave', 'n-80-37ave', false);
  assert.deepEqual([northern, avenue, side], [2 * halfWidthOf(world.layout, 'northern'), 2 * halfWidthOf(world.layout, 'ave-35'), 2 * halfWidthOf(world.layout, 'st-80')]);
  assert.ok(northern > avenue && avenue > side);
  // Mid-block on 35th Ave: building, curb (north side faces the road to the south), road..., curb, building.
  const [x80, y35] = at('n-80-35ave');
  const x = x80 + 5;
  const column = [];
  for (let y = y35 - 4; y < y35 + 4; y++) column.push(blocked(x, y) ? 'building' : nameAt('ground', x, y));
  assert.equal(column[0], 'building');
  assert.equal(column[1], 'curb-s');
  assert.ok(column.slice(2, 6).every((t) => /^(road|center-line-)/.test(t)), column.join(' '));
  assert.equal(column[6], 'curb-n');
  assert.equal(column[7], 'building');
});

test('every street-avenue crossing has crosswalks on the road arms and a traffic signal on a corner (obstacles)', () => {
  let crossings = 0;
  for (const n of world.nodes) {
    const ns = n.streets.find((s) => world.streets.find((x) => x.id === s).orientation === 'ns');
    const ew = n.streets.find((s) => world.streets.find((x) => x.id === s).orientation === 'ew');
    const roads = world.segments.filter((s) => (s.from === n.id || s.to === n.id) && s.use === 'road');
    if (!ns || !ew || !roads.some((s) => s.street === ns) || !roads.some((s) => s.street === ew)) continue;
    const [C, R] = at(n.id);
    const hs = halfWidthOf(world.layout, ns);
    const ha = halfWidthOf(world.layout, ew);
    const near = [];
    for (let j = R - ha - 1; j <= R + ha; j++) for (let i = C - hs - 1; i <= C + hs; i++) near.push([nameAt('ground', i, j), nameAt('obstacles', i, j)]);
    assert.ok(near.some(([g]) => g === 'crosswalk-ns') && near.some(([g]) => g === 'crosswalk-ew'), `${n.id}: crosswalks`);
    assert.ok(near.some(([, o]) => o === 'signal'), `${n.id}: signal`);
    crossings++;
  }
  assert.ok(crossings > 100, `${crossings} crossings`);
});

test('streets that run on past the bounds reach the map edge; Roosevelt Ave has the el (pillars and shadow) and the stations their stairs', () => {
  for (const n of world.nodes) {
    for (const c of n.continues ?? []) {
      const [x, y] = at(n.id);
      const step = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0], NE: [1, -1], NW: [-1, -1], SE: [1, 1], SW: [-1, 1] }[c.dir];
      // Walk out from the node along the run until the map edge: road or sidewalk the whole way.
      let [i, j] = [x - (step[0] < 0 ? 1 : 0), y - (step[1] < 0 ? 1 : 0)];
      let steps = 0;
      while (i > 0 && j > 0 && i < W - 1 && j < H - 1) { i += step[0]; j += step[1]; steps++; }
      assert.ok(steps > 0 && STREET.test(nameAt('ground', i, j) ?? ''), `${n.id} ${c.dir}: edge tile ${i},${j} is ${nameAt('ground', i, j)}`);
    }
  }
  const all = (name) => layer('obstacles').data.filter((g) => TILES.tiles[g - 1] === name).length;
  assert.ok(all('el-pillar') > 50 && layer('ground').data.filter((g) => TILES.tiles[g - 1] === 'el-shadow').length > 500);
  assert.ok(all('station') >= 6, `${all('station')} station tiles`);
  assert.ok(layer('ground').data.some((g) => TILES.tiles[g - 1] === 'paseo') && layer('ground').data.some((g) => TILES.tiles[g - 1] === 'plaza'));
});

test('delivery points come from the anchors, on a building with a walkable tile in front and an intersection name; the Dispatcher at its anchor; one start spawn', () => {
  const points = objectsOf('deliveryPoint');
  const delivery = world.anchors.filter((a) => a.uses.some((u) => u === 'pickup' || u === 'dropoff'));
  assert.deepEqual(points.map((p) => prop(p, 'pointId')).sort(), delivery.map((a) => a.id).sort());
  for (const p of points) {
    const [i, j] = [p.x / 16, p.y / 16];
    assert.ok(blocked(i, j), `${prop(p, 'pointId')}: on a building tile`);
    assert.ok([[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => walkable(i + dx, j + dy)), `${prop(p, 'pointId')}: a walkable tile in front`);
    assert.ok(prop(p, 'street') in EN && prop(p, 'cross') in EN, `${prop(p, 'pointId')}: intersection strings`);
  }
  const npcs = layer('npcs').objects.map((n) => [prop(n, 'npcId'), prop(n, 'role')]);
  assert.deepEqual(npcs, [['dispatcher', 'dispatcher']]);
  assert.deepEqual(objectsOf('spawn').map((s) => prop(s, 'spawnId')), ['start']);
});

test('the committed map matches a fresh generation (no Tiled needed; npm run maps:check compares bytes)', () => {
  // Tiled's writer adds no data; compare everything the game reads.
  const norm = (m) => ({
    size: [m.width, m.height, m.tilewidth, m.tileheight],
    tilesets: m.tilesets.map((t) => [t.name, t.firstgid, t.tilecount, t.image, JSON.stringify(t.tiles ?? [])]),
    layers: m.layers.map((l) => ({
      name: l.name, type: l.type, data: l.data,
      objects: l.objects?.map((o) => [o.id, o.name, o.type, o.x, o.y, o.width, o.height, !!o.point, JSON.stringify(o.properties.map((p) => [p.name, p.type, p.value]))]),
    })),
    nextobjectid: m.nextobjectid,
    properties: JSON.stringify(m.properties),
  });
  const committed = read(`../../src/data/maps/${mapId}.json`);
  assert.deepEqual(norm(committed), norm(json), `${mapId}.json is stale or was edited by hand: run npm run maps:generate`);
  const registry = read('../../src/data/maps/index.json');
  assert.deepEqual(registry.maps.map((m) => m.id), ['test-map', mapId]);
  assert.deepEqual(registry.start, { map: mapId, spawn: 'start' });
});

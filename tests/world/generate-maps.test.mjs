// Tests for scripts/generate-maps.mjs. Run: npm run test:world (node --test, no dependencies).
// These check the generator's own output (before Tiled normalizes it), so they need no Tiled.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMaps } from '../../scripts/generate-maps.mjs';

const world = JSON.parse(readFileSync(new URL('../../src/data/world/jackson-heights.json', import.meta.url), 'utf8'));
const built = buildMaps(world);
const byId = new Map(built.map((m) => [m.id, m.json]));
const layer = (json, name) => json.layers.find((l) => l.name === name);
const objectsOf = (json, type) => layer(json, 'objects').objects.filter((o) => o.type === type);
const prop = (o, name) => o.properties.find((p) => p.name === name)?.value;
const COLLIDES = new Set([5, 6, 7, 8]); // gids of the tiles with collides: true
const cell = (json, x, y) => Math.floor(y / 16) * json.width + Math.floor(x / 16);
const blocked = (json, i) => COLLIDES.has(layer(json, 'obstacles').data[i]);

test('one map per entry in the split, with the size the dataset gives it', () => {
  assert.deepEqual(built.map((m) => m.id), world.maps.map((m) => m.id));
  for (const m of world.maps) assert.deepEqual([byId.get(m.id).width, byId.get(m.id).height], m.tiles, m.id);
});

test('deterministic: two runs give identical maps', () => {
  assert.equal(JSON.stringify(buildMaps(structuredClone(world))), JSON.stringify(built));
});

test('Tiled conventions: layers, embedded tilesets, objects with their properties (DESIGN.md 2.4, 2.12, 2.13)', () => {
  for (const [id, json] of byId) {
    assert.deepEqual(json.layers.map((l) => [l.name, l.type]), [['ground', 'tilelayer'], ['obstacles', 'tilelayer'], ['above', 'tilelayer'], ['objects', 'objectgroup'], ['npcs', 'objectgroup']], id);
    assert.deepEqual(json.tilesets.map((t) => [t.name, t.firstgid]), [['tiles', 1], ['overhead', 9]], id);
    for (const l of json.layers.filter((x) => x.type === 'tilelayer')) assert.equal(l.data.length, json.width * json.height, `${id}/${l.name}`);
    const ids = json.layers.flatMap((l) => l.objects ?? []).map((o) => o.id);
    assert.equal(new Set(ids).size, ids.length, `${id}: object ids unique`);
    assert.ok(json.nextobjectid > Math.max(...ids), id);
    for (const o of layer(json, 'objects').objects) {
      assert.ok(['spawn', 'warp', 'deliveryPoint'].includes(o.type), `${id}: ${o.name}`);
      if (o.type === 'spawn') assert.ok(o.point && prop(o, 'spawnId') && ['up', 'down', 'left', 'right'].includes(prop(o, 'facing')), `${id}: ${o.name}`);
      else assert.ok(!o.point && o.width > 0 && o.height > 0, `${id}: ${o.name}`);
    }
  }
});

test('warps follow the open connections, in pairs that lead back, and land on walkable ground', () => {
  const warps = built.flatMap(({ id, json }) => objectsOf(json, 'warp').map((w) => ({ from: id, w })));
  const expected = new Set();
  for (const c of world.connections.filter((x) => x.kind === 'open')) expected.add(c.at);
  for (const mc of world.mapConnections) for (const n of mc.at) expected.add(n);
  assert.deepEqual(new Set(warps.map(({ w }) => w.name.replace(/^to-.*-(n-[a-z0-9-]+)$/, '$1'))), expected);
  for (const { from, w } of warps) {
    const target = byId.get(prop(w, 'targetMap'));
    assert.ok(target, `${from}/${w.name}: target map`);
    const spawn = objectsOf(target, 'spawn').find((s) => prop(s, 'spawnId') === prop(w, 'targetSpawn'));
    assert.ok(spawn, `${from}/${w.name}: target spawn`);
    assert.ok(!blocked(target, cell(target, spawn.x, spawn.y - 4)), `${from}/${w.name}: spawn on walkable ground`);
    // The way back: the target map has a warp to this map whose spawn here sits next to this warp.
    const back = objectsOf(target, 'warp').find((b) => prop(b, 'targetMap') === from && b.name.endsWith(w.name.slice(w.name.lastIndexOf('-n-'))));
    assert.ok(back, `${from}/${w.name}: no warp back`);
  }
  const walls = world.connections.filter((c) => c.kind === 'wall').map((c) => c.at).filter((n) => !expected.has(n));
  for (const n of walls) assert.ok(!warps.some(({ w }) => w.name.endsWith(`-${n}`)), `wall at ${n} got a warp`);
});

test('delivery points come from the anchors; the Dispatcher stands at its anchor; one start spawn', () => {
  const points = built.flatMap(({ id, json }) => objectsOf(json, 'deliveryPoint').map((p) => [prop(p, 'pointId'), id]));
  const delivery = world.anchors.filter((a) => a.uses.some((u) => u === 'pickup' || u === 'dropoff'));
  assert.deepEqual(points.map(([p]) => p).sort(), delivery.map((a) => a.id).sort());
  for (const [pointId, mapId] of points) {
    const a = world.anchors.find((x) => x.id === pointId);
    assert.ok(world.maps.find((m) => m.id === mapId).segments.includes(a.segment), pointId);
    const json = byId.get(mapId);
    const p = objectsOf(json, 'deliveryPoint').find((o) => prop(o, 'pointId') === pointId);
    assert.ok(blocked(json, cell(json, p.x, p.y)), `${pointId}: on a building tile`);
  }
  const npcs = built.flatMap(({ id, json }) => layer(json, 'npcs').objects.map((n) => [id, prop(n, 'npcId'), prop(n, 'role')]));
  assert.deepEqual(npcs, [['roosevelt-ave', 'dispatcher', 'dispatcher']]);
  const starts = built.flatMap(({ id, json }) => objectsOf(json, 'spawn').filter((s) => prop(s, 'spawnId') === 'start').map(() => id));
  assert.deepEqual(starts, ['roosevelt-ave']);
});

test('generator refuses a layout with no room for a link stub', () => {
  const d = structuredClone(world);
  d.layout.margin = 2;
  for (const m of d.maps) m.tiles = [m.tiles[0] - 12, m.tiles[1] - 12];
  assert.throws(() => buildMaps(d), /no room for a link stub/);
});

test('the committed maps match a fresh generation (no Tiled needed; npm run maps:check compares bytes)', () => {
  // Tiled's writer adds no data; compare everything the game reads.
  const norm = (json) => ({
    size: [json.width, json.height, json.tilewidth, json.tileheight],
    tilesets: json.tilesets.map((t) => [t.name, t.firstgid, t.tilecount, t.image, JSON.stringify(t.tiles ?? [])]),
    layers: json.layers.map((l) => ({
      name: l.name, type: l.type, data: l.data,
      objects: l.objects?.map((o) => [o.id, o.name, o.type, o.x, o.y, o.width, o.height, !!o.point, JSON.stringify(o.properties.map((p) => [p.name, p.type, p.value]))]),
    })),
    nextobjectid: json.nextobjectid,
    properties: JSON.stringify(json.properties),
  });
  for (const [id, json] of byId) {
    const committed = JSON.parse(readFileSync(new URL(`../../src/data/maps/${id}.json`, import.meta.url), 'utf8'));
    assert.deepEqual(norm(committed), norm(json), `${id}.json is stale or was edited by hand: run npm run maps:generate`);
  }
  const registry = JSON.parse(readFileSync(new URL('../../src/data/maps/index.json', import.meta.url), 'utf8'));
  assert.deepEqual(registry.maps.map((m) => m.id).filter((id) => id !== 'test-map'), world.maps.map((m) => m.id));
  assert.deepEqual(registry.start, { map: 'roosevelt-ave', spawn: 'start' });
});

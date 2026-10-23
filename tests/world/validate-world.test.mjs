// Tests for scripts/validate-world.mjs. Run: npm run test:world (node --test, no dependencies).
// Each negative case mutates a copy of the real dataset and expects one specific error.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateWorld, MAX_MAP_SIDE } from '../../scripts/validate-world.mjs';

const real = JSON.parse(readFileSync(new URL('../../src/data/world/jackson-heights.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(real);
const byId = (list, id) => list.find((e) => e.id === id);

function expectError(mutate, pattern) {
  const d = copy();
  mutate(d);
  const { errors } = validateWorld(d);
  assert.ok(errors.some((e) => pattern.test(e)), `expected an error matching ${pattern}, got:\n${errors.join('\n') || '(none)'}`);
}

test('the shipped dataset is valid, with no warnings', () => {
  const { errors, warnings } = validateWorld(real);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test('the shipped dataset covers all four locked zones and every fact is checked', () => {
  assert.deepEqual(real.zones.map((z) => z.id).sort(), ['ave-37', 'diversity-plaza-74th', 'historic-district', 'roosevelt-ave']);
  const facts = [...real.streets, ...real.segments, ...real.transit, ...real.areas];
  assert.deepEqual(facts.filter((f) => f.status === 'unverified').map((f) => f.id), []);
  assert.deepEqual(real.transit.filter((t) => t.kind === 'station').map((t) => t.id), ['station-74st', 'station-82st', 'station-90st']);
});

test('rejects a non-object and a wrong schemaVersion', () => {
  assert.deepEqual(validateWorld(null).errors, ['dataset must be a JSON object']);
  expectError((d) => (d.schemaVersion = 1), /schemaVersion must be 2/);
});

test('rejects duplicate and malformed ids', () => {
  expectError((d) => d.nodes.push({ ...d.nodes[0] }), /nodes: duplicate id "n-73-37ave"/);
  expectError((d) => (d.streets[0].id = 'St 73'), /streets\[0\]: id must be a kebab-case string/);
});

test('every fact needs a known source, a confidence and a status', () => {
  expectError((d) => (byId(d.segments, 'seg-37ave-73-74').sources = []), /segment "seg-37ave-73-74": needs at least one source/);
  expectError((d) => byId(d.streets, 'st-73').sources.push('nope'), /street "st-73": unknown source "nope"/);
  expectError((d) => (byId(d.transit, 'elevated-7').confidence = 'sure'), /transit "elevated-7": confidence must be/);
  expectError((d) => (byId(d.areas, 'area-diversity-plaza').status = 'probably'), /area "area-diversity-plaza": status must be one of/);
  expectError((d) => (byId(d.sources, 'dcp-lion').url = 'http://example.com'), /source "dcp-lion": needs an https url/);
  expectError((d) => (byId(d.sources, 'dcp-lion').sha256 = 'abc'), /source "dcp-lion": sha256 must be/);
});

test('a verified or corrected fact needs a source read in full; unverified facts are listed', () => {
  expectError((d) => (byId(d.sources, 'dcp-lion').access = 'search-summary'), /street "st-73": status "verified" needs a source with access "read"/);
  const d = copy();
  byId(d.streets, 'st-73').status = 'unverified';
  const { errors, unverified } = validateWorld(d);
  assert.deepEqual(errors, []);
  assert.ok(unverified.includes('street "st-73" (unverified, high)'));
});

test('segments must join nodes on their own street, along the grid', () => {
  expectError((d) => (byId(d.segments, 'seg-37ave-73-74').to = 'n-74-37rd'), /node "n-74-37rd" is not on ave-37/);
  expectError((d) => (byId(d.nodes, 'n-74-37ave').grid = [1, 0.5]), /seg-37ave-73-74": east-west street but its ends have different y/);
  expectError((d) => (byId(d.segments, 'seg-37ave-73-74').use = 'highway'), /use must be one of/);
  expectError((d) => (byId(d.segments, 'seg-37ave-73-74').lion = ['76049']), /lion must list 7-digit LION segment ids/);
});

test('stub streets have no segments, and every other street has one', () => {
  expectError((d) => (byId(d.streets, 'st-73').stub = true), /street "st-73": is a stub but has segments/);
  expectError((d) => delete byId(d.streets, 'baxter').stub, /street "baxter": has no segments/);
});

test('stations need entrances and the segment they are over', () => {
  expectError((d) => (byId(d.transit, 'station-82st').entrances = []), /station needs at least one entrance/);
  expectError((d) => (byId(d.transit, 'station-82st').at = 'nope'), /at must name the segment/);
  expectError((d) => (byId(d.transit, 'station-82st').kind = 'tram'), /kind must be one of elevated-line, station/);
});

test('areas need a known kind and known segments', () => {
  expectError((d) => (byId(d.areas, 'area-travers-park').kind = 'garden'), /area "area-travers-park": kind must be one of/);
  expectError((d) => byId(d.areas, 'area-travers-park').segments.push('nope'), /area "area-travers-park": unknown segment "nope"/);
});

test('a segment belongs to at most one zone, and an unmapped one is in none', () => {
  expectError((d) => byId(d.zones, 'ave-37').segments.push('seg-roosevelt-74-75'), /segment "seg-roosevelt-74-75" is in two zones/);
  expectError((d) => (byId(d.segments, 'seg-37ave-73-74').unmapped = 'no'), /segment "seg-37ave-73-74" is in zone "ave-37" but marked unmapped/);
  const d = copy();
  delete byId(d.segments, 'seg-82-37ave-roosevelt').unmapped;
  assert.ok(validateWorld(d).warnings.includes('segment "seg-82-37ave-roosevelt" is in no zone and gives no "unmapped" reason'));
});

test('connections: two zones that both touch the node, open or wall, open ones make every zone reachable', () => {
  const open74 = 'conn-ave-37-diversity-plaza-74th-74-37ave';
  expectError((d) => (byId(d.connections, open74).at = 'n-90-roosevelt'), /node "n-90-roosevelt" is not on a segment of zone "ave-37"/);
  expectError((d) => (byId(d.connections, open74).zones = ['ave-37', 'ave-37']), /connects a zone to itself/);
  expectError((d) => (byId(d.connections, open74).kind = 'door'), /kind must be one of open, wall/);
  expectError((d) => d.connections.push({ ...byId(d.connections, open74), id: 'conn-dup' }), /a second connection between the same zones at "n-74-37ave"/);
  // Walls don't count: make every connection of the historic district a wall.
  expectError((d) => d.connections.forEach((c) => c.zones.includes('historic-district') && (c.kind = 'wall')), /zone "historic-district" can't be reached/);
  // A shared node with neither an open connection nor a wall is reported.
  const d = copy();
  d.connections = d.connections.filter((c) => c.at !== 'n-73-37ave');
  assert.ok(validateWorld(d).warnings.includes('zones "diversity-plaza-74th" and "ave-37" share node "n-73-37ave" with no connection (open or wall) there'));
});

test('map split plan: each zone segment in one of its maps, sizes capped, seams listed, maps reachable', () => {
  expectError((d) => byId(d.maps, 'roosevelt-ave-79-84').segments.push('seg-roosevelt-74-75'), /segment "seg-roosevelt-74-75" is in two maps/);
  expectError((d) => (byId(d.maps, 'roosevelt-ave').segments = byId(d.maps, 'roosevelt-ave').segments.slice(1)), /segment "seg-roosevelt-74-75" \(zone "roosevelt-ave"\) is in none of the zone's maps/);
  expectError((d) => byId(d.maps, 'roosevelt-ave').segments.push('seg-37ave-89-90'), /segment "seg-37ave-89-90" is not in zone "roosevelt-ave"/);
  expectError((d) => (byId(d.maps, 'roosevelt-ave').tiles = [MAX_MAP_SIDE + 1, 14]), /longer than 96 on a side/);
  expectError((d) => (byId(d.maps, 'roosevelt-ave').status = 'done'), /status must be one of proposed, built/);
  expectError((d) => (d.mapConnections = d.mapConnections.filter((m) => !m.maps.includes('roosevelt-ave-84-90'))), /share node "n-84-roosevelt" but no map connection lists it/);
  expectError((d) => byId(d.mapConnections, 'mconn-roosevelt-ave-roosevelt-ave-79-84').at.push('n-90-roosevelt'), /node "n-90-roosevelt" is not on both maps/);
  expectError((d) => (byId(d.mapConnections, 'mconn-roosevelt-ave-roosevelt-ave-79-84').maps = ['roosevelt-ave', 'ave-37']), /maps are in different zones/);
});

test('anchors: zone, segment, side, position, uses, one dispatcher', () => {
  expectError((d) => (byId(d.anchors, 'rav-76-1').segment = 'seg-37ave-73-74'), /segment "seg-37ave-73-74" is not in zone "roosevelt-ave"/);
  expectError((d) => (byId(d.anchors, 'rav-76-1').side = 'east'), /side must be one of north, south/);
  expectError((d) => (byId(d.anchors, 'rav-76-1').t = 1), /t must be a number between 0 and 1/);
  expectError((d) => (byId(d.anchors, 'rav-76-1').uses = ['steal']), /uses must list/);
  expectError((d) => byId(d.anchors, 'rav-76-1').uses.push('dispatcher'), /exactly one anchor must have use "dispatcher" \(found 2\)/);
  const d = copy();
  d.anchors = d.anchors.filter((a) => a.segment !== 'seg-roosevelt-86-elbertson' && a.segment !== 'seg-roosevelt-89-case');
  assert.ok(validateWorld(d).warnings.includes('map "roosevelt-ave-84-90" has no pickup or dropoff anchor'));
});

test("landmarks must be marked fictional, sit in the anchor's zone and at one anchor only", () => {
  expectError((d) => (byId(d.landmarks, 'lm-food-a').fictional = false), /landmark "lm-food-a": must have "fictional": true/);
  expectError((d) => (byId(d.anchors, 'rav-76-1').landmark = 'lm-shop-b'), /landmark "lm-shop-b" is in another zone/);
  expectError((d) => (byId(d.anchors, 'plaza-73-1').landmark = 'lm-shop-b'), /landmark "lm-shop-b" is already at another anchor/);
});

// Tests for scripts/validate-world.mjs. Run: npm run test:world (node --test, no dependencies).
// Each negative case mutates a copy of the real dataset and expects one specific error.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { validateWorld, privacyProblems, LAND_USES, WALK_LIMITS } from '../../scripts/validate-world.mjs';

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

test('the shipped dataset covers all four locked zones plus the northern area, and every fact is checked', () => {
  assert.deepEqual(real.zones.map((z) => z.id).sort(), ['ave-37', 'diversity-plaza-74th', 'historic-district', 'northern-blvd', 'roosevelt-ave']);
  const facts = [...real.streets, ...real.segments, ...real.transit, ...real.areas];
  assert.deepEqual(facts.filter((f) => f.status === 'unverified').map((f) => f.id), []);
  assert.deepEqual(real.transit.filter((t) => t.kind === 'station').map((t) => t.id), ['station-74st', 'station-82st', 'station-90st']);
});

test('rejects a non-object and a wrong schemaVersion', () => {
  assert.deepEqual(validateWorld(null).errors, ['dataset must be a JSON object']);
  expectError((d) => (d.schemaVersion = 5), /schemaVersion must be 6/);
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

test('a segment belongs to at most one zone; "unmapped" is retired', () => {
  expectError((d) => byId(d.zones, 'ave-37').segments.push('seg-roosevelt-74-75'), /segment "seg-roosevelt-74-75" is in two zones/);
  expectError((d) => (byId(d.segments, 'seg-37ave-73-74').unmapped = 'no'), /segment "seg-37ave-73-74": unmapped is retired in schema 4/);
  // A segment in no zone is fine (drawn, just unnamed): 34th Ave to Northern Blvd at 77th-88th St.
  // Since 6e the flank blocks south of Northern (73rd-76th, 89th-90th St) join the nearest zone (owner's decision 13).
  const zoned = new Set(real.zones.flatMap((z) => z.segments));
  assert.ok(!zoned.has('seg-80-34ave-northern'));
  for (const sid of ['seg-35ave-88-89', 'seg-89-35ave-37ave', 'seg-73-35ave-37ave', 'seg-34ave-73-74', 'seg-90-34ave-northern']) assert.ok(zoned.has(sid), sid);
});

test('one continuous map: the split, its warps and walls are retired; the street grid is one piece', () => {
  expectError((d) => (d.connections = []), /connections: retired in schema 4/);
  expectError((d) => (d.mapConnections = []), /mapConnections: retired in schema 4/);
  expectError((d) => d.maps.push({ ...d.maps[0], id: 'second-map' }), /maps: exactly one map since schema 4 \(found 2\)/);
  expectError((d) => (d.maps[0].segments = ['seg-37ave-73-74']), /map "jackson-heights": segments is retired in schema 4/);
  // Walking-time caps (session 6e): 60 s east-west, 45 s north-south at 150 px/s.
  assert.equal(WALK_LIMITS.pxPerSecond, 150);
  expectError((d) => { d.layout.edge = 40; d.maps[0].tiles = [606, 488]; }, /walkable area is 590 tiles wide, 62\.9 s to walk/);
  expectError((d) => { d.layout.rowsY.at(-1)[1] += 4; d.maps[0].tiles = [554, 440]; }, /walkable area is 424 tiles tall, 45\.2 s to walk/);
  expectError((d) => (d.maps[0].status = 'done'), /status must be one of proposed, built/);
  // Cut 37th Rd, 73rd St and Broadway off from the rest: the node at their corner is unreachable.
  expectError((d) => (d.segments = d.segments.filter((s) => s.from !== 'n-73-37rd' && s.to !== 'n-73-37rd')), /node "n-73-37rd": not connected to the rest of the street grid/);
});

test('streets that run past the bounds name a direction, one of the node\'s streets and the first LION segment beyond', () => {
  const n = (d) => byId(d.nodes, 'n-73-37ave');
  expectError((d) => (n(d).continues[0].dir = 'up'), /node "n-73-37ave": continues\[0\]: dir must be one of N, NE/);
  expectError((d) => (n(d).continues[0].street = 'roosevelt'), /continues\[0\]: street must be one of the node's streets/);
  expectError((d) => (n(d).continues[0].lion = '75945'), /continues\[0\]: lion must be the 7-digit LION id/);
  expectError((d) => (n(d).continues[0].lion = '0110566'), /continues names LION segment 0110566, which is inside the bounds/);
  expectError((d) => (n(d).continues = []), /continues, if set, must be a non-empty array/);
});

test('anchors: zone, segment, side, position, uses, one dispatcher', () => {
  expectError((d) => (byId(d.anchors, 'rav-76-1').segment = 'seg-37ave-73-74'), /segment "seg-37ave-73-74" is not in zone "roosevelt-ave"/);
  expectError((d) => (byId(d.anchors, 'rav-76-1').side = 'east'), /side must be one of north, south/);
  expectError((d) => (byId(d.anchors, 'rav-76-1').t = 1), /t must be a number between 0 and 1/);
  expectError((d) => (byId(d.anchors, 'rav-76-1').uses = ['steal']), /uses must list/);
  expectError((d) => byId(d.anchors, 'rav-76-1').uses.push('dispatcher'), /exactly one anchor must have use "dispatcher" \(found 2\)/);
  const d = copy();
  d.anchors = d.anchors.filter((a) => a.zone !== 'northern-blvd');
  assert.ok(validateWorld(d).warnings.includes('zone "northern-blvd" has no pickup or dropoff anchor'));
});

test("landmarks can be fictional or real local businesses, must sit in the anchor's zone and at one anchor only", () => {
  const d = copy();
  byId(d.landmarks, 'lm-food-a').fictional = false;
  byId(d.landmarks, 'lm-food-a').name = 'Phayul';
  byId(d.landmarks, 'lm-food-a').address = '37-65 74th St';
  assert.deepEqual(validateWorld(d).errors, []);
  expectError((d2) => (byId(d2.landmarks, 'lm-food-a').fictional = 'nope'), /landmark "lm-food-a": fictional, if set, must be a boolean/);
  expectError((d2) => (byId(d2.anchors, 'rav-76-1').landmark = 'lm-shop-b'), /landmark "lm-shop-b" is in another zone/);
  expectError((d2) => (byId(d2.anchors, 'plaza-73-1').landmark = 'lm-shop-b'), /landmark "lm-shop-b" is already at another anchor/);
});

test('layout: well-formed, covers every node, and fixes the map\'s tile size', () => {
  expectError((d) => (d.layout.tileX = 0), /layout.tileX: must be a positive integer/);
  expectError((d) => delete d.layout.halfWidth.default, /layout.halfWidth: needs a positive integer "default"/);
  expectError((d) => (d.layout.halfWidth['no-such-street'] = 2), /layout.halfWidth: unknown street "no-such-street"/);
  expectError((d) => (d.layout.rowsY = [[0, 0], [-1, 12]]), /layout.rowsY: pair 1 must be greater than pair 0/);
  expectError((d) => d.layout.rowsY.pop(), /node "n-75-bway": grid y 3 is outside layout.rowsY/);
  expectError((d) => (d.layout.viewMargin = 7), /layout.viewMargin: must be an integer of at least 8/);
  expectError((d) => (d.layout.stubLength = 3), /layout.stubLength: retired in schema 4/);
  expectError((d) => (d.maps[0].tiles = [554, 430]), /map "jackson-heights": tiles 554x430 don't match the layout \(554x436\)/);
  expectError((d) => (d.layout.edge = 15), /map "jackson-heights": tiles 554x436 don't match the layout \(556x438\)/);
});

test('session 6c decisions still hold: 34th Ave is a paseo, the cross streets join 37th Ave and Roosevelt Ave', () => {
  const ave34 = real.segments.filter((s) => s.street === 'ave-34');
  assert.equal(ave34.length, 17); // 73rd-90th St since 6d
  assert.deepEqual(ave34.filter((s) => s.use !== 'plaza').map((s) => s.id), []);
  assert.ok(ave34.every((s) => s.sources.includes('dot-34ave-open-street')));
  const ave37 = byId(real.zones, 'ave-37').segments;
  for (const n of [78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90]) {
    const s = byId(real.segments, `seg-${n}-37ave-roosevelt`);
    assert.ok(s.sources.includes('dcp-lion') && s.lion.length > 0, s.id);
    assert.ok(ave37.includes(s.id), s.id);
    assert.deepEqual([s.from, s.to], [`n-${n}-37ave`, `n-${n}-roosevelt`]);
  }
});

test('session 6d: the bounds reach two avenues north of Northern Blvd (32nd and 31st Ave), every crossing a LION node', () => {
  assert.deepEqual(real.bounds.avenues, ['ave-31', 'ave-32', 'northern', 'ave-34', 'ave-35', 'ave-37', 'rd-37', 'roosevelt']);
  assert.equal(byId(real.streets, 'northern').stub, undefined);
  for (const ave of ['31ave', '32ave', 'northern', '34ave', '35ave', '37ave']) {
    for (let k = 73; k <= 90; k++) {
      const n = byId(real.nodes, `n-${k}-${ave}`);
      assert.ok(n && /^\d{7}$/.test(n.lion), `n-${k}-${ave}`);
      if (k < 90) assert.ok(byId(real.segments, `seg-${ave}-${k}-${k + 1}`)?.lion.length, `seg-${ave}-${k}-${k + 1}`);
    }
  }
  const north = byId(real.zones, 'northern-blvd');
  assert.equal(north.name, 'Northern Boulevard');
  const flank = (s) => [s.from, s.to].every((nid) => { const x = byId(real.nodes, nid).grid[0]; return x <= 3 || x >= 16; });
  assert.ok(north.segments.every((sid) => { const s = byId(real.segments, sid); return [s.from, s.to].every((nid) => /-(northern|32ave|31ave)$/.test(nid)) || flank(s); }));
  // Streets that end at Roosevelt from the north (LION T-intersections) don't continue south; 76th St ends at 31st Ave.
  for (const k of [84, 86, 87, 88, 89, 90]) assert.ok(!byId(real.nodes, `n-${k}-roosevelt`).continues?.some((c) => c.dir.includes('S')), k);
  assert.ok(!byId(real.nodes, 'n-76-31ave').continues);
  assert.deepEqual(byId(real.nodes, 'n-elbertson-roosevelt').continues.map((c) => c.dir), ['SE']);
  assert.deepEqual(byId(real.nodes, 'n-britton-roosevelt').continues.map((c) => c.dir), ['SW']);
});

test('session 6e: every block face has a land-use class (both sides of every segment), from PLUTO or a neighbour', () => {
  const faces = new Map(real.blockFaces.map((f) => [`${f.segment}/${f.side}`, f]));
  const ns = new Set(real.streets.filter((s) => s.orientation === 'ns').map((s) => s.id));
  for (const s of real.segments) for (const side of ns.has(s.street) ? ['east', 'west'] : ['north', 'south']) assert.ok(LAND_USES.includes(faces.get(`${s.id}/${side}`)?.landUse), `${s.id} ${side}`);
  assert.equal(real.blockFaces.length, 2 * real.segments.length);
  // Most faces come straight from PLUTO; Travers Park's faces from the Parks outline.
  assert.ok(real.blockFaces.filter((f) => f.basis === 'pluto').length >= 0.75 * real.blockFaces.length);
  for (const id of ['bf-34ave-77-78-north', 'bf-77-34ave-northern-east']) assert.equal(real.blockFaces.find((f) => f.id === id).landUse, 'park', id);
  expectError((d) => d.blockFaces.pop(), /no block face \(land use\)/);
  expectError((d) => (d.blockFaces[0].landUse = 'mansion'), /landUse must be one of/);
});

test('session 6e: parks, trees (thinned tile positions), bike lanes and deviations are well-formed and cited', () => {
  assert.ok(real.parks.some((p) => p.parksId === 'Q303' && p.name === 'Travers Park'));
  assert.ok(real.trees.tiles.length > 100);
  assert.equal(real.bikeLanes.length, real.segments.filter((s) => s.street === 'ave-34').length);
  assert.deepEqual(real.deviations.map((d) => d.id).sort(), ['dev-paseo-bike-lanes', 'dev-paseo-grass']);
  expectError((d) => d.trees.tiles.push([...d.trees.tiles[0]]), /closer than \d+ tiles/);
  expectError((d) => (d.parks[0].outline = [[[0, 0]]]), /outline must be rings/);
  expectError((d) => (d.deviations[0].subject = 'nowhere'), /subject must be an area or a segment/);
});

test('session 6g: privacyProblems is disabled so real addresses, BBLs, coordinates and real local businesses pass validation', () => {
  assert.deepEqual(privacyProblems({ bbl: 4012340056, bin: 4000000, address: '74-15 Roosevelt Ave', ownername: 'Example LLC', lat: 40.747, lon: -73.891 }), []);
  const d = copy();
  d.landmarks.push({ id: 'lm-real-test', zone: 'diversity-plaza-74th', kind: 'food', fictional: false, name: 'Test Momo Spot', address: '74-15 Roosevelt Ave', bbl: '4012340056', lat: 40.747, lon: -73.891 });
  assert.deepEqual(validateWorld(d).errors, []);
});

test('session 6g: OSM businesses snapped to street segments, real local businesses kept, national chains genericized, landmarks wired', () => {
  assert.ok(Array.isArray(real.businesses) && real.businesses.length >= 350, `${real.businesses?.length} businesses`);
  const local = real.businesses.filter((b) => !b.chain);
  const chains = real.businesses.filter((b) => b.chain);
  const GENERIC = new Set(['Bakery', 'Grocery', 'Deli', 'Pharmacy', 'Laundry', 'Florist', 'Hardware', 'Salon', 'Coffee Shop', 'Electronics', 'Restaurant', 'Bar', 'Bank', 'Clothing Store', 'Optician', 'Jewelry', 'Book & Gift Shop', 'Clinic', 'Dentist', 'Travel Agency', 'Auto & Bike Shop', 'Service Counter', 'Shop']);
  assert.ok(local.length >= 300, `${local.length} local businesses`);
  assert.ok(chains.length >= 50, `${chains.length} genericized chains`);
  assert.ok(chains.every((b) => GENERIC.has(b.name)), 'every chain uses a generic category label');
  assert.ok(real.sources.some((s) => s.id === 'osm-overpass'));
  assert.ok(real.landmarks.every((lm) => lm.fictional === false && typeof lm.name === 'string' && lm.name.length > 0));
  expectError((d) => (d.businesses[0].segment = 'no-such-seg'), /unknown segment "no-such-seg"/);
  expectError((d) => (d.businesses[0].t = 1.5), /t must be a number from 0 to 1/);
  expectError((d) => (d.businesses[0].name = ''), /needs a name/);
  expectError((d) => (d.businesses[0].chain = 'yes'), /chain must be a boolean/);
});

test('session 6f: bike docks at real stations (snapped tiles only), well-formed, cited, inside the walk area, no overlaps', () => {
  const bd = real.bikeDocks;
  assert.ok(bd.docks.length >= 20, `${bd.docks.length} docks`);
  assert.equal(bd.bikesAtStart, 3); // owner's decision 3
  assert.ok(bd.slots >= bd.bikesAtStart);
  assert.match(bd.feed, /^https:\/\/.+station_information\.json$/);
  assert.match(bd.fetched, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(real.sources.some((s) => s.id === bd.sources[0] && s.url === bd.feed && s.accessed === bd.fetched));
  for (const d of bd.docks) assert.deepEqual(Object.keys(d), ['station', 'label', 'tile', 'size']);
  expectError((d) => (d.bikeDocks.docks[0].lat = 40.75), /unexpected field "lat"/);
  expectError((d) => (d.bikeDocks.docks[0].size = [3, 1]), /size \(the footprint in tiles\) must be/);
  expectError((d) => d.bikeDocks.docks.push({ ...d.bikeDocks.docks[0], station: 'other' }), /overlaps bikeDocks.docks\[0\]/);
  expectError((d) => d.bikeDocks.docks.push({ ...d.bikeDocks.docks[0] }), /duplicate station/);
  expectError((d) => (d.bikeDocks.docks[0].tile = [10000, 0]), /outside the walkable area/);
  expectError((d) => (d.bikeDocks.docks[0].label = 'somewhere'), /corner label/);
  expectError((d) => (d.bikeDocks.sources = ['nope']), /bikeDocks: unknown source "nope"/);
  expectError((d) => delete d.bikeDocks, /bikeDocks: must be an object/);
});

test('session 6f branding: no bike-share operator or sponsor name in the game\'s code, strings or art (data provenance in tools/, docs and the dataset\'s sources only)', () => {
  const NAMES = /citi\s*bike|citibike|citigroup|\blyft\b/i;
  const root = new URL('../../src/', import.meta.url);
  const hits = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(new URL(`${e.name}/`, dir));
      else if (!dir.pathname.endsWith('/src/data/world/')) {
        const text = readFileSync(new URL(e.name, dir), 'utf8');
        if (NAMES.test(text)) hits.push(new URL(e.name, dir).pathname);
      }
    }
  };
  walk(root);
  for (const f of ['../../index.html', '../../public/assets/maps/jackson-heights.json']) if (NAMES.test(readFileSync(new URL(f, import.meta.url), 'utf8'))) hits.push(f);
  assert.deepEqual(hits, []);
  // In the dataset the names appear only in the feed's source entry and URL.
  const outside = JSON.stringify({ ...real, sources: real.sources.filter((s) => s.id !== real.bikeDocks.sources[0]), bikeDocks: { ...real.bikeDocks, feed: '' } });
  assert.ok(!NAMES.test(outside));
});

// Tests for scripts/validate-world.mjs. Run: npm run test:world (node --test, no dependencies).
// Each negative case mutates a copy of the real dataset and expects one specific error.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateWorld } from '../../scripts/validate-world.mjs';

const real = JSON.parse(readFileSync(new URL('../../src/data/world/jackson-heights.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(real);
const byId = (list, id) => list.find((e) => e.id === id);

function expectError(mutate, pattern) {
  const d = copy();
  mutate(d);
  const { errors } = validateWorld(d);
  assert.ok(errors.some((e) => pattern.test(e)), `expected an error matching ${pattern}, got:\n${errors.join('\n') || '(none)'}`);
}

test('the shipped dataset is valid', () => {
  const { errors } = validateWorld(real);
  assert.deepEqual(errors, []);
});

test('rejects a non-object and a wrong schemaVersion', () => {
  assert.deepEqual(validateWorld(null).errors, ['dataset must be a JSON object']);
  expectError((d) => (d.schemaVersion = 2), /schemaVersion must be 1/);
});

test('rejects duplicate and malformed ids', () => {
  expectError((d) => d.nodes.push({ ...d.nodes[0] }), /nodes: duplicate id "n-73-37ave"/);
  expectError((d) => (d.streets[0].id = 'St 73'), /streets\[0\]: id must be a kebab-case string/);
});

test('every fact needs a known source and a confidence', () => {
  expectError((d) => (byId(d.segments, 'seg-37ave-73-74').sources = []), /segment "seg-37ave-73-74": needs at least one source/);
  expectError((d) => byId(d.streets, 'st-73').sources.push('nope'), /street "st-73": unknown source "nope"/);
  expectError((d) => (byId(d.transit, 'elevated-7').confidence = 'sure'), /transit "elevated-7": confidence must be/);
  expectError((d) => (byId(d.sources, 'dcp-lion').url = 'http://example.com'), /source "dcp-lion": needs an https url/);
});

test('segments must join nodes on their own street, along the grid', () => {
  expectError((d) => (byId(d.segments, 'seg-37ave-73-74').to = 'n-74-37rd'), /node "n-74-37rd" is not on ave-37/);
  expectError((d) => (byId(d.nodes, 'n-74-37ave').grid = [1, 0.5]), /seg-37ave-73-74": east-west street but its ends have different y/);
  expectError((d) => (byId(d.segments, 'seg-37ave-73-74').use = 'highway'), /use must be one of/);
});

test('a segment belongs to at most one zone, and every zone is reachable', () => {
  expectError((d) => byId(d.zones, 'ave-37').segments.push('seg-roosevelt-73-74'), /segment "seg-roosevelt-73-74" is in two zones/);
  expectError((d) => (d.connections = d.connections.filter((c) => !c.zones.includes('ave-37'))), /zone "ave-37" can't be reached/);
});

test('connections need two zones that both touch the node', () => {
  expectError((d) => (byId(d.connections, 'conn-plaza-37ave-74').at = 'n-75-roosevelt'), /node "n-75-roosevelt" is not on a segment of zone "diversity-plaza-74th"/);
  expectError((d) => (byId(d.connections, 'conn-plaza-37ave-74').zones = ['ave-37', 'ave-37']), /connects a zone to itself/);
});

test('anchors: zone, segment, side, position, uses, one dispatcher', () => {
  expectError((d) => (byId(d.anchors, 'rav-north-1').segment = 'seg-37ave-73-74'), /segment "seg-37ave-73-74" is not in zone "roosevelt-ave"/);
  expectError((d) => (byId(d.anchors, 'rav-north-1').side = 'east'), /side must be one of north, south/);
  expectError((d) => (byId(d.anchors, 'rav-north-1').t = 1), /t must be a number between 0 and 1/);
  expectError((d) => (byId(d.anchors, 'rav-north-1').uses = ['steal']), /uses must list/);
  expectError((d) => byId(d.anchors, 'rav-north-1').uses.push('dispatcher'), /exactly one anchor must have use "dispatcher" \(found 2\)/);
});

test('landmarks must be marked fictional and sit in the anchor\'s zone', () => {
  expectError((d) => (byId(d.landmarks, 'lm-shop-a').fictional = false), /landmark "lm-shop-a": must have "fictional": true/);
  expectError((d) => (byId(d.anchors, 'rav-north-1').landmark = 'lm-shop-b'), /landmark "lm-shop-b" is in another zone/);
});

test('reports unowned segments and unconnected shared nodes as warnings, not errors', () => {
  const { errors, warnings, unverified } = validateWorld(real);
  assert.equal(errors.length, 0);
  assert.ok(warnings.includes('segment "seg-37rd-74-75" is in no zone'));
  assert.ok(warnings.some((w) => w.includes('share node "n-73-bway"')));
  assert.ok(unverified.length > 0, 'nothing has been checked against LION yet, so every fact is unverified');
});

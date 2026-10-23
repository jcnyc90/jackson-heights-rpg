// Validates the world dataset (src/data/world/*.json). See DESIGN.md 2.14.
// Usage: node scripts/validate-world.mjs [file]   (default: src/data/world/jackson-heights.json)
// Exit code 1 on any error. Warnings and the unverified-facts list never fail the run.
// No dependencies; validateWorld() is exported for tests/world/validate-world.test.mjs.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ORIENTATIONS = ['ns', 'ew', 'diagonal'];
const USES = ['road', 'plaza'];
const CONFIDENCE = ['high', 'medium', 'low'];
const ACCESS = ['read', 'search-summary', 'not-downloaded', 'general-knowledge'];
const ANCHOR_USES = ['pickup', 'dropoff', 'dispatcher'];
const SIDES = { ns: ['east', 'west'], ew: ['north', 'south'], diagonal: ['north', 'south'] };

/**
 * Checks one parsed dataset. Returns { errors, warnings, unverified } as string arrays;
 * the dataset is valid when errors is empty. Every problem is collected, not just the first.
 */
export function validateWorld(data) {
  const errors = [];
  const warnings = [];
  const unverified = [];
  const err = (m) => errors.push(m);

  if (data === null || typeof data !== 'object' || Array.isArray(data)) return { errors: ['dataset must be a JSON object'], warnings, unverified };
  if (data.schemaVersion !== 1) err(`schemaVersion must be 1 (got ${JSON.stringify(data.schemaVersion)})`);
  if (typeof data.id !== 'string' || !ID.test(data.id)) err('id must be a kebab-case string');

  // Each collection: an array of objects with unique kebab-case ids. Returns id -> entry.
  const collect = (name, required = true) => {
    const list = data[name];
    const byId = new Map();
    if (list === undefined && !required) return byId;
    if (!Array.isArray(list)) {
      err(`${name}: must be an array`);
      return byId;
    }
    list.forEach((e, i) => {
      if (e === null || typeof e !== 'object') return err(`${name}[${i}]: must be an object`);
      if (typeof e.id !== 'string' || !ID.test(e.id)) return err(`${name}[${i}]: id must be a kebab-case string`);
      if (byId.has(e.id)) return err(`${name}: duplicate id "${e.id}"`);
      byId.set(e.id, e);
    });
    return byId;
  };
  const sources = collect('sources');
  const streets = collect('streets');
  const nodes = collect('nodes');
  const segments = collect('segments');
  const transit = collect('transit', false);
  const zones = collect('zones');
  const connections = collect('connections');
  const anchors = collect('anchors');
  const landmarks = collect('landmarks', false);

  for (const s of sources.values()) {
    if (typeof s.title !== 'string' || s.title === '') err(`source "${s.id}": needs a title`);
    if (!ACCESS.includes(s.access)) err(`source "${s.id}": access must be one of ${ACCESS.join(', ')}`);
    if (s.access !== 'general-knowledge' && !/^https:\/\//.test(s.url ?? '')) err(`source "${s.id}": needs an https url`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.accessed ?? '')) err(`source "${s.id}": accessed must be YYYY-MM-DD`);
    if (s.role !== undefined && s.role !== 'licence') err(`source "${s.id}": role, if set, must be "licence"`);
  }

  // A fact needs at least one known source and a confidence. Anything not "high", or backed
  // only by sources nobody has read in full, goes on the unverified list.
  const cited = new Set();
  const checkFact = (kind, f) => {
    if (!Array.isArray(f.sources) || f.sources.length === 0) return err(`${kind} "${f.id}": needs at least one source`);
    for (const sid of f.sources) {
      if (!sources.has(sid)) err(`${kind} "${f.id}": unknown source "${sid}"`);
      cited.add(sid);
    }
    if (!CONFIDENCE.includes(f.confidence)) return err(`${kind} "${f.id}": confidence must be one of ${CONFIDENCE.join(', ')}`);
    const readInFull = f.sources.some((sid) => sources.get(sid)?.access === 'read');
    if (f.confidence !== 'high' || !readInFull) unverified.push(`${kind} "${f.id}" (${f.confidence}${readInFull ? '' : ', no source read in full'})`);
  };

  for (const s of streets.values()) {
    if (typeof s.name !== 'string' || s.name === '') err(`street "${s.id}": needs a name`);
    if (!ORIENTATIONS.includes(s.orientation)) err(`street "${s.id}": orientation must be one of ${ORIENTATIONS.join(', ')}`);
    checkFact('street', s);
  }

  const b = data.bounds ?? {};
  for (const key of ['streets', 'avenues']) {
    if (!Array.isArray(b[key])) err(`bounds.${key}: must be an array`);
    else for (const sid of b[key]) if (!streets.has(sid)) err(`bounds.${key}: unknown street "${sid}"`);
  }

  for (const n of nodes.values()) {
    if (!Array.isArray(n.streets) || n.streets.length < 2) err(`node "${n.id}": needs at least two streets`);
    else for (const sid of n.streets) if (!streets.has(sid)) err(`node "${n.id}": unknown street "${sid}"`);
    if (!Array.isArray(n.grid) || n.grid.length !== 2 || !n.grid.every(Number.isFinite)) err(`node "${n.id}": grid must be [x, y] numbers`);
  }

  for (const s of segments.values()) {
    const street = streets.get(s.street);
    if (!street) err(`segment "${s.id}": unknown street "${s.street}"`);
    const ends = [s.from, s.to].map((nid) => {
      const n = nodes.get(nid);
      if (!n) err(`segment "${s.id}": unknown node "${nid}"`);
      else if (street && Array.isArray(n.streets) && !n.streets.includes(street.id)) err(`segment "${s.id}": node "${nid}" is not on ${street.id}`);
      return n;
    });
    if (s.from === s.to) err(`segment "${s.id}": from and to are the same node`);
    if (!USES.includes(s.use)) err(`segment "${s.id}": use must be one of ${USES.join(', ')}`);
    if (s.overhead !== undefined && !transit.has(s.overhead)) err(`segment "${s.id}": overhead names unknown transit "${s.overhead}"`);
    const [a, z] = ends;
    if (street && a?.grid && z?.grid) {
      if (street.orientation === 'ns' && a.grid[0] !== z.grid[0]) err(`segment "${s.id}": north-south street but its ends have different x`);
      if (street.orientation === 'ew' && a.grid[1] !== z.grid[1]) err(`segment "${s.id}": east-west street but its ends have different y`);
    }
    checkFact('segment', s);
  }

  for (const tr of transit.values()) {
    for (const sid of tr.segments ?? []) if (!segments.has(sid)) err(`transit "${tr.id}": unknown segment "${sid}"`);
    for (const nid of tr.entrances ?? []) if (!nodes.has(nid)) err(`transit "${tr.id}": unknown entrance node "${nid}"`);
    checkFact('transit', tr);
  }

  // Zones own segments; a segment belongs to at most one zone. Unowned segments are allowed
  // (in the data, not in any map yet) and reported.
  const owner = new Map();
  const zoneNodes = new Map();
  for (const z of zones.values()) {
    if (typeof z.name !== 'string' || z.name === '') err(`zone "${z.id}": needs a name`);
    if (!Array.isArray(z.segments) || z.segments.length === 0) {
      err(`zone "${z.id}": needs at least one segment`);
      continue;
    }
    const ns = new Set();
    for (const sid of z.segments) {
      const s = segments.get(sid);
      if (!s) {
        err(`zone "${z.id}": unknown segment "${sid}"`);
        continue;
      }
      if (owner.has(sid)) err(`segment "${sid}" is in two zones ("${owner.get(sid)}", "${z.id}")`);
      owner.set(sid, z.id);
      ns.add(s.from).add(s.to);
    }
    zoneNodes.set(z.id, ns);
  }
  for (const sid of segments.keys()) if (!owner.has(sid)) warnings.push(`segment "${sid}" is in no zone`);

  const linked = new Map([...zones.keys()].map((id) => [id, new Set()]));
  const connectedAt = new Set();
  for (const c of connections.values()) {
    if (!Array.isArray(c.zones) || c.zones.length !== 2) {
      err(`connection "${c.id}": zones must name exactly two zones`);
      continue;
    }
    const [za, zb] = c.zones;
    if (za === zb) err(`connection "${c.id}": connects a zone to itself`);
    if (!nodes.has(c.at)) err(`connection "${c.id}": unknown node "${c.at}"`);
    for (const zid of c.zones) {
      if (!zones.has(zid)) err(`connection "${c.id}": unknown zone "${zid}"`);
      else if (!zoneNodes.get(zid)?.has(c.at)) err(`connection "${c.id}": node "${c.at}" is not on a segment of zone "${zid}"`);
    }
    if (zones.has(za) && zones.has(zb)) {
      linked.get(za).add(zb);
      linked.get(zb).add(za);
      connectedAt.add(`${[za, zb].sort().join('|')}@${c.at}`);
    }
  }
  // Two zones sharing a node with no connection there: the generator will have to wall it off.
  const zoneIds = [...zoneNodes.keys()];
  for (let i = 0; i < zoneIds.length; i++) {
    for (let j = i + 1; j < zoneIds.length; j++) {
      for (const nid of zoneNodes.get(zoneIds[i])) {
        const key = `${[zoneIds[i], zoneIds[j]].sort().join('|')}@${nid}`;
        if (zoneNodes.get(zoneIds[j]).has(nid) && !connectedAt.has(key)) warnings.push(`zones "${zoneIds[i]}" and "${zoneIds[j]}" share node "${nid}" with no connection there`);
      }
    }
  }
  if (zones.size > 0) {
    const seen = new Set([zones.keys().next().value]);
    const queue = [...seen];
    while (queue.length) for (const next of linked.get(queue.shift()) ?? []) if (!seen.has(next)) seen.add(next) && queue.push(next);
    for (const zid of zones.keys()) if (!seen.has(zid)) err(`zone "${zid}" can't be reached from the others`);
  }

  for (const lm of landmarks.values()) {
    if (lm.fictional !== true) err(`landmark "${lm.id}": must have "fictional": true (real businesses stay out; DESIGN.md 1, #5)`);
    if (!zones.has(lm.zone)) err(`landmark "${lm.id}": unknown zone "${lm.zone}"`);
    if (typeof lm.placeholder !== 'string' || lm.placeholder === '') err(`landmark "${lm.id}": needs a placeholder label`);
  }

  // Anchor ids become deliveryPoint pointIds, so they're unique across the whole dataset.
  const usedLandmarks = new Set();
  let dispatchers = 0;
  for (const a of anchors.values()) {
    if (!zones.has(a.zone)) err(`anchor "${a.id}": unknown zone "${a.zone}"`);
    const s = segments.get(a.segment);
    if (!s) err(`anchor "${a.id}": unknown segment "${a.segment}"`);
    else if (owner.get(a.segment) !== a.zone) err(`anchor "${a.id}": segment "${a.segment}" is not in zone "${a.zone}"`);
    const orientation = streets.get(s?.street)?.orientation;
    if (orientation && !SIDES[orientation].includes(a.side)) err(`anchor "${a.id}": side must be one of ${SIDES[orientation].join(', ')} on this street`);
    if (typeof a.t !== 'number' || !(a.t > 0 && a.t < 1)) err(`anchor "${a.id}": t must be a number between 0 and 1 (exclusive)`);
    if (!Array.isArray(a.uses) || a.uses.length === 0 || !a.uses.every((u) => ANCHOR_USES.includes(u))) err(`anchor "${a.id}": uses must list ${ANCHOR_USES.join(', ')}`);
    else if (a.uses.includes('dispatcher')) dispatchers++;
    if (a.landmark !== undefined) {
      const lm = landmarks.get(a.landmark);
      if (!lm) err(`anchor "${a.id}": unknown landmark "${a.landmark}"`);
      else if (lm.zone !== a.zone) err(`anchor "${a.id}": landmark "${a.landmark}" is in another zone`);
      usedLandmarks.add(a.landmark);
    }
  }
  if (dispatchers !== 1) err(`exactly one anchor must have use "dispatcher" (found ${dispatchers})`);
  for (const z of zones.values()) {
    const n = [...anchors.values()].filter((a) => a.zone === z.id && a.uses?.some((u) => u === 'pickup' || u === 'dropoff')).length;
    if (n === 0) warnings.push(`zone "${z.id}" has no pickup or dropoff anchor`);
  }
  for (const lid of landmarks.keys()) if (!usedLandmarks.has(lid)) warnings.push(`landmark "${lid}" is at no anchor`);
  for (const sid of sources.keys()) if (!cited.has(sid) && sources.get(sid).role !== 'licence') warnings.push(`source "${sid}" is cited by no fact`);

  return { errors, warnings, unverified };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] ?? 'src/data/world/jackson-heights.json';
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`[world] ${file}: ${e.message}`);
    process.exit(1);
  }
  const { errors, warnings, unverified } = validateWorld(data);
  const count = (k) => (Array.isArray(data[k]) ? data[k].length : 0);
  console.log(`[world] ${file}: ${count('zones')} zones, ${count('segments')} segments, ${count('nodes')} nodes, ${count('connections')} connections, ${count('anchors')} anchors, ${count('sources')} sources`);
  for (const w of warnings) console.log(`[world] warning: ${w}`);
  console.log(`[world] unverified facts: ${unverified.length}`);
  for (const u of unverified) console.log(`[world]   ${u}`);
  for (const e of errors) console.error(`[world] ERROR: ${e}`);
  console.log(errors.length ? `[world] FAIL (${errors.length} errors)` : '[world] OK');
  process.exit(errors.length ? 1 : 0);
}

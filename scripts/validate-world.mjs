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
const STATUS = ['verified', 'corrected', 'unverified'];
const ACCESS = ['read', 'search-summary', 'not-downloaded', 'general-knowledge'];
const TRANSIT_KINDS = ['elevated-line', 'station'];
const AREA_KINDS = ['historic-district', 'pedestrian-plaza', 'park', 'event-route'];
const CONNECTION_KINDS = ['open', 'wall'];
const MAP_STATUS = ['proposed', 'built'];
const ANCHOR_USES = ['pickup', 'dropoff', 'dispatcher'];
const SIDES = { ns: ['east', 'west'], ew: ['north', 'south'], diagonal: ['north', 'south'] };
// Longest side of one map, in 16x16 tiles (DESIGN.md 2.14, map split plan).
export const MAX_MAP_SIDE = 96;

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
  if (data.schemaVersion !== 2) err(`schemaVersion must be 2 (got ${JSON.stringify(data.schemaVersion)})`);
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
  const areas = collect('areas', false);
  const zones = collect('zones');
  const connections = collect('connections');
  const maps = collect('maps', false);
  const mapConnections = collect('mapConnections', false);
  const anchors = collect('anchors');
  const landmarks = collect('landmarks', false);

  for (const s of sources.values()) {
    if (typeof s.title !== 'string' || s.title === '') err(`source "${s.id}": needs a title`);
    if (!ACCESS.includes(s.access)) err(`source "${s.id}": access must be one of ${ACCESS.join(', ')}`);
    if (s.access !== 'general-knowledge' && !/^https:\/\//.test(s.url ?? '')) err(`source "${s.id}": needs an https url`);
    if (s.download !== undefined && !/^https:\/\//.test(s.download)) err(`source "${s.id}": download must be an https url`);
    if (s.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(s.sha256)) err(`source "${s.id}": sha256 must be 64 lowercase hex digits`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.accessed ?? '')) err(`source "${s.id}": accessed must be YYYY-MM-DD`);
    if (s.role !== undefined && s.role !== 'licence') err(`source "${s.id}": role, if set, must be "licence"`);
  }

  // A fact needs at least one known source, a confidence and a status. "verified" and "corrected"
  // need a source read in full. Anything unverified or below "high" goes on the unverified list.
  const cited = new Set();
  const checkFact = (kind, f) => {
    if (!Array.isArray(f.sources) || f.sources.length === 0) return err(`${kind} "${f.id}": needs at least one source`);
    for (const sid of f.sources) {
      if (!sources.has(sid)) err(`${kind} "${f.id}": unknown source "${sid}"`);
      cited.add(sid);
    }
    if (!CONFIDENCE.includes(f.confidence)) return err(`${kind} "${f.id}": confidence must be one of ${CONFIDENCE.join(', ')}`);
    if (!STATUS.includes(f.status)) return err(`${kind} "${f.id}": status must be one of ${STATUS.join(', ')}`);
    const readInFull = f.sources.some((sid) => sources.get(sid)?.access === 'read');
    if (f.status !== 'unverified' && !readInFull) err(`${kind} "${f.id}": status "${f.status}" needs a source with access "read"`);
    if (f.status === 'unverified' || f.confidence !== 'high') unverified.push(`${kind} "${f.id}" (${f.status}, ${f.confidence})`);
  };

  for (const s of streets.values()) {
    if (typeof s.name !== 'string' || s.name === '') err(`street "${s.id}": needs a name`);
    if (!ORIENTATIONS.includes(s.orientation)) err(`street "${s.id}": orientation must be one of ${ORIENTATIONS.join(', ')}`);
    if (s.stub !== undefined && s.stub !== true) err(`street "${s.id}": stub, if set, must be true`);
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
    if (n.lion !== undefined && !/^\d{7}$/.test(n.lion)) err(`node "${n.id}": lion must be a 7-digit LION node id`);
  }

  const streetsWithSegments = new Set();
  for (const s of segments.values()) {
    const street = streets.get(s.street);
    if (!street) err(`segment "${s.id}": unknown street "${s.street}"`);
    else streetsWithSegments.add(street.id);
    const ends = [s.from, s.to].map((nid) => {
      const n = nodes.get(nid);
      if (!n) err(`segment "${s.id}": unknown node "${nid}"`);
      else if (street && Array.isArray(n.streets) && !n.streets.includes(street.id)) err(`segment "${s.id}": node "${nid}" is not on ${street.id}`);
      return n;
    });
    if (s.from === s.to) err(`segment "${s.id}": from and to are the same node`);
    if (!USES.includes(s.use)) err(`segment "${s.id}": use must be one of ${USES.join(', ')}`);
    if (s.overhead !== undefined && !transit.has(s.overhead)) err(`segment "${s.id}": overhead names unknown transit "${s.overhead}"`);
    if (s.lion !== undefined && (!Array.isArray(s.lion) || s.lion.length === 0 || !s.lion.every((x) => /^\d{7}$/.test(x)))) err(`segment "${s.id}": lion must list 7-digit LION segment ids`);
    if (s.unmapped !== undefined && (typeof s.unmapped !== 'string' || s.unmapped === '')) err(`segment "${s.id}": unmapped, if set, must give a reason`);
    const [a, z] = ends;
    if (street && a?.grid && z?.grid) {
      if (street.orientation === 'ns' && a.grid[0] !== z.grid[0]) err(`segment "${s.id}": north-south street but its ends have different x`);
      if (street.orientation === 'ew' && a.grid[1] !== z.grid[1]) err(`segment "${s.id}": east-west street but its ends have different y`);
    }
    checkFact('segment', s);
  }
  // A stub street only has its mouth in the bounds; every other street needs a segment.
  for (const s of streets.values()) {
    if (s.stub && streetsWithSegments.has(s.id)) err(`street "${s.id}": is a stub but has segments`);
    if (!s.stub && !streetsWithSegments.has(s.id)) err(`street "${s.id}": has no segments (mark it "stub": true if only its mouth is in the bounds)`);
  }

  for (const tr of transit.values()) {
    if (!TRANSIT_KINDS.includes(tr.kind)) err(`transit "${tr.id}": kind must be one of ${TRANSIT_KINDS.join(', ')}`);
    for (const sid of tr.segments ?? []) if (!segments.has(sid)) err(`transit "${tr.id}": unknown segment "${sid}"`);
    for (const nid of tr.entrances ?? []) if (!nodes.has(nid)) err(`transit "${tr.id}": unknown entrance node "${nid}"`);
    if (tr.kind === 'station') {
      if (!Array.isArray(tr.entrances) || tr.entrances.length === 0) err(`transit "${tr.id}": a station needs at least one entrance`);
      if (!segments.has(tr.at)) err(`transit "${tr.id}": at must name the segment the station is over`);
    }
    checkFact('transit', tr);
  }

  for (const ar of areas.values()) {
    if (typeof ar.name !== 'string' || ar.name === '') err(`area "${ar.id}": needs a name`);
    if (!AREA_KINDS.includes(ar.kind)) err(`area "${ar.id}": kind must be one of ${AREA_KINDS.join(', ')}`);
    if (!Array.isArray(ar.segments) || ar.segments.length === 0) err(`area "${ar.id}": needs at least one segment`);
    else for (const sid of ar.segments) if (!segments.has(sid)) err(`area "${ar.id}": unknown segment "${sid}"`);
    checkFact('area', ar);
  }

  // Zones own segments; a segment belongs to at most one zone. A segment in no zone must say why
  // ("unmapped"); one without a reason is reported.
  const owner = new Map();
  const nodesOf = (segIds) => new Set(segIds.flatMap((sid) => (segments.has(sid) ? [segments.get(sid).from, segments.get(sid).to] : [])));
  const zoneNodes = new Map();
  for (const z of zones.values()) {
    if (typeof z.name !== 'string' || z.name === '') err(`zone "${z.id}": needs a name`);
    if (!Array.isArray(z.segments) || z.segments.length === 0) {
      err(`zone "${z.id}": needs at least one segment`);
      continue;
    }
    for (const sid of z.segments) {
      const s = segments.get(sid);
      if (!s) {
        err(`zone "${z.id}": unknown segment "${sid}"`);
        continue;
      }
      if (owner.has(sid)) err(`segment "${sid}" is in two zones ("${owner.get(sid)}", "${z.id}")`);
      if (s.unmapped !== undefined) err(`segment "${sid}" is in zone "${z.id}" but marked unmapped`);
      owner.set(sid, z.id);
    }
    zoneNodes.set(z.id, nodesOf(z.segments));
  }
  for (const s of segments.values()) if (!owner.has(s.id) && s.unmapped === undefined) warnings.push(`segment "${s.id}" is in no zone and gives no "unmapped" reason`);

  // Connections: "open" is a way through (a warp pair in 6c), "wall" means the generator blocks it.
  // Only open connections count for reachability. Every node two zones share needs one or the other.
  const linked = new Map([...zones.keys()].map((id) => [id, new Set()]));
  const decided = new Set();
  for (const c of connections.values()) {
    if (!CONNECTION_KINDS.includes(c.kind)) err(`connection "${c.id}": kind must be one of ${CONNECTION_KINDS.join(', ')}`);
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
    const key = `${[za, zb].sort().join('|')}@${c.at}`;
    if (decided.has(key)) err(`connection "${c.id}": a second connection between the same zones at "${c.at}"`);
    decided.add(key);
    if (c.kind === 'open' && zones.has(za) && zones.has(zb)) {
      linked.get(za).add(zb);
      linked.get(zb).add(za);
    }
  }
  const zoneIds = [...zoneNodes.keys()];
  for (let i = 0; i < zoneIds.length; i++) {
    for (let j = i + 1; j < zoneIds.length; j++) {
      for (const nid of zoneNodes.get(zoneIds[i])) {
        const key = `${[zoneIds[i], zoneIds[j]].sort().join('|')}@${nid}`;
        if (zoneNodes.get(zoneIds[j]).has(nid) && !decided.has(key)) warnings.push(`zones "${zoneIds[i]}" and "${zoneIds[j]}" share node "${nid}" with no connection (open or wall) there`);
      }
    }
  }
  const unreachable = (ids, links) => {
    if (ids.length === 0) return [];
    const seen = new Set([ids[0]]);
    const queue = [ids[0]];
    while (queue.length) for (const next of links.get(queue.shift()) ?? []) if (!seen.has(next)) seen.add(next) && queue.push(next);
    return ids.filter((id) => !seen.has(id));
  };
  for (const zid of unreachable([...zones.keys()], linked)) err(`zone "${zid}" can't be reached from the others through open connections`);

  // Map split plan: each zone's segments go to exactly one of its maps; maps of one zone that share
  // a node are joined by a map connection there, and all of a zone's maps are reachable.
  if (maps.size > 0) {
    const mapOf = new Map();
    const mapNodes = new Map();
    for (const m of maps.values()) {
      const z = zones.get(m.zone);
      if (!z) err(`map "${m.id}": unknown zone "${m.zone}"`);
      if (!MAP_STATUS.includes(m.status)) err(`map "${m.id}": status must be one of ${MAP_STATUS.join(', ')}`);
      if (!Array.isArray(m.tiles) || m.tiles.length !== 2 || !m.tiles.every((n) => Number.isInteger(n) && n > 0)) err(`map "${m.id}": tiles must be [width, height] positive integers`);
      else if (Math.max(...m.tiles) > MAX_MAP_SIDE) err(`map "${m.id}": ${m.tiles.join('x')} tiles is longer than ${MAX_MAP_SIDE} on a side; split it`);
      if (!Array.isArray(m.segments) || m.segments.length === 0) {
        err(`map "${m.id}": needs at least one segment`);
        continue;
      }
      for (const sid of m.segments) {
        if (!segments.has(sid)) err(`map "${m.id}": unknown segment "${sid}"`);
        else if (z && owner.get(sid) !== z.id) err(`map "${m.id}": segment "${sid}" is not in zone "${m.zone}"`);
        if (mapOf.has(sid)) err(`segment "${sid}" is in two maps ("${mapOf.get(sid)}", "${m.id}")`);
        mapOf.set(sid, m.id);
      }
      mapNodes.set(m.id, nodesOf(m.segments));
    }
    for (const [sid, zid] of owner) if (!mapOf.has(sid)) err(`segment "${sid}" (zone "${zid}") is in none of the zone's maps`);
    const mapLinks = new Map([...maps.keys()].map((id) => [id, new Set()]));
    const seams = new Set();
    for (const mc of mapConnections.values()) {
      if (!Array.isArray(mc.maps) || mc.maps.length !== 2 || mc.maps[0] === mc.maps[1]) {
        err(`map connection "${mc.id}": maps must name two different maps`);
        continue;
      }
      const [ma, mb] = mc.maps.map((id) => maps.get(id));
      if (!ma || !mb) {
        err(`map connection "${mc.id}": unknown map`);
        continue;
      }
      if (ma.zone !== mb.zone) err(`map connection "${mc.id}": maps are in different zones (use a zone connection)`);
      if (!Array.isArray(mc.at) || mc.at.length === 0) err(`map connection "${mc.id}": at must list the shared nodes`);
      for (const nid of mc.at ?? []) {
        if (!mapNodes.get(ma.id)?.has(nid) || !mapNodes.get(mb.id)?.has(nid)) err(`map connection "${mc.id}": node "${nid}" is not on both maps`);
        seams.add(`${[ma.id, mb.id].sort().join('|')}@${nid}`);
      }
      mapLinks.get(ma.id).add(mb.id);
      mapLinks.get(mb.id).add(ma.id);
    }
    const byZone = new Map();
    for (const m of maps.values()) byZone.set(m.zone, [...(byZone.get(m.zone) ?? []), m.id]);
    for (const ids of byZone.values()) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          for (const nid of mapNodes.get(ids[i]) ?? []) {
            if (mapNodes.get(ids[j])?.has(nid) && !seams.has(`${[ids[i], ids[j]].sort().join('|')}@${nid}`)) err(`maps "${ids[i]}" and "${ids[j]}" share node "${nid}" but no map connection lists it`);
          }
        }
      }
      for (const mid of unreachable(ids, mapLinks)) err(`map "${mid}" can't be reached from the other maps of its zone`);
    }
    for (const zid of zones.keys()) if (!byZone.has(zid)) err(`zone "${zid}" has no maps`);
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
      else if (usedLandmarks.has(a.landmark)) err(`anchor "${a.id}": landmark "${a.landmark}" is already at another anchor`);
      usedLandmarks.add(a.landmark);
    }
  }
  if (dispatchers !== 1) err(`exactly one anchor must have use "dispatcher" (found ${dispatchers})`);
  const delivers = (a) => a.uses?.some((u) => u === 'pickup' || u === 'dropoff');
  for (const z of zones.values()) if (![...anchors.values()].some((a) => a.zone === z.id && delivers(a))) warnings.push(`zone "${z.id}" has no pickup or dropoff anchor`);
  for (const m of maps.values()) {
    const segs = new Set(m.segments ?? []);
    if (![...anchors.values()].some((a) => segs.has(a.segment) && delivers(a))) warnings.push(`map "${m.id}" has no pickup or dropoff anchor`);
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
  const stations = Array.isArray(data.transit) ? data.transit.filter((t) => t.kind === 'station').length : 0;
  console.log(`[world] ${file}: ${count('zones')} zones, ${count('maps')} maps, ${count('streets')} streets, ${count('nodes')} nodes, ${count('segments')} segments, ${stations} stations, ${count('areas')} areas, ${count('connections')} connections, ${count('anchors')} anchors, ${count('landmarks')} landmarks, ${count('sources')} sources`);
  for (const w of warnings) console.log(`[world] warning: ${w}`);
  console.log(`[world] facts not both verified and high confidence: ${unverified.length}`);
  for (const u of unverified) console.log(`[world]   ${u}`);
  for (const e of errors) console.error(`[world] ERROR: ${e}`);
  console.log(errors.length ? `[world] FAIL (${errors.length} errors)` : '[world] OK');
  process.exit(errors.length ? 1 : 0);
}

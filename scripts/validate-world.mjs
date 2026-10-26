// Validates the world dataset (src/data/world/*.json). See DESIGN.md 2.14.
// Usage: node scripts/validate-world.mjs [file]   (default: src/data/world/jackson-heights.json)
// Exit code 1 on any error. Warnings and the unverified-facts list never fail the run.
// No dependencies; validateWorld() is exported for tests/world/validate-world.test.mjs.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { layoutProblems, mapBoxes } from './world-layout.mjs';

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ORIENTATIONS = ['ns', 'ew', 'diagonal'];
const USES = ['road', 'plaza'];
const CONFIDENCE = ['high', 'medium', 'low'];
const STATUS = ['verified', 'corrected', 'unverified'];
const ACCESS = ['read', 'search-summary', 'not-downloaded', 'general-knowledge'];
const TRANSIT_KINDS = ['elevated-line', 'station'];
const AREA_KINDS = ['historic-district', 'pedestrian-plaza', 'park', 'event-route'];
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const MAP_STATUS = ['proposed', 'built'];
const ANCHOR_USES = ['pickup', 'dropoff', 'dispatcher'];
const SIDES = { ns: ['east', 'west'], ew: ['north', 'south'], diagonal: ['north', 'south'] };
// What a block face shows (schema 5, session 6e; owner's decision 11), from PLUTO land use.
export const LAND_USES = ['commercial', 'walkup', 'garden-coop', 'house', 'park', 'parking', 'civic'];
// The walkable area's size, as walking time at walking speed (owner's stop conditions in session 6e:
// a full east-west walk at most 60 s, a full north-south walk at most 45 s, at 150 px/s). Replaces
// 6d's 256-tiles-a-side cap, which was about bundling one Phaser tilemap of the whole map: since 6e
// the map is an external file drawn through a small window (src/systems/worldView.ts).
export const WALK_LIMITS = { pxPerSecond: 150, eastWestSeconds: 60, northSouthSeconds: 45, tile: 16 };

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
  if (data.schemaVersion !== 6) err(`schemaVersion must be 6 (got ${JSON.stringify(data.schemaVersion)})`);
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
  const maps = collect('maps');
  // 6c's warp pairs and walls: gone with the split (one continuous map since 6d).
  for (const old of ['connections', 'mapConnections']) if (old in data) err(`${old}: retired in schema 4 (one continuous map, no warps or walls)`);
  const anchors = collect('anchors');
  const landmarks = collect('landmarks', false);
  const businesses = collect('businesses', false);

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

  // Layout (schema 3, reshaped in 4): how grid positions become tiles. Every node must fall inside rowsY.
  const layoutErrors = layoutProblems(data.layout);
  for (const e of layoutErrors) err(e);
  const layoutOk = layoutErrors.length === 0;
  if (layoutOk) for (const sid of Object.keys(data.layout.halfWidth)) if (sid !== 'default' && !streets.has(sid)) err(`layout.halfWidth: unknown street "${sid}"`);

  for (const n of nodes.values()) {
    if (!Array.isArray(n.streets) || n.streets.length < 2) err(`node "${n.id}": needs at least two streets`);
    else for (const sid of n.streets) if (!streets.has(sid)) err(`node "${n.id}": unknown street "${sid}"`);
    if (!Array.isArray(n.grid) || n.grid.length !== 2 || !n.grid.every(Number.isFinite)) err(`node "${n.id}": grid must be [x, y] numbers`);
    if (n.lion !== undefined && !/^\d{7}$/.test(n.lion)) err(`node "${n.id}": lion must be a 7-digit LION node id`);
    if (layoutOk && Array.isArray(n.grid)) {
      const rows = data.layout.rowsY;
      if (!(n.grid[1] >= rows[0][0] && n.grid[1] <= rows.at(-1)[0])) err(`node "${n.id}": grid y ${n.grid[1]} is outside layout.rowsY`);
    }
    // Streets that run on past the bounds (drawn to the map edge), each with the first LION segment beyond.
    if (n.continues !== undefined) {
      if (!Array.isArray(n.continues) || n.continues.length === 0) err(`node "${n.id}": continues, if set, must be a non-empty array`);
      else n.continues.forEach((c, i) => {
        const where = `node "${n.id}": continues[${i}]`;
        if (!COMPASS.includes(c?.dir)) err(`${where}: dir must be one of ${COMPASS.join(', ')}`);
        if (!Array.isArray(n.streets) || !n.streets.includes(c?.street)) err(`${where}: street must be one of the node's streets`);
        if (!/^\d{7}$/.test(c?.lion ?? '')) err(`${where}: lion must be the 7-digit LION id of the first segment beyond the bounds`);
      });
    }
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
    if (s.unmapped !== undefined) err(`segment "${s.id}": unmapped is retired in schema 4 (every segment is on the one map)`);
    const [a, z] = ends;
    if (street && a?.grid && z?.grid) {
      if (street.orientation === 'ns' && a.grid[0] !== z.grid[0]) err(`segment "${s.id}": north-south street but its ends have different x`);
      if (street.orientation === 'ew' && a.grid[1] !== z.grid[1]) err(`segment "${s.id}": east-west street but its ends have different y`);
    }
    checkFact('segment', s);
  }
  const segmentLion = new Set([...segments.values()].flatMap((s) => (Array.isArray(s.lion) ? s.lion : [])));
  for (const n of nodes.values()) for (const c of Array.isArray(n.continues) ? n.continues : []) if (segmentLion.has(c?.lion)) err(`node "${n.id}": continues names LION segment ${c.lion}, which is inside the bounds (a segment's)`);
  // The street graph is one piece: every node is reachable from every other along segments.
  const graph = new Map([...nodes.keys()].map((id) => [id, new Set()]));
  for (const s of segments.values()) if (graph.has(s.from) && graph.has(s.to)) graph.get(s.from).add(s.to) && graph.get(s.to).add(s.from);
  const firstNode = [...graph.keys()][0];
  if (firstNode) {
    const seen = new Set([firstNode]);
    const queue = [firstNode];
    while (queue.length) for (const next of graph.get(queue.shift())) if (!seen.has(next)) seen.add(next) && queue.push(next);
    for (const id of graph.keys()) if (!seen.has(id)) err(`node "${id}": not connected to the rest of the street grid`);
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

  // Zones are named areas of the one map (name card, HUD); a segment is in at most one zone,
  // and segments in no zone are drawn the same, just without a name.
  const owner = new Map();
  for (const z of zones.values()) {
    if (typeof z.name !== 'string' || z.name === '') err(`zone "${z.id}": needs a name`);
    if (!Array.isArray(z.segments) || z.segments.length === 0) {
      err(`zone "${z.id}": needs at least one segment`);
      continue;
    }
    for (const sid of z.segments) {
      if (!segments.has(sid)) {
        err(`zone "${z.id}": unknown segment "${sid}"`);
        continue;
      }
      if (owner.has(sid)) err(`segment "${sid}" is in two zones ("${owner.get(sid)}", "${z.id}")`);
      owner.set(sid, z.id);
    }
  }

  // One map (6d): every segment is on it, and its tile size follows from the layout: the node box
  // plus the edge and the view margin on each side (scripts/world-layout.mjs).
  if (maps.size !== 1) err(`maps: exactly one map since schema 4 (found ${maps.size})`);
  for (const m of maps.values()) {
    if (!MAP_STATUS.includes(m.status)) err(`map "${m.id}": status must be one of ${MAP_STATUS.join(', ')}`);
    for (const old of ['zone', 'segments']) if (old in m) err(`map "${m.id}": ${old} is retired in schema 4 (the map covers every segment)`);
    if (!Array.isArray(m.tiles) || m.tiles.length !== 2 || !m.tiles.every((n) => Number.isInteger(n) && n > 0)) err(`map "${m.id}": tiles must be [width, height] positive integers`);
    else {
      if (layoutOk && nodes.size > 0 && [...nodes.values()].every((n) => Array.isArray(n.grid))) {
        const { map: box, walk } = mapBoxes(data.layout, [...nodes.values()]);
        if (m.tiles[0] !== box.width || m.tiles[1] !== box.height) err(`map "${m.id}": tiles ${m.tiles.join('x')} don't match the layout (${box.width}x${box.height})`);
        const secs = (tiles) => (tiles * WALK_LIMITS.tile) / WALK_LIMITS.pxPerSecond;
        if (secs(walk.width) > WALK_LIMITS.eastWestSeconds) err(`map "${m.id}": the walkable area is ${walk.width} tiles wide, ${secs(walk.width).toFixed(1)} s to walk at ${WALK_LIMITS.pxPerSecond} px/s (limit ${WALK_LIMITS.eastWestSeconds} s)`);
        if (secs(walk.height) > WALK_LIMITS.northSouthSeconds) err(`map "${m.id}": the walkable area is ${walk.height} tiles tall, ${secs(walk.height).toFixed(1)} s to walk at ${WALK_LIMITS.pxPerSecond} px/s (limit ${WALK_LIMITS.northSouthSeconds} s)`);
      }
    }
  }

  for (const lm of landmarks.values()) {
    if (lm.fictional !== undefined && typeof lm.fictional !== 'boolean') err(`landmark "${lm.id}": fictional, if set, must be a boolean`);
    if (!zones.has(lm.zone)) err(`landmark "${lm.id}": unknown zone "${lm.zone}"`);
    const label = lm.name ?? lm.placeholder;
    if (typeof label !== 'string' || label === '') err(`landmark "${lm.id}": needs a name or placeholder label`);
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
  for (const lid of landmarks.keys()) if (!usedLandmarks.has(lid)) warnings.push(`landmark "${lid}" is at no anchor`);

  // ---- schema 5 (session 6e): land use per block face, parks, street trees, bike lanes, deviations ----
  const cite = (where, list) => {
    if (!Array.isArray(list) || list.length === 0) return err(`${where}: needs at least one source`);
    for (const sid of list) {
      if (!sources.has(sid)) err(`${where}: unknown source "${sid}"`);
      cited.add(sid);
    }
  };
  // Every segment has a face on each side, with one land-use class (PLUTO, or inferred from a neighbour).
  const faces = collect('blockFaces');
  const faceOf = new Set();
  for (const f of faces.values()) {
    const s = segments.get(f.segment);
    if (!s) err(`block face "${f.id}": unknown segment "${f.segment}"`);
    const orientation = streets.get(s?.street)?.orientation;
    if (orientation && !SIDES[orientation].includes(f.side)) err(`block face "${f.id}": side must be one of ${SIDES[orientation].join(', ')} on this street`);
    if (!LAND_USES.includes(f.landUse)) err(`block face "${f.id}": landUse must be one of ${LAND_USES.join(', ')}`);
    if (typeof f.basis !== 'string' || !/^(pluto|parks-outline|nearest:bf-[a-z0-9-]+)$/.test(f.basis)) err(`block face "${f.id}": basis must be "pluto", "parks-outline" or "nearest:<face id>"`);
    if (faceOf.has(`${f.segment}/${f.side}`)) err(`block face "${f.id}": a second face for ${f.segment} ${f.side}`);
    faceOf.add(`${f.segment}/${f.side}`);
  }
  for (const s of segments.values()) {
    const sides = SIDES[streets.get(s.street)?.orientation] ?? [];
    for (const side of sides) if (!faceOf.has(`${s.id}/${side}`)) err(`segment "${s.id}": no block face (land use) on its ${side} side`);
  }
  if (faces.size > 0) cited.add('dcp-pluto');
  const point = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
  for (const pk of collect('parks').values()) {
    if (typeof pk.name !== 'string' || pk.name === '') err(`park "${pk.id}": needs a name`);
    if (!Array.isArray(pk.outline) || pk.outline.length === 0 || !pk.outline.every((r) => Array.isArray(r) && r.length >= 3 && r.every(point))) err(`park "${pk.id}": outline must be rings of at least 3 [x, y] grid points`);
    cite(`park "${pk.id}"`, pk.sources);
  }
  const tr = data.trees;
  if (tr === null || typeof tr !== 'object' || Array.isArray(tr)) err('trees: must be an object');
  else {
    cite('trees', tr.sources);
    if (!Number.isInteger(tr.gapTiles) || tr.gapTiles < 1) err('trees.gapTiles: must be a positive integer');
    if (!Array.isArray(tr.tiles) || !tr.tiles.every((t) => Array.isArray(t) && t.length === 2 && t.every(Number.isInteger))) err('trees.tiles: must list [column, row] integer tile positions');
    else {
      const seen = new Set();
      for (const [x, y] of tr.tiles) {
        for (let dx = 1 - tr.gapTiles; dx < tr.gapTiles; dx++) for (let dy = 1 - tr.gapTiles; dy < tr.gapTiles; dy++) if (seen.has(`${x + dx},${y + dy}`)) err(`trees: [${x}, ${y}] is closer than ${tr.gapTiles} tiles to another tree`);
        seen.add(`${x},${y}`);
      }
    }
  }
  const bikes = Array.isArray(data.bikeLanes) ? data.bikeLanes : (err('bikeLanes: must be an array'), []);
  for (const bl of bikes) {
    const s = segments.get(bl?.segment);
    if (!s) err(`bikeLanes: unknown segment "${bl?.segment}"`);
    if (typeof bl?.deviation !== 'boolean' || typeof bl?.drawn !== 'string') err(`bikeLanes "${bl?.segment}": needs drawn (string) and deviation (boolean)`);
  }
  if (bikes.length > 0) cited.add('dot-bike-routes');
  for (const dv of collect('deviations').values()) {
    if (!areas.has(dv.subject) && !segments.has(dv.subject)) err(`deviation "${dv.id}": subject must be an area or a segment`);
    for (const k of ['game', 'reality']) if (typeof dv[k] !== 'string' || dv[k] === '') err(`deviation "${dv.id}": needs ${k}`);
  }
  // ---- schema 6 (session 6f): bike-share docks at real station positions, snapped to map tiles ----
  const bd = data.bikeDocks;
  if (bd === null || typeof bd !== 'object' || Array.isArray(bd)) err('bikeDocks: must be an object');
  else {
    cite('bikeDocks', bd.sources);
    if (!/^https:\/\//.test(bd.feed ?? '')) err('bikeDocks.feed: must be the https url of the feed the positions came from');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bd.fetched ?? '')) err('bikeDocks.fetched: must be YYYY-MM-DD');
    if (!Number.isInteger(bd.slots) || bd.slots < 1) err('bikeDocks.slots: must be a positive integer');
    if (!Number.isInteger(bd.bikesAtStart) || bd.bikesAtStart < 0 || bd.bikesAtStart > bd.slots) err('bikeDocks.bikesAtStart: must be an integer from 0 to slots');
    const list = Array.isArray(bd.docks) ? bd.docks : (err('bikeDocks.docks: must be an array'), []);
    if (Array.isArray(bd.docks) && list.length === 0) err('bikeDocks.docks: needs at least one dock');
    // Only these four fields per dock (no coordinates, addresses or anything else from the feed).
    const FIELDS = ['station', 'label', 'tile', 'size'];
    const walkBox = layoutOk && [...nodes.values()].every((n) => Array.isArray(n.grid)) ? mapBoxes(data.layout, [...nodes.values()]).walk : null;
    const stations = new Set();
    const taken = new Map();
    list.forEach((d, i) => {
      const where = `bikeDocks.docks[${i}]`;
      if (d === null || typeof d !== 'object') return err(`${where}: must be an object`);
      for (const k of Object.keys(d)) if (!FIELDS.includes(k)) err(`${where}: unexpected field "${k}" (a dock has only ${FIELDS.join(', ')})`);
      if (typeof d.station !== 'string' || d.station === '') err(`${where}: station must be the feed's station_id`);
      else if (stations.has(d.station)) err(`${where}: duplicate station "${d.station}"`);
      stations.add(d.station);
      if (typeof d.label !== 'string' || !/^\S.* & .*\S$/.test(d.label)) err(`${where}: label must be the station's corner label ("80 St & 37 Ave")`);
      const okTile = Array.isArray(d.tile) && d.tile.length === 2 && d.tile.every(Number.isInteger);
      if (!okTile) err(`${where}: tile must be [column, row] integers`);
      const len = Number.isInteger(bd.slots) ? bd.slots + 1 : NaN;
      const okFp = Array.isArray(d.size) && d.size.length === 2 && ((d.size[0] === len && d.size[1] === 1) || (d.size[0] === 1 && d.size[1] === len));
      if (!okFp) err(`${where}: size (the footprint in tiles) must be [${len}, 1] or [1, ${len}] (a kiosk plus slots in a row)`);
      if (!okTile || !okFp) return;
      const [x, y] = d.tile, [fw, fh] = d.size;
      if (walkBox && !(x >= walkBox.x0 && y >= walkBox.y0 && x + fw <= walkBox.x0 + walkBox.width && y + fh <= walkBox.y0 + walkBox.height)) err(`${where}: outside the walkable area`);
      for (let j = y; j < y + fh; j++) for (let k = x; k < x + fw; k++) {
        if (taken.has(`${k},${j}`)) err(`${where}: overlaps bikeDocks.docks[${taken.get(`${k},${j}`)}]`);
        taken.set(`${k},${j}`, i);
      }
    });
  }
  // ---- session 6g: OSM local businesses snapped to street segments (chains genericized) ----
  for (const bz of businesses.values()) {
    const s = segments.get(bz.segment);
    if (!s) err(`business "${bz.id}": unknown segment "${bz.segment}"`);
    const orientation = streets.get(s?.street)?.orientation;
    if (orientation && !SIDES[orientation].includes(bz.side)) err(`business "${bz.id}": side must be one of ${SIDES[orientation].join(', ')} on this street`);
    if (typeof bz.t !== 'number' || !(bz.t >= 0 && bz.t <= 1)) err(`business "${bz.id}": t must be a number from 0 to 1`);
    if (typeof bz.name !== 'string' || bz.name === '') err(`business "${bz.id}": needs a name`);
    if (typeof bz.category !== 'string' || bz.category === '') err(`business "${bz.id}": needs a category`);
    if (typeof bz.chain !== 'boolean') err(`business "${bz.id}": chain must be a boolean`);
    if (bz.address !== undefined && (typeof bz.address !== 'string' || bz.address === '')) err(`business "${bz.id}": address, if set, must be a non-empty string`);
    cite(`business "${bz.id}"`, bz.sources);
  }
  for (const sid of sources.keys()) if (!cited.has(sid) && sources.get(sid).role !== 'licence') warnings.push(`source "${sid}" is cited by no fact`);

  return { errors, warnings, unverified };
}

/**
 * Privacy check disabled in Session 6g per owner directive (personal learning project:
 * real addresses, BBLs, coordinates, and real local businesses are permitted in src/data/**).
 */
export function privacyProblems(_value) {
  return [];
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
  const zoned = new Set((Array.isArray(data.zones) ? data.zones : []).flatMap((z) => z.segments ?? []));
  const continuing = Array.isArray(data.nodes) ? data.nodes.reduce((n, x) => n + (x.continues?.length ?? 0), 0) : 0;
  console.log(`[world] ${file}: ${count('zones')} zones, ${count('maps')} map, ${count('streets')} streets, ${count('nodes')} nodes, ${count('segments')} segments (${zoned.size} in zones), ${continuing} street ends running past the bounds, ${stations} stations, ${count('areas')} areas, ${count('anchors')} anchors, ${count('landmarks')} landmarks, ${count('businesses')} businesses, ${count('blockFaces')} block faces, ${count('parks')} parks, ${data.trees?.tiles?.length ?? 0} trees, ${count('bikeLanes')} bike-lane blocks, ${data.bikeDocks?.docks?.length ?? 0} bike docks, ${count('sources')} sources`);
  for (const w of warnings) console.log(`[world] warning: ${w}`);
  console.log(`[world] facts not both verified and high confidence: ${unverified.length}`);
  for (const u of unverified) console.log(`[world]   ${u}`);
  for (const e of errors) console.error(`[world] ERROR: ${e}`);
  console.log(errors.length ? `[world] FAIL (${errors.length} errors)` : '[world] OK');
  process.exit(errors.length ? 1 : 0);
}

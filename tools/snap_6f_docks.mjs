// Session 6f: dock candidates -> snapped docks (called by tools/derive_6f_docks.py, which writes them into the dataset).
//   node tools/snap_6f_docks.mjs <dock-candidates.json> <snapped.json>
// Builds the map with the generator's snapping step (scripts/generate-maps.mjs, buildMaps({ snapDocks })), so a
// dock is snapped against the same cells the game gets: the legal footprint nearest the station on its own block
// face (curb, paseo bike-lane edge or plaza road edge; away from crossings, doors, signals and posts). Stations
// more than MAX_FROM_LINE metres from every dataset street's centre line are dropped (their street isn't drawn).
// Snapped against the dataset without any docks (the snapping step places them one by one, in candidate order).
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMaps, DOCK_SLOTS } from '../scripts/generate-maps.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORLD_FILE = join(ROOT, 'src/data/world/jackson-heights.json');
const MAX_FROM_LINE = 40; // metres (Claude's choice): an avenue's half-width plus its sidewalk, with room

const [candFile, outFile] = process.argv.slice(2);
if (!candFile || !outFile) throw new Error('usage: node tools/snap_6f_docks.mjs <dock-candidates.json> <snapped.json>');
const { candidates } = JSON.parse(readFileSync(candFile, 'utf8'));
const world = JSON.parse(readFileSync(WORLD_FILE, 'utf8'));

const near = candidates.filter((c) => c.metresFromCentreLine <= MAX_FROM_LINE);
const far = candidates.filter((c) => c.metresFromCentreLine > MAX_FROM_LINE).map((c) => ({ ...c, dropped: `${c.metresFromCentreLine} m from the nearest dataset street (its own street is not on the map)` }));
const { docks } = buildMaps({ ...world, bikeDocks: undefined }, { snapDocks: near })[0];
const placed = docks.filter((d) => d.snapped);
const dropped = [...far, ...docks.filter((d) => d.dropped)];

writeFileSync(outFile, `${JSON.stringify({ placed: placed.map((d) => ({ station: d.station, label: d.label, tile: d.snapped.tile, footprint: d.snapped.footprint, from: d.tile, segment: d.segment, side: d.side, movedTiles: d.snapped.movedTiles })), dropped: dropped.map((d) => ({ station: d.station, label: d.label, why: d.dropped })), slots: DOCK_SLOTS }, null, 1)}\n`);

console.log(`candidates inside the walkable area: ${candidates.length}; placed: ${placed.length}; dropped: ${dropped.length}`);
for (const d of placed) console.log(`  placed  ${d.label.padEnd(30)} raw ${d.tile} -> tile ${d.snapped.tile} footprint ${d.snapped.footprint} (${d.segment} ${d.side}, moved ${d.snapped.movedTiles} tiles)`);
for (const d of dropped) console.log(`  dropped ${d.label.padEnd(30)} ${d.dropped}`);

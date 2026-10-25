#!/usr/bin/env python3
# Session 6f: bike-share stations -> the world dataset's `bikeDocks` (schema 6).
#   python3 -I tools/fetch_6f_gbfs.py                       (raw feed into gitignored logs/s6f-src)
#   python3 -I tools/derive_6f_docks.py --lion logs/s6b-src/lion26c-jh.geojson \
#       --stations logs/s6f-src/station_information.json [--world src/data/world/jackson-heights.json]
# 1. Here: each station -> a layout tile and its block face; stations outside the walkable area are dropped.
# 2. `node tools/snap_6f_docks.mjs` (run from here): each candidate is snapped to a legal curb, paseo-lane or
#    plaza-edge footprint on its own block face of the generated map (scripts/generate-maps.mjs).
# 3. Here: the snapped docks are written into the dataset, in the dataset's own JSON layout. Idempotent.
# Pure Python plus the repo's node scripts; no dependencies.
#
# Same LION matching as the street trees (tools/derive_6e_data.py, copied here because `python3 -I`
# can't import a sibling module): a station's lon/lat -> grid coordinates by inverse bilinear
# interpolation over the lattice of dataset nodes (their LION node positions) -> layout tile; its block
# face = the nearest dataset segment (LION centre lines) and the side of it the station is on, like the
# PLUTO lots. Stations whose tile is outside the walkable area are dropped.
#
# The output stays in gitignored logs/ (it holds no lat/lon either, but it is raw-derived and unsnapped).
import argparse, json, math

ap = argparse.ArgumentParser()
ap.add_argument('--lion', required=True)
ap.add_argument('--stations', required=True)
ap.add_argument('--world', default='src/data/world/jackson-heights.json')
ap.add_argument('--out', default='logs/s6f-src/dock-candidates.json')
ap.add_argument('--snapped', default='logs/s6f-src/docks-snapped.json')
args = ap.parse_args()

w = json.load(open(args.world))

# ---- from tools/derive_6e_data.py: local metres rotated into the grid frame, LION geometry, lattice ----
LAT0 = 40.75
KX, KY = math.cos(math.radians(LAT0)) * 111320, 110540
ROT = math.radians(8)
def grid_m(lon, lat):
    x, y = lon * KX, lat * KY
    return (x * math.cos(ROT) - y * math.sin(ROT), x * math.sin(ROT) + y * math.cos(ROT))

GEOM, NODE = {}, {}
for f in json.load(open(args.lion))['features']:
    p = f['properties']
    if p['RB_Layer'] not in ('G', 'B'): continue
    g = f['geometry']; cs = g['coordinates'] if g['type'] == 'LineString' else [c for part in g['coordinates'] for c in part]
    GEOM.setdefault(p['SegmentID'], [grid_m(*c[:2]) for c in cs])
    NODE.setdefault(p['NodeIDFrom'], grid_m(*cs[0][:2])); NODE.setdefault(p['NodeIDTo'], grid_m(*cs[-1][:2]))
segs = w['segments']
SEGLINE = {s['id']: [pt for sid in s['lion'] for pt in GEOM[sid]] for s in segs}

def dist_seg(p, a, b):
    vx, vy = b[0] - a[0], b[1] - a[1]; L2 = vx * vx + vy * vy or 1e-9
    t = max(0, min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2))
    q = (a[0] + t * vx, a[1] + t * vy)
    return math.hypot(p[0] - q[0], p[1] - q[1]), q
def nearest_on(line, p):
    best = (1e18, None, None)
    for a, b in zip(line, line[1:]):
        d, q = dist_seg(p, a, b)
        if d < best[0]: best = (d, q, (b[0] - a[0], b[1] - a[1]))
    return best
ORIENT = {s['id']: s['orientation'] for s in w['streets']}
def side_of(seg, p):
    d, q, _ = nearest_on(SEGLINE[seg['id']], p)
    nx, ny = p[0] - q[0], p[1] - q[1]
    if ORIENT[seg['street']] == 'ns': return 'east' if nx > 0 else 'west'
    return 'north' if ny > 0 else 'south'

lattice = {}
for n in w['nodes']:
    gx, gy = n['grid']
    if float(gx).is_integer() and float(gy).is_integer() and n['lion'] in NODE: lattice[(int(gx), int(gy))] = NODE[n['lion']]
XS = sorted({x for x, _ in lattice}); YS = sorted({y for _, y in lattice})
def rows_at(x):
    return [y for y in YS if (x, y) in lattice and (x + 1, y) in lattice]
def bilinear(x, y0, y1, u, v):
    a, b, c, d = lattice[(x, y0)], lattice[(x + 1, y0)], lattice[(x, y1)], lattice[(x + 1, y1)]
    return (a[0] * (1 - u) * (1 - v) + b[0] * u * (1 - v) + c[0] * (1 - u) * v + d[0] * u * v,
            a[1] * (1 - u) * (1 - v) + b[1] * u * (1 - v) + c[1] * (1 - u) * v + d[1] * u * v)
def invert_cell(x, y0, y1, p):
    u = v = 0.5
    for _ in range(30):
        f = bilinear(x, y0, y1, u, v); ex, ey = f[0] - p[0], f[1] - p[1]
        h = 1e-4
        fu = bilinear(x, y0, y1, u + h, v); fv = bilinear(x, y0, y1, u, v + h)
        j = ((fu[0] - f[0]) / h, (fv[0] - f[0]) / h, (fu[1] - f[1]) / h, (fv[1] - f[1]) / h)
        det = j[0] * j[3] - j[1] * j[2]
        if abs(det) < 1e-9 or abs(u) > 50 or abs(v) > 50: return 99.0, 99.0
        du = (j[3] * ex - j[1] * ey) / det; dv = (-j[2] * ex + j[0] * ey) / det
        u -= du; v -= dv
        if abs(du) + abs(dv) < 1e-9: break
    return u, v
CELLS = [(x, y0, y1) for x in XS[:-1] for y0, y1 in zip(rows_at(x), rows_at(x)[1:])]
CENTRE = {c: bilinear(*c, 0.5, 0.5) for c in CELLS}
def to_grid(lon, lat):
    p = grid_m(lon, lat)
    best = None
    for c in sorted(CELLS, key=lambda c: math.dist(CENTRE[c], p))[:6]:
        x, y0, y1 = c
        u, v = invert_cell(x, y0, y1, p)
        out = max(0, -u, u - 1) + max(0, -v, v - 1)
        if best is None or out < best[0]: best = (out, x + u, y0 + v * (y1 - y0))
        if out == 0: break
    return best[1], best[2]
L = w['layout']
def tile_of(gx, gy):
    rows = L['rowsY']
    for (g0, t0), (g1, t1) in zip(rows, rows[1:]):
        if g0 <= gy <= g1: return gx * L['tileX'], t0 + (gy - g0) / (g1 - g0) * (t1 - t0)
    (g0, t0), (g1, t1) = (rows[0], rows[1]) if gy < rows[0][0] else (rows[-2], rows[-1])
    return gx * L['tileX'], t0 + (gy - g0) / (g1 - g0) * (t1 - t0)

# ---- the walkable area in layout tiles (scripts/world-layout.mjs mapBoxes: node box + edge) ----
pts = [tile_of(*n['grid']) for n in w['nodes']]
xs = [round(x) for x, _ in pts]; ys = [round(y) for _, y in pts]
WALK = (min(xs) - L['edge'], min(ys) - L['edge'], max(xs) + L['edge'], max(ys) + L['edge'])  # x0, y0, x1, y1 (exclusive)

# ---- stations ----
feed = json.load(open(args.stations))
stations = feed['data']['stations']
cands, dropped = [], []
for st in stations:
    gx, gy = to_grid(st['lon'], st['lat'])
    if not (-2 <= gx <= 19 and -7 <= gy <= 5): continue  # nowhere near the bounds (keeps the report short)
    tx, ty = tile_of(gx, gy)
    if not (WALK[0] <= tx < WALK[2] and WALK[1] <= ty < WALK[3]):
        dropped.append({'station': st['station_id'], 'label': st['name'], 'why': 'outside the walkable area', 'tile': [round(tx, 1), round(ty, 1)]})
        continue
    p = grid_m(st['lon'], st['lat'])
    d, i = min((nearest_on(SEGLINE[s['id']], p)[0], i) for i, s in enumerate(segs))
    seg = segs[i]
    cands.append({'station': st['station_id'], 'label': st['name'], 'tile': [round(tx, 2), round(ty, 2)], 'segment': seg['id'], 'side': side_of(seg, p), 'metresFromCentreLine': round(d, 1)})
cands.sort(key=lambda c: (c['tile'][1], c['tile'][0]))
json.dump({'feedLastUpdated': feed['last_updated'], 'walk': WALK, 'candidates': cands, 'dropped': dropped}, open(args.out, 'w'), indent=1, ensure_ascii=False)
print(f'stations in the feed: {len(stations)}; near the bounds: {len(cands) + len(dropped)}; inside the walkable area: {len(cands)}; dropped (outside it): {len(dropped)}')
for c in cands: print(f"  in   {c['label']:<32} tile {c['tile']}  {c['segment']} {c['side']} ({c['metresFromCentreLine']} m)")
for c in dropped: print(f"  out  {c['label']:<32} tile {c['tile']}")

# ---- 2. snap on the generated map ----
import subprocess
subprocess.run(['node', 'tools/snap_6f_docks.mjs', args.out, args.snapped], check=True)
snapped = json.load(open(args.snapped))

# ---- 3. write the dataset (schema 6) ----
fetch = json.load(open('logs/s6f-src/fetch.json'))
FEED = fetch['feeds']['station_information.json']
day = fetch['fetched'][:10]
source = {'id': 'gbfs-bike-share', 'title': 'Citi Bike GBFS 2.3 station_information (public feed, operated by Lyft)', 'version': f'fetched {fetch["fetched"]}',
          'url': FEED, 'publisher': 'Lyft Bikes and Scooters, LLC (Citi Bike system data)', 'accessed': day, 'access': 'read',
          'terms': f'Citi Bike Data License Agreement ({fetch["terms"]}): use and modification in a product allowed; no stand-alone redistribution, no use of its names or marks, no implied endorsement. The game is not affiliated with the system and shows generic "Bike Share" branding.',
          'usedFor': "Session 6f (owner's decision 1: a one-time exception to the NYC-Open-Data-only rule, for station positions only): bike-share dock positions, snapped to map tiles. Only station ids, corner labels and snapped tiles are committed; no coordinates."}
w['schemaVersion'] = 6
w['sources'] = [s_ for s_ in w['sources'] if s_['id'] != source['id']] + [source]
w['bikeDocks'] = {
    'sources': [source['id']], 'feed': FEED, 'fetched': day, 'slots': snapped['slots'], 'bikesAtStart': 3,
    'description': ("Bike-share docks at the real station positions inside the walkable area (session 6f, owner's decisions 1-3). Each: the station's GBFS station_id, "
                    "its corner label as the feed names it, the snapped tile (top-left of the dock, in layout tile coordinates like trees.tiles) and its size [width, height] "
                    "in tiles: a kiosk plus `slots` bike slots in a row along a curb, the paseo's bike lane or a plaza edge. Regenerate with tools/derive_6f_docks.py."),
    'docks': [{'station': d['station'], 'label': d['label'], 'tile': d['tile'], 'size': d['footprint']} for d in snapped['placed']],
}
order = [k for k in w if k != 'bikeDocks'] + ['bikeDocks']
def dump(v): return json.dumps(v, ensure_ascii=False)
out = ['{']
for i, k in enumerate(order):
    v = w[k]
    if isinstance(v, list) and v and isinstance(v[0], dict):
        body = '[\n' + ',\n'.join('    ' + dump(e) for e in v) + '\n  ]'
    elif k == 'trees':
        body = '{\n' + ',\n'.join(f'    {dump(a)}: {dump(b)}' for a, b in v.items()) + '\n  }'
    elif k == 'bikeDocks':
        body = '{\n' + ',\n'.join(f'    {dump(a)}: ' + ('[\n' + ',\n'.join('      ' + dump(e) for e in b) + '\n    ]' if a == 'docks' else dump(b)) for a, b in v.items()) + '\n  }'
    elif isinstance(v, dict):
        body = json.dumps(v, indent=2, ensure_ascii=False).replace('\n', '\n  ')
    else:
        body = dump(v)
    out.append(f'  {dump(k)}: {body}' + (',' if i < len(order) - 1 else ''))
out.append('}')
open(args.world, 'w').write('\n'.join(out) + '\n')
print(f"bikeDocks written: {len(w['bikeDocks']['docks'])} docks (schema 6)")

#!/usr/bin/env python3
# Session 6e: derives the schema-5 additions of the world dataset from raw NYC Open Data files.
# Pure Python, no dependencies. Raw inputs stay in gitignored logs/ and are passed as arguments:
#   python3 -I tools/derive_6e_data.py --lion logs/s6b-src/lion26c-jh.geojson \
#       --pluto logs/s6e-src/pluto-jh.json --parks logs/s6e-src/parks-jh.geojson \
#       --trees logs/s6e-src/trees2015-jh.json --bikes logs/s6e-src/bike-routes-jh.geojson \
#       [--world src/data/world/jackson-heights.json]
# Rewrites the dataset in place (schema 4 or 5 in, schema 5 out); re-running it is idempotent.
#
# What it writes (and what it never writes):
# - blockFaces: one land-use class per block face (a segment side). Tax lots are matched to the
#   nearest dataset segment (LION geometry) and side, weighted by frontage, then aggregated. No
#   BBL, address, owner, lot geometry or per-lot value is written: only the class per face.
# - parks: Parks Properties outlines inside the bounds, in grid coordinates (3 decimals).
# - trees: 2015 Street Tree Census (alive trees), snapped to map tiles of the dataset's layout and
#   thinned to TREE_GAP tiles apart. Only the snapped tile positions are written.
# - bikeLanes: DOT Bike Routes facility classes on each 34th Ave block, and how the game draws them.
# - deviations: where the game knowingly differs from the data.
#
# Raw inputs (fetched 2026-10-23 with the SODA API, bbox lat 40.737-40.763, lon -73.902 to -73.868):
#   PLUTO 64uk-42ks ($select=landuse,bldgclass,numfloors,unitsres,lotfront,latitude,longitude,version)
#   Parks Properties enfh-gkve (GeoJSON), 2015 Street Tree Census uvpi-gqnh
#   ($select=status,tree_dbh,curb_loc,latitude,longitude), New York City Bike Routes mzxg-pwib (GeoJSON).
import argparse, collections, json, math

ap = argparse.ArgumentParser()
ap.add_argument('--lion', required=True)
ap.add_argument('--pluto', required=True)
ap.add_argument('--parks', required=True)
ap.add_argument('--trees', required=True)
ap.add_argument('--bikes', required=True)
ap.add_argument('--world', default='src/data/world/jackson-heights.json')
args = ap.parse_args()

w = json.load(open(args.world))
assert w['schemaVersion'] in (4, 5), w['schemaVersion']

# ---- local metres, rotated into the grid frame (numbered streets run grid-north) ----
LAT0 = 40.75
KX, KY = math.cos(math.radians(LAT0)) * 111320, 110540
ROT = math.radians(8)  # LION bearings + 8 degrees = grid bearings (tools/extend_lion_6d.py)
def grid_m(lon, lat):
    x, y = lon * KX, lat * KY
    # rotate by +8 degrees: grid east, grid north
    return (x * math.cos(ROT) - y * math.sin(ROT), x * math.sin(ROT) + y * math.cos(ROT))

# ---- LION geometry per segment id, node positions ----
GEOM, NODE = {}, {}
for f in json.load(open(args.lion))['features']:
    p = f['properties']
    if p['RB_Layer'] not in ('G', 'B'): continue
    g = f['geometry']; cs = g['coordinates'] if g['type'] == 'LineString' else [c for part in g['coordinates'] for c in part]
    GEOM.setdefault(p['SegmentID'], [grid_m(*c[:2]) for c in cs])
    NODE.setdefault(p['NodeIDFrom'], grid_m(*cs[0][:2])); NODE.setdefault(p['NodeIDTo'], grid_m(*cs[-1][:2]))
nodes = {n['id']: n for n in w['nodes']}
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
    """Which side of the segment p is on, in the dataset's terms (ns: east/west; ew and diagonal: north/south)."""
    d, q, _ = nearest_on(SEGLINE[seg['id']], p)
    nx, ny = p[0] - q[0], p[1] - q[1]
    if ORIENT[seg['street']] == 'ns': return 'east' if nx > 0 else 'west'
    return 'north' if ny > 0 else 'south'

# ---- real -> grid: inverse bilinear over the lattice of dataset nodes (streets x, avenues y) ----
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
    """Grid coordinates of a point: inside a lattice cell when it is in one, else extrapolated from the nearest cell."""
    p = grid_m(lon, lat)
    best = None
    for c in sorted(CELLS, key=lambda c: math.dist(CENTRE[c], p))[:6]:
        x, y0, y1 = c
        u, v = invert_cell(x, y0, y1, p)
        out = max(0, -u, u - 1) + max(0, -v, v - 1)
        if best is None or out < best[0]: best = (out, x + u, y0 + v * (y1 - y0))
        if out == 0: break
    return best[1], best[2]

# ---- layout: grid -> map tile (same formula as scripts/world-layout.mjs tileOf, unrounded) ----
L = w['layout']
def tile_of(gx, gy):
    rows = L['rowsY']
    for (g0, t0), (g1, t1) in zip(rows, rows[1:]):
        if g0 <= gy <= g1: return gx * L['tileX'], t0 + (gy - g0) / (g1 - g0) * (t1 - t0)
    (g0, t0), (g1, t1) = (rows[0], rows[1]) if gy < rows[0][0] else (rows[-2], rows[-1])
    return gx * L['tileX'], t0 + (gy - g0) / (g1 - g0) * (t1 - t0)

# ---- block faces: land use from PLUTO ----
# PLUTO LandUse -> game class (decision 11; codes 3, 6, 7 and 11 mapped by Claude's choice).
LANDUSE = {'1': 'house', '2': 'walkup', '3': 'walkup', '4': 'commercial', '5': 'commercial', '6': 'commercial',
           '7': 'parking', '8': 'civic', '9': 'park', '10': 'parking', '11': 'parking'}
MAX_LOT_DIST = 80  # metres from a segment's centre line; farther lots belong to no face here
hd = next(a for a in w['areas'] if a['id'] == 'area-jh-historic-district')
HD = set(hd['segments'])
weights = collections.defaultdict(collections.Counter)
lot_count = 0
for lot in json.load(open(args.pluto)):
    if lot.get('landuse') not in LANDUSE or not lot.get('latitude'): continue
    p = grid_m(float(lot['longitude']), float(lot['latitude']))
    d, i = min((nearest_on(SEGLINE[s['id']], p)[0], i) for i, s in enumerate(segs))
    if d > MAX_LOT_DIST: continue
    seg = segs[i]
    front = float(lot.get('lotfront') or 0) or 25.0
    weights[(seg['id'], side_of(seg, p))][LANDUSE[lot['landuse']]] += front
    lot_count += 1

def classify(c):
    total = sum(c.values())
    if c['commercial'] >= total / 3: return 'commercial'
    return max(sorted(c), key=lambda k: c[k])
faces = []
for s in segs:
    sides = ['east', 'west'] if ORIENT[s['street']] == 'ns' else ['north', 'south']
    for side in sides:
        c = weights.get((s['id'], side))
        faces.append({'id': f"bf-{s['id'][4:]}-{side}", 'segment': s['id'], 'side': side, 'c': c})
# Faces with no lot of their own take the class of the nearest face on the same street side.
def mid(seg_id):
    line = SEGLINE[seg_id]; return line[len(line) // 2]
for f in faces:
    if f['c']:
        cls = classify(f['c'])
        if cls == 'walkup' and f['segment'] in HD: cls = 'garden-coop'
        f['landUse'], f['basis'] = cls, 'pluto'
for f in faces:
    if f['c']: continue
    m = mid(f['segment'])
    donor = min((g for g in faces if g['c'] and g['side'] == f['side']), key=lambda g: math.dist(mid(g['segment']), m))
    f['landUse'], f['basis'] = donor['landUse'], f'nearest:{donor["id"]}'

# ---- parks inside the bounds ----
in_bounds = lambda gx, gy: -0.05 <= gx <= 17.05 and -5.05 <= gy <= 3.05
parks = []
for feat in json.load(open(args.parks))['features']:
    pr = feat['properties']; g = feat['geometry']
    polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    rings = [[to_grid(*c[:2]) for c in poly[0]] for poly in polys]
    inside = sum(in_bounds(*pt) for r in rings for pt in r)
    if inside == 0: continue
    parks.append({'id': f"park-{pr['gispropnum'].lower()}", 'name': pr['signname'], 'parksId': pr['gispropnum'], 'category': pr['typecategory'],
                  'acres': float(pr['acres']), 'outline': [[[round(x, 3), round(y, 3)] for x, y in r] for r in rings],
                  'pointsInBounds': f'{inside}/{sum(len(r) for r in rings)}'})

# Faces that front a park (Parks outline covers points just inside the block along the face) are 'park'.
def in_ring(pt, ring):
    x, y = pt; ins = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1): ins = not ins
    return ins
# Malls (planted medians, e.g. Mall Thirty Four XXXIV along the paseo) are not block land.
BLOCK_PARKS = [p for p in parks if p['category'] != 'Mall']
park_faces = []
for f in faces:
    s_ = next(s for s in segs if s['id'] == f['segment'])
    (ax, ay), (bx, by) = nodes[s_['from']]['grid'], nodes[s_['to']]['grid']
    off = {'north': (0, -0.08), 'south': (0, 0.08), 'east': (0.2, 0), 'west': (-0.2, 0)}[f['side']]
    pts = [(ax + (bx - ax) * t + off[0], ay + (by - ay) * t + off[1]) for t in (0.25, 0.5, 0.75)]
    if sum(any(in_ring(pt, r) for p in BLOCK_PARKS for r in p['outline']) for pt in pts) >= 2:
        f['landUse'], f['basis'] = 'park', 'parks-outline'
        park_faces.append(f['id'])

# ---- trees: alive, snapped to tiles, thinned ----
TREE_GAP = 4  # tiles (Claude's choice): at 30 tiles per block (~2.6 m a tile) about 10 m apart
raw_trees = [t for t in json.load(open(args.trees)) if t.get('status') == 'Alive' and t.get('latitude')]
snapped = []
for t in raw_trees:
    gx, gy = to_grid(float(t['longitude']), float(t['latitude']))
    if not (-0.8 <= gx <= 17.8 and -5.8 <= gy <= 3.8): continue
    tx, ty = tile_of(gx, gy)
    snapped.append((math.floor(tx), math.floor(ty)))
kept = []
grid = {}
for tx, ty in sorted(set(snapped), key=lambda c: (c[1], c[0])):
    cx, cy = tx // TREE_GAP, ty // TREE_GAP
    near = [k for dx in (-1, 0, 1) for dy in (-1, 0, 1) for k in grid.get((cx + dx, cy + dy), [])]
    if any(max(abs(tx - a), abs(ty - b)) < TREE_GAP for a, b in near): continue
    kept.append([tx, ty]); grid.setdefault((cx, cy), []).append((tx, ty))

# ---- 34th Ave bike lanes (DOT Bike Routes) ----
bike_feats = []
for f in json.load(open(args.bikes))['features']:
    p = f['properties']
    if p.get('status') != 'Current' or not (p.get('street') or '').startswith('34 AV'): continue
    g = f['geometry']; cs = g['coordinates'] if g['type'] == 'LineString' else [c for part in g['coordinates'] for c in part]
    pts = [grid_m(*c[:2]) for c in cs]
    bike_feats.append((pts[len(pts) // 2], p.get('ft_facilit'), p.get('tf_facilit')))
bike = []
for s in segs:
    if s['street'] != 'ave-34': continue
    line = SEGLINE[s['id']]
    hits = [(ft, tf) for m, ft, tf in bike_feats if nearest_on(line, m)[0] < 25]
    ft = sorted({a for a, _ in hits if a}); tf = sorted({b for _, b in hits if b})
    lane = lambda cs: any(c in ('Protected', 'Conventional') for c in cs)
    bike.append({'segment': s['id'], 'dataFromTo': ft, 'dataToFrom': tf, 'drawn': 'green-lane-both-sides', 'deviation': not (lane(ft) and lane(tf))})

# ---- write ----
w['schemaVersion'] = 5
dates = {'accessed': '2026-10-23', 'access': 'read', 'terms': 'NYC Open Data (no restrictions).'}
new_sources = [
    {'id': 'dcp-pluto', 'title': 'Primary Land Use Tax Lot Output (PLUTO) (NYC Open Data 64uk-42ks)', 'version': '26v2 (rows updated 2026-08-24)', 'url': 'https://data.cityofnewyork.us/d/64uk-42ks',
     'publisher': 'NYC Department of City Planning', **dates,
     'usedFor': 'Land use per block face (LandUse codes aggregated by frontage). Only the class per face is committed: no BBLs, addresses, owners or lot geometry.'},
    {'id': 'parks-properties', 'title': 'Parks Properties (NYC Open Data enfh-gkve)', 'version': 'rows updated 2026-10-16', 'url': 'https://data.cityofnewyork.us/d/enfh-gkve',
     'publisher': 'NYC Department of Parks and Recreation', **dates,
     'usedFor': "Travers Park (Q303): '34 Ave. bet. 77 St. and 78 St.', playground. Since 6e also the park outlines in the bounds (dataset 'parks')."},
    {'id': 'street-trees-2015', 'title': '2015 Street Tree Census - Tree Data (NYC Open Data uvpi-gqnh)', 'version': 'rows updated 2017-10-04', 'url': 'https://data.cityofnewyork.us/d/uvpi-gqnh',
     'publisher': 'NYC Department of Parks and Recreation', **dates,
     'usedFor': f'Street tree positions (status Alive), snapped to map tiles and thinned to {TREE_GAP} tiles apart. Only the snapped tile positions are committed.'},
    {'id': 'dot-bike-routes', 'title': 'New York City Bike Routes (NYC Open Data mzxg-pwib)', 'version': 'rows updated 2026-07-24', 'url': 'https://data.cityofnewyork.us/d/mzxg-pwib',
     'publisher': 'NYC Department of Transportation', **dates,
     'usedFor': 'Bike facility classes on 34th Ave (status Current) per block, to check the green lanes drawn along the paseo.'},
]
w['sources'] = [s for s in w['sources'] if s['id'] not in {x['id'] for x in new_sources}]
at = next(i for i, s in enumerate(w['sources']) if s['id'] == 'lpc-historic-districts') + 1
w['sources'][at:at] = [s for s in new_sources if s['id'] != 'parks-properties']
w['sources'].insert(next(i for i, s in enumerate(w['sources']) if s['id'] == 'mta-stations'), next(s for s in new_sources if s['id'] == 'parks-properties'))

w['blockFaces'] = [{'id': f['id'], 'segment': f['segment'], 'side': f['side'], 'landUse': f['landUse'], 'basis': f['basis']} for f in faces]
w['parks'] = [{k: v for k, v in p.items() if k != 'pointsInBounds'} | {'sources': ['parks-properties']} for p in parks]
w['trees'] = {'sources': ['street-trees-2015'], 'status': 'Alive', 'gapTiles': TREE_GAP,
              'description': 'Street trees snapped to map tiles of this layout ([column, row] in layout tile coordinates: x = 0 at 73rd St centre line, y = 0 at 37th Ave centre line) and thinned so no two are closer than gapTiles (Chebyshev). Regenerate with tools/derive_6e_data.py when the layout changes.',
              'tiles': kept}
w['bikeLanes'] = bike
w['deviations'] = [
    {'id': 'dev-paseo-grass', 'subject': 'area-34th-avenue-plaza', 'game': 'Grassy green surface, car-free and continuous (owner\'s decision 9).', 'reality': 'Asphalt street with planters, plaza blocks and shared-street blocks (DOT 34th Avenue Open Street).'},
    {'id': 'dev-paseo-bike-lanes', 'subject': 'area-34th-avenue-plaza', 'game': 'A green painted bike lane along both sides of every block, 73rd to 90th St (owner\'s decision 9).',
     'reality': 'DOT Bike Routes list a current facility on every block (protected, conventional or shared, per direction); blocks marked deviation in bikeLanes have no dedicated lane in both directions in the data.'},
]
order = ['schemaVersion', 'id', 'bounds', 'layout', 'sources', 'streets', 'nodes', 'segments', 'transit', 'areas', 'zones', 'maps', 'anchors', 'landmarks', 'blockFaces', 'parks', 'trees', 'bikeLanes', 'deviations']
assert set(order) == set(w), set(w) ^ set(order)
def dump(v): return json.dumps(v, ensure_ascii=False)
out = ['{']
for i, k in enumerate(order):
    v = w[k]
    if isinstance(v, list) and v and isinstance(v[0], dict):
        body = '[\n' + ',\n'.join('    ' + dump(e) for e in v) + '\n  ]'
    elif k == 'trees':
        body = '{\n' + ',\n'.join(f'    {dump(a)}: {dump(b)}' for a, b in v.items()) + '\n  }'
    elif isinstance(v, dict):
        body = json.dumps(v, indent=2, ensure_ascii=False).replace('\n', '\n  ')
    else:
        body = dump(v)
    out.append(f'  {dump(k)}: {body}' + (',' if i < len(order) - 1 else ''))
out.append('}')
open(args.world, 'w').write('\n'.join(out) + '\n')

cc = collections.Counter(f['landUse'] for f in faces)
print(f'lots matched to faces: {lot_count}; faces: {len(faces)} ({sum(1 for f in faces if f["basis"] == "pluto")} from PLUTO, {sum(1 for f in faces if f["basis"] != "pluto")} inferred)')
print('land-use classes:', dict(sorted(cc.items())))
print('parks in bounds:', [(p['id'], p['name'], p['pointsInBounds']) for p in parks])
print(f'trees: {len(raw_trees)} alive in the download, {len(snapped)} in the map area, {len(set(snapped))} distinct tiles, {len(kept)} kept after thinning')
print('bike lanes:', [(b['segment'][11:], b['dataFromTo'], b['dataToFrom'], b['deviation']) for b in bike])
print('faces set to park from Parks outlines:', park_faces)

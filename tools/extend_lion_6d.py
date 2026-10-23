#!/usr/bin/env python3
# Session 6d migration, kept as a tool (session 6e): extends the world dataset from schema 3 to 4
# (two avenues north of Northern Blvd, one continuous map) using raw LION 26C.
# Pure Python, no dependencies. Raw inputs live in gitignored logs/ and are passed as arguments:
#   python3 -I tools/extend_lion_6d.py --lion logs/s6b-src/lion26c-jh.geojson \
#       --lpc logs/s6b-src/lpc-historic-districts.geojson --world-in <schema-3 json> --out <path>
# --lion is the LION 26C extract (EPSG:4326 GeoJSON of the lion layer around Jackson Heights,
# made from nyclion_26c.zip). Reproducibility check: run on the schema-3 file from commit e3131eb;
# the output equals src/data/world/jackson-heights.json as committed in 59945a8.
import argparse, collections, json, math

ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument('--lion', required=True, help='LION 26C extract (GeoJSON, EPSG:4326), gitignored')
ap.add_argument('--lpc', required=True, help='LPC historic districts GeoJSON, gitignored')
ap.add_argument('--world-in', required=True, help='schema-3 world dataset')
ap.add_argument('--out', required=True, help='where to write the schema-4 dataset')
args = ap.parse_args()

# ---- LION graph: street names per node, node positions, generic-centreline segments ----
LION_FEATURES = json.load(open(args.lion))['features']
_st = collections.defaultdict(set); XY = {}; SEG = {}
for f in LION_FEATURES:
    p = f['properties']
    if p['RB_Layer'] not in ('G', 'B') or p['FeatureTyp'] not in ('0', '6', 'A', 'W', 'C'): continue
    name = (p['Street'] or '').strip()
    g = f['geometry']; cs = g['coordinates'] if g['type'] == 'LineString' else [c for part in g['coordinates'] for c in part]
    for nid, xy in ((p['NodeIDFrom'], cs[0]), (p['NodeIDTo'], cs[-1])):
        _st[nid].add(name); XY[nid] = xy
    SEG.setdefault(p['SegmentID'], dict(street=name, a=p['NodeIDFrom'], b=p['NodeIDTo'], ft=p['FeatureTyp'], traf=p['TrafDir']))
ST = {k: sorted(v) for k, v in _st.items()}
ADJ = collections.defaultdict(list)
for sid, s in SEG.items():
    ADJ[s['a']].append((s['b'], s['street'], sid)); ADJ[s['b']].append((s['a'], s['street'], sid))
def bearing(a, b):
    (x0, y0), (x1, y1) = XY[a], XY[b]
    dx = (x1 - x0) * math.cos(math.radians(40.75)) * 111320; dy = (y1 - y0) * 110540
    return (math.degrees(math.atan2(dx, dy)) + 8) % 360, math.hypot(dx, dy)  # grid frame: streets run N/S
def compass(deg):
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][round(deg / 45) % 8]
def node(*names, box=(-73.900, 40.738, -73.870, 40.763)):
    return [n for n, s in ST.items() if all(x in s for x in names) and box[0] < XY[n][0] < box[2] and box[1] < XY[n][1] < box[3]]
def path(street, a, b, avoid=()):
    prev = {a: None}; q = [a]
    while q:
        n = q.pop(0)
        if n == b: break
        for m, nm, sid in ADJ[n]:
            if nm == street and m not in prev and m not in avoid: prev[m] = (n, sid); q.append(m)
    if b not in prev: return None
    out = []; n = b
    while prev[n]: n, sid = prev[n]; out.append(sid)
    return out[::-1]
def ped(sid):
    s = SEG[sid]; return s['ft'] == 'W' or s['traf'] == 'P'

w = json.load(open(args.world_in))
assert w['schemaVersion'] == 3, 'expects a schema-3 dataset'
# ---- LION geometry + LPC polygon (pure Python) ----
GEOM = {}
PAIRS = []  # (state plane feet, lon/lat) at LION segment ends: fits the LPC polygon's projection (EPSG:2263) to lon/lat
for f in LION_FEATURES:
    p = f['properties']
    if p['RB_Layer'] in ('G', 'B'):
        g = f['geometry']; cs = g['coordinates'] if g['type'] == 'LineString' else [c for part in g['coordinates'] for c in part]
        GEOM.setdefault(p['SegmentID'], cs)
        PAIRS.append(((p['XFrom'], p['YFrom']), cs[0]))
def fit_affine(pairs):
    # least squares lon = a*x + b*y + c (and lat likewise); the area is ~2 km across, so an affine fit is well under a metre off
    import itertools
    def solve(col):
        S = [[0.0] * 3 for _ in range(3)]; r = [0.0] * 3
        for (x, y), out in pairs:
            v = (x, y, 1.0)
            for i in range(3):
                r[i] += v[i] * out[col]
                for j in range(3): S[i][j] += v[i] * v[j]
        # Gaussian elimination
        for i in range(3):
            piv = S[i][i]
            for j in range(i + 1, 3):
                f_ = S[j][i] / piv
                for k in range(3): S[j][k] -= f_ * S[i][k]
                r[j] -= f_ * r[i]
        x = [0.0] * 3
        for i in (2, 1, 0): x[i] = (r[i] - sum(S[i][k] * x[k] for k in range(i + 1, 3))) / S[i][i]
        return x
    return solve(0), solve(1)
AX, AY = fit_affine(PAIRS)
resid = max(math.hypot((AX[0]*x+AX[1]*y+AX[2]-o[0])*math.cos(math.radians(40.75))*111320, (AY[0]*x+AY[1]*y+AY[2]-o[1])*110540) for (x, y), o in PAIRS)
print(f'affine EPSG:2263 -> lon/lat fit: max residual {resid:.2f} m over {len(PAIRS)} LION points')
hd = [f for f in json.load(open(args.lpc))['features'] if f['properties']['area_name'] == 'Jackson Heights Historic District'][0]
RING = [(AX[0]*x+AX[1]*y+AX[2], AY[0]*x+AY[1]*y+AY[2]) for x, y in hd['geometry']['coordinates'][0]]
KX, KY = math.cos(math.radians(40.75)) * 111320, 110540
def m(pt): return (pt[0] * KX, pt[1] * KY)
RINGM = [m(p) for p in RING]
def inside(pt):
    x, y = m(pt); ins = False
    for (x1, y1), (x2, y2) in zip(RINGM, RINGM[1:] + RINGM[:1]):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1): ins = not ins
    if ins: return True
    for (x1, y1), (x2, y2) in zip(RINGM, RINGM[1:] + RINGM[:1]):  # 5 m buffer, as in 6b
        vx, vy = x2 - x1, y2 - y1; L2 = vx * vx + vy * vy or 1
        t = max(0, min(1, ((x - x1) * vx + (y - y1) * vy) / L2))
        if math.hypot((x - x1 - t * vx) / KX, (y - y1 - t * vy) / KY) < 0.00005: return True  # 6b: shapely buffer(0.00005) in degrees
    return False
def frac_in(sids):
    tot = ins = 0.0
    for sid in sids:
        cs = GEOM[sid]
        for a, b in zip(cs, cs[1:]):
            L = math.hypot(*(p - q for p, q in zip(m(b), m(a)))); n = max(1, int(L / 2))
            for i in range(n):
                t = (i + 0.5) / n; pt = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
                tot += L / n; ins += L / n if inside(pt) else 0
    return ins / tot if tot else 0

# Sanity: recompute 6b's HD membership on the existing segments (6b: 53 of 53 match).
hd_area = next(a for a in w['areas'] if a['id'] == 'area-jh-historic-district')
mismatch = [s['id'] for s in w['segments'] if (frac_in(s['lion']) >= 0.5) != (s['id'] in hd_area['segments'])]
print('HD membership re-check on existing segments, mismatches:', mismatch)

# ---- grid ----
AVES = [('31 AVENUE', 'ave-31', '31ave', -5), ('32 AVENUE', 'ave-32', '32ave', -4), ('NORTHERN BOULEVARD', 'northern', 'northern', -3),
        ('34 AVENUE', 'ave-34', '34ave', -2), ('35 AVENUE', 'ave-35', '35ave', -1), ('37 AVENUE', 'ave-37', '37ave', 0)]
def ordinal(k): return f'{k}{"th" if 10 <= k % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(k % 10, "th")}'
nodes = {n['id']: n for n in w['nodes']}
segs = {s['id']: s for s in w['segments']}
streets = {s['id']: s for s in w['streets']}
added = {'streets': [], 'nodes': [], 'segments': []}

for sid, name in [('ave-32', '32nd Avenue'), ('ave-31', '31st Avenue')]:
    s = {'id': sid, 'name': name, 'orientation': 'ew', 'sources': ['dcp-lion'], 'confidence': 'high', 'status': 'verified',
         'notes': 'Session 6d: one of the two avenues north of Northern Blvd (LION 26C: crosses every numbered street from 73rd to 90th St).'}
    w['streets'].insert(next(i for i, x in enumerate(w['streets']) if x['id'] == 'northern'), s); streets[sid] = s; added['streets'].append(sid)
nb = streets['northern']; del nb['stub']
nb['notes'] = 'A wide arterial. Since session 6d the whole of Northern Blvd from 73rd to 90th St is in the bounds (6b-6c: only the 78th St mouth, at the north end of the 78th Street Plaza).'

def lion_node(k, an):
    h = node(f'{k} STREET', an); assert len(h) == 1, (k, an, h); return h[0]
def add_node(nid, sts, grid, lion):
    if nid in nodes:
        assert nodes[nid]['lion'] == lion, (nid, nodes[nid]['lion'], lion); return
    n = {'id': nid, 'streets': sts, 'grid': grid, 'lion': lion}
    w['nodes'].append(n); nodes[nid] = n; added['nodes'].append(nid)
for k in range(73, 91):
    for an, aid, short, gy in AVES:
        add_node(f'n-{k}-{short}', [f'st-{k}', aid], [k - 73, gy], lion_node(k, an))

def add_seg(sid, street, a, b, lion_street, use='road', extra=None):
    ids = path(lion_street, nodes[a]['lion'], nodes[b]['lion'])
    assert ids, (sid, a, b)
    if sid in segs:
        assert set(segs[sid]['lion']) == set(ids), (sid, segs[sid]['lion'], ids); return
    pedestrian = all(ped(x) for x in ids)
    s = {'id': sid, 'street': street, 'from': a, 'to': b, 'use': use, 'lion': ids, 'sources': ['dcp-lion'], 'confidence': 'high', 'status': 'verified'}
    if pedestrian and use == 'road': s['use'] = 'plaza'
    if extra: s.update(extra(s))
    w['segments'].append(s); segs[sid] = s; added['segments'].append(sid)

PAIR = {('37ave', '35ave'): '35ave-37ave', ('35ave', '34ave'): '34ave-35ave', ('34ave', 'northern'): '34ave-northern', ('northern', '32ave'): 'northern-32ave', ('32ave', '31ave'): '32ave-31ave'}
AVE34_NOTE = ('34th Avenue Open Street (DOT, 69th to 96th St; nyc.gov/34ave). Session 6d extends the 6c paseo decision to the whole bounds: '
              'drawn as plaza. LION 26C still codes this block as a street.')
def ave34(s):
    lion_ped = all(ped(x) for x in s['lion'])
    return {'use': 'plaza', 'sources': ['dcp-lion', 'dot-ped-plazas', 'dot-34ave-open-street', 'dot-projects-2025'], 'confidence': 'high' if lion_ped else 'medium',
            'status': 'verified' if lion_ped else 'corrected', 'notes': AVE34_NOTE}
for k in range(73, 91):
    shorts = [a[2] for a in reversed(AVES)]  # 37ave .. 31ave, south to north
    for s1, s2 in zip(shorts, shorts[1:]):
        add_seg(f'seg-{k}-{PAIR[(s1, s2)]}', f'st-{k}', f'n-{k}-{s1}', f'n-{k}-{s2}', f'{k} STREET')
for an, aid, short, gy in AVES:
    for k in range(73, 90):
        add_seg(f'seg-{short}-{k}-{k + 1}', aid, f'n-{k}-{short}', f'n-{k + 1}-{short}', an, extra=ave34 if aid == 'ave-34' else None)

# 6c's two unmapped segments are drawn now (one continuous map): drop the field.
for s in w['segments']: s.pop('unmapped', None)

# ---- streets that continue past the bounds (drawn to the map edge) ----
segLion = {x for s in w['segments'] for x in s['lion']}
DIRS = {'E': 'W', 'W': 'E'}
def beyond(nid, lion_street, want, optional=False):
    L = nodes[nid]['lion']
    hits = [(compass(bearing(L, mm)[0]), sid) for mm, nm, sid in ADJ[L] if nm == lion_street and sid not in segLion]
    if optional and not hits: return None
    assert len(hits) == 1 and hits[0][0] in want, (nid, lion_street, hits)
    return {'dir': hits[0][0], 'street': None, 'lion': hits[0][1]}
cont = {}
def add_cont(nid, street, lion_street, want, note=None, optional=False):
    c = beyond(nid, lion_street, want, optional)
    if c is None: return print('no LION segment beyond', nid, 'on', lion_street)
    c['street'] = street
    if note: c['notes'] = note
    cont.setdefault(nid, []).append(c)
for an, aid, short, gy in AVES:
    add_cont(f'n-73-{short}', aid, an, ['W']); add_cont(f'n-90-{short}', aid, an, ['E'])
for k in range(73, 91): add_cont(f'n-{k}-31ave', f'st-{k}', f'{k} STREET', ['N'], optional=True)
add_cont('n-73-roosevelt', 'roosevelt', 'ROOSEVELT AVENUE', ['W']); add_cont('n-90-roosevelt', 'roosevelt', 'ROOSEVELT AVENUE', ['E'])
add_cont('n-73-37rd', 'broadway', 'BROADWAY', ['NW']); add_cont('n-75-bway', 'broadway', 'BROADWAY', ['SE'])
add_cont('n-73-roosevelt', 'st-73', '73 STREET', ['S']); add_cont('n-74-bway', 'st-74', '74 STREET', ['S']); add_cont('n-75-bway', 'st-75', '75 STREET', ['S'])
for k in [76, 77, 79, 80, 81, 82, 83]: add_cont(f'n-{k}-roosevelt', f'st-{k}', f'{k} STREET', ['S'])
# 78th St jogs: its south piece leaves Roosevelt from LION node 0046619, 12 m west of the north piece's node.
L78 = [(compass(bearing('0046619', mm)[0]), sid) for mm, nm, sid in ADJ['0046619'] if nm == '78 STREET']
assert L78 == [('S', '0076204')], L78
cont.setdefault('n-78-roosevelt', []).append({'dir': 'S', 'street': 'st-78', 'lion': '0076204', 'notes': 'South of Roosevelt 78th St leaves from LION node 0046619, 12 m west of this node (a jog too small to draw).'})
for nid, st, ln, d in [('n-baxter-roosevelt', 'baxter', 'BAXTER AVENUE', 'S'), ('n-85-roosevelt', 'forley', 'FORLEY STREET', 'S'), ('n-elbertson-roosevelt', 'elbertson', 'ELBERTSON STREET', 'SE'),
                       ('n-britton-roosevelt', 'britton', 'BRITTON AVENUE', 'SW'), ('n-case-roosevelt', 'case', 'CASE STREET', 'SE')]:
    add_cont(nid, st, ln, [d])
for nid, cs in cont.items():
    nodes[nid]['continues'] = [{k: v for k, v in c.items()} for c in cs]
# Streets that end at Roosevelt from the north, per LION (T-intersections): recorded as facts in their notes below.
ends = []
for k in [84, 86, 87, 88, 89, 90]:
    L = nodes[f'n-{k}-roosevelt']['lion']
    assert not [1 for mm, nm, sid in ADJ[L] if nm == f'{k} STREET' and sid not in segLion], k
    ends.append(k)
print('streets ending at Roosevelt (no LION segment south):', ends)

# Stub streets: only their mouth node in the bounds, now drawn as streets that run off the map edge.
for sid in ['baxter', 'forley', 'elbertson', 'britton', 'case']:
    s = streets[sid]
    s['notes'] = (s.get('notes', '') + ' ' if s.get('notes') else '') + 'Session 6d: drawn running off the south edge of the map from its Roosevelt Ave mouth, in its LION bearing (node "continues").'

# ---- zones ----
north = [x for x in added['segments'] if any(x.startswith(p) for p in ('seg-northern-', 'seg-32ave-', 'seg-31ave-')) or x.endswith('-northern-32ave') or x.endswith('-32ave-31ave')]
w['zones'].append({'id': 'northern-blvd', 'name': 'Northern Boulevard', 'lockedDecision': None,
                   'summary': 'Session 6d (owner\'s decision: the map reaches two avenues north of Northern Blvd, as their own named area): Northern Blvd from 73rd to 90th St, 32nd Ave and 31st Ave, and the numbered streets between them. Residential blocks stay generic.',
                   'segments': north})
for z in w['zones']:
    if z['id'] == 'northern-blvd': del z['lockedDecision']

# ---- areas ----
p34 = next(a for a in w['areas'] if a['id'] == 'area-34th-avenue-plaza')
p34['segments'] += [x for x in added['segments'] if x.startswith('seg-34ave-')]
p34['notes'] = p34['notes'].replace('Only 77th-88th St is in the bounds.', 'Since session 6d the bounds take in 73rd-90th St, all drawn as the paseo.')
newhd = [x for x in added['segments'] if frac_in(segs[x]['lion']) >= 0.5]
print('new segments at least half inside the LPC polygon:', newhd)
hd_area['segments'] += newhd

# ---- anchors / landmarks (Northern Blvd storefronts only; no residential points) ----
w['landmarks'] += [
    {'id': 'lm-shop-l', 'zone': 'northern-blvd', 'kind': 'shop', 'fictional': True, 'placeholder': 'Shop L (fictional placeholder)'},
    {'id': 'lm-food-m', 'zone': 'northern-blvd', 'kind': 'food', 'fictional': True, 'placeholder': 'Food stall M (fictional placeholder)'},
]
w['anchors'] += [
    {'id': 'nb-80-1', 'zone': 'northern-blvd', 'segment': 'seg-northern-80-81', 'side': 'south', 't': 0.5, 'uses': ['pickup', 'dropoff'], 'landmark': 'lm-shop-l'},
    {'id': 'nb-86-1', 'zone': 'northern-blvd', 'segment': 'seg-northern-86-87', 'side': 'north', 't': 0.5, 'uses': ['pickup', 'dropoff'], 'landmark': 'lm-food-m'},
]

# ---- retire the split: one map, no warps, no walls ----
del w['connections']; del w['mapConnections']
w['schemaVersion'] = 4
w['bounds'] = {
    'description': ('Session 6d (owner\'s decision: two avenues north of Northern Blvd; east-west bounds stay 73rd-90th St). West 73rd St, east 90th St, '
                    'north 31st Ave (LION 26C: 32nd Ave and 31st Ave are the first two avenues north of Northern Blvd, each crossing every numbered street from 73rd to 90th St), '
                    'south Roosevelt Ave plus the station triangle down to Broadway at 74th-75th St. Grid: x = 0 at 73rd St, +1 per numbered street east; '
                    'y = 0 at 37th Ave, -1 35th Ave, -2 34th Ave, -3 Northern Blvd, -4 32nd Ave, -5 31st Ave, 1 37th Rd, 2 Roosevelt Ave; fractions for Broadway and '
                    'the streets meeting Roosevelt from the south. Distances are stylized; only order and topology are real. Streets that continue past the bounds '
                    '(node "continues", each with the first LION segment beyond) are drawn running to the map edge.'),
    'streets': [f'st-{k}' for k in range(73, 91)],
    'avenues': ['ave-31', 'ave-32', 'northern', 'ave-34', 'ave-35', 'ave-37', 'rd-37', 'roosevelt'],
}

w['layout'] = {
    'description': ('Session 6d: one continuous map (owner\'s decision), scaled so blocks keep their real long-thin shape (owner\'s grid reference). '
                    'Tile position of a grid point: x = gridX * tileX (10 tiles per short east-west block, street centre to street centre); y piecewise linear through rowsY '
                    '([gridY, tileY] pairs): 20-26 tiles per long north-south block, 20 from 37th Ave to 37th Rd, 8 from 37th Rd to Roosevelt Ave, 10 from Roosevelt Ave to Broadway at 75th St. '
                    'halfWidth: corridor half-width in tiles per street, sidewalks included (side streets 2, avenues 3, Northern Blvd and Roosevelt Ave 4). '
                    'edge: walkable tiles past the outermost nodes (where streets run on toward the map edge). viewMargin: tiles of scenery past that, so the camera never stops '
                    'scrolling while the player can move (the player always stays mid-screen). Map tiles = node box + edge + viewMargin on each side (scripts/world-layout.mjs).'),
    'tileX': 10,
    'rowsY': [[-5, -118], [-4, -98], [-3, -72], [-2, -50], [-1, -26], [0, 0], [1, 20], [2, 28], [3, 38]],
    'halfWidth': {'default': 2, 'ave-31': 3, 'ave-32': 3, 'northern': 4, 'ave-34': 3, 'ave-35': 3, 'ave-37': 3, 'roosevelt': 4, 'broadway': 3},
    'edge': 6,
    'viewMargin': 8,
}
w['maps'] = [{'id': 'jackson-heights', 'tiles': [198, 184], 'status': 'built',
              'summary': 'Session 6d: the whole neighborhood as one map the camera scrolls across (owner\'s decision). Every segment of the dataset is on it; zones are named areas on it.'}]
# Keep the key order of the file: schemaVersion, id, bounds, layout, sources, then the collections.
order = ['schemaVersion', 'id', 'bounds', 'layout', 'sources', 'streets', 'nodes', 'segments', 'transit', 'areas', 'zones', 'maps', 'anchors', 'landmarks']
assert set(order) == set(w), set(w) ^ set(order)
def dump(v): return json.dumps(v, ensure_ascii=False)
out = ['{']
for i, k in enumerate(order):
    v = w[k]
    if isinstance(v, list) and v and isinstance(v[0], dict):
        body = '[\n' + ',\n'.join('    ' + dump(e) for e in v) + '\n  ]'
    elif isinstance(v, dict):
        body = json.dumps(v, indent=2, ensure_ascii=False).replace('\n', '\n  ')
    else:
        body = dump(v)
    out.append(f'  {dump(k)}: {body}' + (',' if i < len(order) - 1 else ''))
out.append('}')
open(args.out, 'w').write('\n'.join(out) + '\n')
print({k: len(v) for k, v in added.items()}, 'continues on', len(cont), 'nodes;', 'northern zone segments', len(north))
print('totals', {k: len(w[k]) for k in ('streets', 'nodes', 'segments', 'zones', 'anchors', 'landmarks')})

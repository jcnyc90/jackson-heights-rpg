#!/usr/bin/env python3
# Session 6e: the 30-tile layout and the flank-block zones in the world dataset (schema 5).
# Pure Python, no inputs but the dataset; idempotent. Run, then re-snap the trees to the new layout:
#   python3 -I tools/layout_6e.py [src/data/world/jackson-heights.json]
#   python3 -I tools/derive_6e_data.py ...   (see its header)
import json, math, sys

WORLD = sys.argv[1] if len(sys.argv) > 1 else 'src/data/world/jackson-heights.json'
w = json.load(open(WORLD))
assert w['schemaVersion'] in (5, 6)  # 6: session 6f's bikeDocks (re-run tools/derive_6f_docks.py after a layout change)

# Owner's decisions 2 and 3: 30 tiles per short east-west block; a straight walk from 31st Ave to the
# southern edge in 45 s or less at 150 px/s (6750 px = 421.9 tiles). Corridors keep 6d's widths
# times 3 (6d: 2/3/4 half-widths at 10 tiles per block). The walk area is 392 tiles of grid rows plus
# the 14-tile edge on each side = 420 tiles = 6720 px = 44.8 s.
# Rows (Claude's choice): gap = the two half-widths + a block interior scaled from the real
# interior (LION centre-line distance minus the real half-widths) by ~0.21 tiles/m, so the long
# residential block faces take the compression (real 0.38 tiles/m east-west); 37th Rd to Roosevelt
# gets a 10-tile minimum interior.
#   real centre-line metres (LION 26C, any street): 31-32 173, 32-Northern 237, Northern-34 204,
#   34-35 217, 35-37 228, 37-37Rd 192, 37Rd-Roosevelt 44, Roosevelt-Broadway at 75th 79.
GAPS = [(-5, -4, 49), (-4, -3, 62), (-3, -2, 57), (-2, -1, 58), (-1, 0, 60), (0, 1, 46), (1, 2, 28), (2, 3, 32)]
rows = {0: 0}
for g0, g1, gap in reversed(GAPS[:5]): rows[g0] = rows[g1] - gap
for g0, g1, gap in GAPS[5:]: rows[g1] = rows[g0] + gap
w['layout'] = {
    'description': ('Session 6e: one continuous map at EarthBound-like building scale (owner\'s decisions 2 and 3). '
                    'Tile position of a grid point: x = gridX * tileX (30 tiles per short east-west block, street centre to street centre); '
                    'y piecewise linear through rowsY ([gridY, tileY] pairs). North-south is capped by the 45 s walk at 150 px/s: corridors keep '
                    'their width and the long residential blocks take the compression (tools/layout_6e.py has the numbers). '
                    'halfWidth: corridor half-width in tiles per street, sidewalks included (6d x 3: side streets 6, avenues 9, Northern Blvd and Roosevelt Ave 12). '
                    'edge: walkable tiles past the outermost nodes, ending at the map-edge barriers. viewMargin: tiles of scenery past that, so the camera never stops '
                    'scrolling while the player can move. Map tiles = node box + edge + viewMargin on each side (scripts/world-layout.mjs).'),
    'tileX': 30,
    'rowsY': [[g, rows[g]] for g in sorted(rows)],
    'halfWidth': {'default': 6, 'ave-31': 9, 'ave-32': 9, 'northern': 12, 'ave-34': 9, 'ave-35': 9, 'ave-37': 9, 'roosevelt': 12, 'broadway': 9},
    'edge': 14,
    'viewMargin': 8,
}
xs = [n['grid'][0] for n in w['nodes']]
ys = [rows_y for rows_y in [None]]
def tile_y(gy):
    r = w['layout']['rowsY']
    for (g0, t0), (g1, t1) in zip(r, r[1:]):
        if g0 <= gy <= g1: return round(t0 + (gy - g0) / (g1 - g0) * (t1 - t0))
tx = [round(x * 30) for x in xs]; ty = [tile_y(n['grid'][1]) for n in w['nodes']]
m = w['layout']['edge'] + w['layout']['viewMargin']
w['maps'][0]['tiles'] = [max(tx) - min(tx) + 2 * m, max(ty) - min(ty) + 2 * m]
w['maps'][0]['summary'] = ('Session 6e: the whole neighborhood as one map at 30 tiles per block, loaded at runtime as an external Tiled file '
                           '(base64 + zlib layers) and drawn in chunks (owner\'s decisions 1-3). Every segment of the dataset is on it; zones are named areas on it.')

# Owner's decision 13: the flank blocks (73rd-76th and 89th-90th St, south of Northern Blvd) join the
# nearest zone. A flank segment: in no zone, south of Northern (grid y > -3), midpoint x <= 3.5 or >= 15.5.
# Nearest = zoned segment with the closest midpoint, distances in metres (a grid unit is ~79 m east-west,
# ~215 m north-south).
nodes = {n['id']: n for n in w['nodes']}
def midm(s):
    a, b = nodes[s['from']]['grid'], nodes[s['to']]['grid']
    return ((a[0] + b[0]) / 2 * 79, (a[1] + b[1]) / 2 * 215)
zone_of = {sid: z['id'] for z in w['zones'] for sid in z['segments']}
zoned = [s for s in w['segments'] if s['id'] in zone_of]
moved = {}
for s in w['segments']:
    if s['id'] in zone_of: continue
    a, b = nodes[s['from']]['grid'], nodes[s['to']]['grid']
    mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    if my <= -3 or not (mx <= 3.5 or mx >= 15.5): continue
    near = min(zoned, key=lambda z: (math.dist(midm(z), midm(s)), z['id']))
    moved[s['id']] = zone_of[near['id']]
for z in w['zones']:
    add = sorted(sid for sid, zid in moved.items() if zid == z['id'])
    if add:
        z['segments'] += add
        note = 'Session 6e (owner\'s decision 13): the flank blocks south of Northern Blvd join the nearest zone.'
        if note not in z['summary']: z['summary'] += ' ' + note

order = list(w.keys())
def dump(v): return json.dumps(v, ensure_ascii=False)
out = ['{']
for i, k in enumerate(order):
    v = w[k]
    if isinstance(v, list) and v and isinstance(v[0], dict):
        body = '[\n' + ',\n'.join('    ' + dump(e) for e in v) + '\n  ]'
    elif k == 'trees':
        body = '{\n' + ',\n'.join(f'    {dump(a)}: {dump(b)}' for a, b in v.items()) + '\n  }'
    elif k == 'bikeDocks':  # session 6f (tools/derive_6f_docks.py): one dock per line
        body = '{\n' + ',\n'.join(f'    {dump(a)}: ' + ('[\n' + ',\n'.join('      ' + dump(e) for e in b) + '\n    ]' if a == 'docks' else dump(b)) for a, b in v.items()) + '\n  }'
    elif isinstance(v, dict):
        body = json.dumps(v, indent=2, ensure_ascii=False).replace('\n', '\n  ')
    else:
        body = dump(v)
    out.append(f'  {dump(k)}: {body}' + (',' if i < len(order) - 1 else ''))
out.append('}')
open(WORLD, 'w').write('\n'.join(out) + '\n')
print('rowsY', w['layout']['rowsY'], 'map tiles', w['maps'][0]['tiles'])
print('flank segments moved into zones:', {z: sorted(s for s, zz in moved.items() if zz == z) for z in sorted(set(moved.values()))})

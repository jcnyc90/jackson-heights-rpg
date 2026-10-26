#!/usr/bin/env python3
# Session 6g: derives real local Jackson Heights businesses from OpenStreetMap (Overpass API)
# into `src/data/world/jackson-heights.json` (`businesses` + anchor `landmarks` + `osm-overpass` source).
#   python3 -I tools/fetch_6g_osm.py                        (raw response into gitignored logs/s6g-src)
#   python3 -I tools/derive_6g_businesses.py --lion logs/s6b-src/lion26c-jh.geojson \
#       --osm logs/s6g-src/osm-businesses-jh.json [--world src/data/world/jackson-heights.json]
# Pure Python, no dependencies. Re-running is idempotent.
import argparse, json, math, os, re, unicodedata

ap = argparse.ArgumentParser()
ap.add_argument('--lion', default='logs/s6b-src/lion26c-jh.geojson')
ap.add_argument('--osm', default='logs/s6g-src/osm-businesses-jh.json')
ap.add_argument('--fetch', default='logs/s6g-src/fetch.json')
ap.add_argument('--world', default='src/data/world/jackson-heights.json')
args = ap.parse_args()

w = json.load(open(args.world))
assert w['schemaVersion'] == 6, w['schemaVersion']

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

nodes_by_id = {n['id']: n for n in w['nodes']}
segs = w['segments']
SEGLINE = {s['id']: [pt for sid in s['lion'] for pt in GEOM[sid]] for s in segs}
ORIENT = {s['id']: s['orientation'] for s in w['streets']}

def dist_seg(p, a, b):
    vx, vy = b[0] - a[0], b[1] - a[1]; L2 = vx * vx + vy * vy or 1e-9
    t = max(0, min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2))
    q = (a[0] + t * vx, a[1] + t * vy)
    return math.hypot(p[0] - q[0], p[1] - q[1]), q, t

def nearest_on(seg, p):
    line = SEGLINE[seg['id']]
    # Ensure polyline runs from seg['from'] towards seg['to'] when computing t in [0, 1]
    nf = nodes_by_id.get(seg['from'], {}).get('lion')
    nt = nodes_by_id.get(seg['to'], {}).get('lion')
    if nf in NODE and nt in NODE:
        if math.dist(line[0], NODE[nf]) > math.dist(line[-1], NODE[nf]):
            line = list(reversed(line))
    lengths = [math.dist(a, b) for a, b in zip(line, line[1:])]
    total_len = sum(lengths) or 1e-9
    best = (1e18, None, 0.5)
    acc = 0.0
    for (a, b), seg_len in zip(zip(line, line[1:]), lengths):
        d, q, t_part = dist_seg(p, a, b)
        if d < best[0]:
            best = (d, q, (acc + t_part * seg_len) / total_len)
        acc += seg_len
    return best

def side_of(seg, p):
    d, q, _ = nearest_on(seg, p)
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

pts = [tile_of(*n['grid']) for n in w['nodes']]
xs = [round(x) for x, _ in pts]; ys = [round(y) for _, y in pts]
WALK = (min(xs) - L['edge'], min(ys) - L['edge'], max(xs) + L['edge'], max(ys) + L['edge'])

# Clean text to NFC + Spleen 6x12 printable ASCII / Latin-1 range
REPL = {
    '\u2018': "'", '\u2019': "'", '\u201a': "'", '\u201b': "'",
    '\u201c': '"', '\u201d': '"', '\u201e': '"',
    '\u2013': '-', '\u2014': '-', '\u2212': '-',
    '\u2026': '...', '\u00a0': ' ',
}
def clean_text(s):
    if not s: return ''
    s = unicodedata.normalize('NFC', str(s).strip())
    for k, v in REPL.items():
        s = s.replace(k, v)
    out = []
    for ch in s:
        code = ord(ch)
        if (0x20 <= code <= 0x7e) or (0xa0 <= code <= 0xff):
            out.append(ch)
        else:
            # Transliterate remaining non-Latin-1 characters to ASCII if possible
            decomposed = unicodedata.normalize('NFKD', ch).encode('ascii', 'ignore').decode('ascii')
            out.append(decomposed)
    return re.sub(r'\s+', ' ', ''.join(out)).strip()

# Non-business / civic / street-furniture amenities to skip when not a shop or craft
SKIP_AMENITIES = {
    'bicycle_rental', 'post_box', 'telephone', 'bench', 'waste_basket', 'parking',
    'parking_entrance', 'parking_space', 'fire_station', 'police', 'place_of_worship',
    'school', 'kindergarten', 'childcare', 'library', 'toilets', 'fountain', 'atm',
    'vending_machine', 'recycling', 'public_bookcase', 'social_facility', 'community_centre',
    'bus_station', 'ferry_terminal', 'Subway Entrance', 'clock', 'give_box', 'arts_centre',
    'events_venue', 'public_building', 'townhall', 'courthouse'
}

# Known national / regional chain keywords (detected via brand, brand:wikidata, operator, or name)
CHAIN_PATTERN = re.compile(
    r'\b('
    r'7-eleven|walgreens|cvs|duane\s*reade|rite\s*aid|starbucks|dunkin|mcdonald|burger\s*king|'
    r'wendy\'?s|taco\s*bell|kfc|kentucky\s*fried|popeyes|subway|pizza\s*hut|domino\'?s|papa\s*john|'
    r'chipotle|panera|denny\'?s|ihop|applebee|baskin[\s-]*robbins|carvel|haagen[\s-]*dazs|cold\s*stone|'
    r'chase|jpmorgan|citibank|citigroup|bank\s*of\s*america|td\s*bank|capital\s*one|hsbc|santander|'
    r'wells\s*fargo|citizens\s*bank|apple\s*bank|dime\s*community|flushing\s*bank|cathay\s*bank|'
    r'popular\s*bank|banco\s*popular|ponce\s*bank|ridgewood\s*savings|amalgamated\s*bank|habib\s*american|'
    r't-mobile|metro\s*by\s*t-mobile|metropcs|verizon|at&t|boost\s*mobile|cricket\s*wireless|'
    r'target|gap\b|old\s*navy|banana\s*republic|foot\s*locker|skechers|gnc|vitamin\s*shoppe|'
    r'advance\s*auto|autozone|pep\s*boys|mobil\b|shell\b|bp\b|sunoco|exxon|citgo|amoco|speedway|'
    r'foodtown|c-town|key\s*food|associated\s*supermarket|bravo\s*supermarket|food\s*bazaar|fine\s*fare|'
    r'ideal\s*food|met\s*fresh|western\s*union|moneygram|ups\s*store|fedex|usps|postal\s*service|'
    r'h&r\s*block|jackson\s*hewitt|liberty\s*tax|citymd|northwell|quest\s*diagnostics|labcorp|'
    r'lenscrafters|cohen\'?s\s*fashion|pearlevision|tex\'?s\s*chicken|kennedy\s*fried|crown\s*fried|'
    r'pollo\s*campero|jollibee|gong\s*cha|kung\s*fu\s*tea|tiger\s*sugar|vivi\s*bubble|paris\s*baguette|'
    r'tous\s*les\s*jours|auntie\s*anne|cinnabon|pret\s*a\s*manger|shake\s*shack|five\s*guys|'
    r'sweetgreen|wingstop|checkers|nathan\'?s|little\s*caesars|dollar\s*tree|family\s*dollar|'
    r'marshalls|tj\s*maxx|burlington|aldo\b|payless|gamestop|radioshack|staples|office\s*depot|'
    r'petco|petsmart|sephora|ulta|bath\s*&\s*body|victoria\'?s\s*secret|children\'?s\s*place|carter\'?s|'
    r'gymboree|justice\b|claire\'?s|kay\s*jewelers|zales|pandora\b|swarovski|sunglass\s*hut'
    r')\b',
    re.IGNORECASE,
)

# Map raw OSM shop/amenity/craft tags to (category, sign_key, generic_chain_label)
def classify_tags(tags):
    shop = tags.get('shop', '')
    amenity = tags.get('amenity', '')
    craft = tags.get('craft', '')
    if shop in ('bakery', 'pastry', 'confectionery', 'chocolate', 'cake'):
        return 'bakery', 'bakery', 'Bakery'
    if shop in ('supermarket', 'grocery', 'greengrocer', 'convenience', 'food', 'health_food', 'spices', 'frozen_food', 'seafood', 'cheese', 'dairy', 'pasta', 'tea', 'coffee', 'water'):
        return 'grocery', 'grocery', 'Grocery'
    if shop in ('deli', 'butcher'):
        return 'deli', 'deli', 'Deli'
    if shop in ('chemist', 'medical_supply', 'herbalist') or amenity == 'pharmacy':
        return 'pharmacy', 'pharmacy', 'Pharmacy'
    if shop in ('laundry', 'dry_cleaning'):
        return 'laundry', 'laundry', 'Laundry'
    if shop in ('florist', 'garden_centre', 'plant'):
        return 'florist', 'florist', 'Florist'
    if shop in ('hardware', 'doityourself', 'paint', 'locksmith', 'glaziery', 'electrical', ' flooring', 'tiles', 'furniture', 'lighting', 'houseware', 'appliance', 'carpet', 'curtain', 'bed', 'interior_decoration'):
        return 'hardware', 'hardware', 'Hardware'
    if shop in ('hairdresser', 'beauty', 'cosmetics', 'perfumery', 'massage', 'tattoo', 'nail', 'barber'):
        return 'salon', 'salon', 'Salon'
    if amenity in ('cafe', 'ice_cream', 'juice_bar', 'internet_cafe'):
        return 'cafe', 'cafe', 'Coffee Shop'
    if shop in ('electronics', 'mobile_phone', 'computer', 'radiotechnics', 'hifi', 'appliance', 'vacuum_cleaner', 'video_games'):
        return 'electronics', 'electronics', 'Electronics'
    if amenity in ('restaurant', 'fast_food', 'food_court') or craft == 'caterer':
        return 'restaurant', 'restaurant', 'Restaurant'
    if amenity in ('bar', 'pub', 'nightclub', 'biergarten') or shop in ('alcohol', 'wine', 'beverages'):
        return 'bar', 'bar', 'Bar'
    if amenity in ('bank', 'bureau_de_change', 'money_transfer', 'payment_centre'):
        return 'bank', 'bank', 'Bank'
    if shop in ('clothes', 'shoes', 'fashion', 'fashion_accessories', 'Boutique', 'boutique', 'bag', 'TAILOR', 'tailor', 'fabric', 'sewing', 'leather', 'watches'):
        return 'clothes', 'clothes', 'Clothing Store'
    if shop in ('optician', 'hearing_aids'):
        return 'optician', 'optician', 'Optician'
    if shop in ('jewelry', 'jewellery', 'gold_buyer', 'pawnbroker'):
        return 'jewelry', 'jewelry', 'Jewelry'
    if shop in ('books', 'newsagent', 'stationery', 'copyshop', 'printing', 'art', 'craft', 'frame', 'music', 'musical_instrument', 'record', 'video', 'toys', 'games', 'gift'):
        return 'books', 'books', 'Book & Gift Shop'
    if amenity in ('doctors', 'clinic', 'hospital', 'veterinary', 'pharmacy'):
        return 'clinic', 'clinic', 'Clinic'
    if amenity == 'dentist':
        return 'dentist', 'dentist', 'Dentist'
    if shop in ('travel_agency', 'ticket'):
        return 'travel', 'travel', 'Travel Agency'
    if amenity == 'fuel' or shop in ('car', 'car_repair', 'car_parts', 'tyres', 'motorcycle', 'bicycle'):
        return 'hardware', 'hardware', 'Auto & Bike Shop'
    if amenity in ('post_office', 'driving_school', 'language_school', 'prep_school', 'music_school', 'dancing_school', 'training', 'theatre', 'cinema', 'studio') or craft:
        return 'service', 'books', 'Service Counter'
    return 'shop', 'grocery', 'Shop'

STREET_ABBR = [
    (r'\bStreet\b', 'St'),
    (r'\bAvenue\b', 'Ave'),
    (r'\bRoad\b', 'Rd'),
    (r'\bBoulevard\b', 'Blvd'),
]
def format_address(tags):
    hn = clean_text(tags.get('addr:housenumber', ''))
    st = clean_text(tags.get('addr:street', ''))
    if not hn or not st:
        return None
    for pat, rep in STREET_ABBR:
        st = re.sub(pat, rep, st, flags=re.IGNORECASE)
    return f'{hn} {st}'

def is_chain(tags, raw_name):
    if tags.get('brand') or tags.get('brand:wikidata'):
        return True
    for field in (raw_name, tags.get('operator', ''), tags.get('official_name', '')):
        if field and CHAIN_PATTERN.search(field):
            return True
    return False

osm_data = json.load(open(args.osm))
elements = osm_data.get('elements', [])
MAX_BIZ_DIST = 50.0  # metres from nearest segment centreline

zone_of_seg = {}
for z in w['zones']:
    for sid in z['segments']:
        zone_of_seg[sid] = z['id']

businesses = []
seen_keys = set()
local_count = 0
chain_count = 0

for e in elements:
    tags = e.get('tags', {})
    raw_name = clean_text(tags.get('name', ''))
    if not raw_name:
        continue
    if tags.get('amenity') in SKIP_AMENITIES and 'shop' not in tags and 'craft' not in tags:
        continue
    # Never allow bike-share operator/sponsor names into dataset
    if re.search(r'citi\s*bike|citibike|\blyft\b', raw_name, re.IGNORECASE):
        continue
    lat = e.get('lat') or e.get('center', {}).get('lat')
    lon = e.get('lon') or e.get('center', {}).get('lon')
    if lat is None or lon is None:
        continue
    gx, gy = to_grid(lon, lat)
    tx, ty = tile_of(gx, gy)
    if not (WALK[0] <= tx < WALK[2] and WALK[1] <= ty < WALK[3]):
        continue
    p = grid_m(lon, lat)
    best_seg = None
    best_d = 1e18
    best_t = 0.5
    for s in segs:
        d, _, t_seg = nearest_on(s, p)
        if d < best_d:
            best_d = d
            best_seg = s
            best_t = t_seg
    if best_seg is None or best_d > MAX_BIZ_DIST:
        continue

    side = side_of(best_seg, p)
    t_clamped = round(max(0.02, min(0.98, best_t)), 3)
    category, sign_key, generic_label = classify_tags(tags)
    chain = is_chain(tags, raw_name)
    display_name = generic_label if chain else raw_name
    # Final safety check against Citigroup/Citibank/Citi Bike/Lyft in display_name
    if re.search(r'citi\s*bike|citibike|citigroup|citibank|\blyft\b', display_name, re.IGNORECASE):
        chain = True
        display_name = generic_label

    addr = format_address(tags)
    # Deduplicate identical (name, segment, side, round(t, 1)) entries
    dedup_key = (display_name.lower(), best_seg['id'], side, round(t_clamped, 1))
    if dedup_key in seen_keys and chain:
        continue
    seen_keys.add(dedup_key)

    etype = e['type'][0]  # n, w, r
    bid = f"biz-{etype}-{e['id']}"
    entry = {
        'id': bid,
        'osm': f"{e['type']}/{e['id']}",
        'name': display_name,
        'category': category,
        'sign': sign_key,
        'chain': chain,
        'segment': best_seg['id'],
        'side': side,
        't': t_clamped,
        'tile': [round(tx), round(ty)],
    }
    if addr:
        entry['address'] = addr
    entry['sources'] = ['osm-overpass']
    businesses.append(entry)
    if chain:
        chain_count += 1
    else:
        local_count += 1

businesses.sort(key=lambda b: (b['segment'], b['side'], b['t'], b['id']))

# Also wire real local businesses into the 13 anchor-linked `landmarks` (preserving their ids & zones)
used_biz_for_lm = set()
anchors_by_lm = {a['landmark']: a for a in w['anchors'] if 'landmark' in a}
KIND_CATS = {
    'food': {'restaurant', 'bakery', 'cafe', 'deli', 'bar', 'grocery'},
    'shop': {'grocery', 'clothes', 'electronics', 'hardware', 'florist', 'books', 'jewelry', 'optician', 'pharmacy', 'shop'},
    'service': {'laundry', 'salon', 'bank', 'clinic', 'dentist', 'travel', 'service', 'pharmacy', 'optician'},
}
for lm in w['landmarks']:
    anchor = anchors_by_lm.get(lm['id'])
    if not anchor:
        continue
    want_cats = KIND_CATS.get(lm['kind'], set())
    cands = [
        b for b in businesses
        if not b['chain']
        and b['id'] not in used_biz_for_lm
        and zone_of_seg.get(b['segment']) == lm['zone']
    ]
    if not cands:
        continue
    def lm_score(b):
        same_seg = 0 if b['segment'] == anchor['segment'] else 1
        same_side = 0 if (b['segment'] == anchor['segment'] and b['side'] == anchor['side']) else 1
        cat_match = 0 if b['category'] in want_cats else 1
        dist_t = abs(b['t'] - anchor['t']) if b['segment'] == anchor['segment'] else math.hypot(b['tile'][0] - tile_of(*nodes_by_id[segs[[s['id'] for s in segs].index(anchor['segment'])]['from']]['grid'])[0], 0) / 100.0
        return (same_seg, same_side, cat_match, dist_t)
    cands.sort(key=lm_score)
    pick = cands[0]
    used_biz_for_lm.add(pick['id'])
    lm['fictional'] = False
    lm['name'] = pick['name']
    lm['category'] = pick['category']
    lm['osm'] = pick['osm']
    if 'address' in pick:
        lm['address'] = pick['address']
    elif 'address' in lm:
        del lm['address']
    if 'placeholder' in lm:
        del lm['placeholder']
    lm['sources'] = ['osm-overpass']

fetch_meta = json.load(open(args.fetch)) if os.path.exists(args.fetch) else {'fetched': '2026-10-26T20:26:42Z', 'endpoint': 'https://overpass-api.de/api/interpreter'}
day = fetch_meta['fetched'][:10]
source = {
    'id': 'osm-overpass',
    'title': 'OpenStreetMap POIs via Overpass API (Jackson Heights bbox 40.742,-73.898,40.763,-73.875)',
    'version': f"fetched {fetch_meta['fetched']}",
    'url': fetch_meta.get('endpoint', 'https://overpass-api.de/api/interpreter'),
    'publisher': 'OpenStreetMap contributors (ODbL 1.0)',
    'accessed': day,
    'access': 'read',
    'terms': 'Open Database License (ODbL 1.0, https://www.openstreetmap.org/copyright): attribution to OpenStreetMap contributors. Used in Session 6g per owner directive for real local Jackson Heights businesses and street addresses; national chains are genericized.',
    'usedFor': 'Session 6g: real local Jackson Heights businesses (names, categories, street addresses) snapped to street segments, sides, and t positions, with national chains mapped to generic category names.',
}
w['sources'] = [s_ for s_ in w['sources'] if s_['id'] != source['id']] + [source]
w['businesses'] = businesses

order = [k for k in w if k != 'businesses'] + ['businesses']
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
print(f"businesses written: {len(businesses)} total ({local_count} real local businesses, {chain_count} genericized chains, {sum(1 for b in businesses if 'address' in b)} with street addresses); {len(used_biz_for_lm)} landmarks wired to real local businesses")

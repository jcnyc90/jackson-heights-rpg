#!/usr/bin/env python3
# Session 6g: fetches real local Jackson Heights businesses from OpenStreetMap (Overpass API)
# into gitignored logs/s6g-src/osm-businesses-jh.json (raw, never committed).
#   python3 -I tools/fetch_6g_osm.py [out_dir]     (default logs/s6g-src)
# Pure Python, no dependencies.
import datetime, json, os, sys, urllib.parse, urllib.request

BBOX = (40.742, -73.898, 40.763, -73.875)  # south, west, north, east
QUERY = f"""[out:json][timeout:60];
(
  nwr["shop"]["name"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  nwr["amenity"]["name"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  nwr["craft"]["name"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
);
out center tags;
"""

ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

out = sys.argv[1] if len(sys.argv) > 1 else 'logs/s6g-src'
os.makedirs(out, exist_ok=True)
fetched = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

body = None
used_url = None
data_bytes = urllib.parse.urlencode({'data': QUERY}).encode('utf-8')
for url in ENDPOINTS:
    try:
        req = urllib.request.Request(
            url,
            data=data_bytes,
            headers={'User-Agent': 'jackson-heights-rpg data tool (https://github.com/jcnyc90/jackson-heights-rpg)'},
        )
        with urllib.request.urlopen(req, timeout=90) as r:
            raw = r.read()
        parsed = json.loads(raw)
        if 'elements' in parsed:
            body = raw
            used_url = url
            break
    except Exception as exc:
        print(f'warning: {url} failed: {exc}', file=sys.stderr)

if body is None:
    raise SystemExit('error: all Overpass API endpoints failed')

out_path = os.path.join(out, 'osm-businesses-jh.json')
open(out_path, 'wb').write(body)
elements = json.loads(body).get('elements', [])
meta = {
    'fetched': fetched,
    'endpoint': used_url,
    'bbox': list(BBOX),
    'query': QUERY.strip(),
    'elements': len(elements),
    'terms': 'https://www.openstreetmap.org/copyright (ODbL 1.0)',
}
open(os.path.join(out, 'fetch.json'), 'w').write(json.dumps(meta, indent=2) + '\n')
print(f'osm-businesses-jh.json: {len(body)} bytes ({len(elements)} elements) from {used_url} at {fetched}')

#!/usr/bin/env python3
# Session 6f: fetches the bike-share station positions into gitignored logs/s6f-src/ (raw, never committed).
#   python3 -I tools/fetch_6f_gbfs.py [out_dir]     (default logs/s6f-src)
# Source: Citi Bike's public GBFS 2.3 feed, station_information (operated by Lyft). Owner's one-time
# exception to the NYC-Open-Data-only rule, for station positions only (session 6f, decision 1).
# Terms: the Citi Bike Data License Agreement (https://citibikenyc.com/data-sharing-policy) allows using,
# modifying and distributing the data in a product; it forbids redistributing it as a stand-alone dataset,
# implying endorsement, and using the operator's or sponsor's names or marks. The game commits only
# snapped tile positions and uses generic "Bike Share" branding; nothing in the game names the system.
# Pure Python, no dependencies.
import datetime, json, os, sys, urllib.request

FEEDS = {
    'station_information.json': 'https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_information.json',
    'system_information.json': 'https://gbfs.lyft.com/gbfs/2.3/bkn/en/system_information.json',
}
out = sys.argv[1] if len(sys.argv) > 1 else 'logs/s6f-src'
os.makedirs(out, exist_ok=True)
fetched = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
for name, url in FEEDS.items():
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'jackson-heights-rpg data tool'}), timeout=60) as r:
        body = r.read()
    json.loads(body)  # fail on anything that isn't JSON
    open(os.path.join(out, name), 'wb').write(body)
    print(f'{name}: {len(body)} bytes from {url}')
meta = {'fetched': fetched, 'feeds': FEEDS, 'terms': 'https://citibikenyc.com/data-sharing-policy'}
open(os.path.join(out, 'fetch.json'), 'w').write(json.dumps(meta, indent=2) + '\n')
stations = json.load(open(os.path.join(out, 'station_information.json')))['data']['stations']
print(f'fetched {fetched}: {len(stations)} stations system-wide')

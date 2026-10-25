# Browser checks

Four scripts run inside the dev-server page. They need the DEV-only `window.game` hook,
so they don't work against a production build. The fifth, `live-check.js`, is for the
production build (the live site or `npm run preview`). All of them step frames at exactly
60 fps, so results are deterministic and don't depend on the tab being visible.

| Script | What it checks | Expected |
|--------|----------------|----------|
| `regression-suite.js` | Config, movement, input, collision, camera, blur fix (A–G); strings, font, tileset export, dialogue, NPCs, depth sorting (H–M); Spleen font, the `above` layer, registry, warps, fades, input lock (N–P); delivery orders end to end and the ticket (Q); the world map (6e: external, chunked): street tiles and delivery points reachable (S); movement at 150 px/s, diagonals within 2%, wall sliding, the full east-west and north-south walks (T); thumbstick (U); radar, corner name, edge arrow, zone cards, corner-post signs, the map edge, the ticket (V); depth sorting with houses and trees, collision fuzz through the sliding window, land use, Travers Park, the paseo (W). A–O run on test-map; the rest derive routes from map data (8-way BFS) and walk them with real keys | `137 pass / 0 fail` |
| `render-check.js` | Pixel hashes of fixed scenes on test-map and off-palette pixel counts | 0 off-palette pixels; `fractional-pos` = `int-101-150` (2.10). Session 6d repainted the road light grey, so the map shots' hashes changed (report) |
| `touch-check.js` | On-screen thumbstick (sectors, multi-touch Action, deadzone, release outside, blur) and Action button, including Action driving dialogue and a warp taken with the stick held; the order ticket's and the radar's placement against the controls (and each other); one order completed by touch on the world map, steering the stick along pathfound 8-way routes. Run with a touch viewport (375×812, 667×375; the pane only emulates touch below 768 px wide) | `ticketVsControls.result`, `radarVsControls.result` and `orderByTouch.result` = `PASS` |
| `stream-check.js` | Session 6f: edge to edge across the world map (east-west and north-south) at every speed, walking and riding x1-x8: frames with an unbuilt bin on screen, bins built only as they came into view, window refills; per-frame work (median, p95, worst) at x1 walking and x8 riding. Needs the riding and speedButtons flags (on since 6f; `?features=riding,speedButtons` while they were off) | `summary: 'PASS'` (0 unbuilt-visible frames) |
| `live-check.js` | Production build without the dev hook: fetches the map data, walks pathfound (4-way, dead-reckoned at 2 px a frame) routes with real key events from a new game's start to the Dispatcher and completes Order #1 on the one world map; matches the start zone's name card, every text line and order ticket against the shipped font atlas; checks the radar is drawn, the Spleen notices and page errors; reports the walking time | `summary: 'PASS'` |

## Running

```bash
npm run dev
```

Open <http://localhost:5173>, open the browser console, and paste (swap the file name as needed):

```js
const src = (await import('/tests/browser/regression-suite.js?raw')).default;
const R = await (0, eval)(`(async () => {${src.replace(/\n(R|out);\s*$/, '\nreturn $1;')}})()`);
R.summary ?? R;
```

Run each script on a freshly loaded page: they move the player and leave the game paused-then-resumed,
which is fine for one run but can skew a second one.

### Live-site check

`live-check.js` can't be imported from the live site, so paste its contents into the browser
console on <https://jcnyc90.github.io/jackson-heights-rpg/> (or <http://localhost:4173> after
`npm run build && npm run preview`). Paste it **twice**: the first run re-writes the page with a
`requestAnimationFrame` shim and returns `'reloaded'`; the second runs the checks and returns
the results. Since session 6c the routes come from map data (one map since 6d): the script fetches the registry,
orders and strings from this repo's `main` branch (the world map itself from the site under test) on raw.githubusercontent.com, so it follows whatever
layout is deployed once `main` and the site agree. To check a local preview against the working tree,
keep the dev server running and set `window.__dataBase = 'http://localhost:5173/src/data/'` before the
first paste (it survives the reload).

### Map checks (no browser)

```bash
npm run test:world
```

```bash
npm run maps:check
```

`test:world` validates the dataset and checks the generator's output against the committed maps
(no Tiled needed). `maps:check` regenerates every map through Tiled and fails on any byte difference.

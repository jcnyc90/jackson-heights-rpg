# Browser checks

Three scripts run inside the dev-server page. They need the DEV-only `window.game` hook,
so they don't work against a production build. The fourth, `live-check.js`, is for the
production build (the live site or `npm run preview`). All of them step frames at exactly
60 fps, so results are deterministic and don't depend on the tab being visible.

| Script | What it checks | Expected |
|--------|----------------|----------|
| `regression-suite.js` | Config, movement, input, collision, camera, blur fix (A–G, sessions 1–2); strings, font, tileset export, dialogue, NPC targeting, NPC collision, depth sorting (H–M, session 3); Spleen font, accented text, the `above` layer, registry, warps, fades, input lock, stuck keys and thumbstick across a warp, focus loss mid-fade, broken links, dialogue per map (N–P, session 4); delivery orders: data and broken-order failures, the state machine, one order end to end, the ticket's pixels and placement (Q, session 5); the world map: every street tile and delivery point reachable, one map covering the dataset (S, 6c/6d); 8-way movement, diagonal speed, wall sliding, keyboard diagonals and facing, 8-way BFS, the end-to-end walk time (T); thumbstick sectors, deadzone, knob (U); minimap, player/target/Dispatcher markers, overlaps, edge arrow, zone name card, street signs, the intersection ticket (V) (6d). A–O run on test-map; P, Q, S–V derive routes from map data (8-way BFS) and walk them with real keys | `130 pass / 0 fail` |
| `render-check.js` | Pixel hashes of fixed scenes on test-map and off-palette pixel counts | 0 off-palette pixels; `fractional-pos` = `int-101-150` (2.10). Session 6d repainted the road light grey, so the map shots' hashes changed (report) |
| `touch-check.js` | On-screen thumbstick (sectors, multi-touch Action, deadzone, release outside, blur) and Action button, including Action driving dialogue and a warp taken with the stick held; the order ticket's and the minimap's placement against the controls (and each other); one order completed by touch on the world map, steering the stick along pathfound 8-way routes. Run with a touch viewport (375×812, 667×375; the pane only emulates touch below 768 px wide) | `ticketVsControls.result`, `minimapVsControls.result` and `orderByTouch.result` = `PASS` |
| `live-check.js` | Production build without the dev hook: fetches the map data, walks pathfound (4-way, dead-reckoned at 2 px a frame) routes with real key events from a new game's start to the Dispatcher and completes Order #1 on the one world map; matches the start zone's name card, every text line and order ticket against the shipped font atlas; checks the minimap is drawn, the Spleen notices and page errors; reports the walking time | `summary: 'PASS'` |

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
the results. Since session 6c the routes come from map data (one map since 6d): the script fetches the registry, maps,
orders and strings from this repo's `main` branch on raw.githubusercontent.com, so it follows whatever
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

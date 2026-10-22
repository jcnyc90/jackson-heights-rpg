# Browser checks

Three scripts run inside the dev-server page. They need the DEV-only `window.game` hook,
so they don't work against a production build. The fourth, `live-check.js`, is for the
production build (the live site or `npm run preview`). All of them step frames at exactly
60 fps, so results are deterministic and don't depend on the tab being visible.

| Script | What it checks | Expected |
|--------|----------------|----------|
| `regression-suite.js` | Config, movement, input, collision, camera, blur fix (A–G, sessions 1–2); strings, font, tileset export, dialogue, NPC targeting, NPC collision, depth sorting (H–M, session 3); Spleen font pixel-exact from the BDF, accented text, the `above` layer, map registry, every warp both ways, fades, input lock, stuck keys and D-pad, focus loss mid-fade, broken-link handling, dialogue in each map (N–P, session 4); delivery orders: data and broken-order failures, the order state machine, one order end to end across two warps with state surviving them, the order ticket's pixels and placement (Q, session 5) | `111 pass / 0 fail` |
| `render-check.js` | Pixel hashes of fixed scenes and off-palette pixel counts | 0 off-palette pixels; `fractional-pos` = `int-101-150` (2.10). Session 4 hashes are in its report (the tree redraw changed the map shots) |
| `touch-check.js` | On-screen D-pad and Action button, including Action driving dialogue and a warp taken with the D-pad held; the order ticket's placement against the controls and one order completed by touch (session 5). Run with a touch viewport (375×812, 667×375, and 700×525 / 760×700 where the controls overlap the game; the pane only emulates touch below 768 px wide) | `ticketVsControls.result` and `orderByTouch.result` = `PASS`; the rest see the session reports |
| `live-check.js` | Production build without the dev hook: walks all four warps with real key events, matches each arrival's name card and the accented font-test line against the shipped font atlas, checks the fade reaches black, the Spleen notices, and page errors | `summary: 'PASS'` |

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
the results. The walk is scripted in frames from the start spawn and follows the session 4 maps,
so update it when those layouts change.

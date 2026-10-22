# Browser checks

Three scripts that run inside the dev-server page. They need the DEV-only `window.game` hook,
so they don't work against a production build. Each pauses Phaser's loop and steps frames at
exactly 60 fps, so results are deterministic and don't depend on the tab being visible.

| Script | What it checks | Expected |
|--------|----------------|----------|
| `regression-suite.js` | Config, movement, input, collision, camera, blur fix (A–G, sessions 1–2); strings, font, tileset export, dialogue, NPC targeting, NPC collision, depth sorting (H–M, session 3) | `80 pass / 0 fail` |
| `render-check.js` | Pixel hashes of fixed scenes and off-palette pixel counts | 0 off-palette pixels; session-2 shots keep their hashes (`docs/DESIGN.md` 2.10) |
| `touch-check.js` | On-screen D-pad and Action button, including Action driving dialogue. Run with a touch viewport (375×812 and 667×375) | see the session reports |

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

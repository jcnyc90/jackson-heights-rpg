# Jackson Heights RPG

An EarthBound-inspired browser RPG set in Jackson Heights, Queens. Built with Phaser 4, Vite and TypeScript.

Play it: <https://jcnyc90.github.io/jackson-heights-rpg/>

> **Status: early scaffold.** Jackson Heights from 73rd to 90th St and from Roosevelt Ave up to 31st Ave is one continuous map, generated from NYC city data: drawn at 30 tiles a block in a hybrid oblique view: buildings chosen per block face from city land-use data, Travers Park, the grassy 34th Ave paseo with green bike lanes, census street trees, crosswalks, signals with corner-post street signs, the elevated 7 over Roosevelt Ave and barricades where the map ends. There's 8-way movement at 150 px/s (keyboard or an on-screen thumbstick), a circular radar, a placeholder Dispatcher and a first delivery loop with three placeholder orders. All art is placeholder, generated in code. No story, battles or saves yet. See [`docs/DESIGN.md`](docs/DESIGN.md) for locked design decisions and the roadmap.

## Requirements

- Node.js **22.12+**; 24 recommended (`.nvmrc` selects the latest 24.x, which CI uses too)
- npm 10+

## Run it

```bash
npm ci
npm run dev
```

Open <http://localhost:5173>. Add `?debug` to the URL to draw collision boxes (dev server only).

### Controls

| Action | Keyboard | Touch |
|--------|----------|-------|
| Move (8-way; two keys for a diagonal) | Arrow keys / WASD | On-screen thumbstick |
| Action (talk / next page) | Space / Enter / Z | Round button |

Touch controls appear only on touch devices. Face an NPC and press Action to talk; Action finishes the current page, then turns the page, then closes the window. You can't walk while the window is open.

**Deliveries:** talk to the Dispatcher on the north sidewalk of Roosevelt Ave between 74th and 75th St (a new game starts next to them) to get an order. The ticket at the bottom of the screen names the intersection to go to ("Pick up: 73rd St & 37th Rd"); the radar in the top-left corner marks it (on its rim while it's off the radar), the top-right corner names the crossing you stand in, an arrow at the screen edge points to it while it's off-screen, and a tag bobs over its door. Face the door and press Action, then do the same at the dropoff. One order at a time; progress is lost on reload (no saves yet).

Street signs at every intersection name the two streets, and a name card shows when you walk into an area (Diversity Plaza, Roosevelt Avenue, 37th Avenue, Historic District, Northern Boulevard).

### Test on a phone

Your phone must be on the same Wi-Fi network as your computer:

```bash
npm run dev -- --host
```

Then open the `Network:` URL that Vite prints. `--host` exposes the dev server to your whole local network, so only use it on a network you trust, and stop it when you're done. Vite's dev server has had several file-access security fixes; keep Vite updated.

## Build

```bash
npm run build
```

This runs `tsc --noEmit` (type check; any error fails the build) and then `vite build`, which writes the output to `dist/`. To serve the production build locally:

```bash
npm run preview
```

Then open <http://localhost:4173>.

## Deploy (GitHub Pages)

The workflow `.github/workflows/deploy.yml` builds and publishes `dist/` on every push to `main`.

`vite.config.ts` uses a relative `base: './'`, so the build works at `https://<user>.github.io/<repo>/` under any repo name, and also locally.

One-time setup:

1. Create an **empty** GitHub repo `jcnyc90/jackson-heights-rpg`, without a README or licence, so the first push doesn't conflict. On the GitHub Free plan, Pages only works for **public** repos. Don't let GitHub add a licence; `LICENSE` and `LICENSE-CONTENT` are already in the repo.
2. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push. The local repo is already on branch `main`; the workflow only runs for `main`.
   ```bash
   git remote add origin https://github.com/jcnyc90/jackson-heights-rpg.git
   git push -u origin main
   ```
4. Watch the **Actions** tab. The site goes live at <https://jcnyc90.github.io/jackson-heights-rpg/>. If the push happened before step 2, re-run the workflow from the Actions tab.

## Project layout

```
index.html                 page shell + touch-control markup
src/
  main.ts                  loads the external world map, then the game
  game.ts                  Phaser game config
  config.ts                resolution, tile size, texture keys, sprite layout
  style.css                full-screen layout, touch controls
  scenes/
    BootScene.ts           load maps and the font atlas, generate placeholder art, register animations
    MapScene.ts            plays any registered map: 8-way movement, NPCs, talking, depth sorting, warps + fades,
                           radar, corner name, target arrow, zone name cards
    DialogueScene.ts       text window (typewriter, pages), launched over the map
  systems/
    controls.ts            keyboard + touch -> direction / action
    touchControls.ts       on-screen thumbstick + action button (DOM)
    placeholderArt.ts      code-drawn placeholder tiles, sprites and window frame
    font.ts                registers the Spleen 6x12 atlas as a bitmap font; character set
    maps.ts                map registry; spawns, warps, delivery points, signs, corners, zones, walkable area from Tiled; link checks
    mapLoader.ts           fetches and inflates the external world map (base64 + zlib layers) before the game loads
    worldView.ts           draws the world map: a sliding ground/collision tile window + sprite bins near the camera
    worldArt.ts            placeholder buildings (front face, shaded side face, roof strip) and street-furniture sprites
    radar.ts               the circular radar
    strings.ts             t(id, params) lookup for all player-facing text
    textLayout.ts          word wrap + pagination for the text window
    npcs.ts                reads and validates NPCs from the Tiled "npcs" layer
    orders.ts              loads and validates delivery orders
    gameState.ts           in-memory state that survives warps: active order, deliveries, reward total
  data/
    strings/en.json        every player-facing string, keyed by ID
    dialogue.json          dialogue ID -> list of string IDs
    orders.json            delivery orders: pickup, dropoff, item, reward, string IDs
    maps/index.json        map registry: id, file (bundled) or url (external), display-name string ID; start point
    maps/test-map.json     hand-made test fixture (Tiled 1.12)
    tiles.json             tile ids of the placeholder tilesets (shared by the art and the generator)
    world/jackson-heights.json  world dataset: streets, nodes, segments, zones, anchors, sources (the generator's input; DESIGN.md 2.14)
public/assets/maps/jackson-heights.json  the world map (generated, 554x436, zlib layers), fetched at runtime
public/assets/tilesets/    tiles.png + overhead.png: placeholder tilesets exported for Tiled (see Editing maps)
public/assets/fonts/spleen-6x12.png  font atlas, generated from the BDF (third-party, BSD-2-Clause)
third_party/spleen-2.2.0/  Spleen 6x12 BDF and LICENSE, unmodified from the 2.2.0 release (SOURCE.txt)
scripts/build-font-atlas.mjs  BDF -> PNG atlas converter (no dependencies)
scripts/validate-world.mjs    world dataset validator: npm run validate:world (no dependencies)
scripts/generate-maps.mjs     world dataset -> Tiled map: npm run maps:generate / maps:check (needs Tiled)
tools/                     Python scripts that derive the dataset from raw NYC Open Data kept in gitignored logs/
tests/browser/             regression, render, touch and live-site checks
tests/world/               validator and generator tests: npm run test:world (node --test, no dependencies)
public/THIRD-PARTY-NOTICES.txt  licences of bundled third-party code (served with the game)
docs/DESIGN.md             locked decisions, conventions, Phaser 4 notes, roadmap
LICENSE                    MIT (code)
LICENSE-CONTENT            CC BY-NC-SA 4.0 (content)
```

## Swapping in real art

Placeholder textures are generated at boot under the keys in `src/config.ts`. To replace one, load a file under the **same key** in `BootScene.preload()`, with the same frame size and layout. The generator skips keys that already exist. For example:

```ts
this.load.spritesheet(TEXTURES.player, 'assets/sprites/player.png', { frameWidth: 16, frameHeight: 24 });
this.load.image(TEXTURES.tiles, 'assets/tilesets/tiles.png');
```

Layouts are documented in [`docs/DESIGN.md` §2.3](docs/DESIGN.md#23-asset-keys-and-sizes-swap-contract).

## License

Code and content are licensed separately. Copyright (c) 2026 jcnyc90.

| License | Applies to |
|---------|------------|
| **MIT** ([`LICENSE`](LICENSE)) — code | `src/**` except `src/data/**` (including `src/systems/placeholderArt.ts`: its code-drawn placeholder art is MIT like the rest of the code, and replacing it later doesn't revoke that; the same holds for the placeholder font that sessions 1–3 drew in code, now removed), `scripts/**`, `tests/**`, `src/style.css`, `index.html`, build and tooling files (`package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `.github/**`, dotfiles), and this `README.md` |
| **CC BY-NC-SA 4.0** ([`LICENSE-CONTENT`](LICENSE-CONTENT)) — content | `src/data/**` (maps now; dialogue, story text and other game data later), `public/assets/**` (art, audio) except `public/assets/fonts/**`, and `docs/**` (design and narrative documents) |
| **BSD-2-Clause** (Spleen's own [`LICENSE`](third_party/spleen-2.2.0/LICENSE)) — third-party font | `third_party/spleen-2.2.0/**` (Spleen 6x12 by Frederic Cambus, unmodified) and `public/assets/fonts/spleen-6x12.png` (a pixel-exact bitmap generated from it). Not ours, so neither MIT nor CC applies. |

Third-party paths take precedence over content paths, and content paths over code paths. Anything not listed under content or third-party is code and falls under MIT, except the licence and notice files themselves (`LICENSE`, `LICENSE-CONTENT`, `public/THIRD-PARTY-NOTICES.txt`), which keep their own terms. `package.json` declares `"license": "MIT"` for the code.

The built game in `dist/` bundles both kinds of material, so redistributing the build means following both licences, including CC BY-NC-SA's non-commercial and share-alike terms for the content.

Third-party: the build bundles [Phaser](https://phaser.io) (MIT), along with code Phaser itself includes: eventemitter3, Matter.js, poly-decomp (MIT), Earcut (ISC), Simplify.js (BSD-2-Clause), psrdnoise (MIT) and a few attributed snippets. The game's font is [Spleen](https://github.com/fcambus/spleen) 6x12, release 2.2.0, © 2018-2026 Frederic Cambus, BSD-2-Clause; it's bundled with the game as a PNG atlas, never loaded from elsewhere. All their notices ship with the game in [`public/THIRD-PARTY-NOTICES.txt`](public/THIRD-PARTY-NOTICES.txt), and a banner at the top of the built JS names Spleen and points to that file.

When Phaser, the font or other dependencies change, update that file. Check the installed `LICENSE` files, and look for vendored code inside Phaser's build with:

```bash
grep -nE "ISC License|Redistribution and use|Copyright \(c\)|@license" node_modules/phaser/dist/phaser.esm.js | grep -v "Phaser Studio"
```

### World data

The street layout is hand-drawn using public NYC data as a reference only. `src/data/world/jackson-heights.json` records facts (street names, which streets meet, their order, pedestrian-only blocks, station corners) and the LION ids they came from, not copied geometry or coordinates. Sources, all accessed 2026-10-23:

- **LION** single line street base map, release 26C (August 2026), NYC Department of City Planning (BYTES of the BIG APPLE). Provided for informational purposes only; DCP makes no warranty of completeness, accuracy or fitness for any purpose.
- **Historic Districts**, NYC Landmarks Preservation Commission; **Pedestrian Plazas**, NYC Department of Transportation; **Parks Properties**, NYC Department of Parks and Recreation. All via NYC Open Data, which has no restrictions on use.
- **Subway Stations** and **Subway Entrances and Exits: 2024**, Metropolitan Transportation Authority, via data.ny.gov (OPEN-NY Terms of Use).
- Queens Pride Parade route: NYPD traffic advisory (June 2023) and NYC DOT's 2026 closures as reported by CBS New York.

This game isn't endorsed by the City of New York, its agencies, the State of New York or the MTA. The layout is simplified and stylized: don't use it for navigation. Exact URLs and versions are in the dataset's `sources` and in [`docs/DESIGN.md` §2.14](docs/DESIGN.md#214-world-dataset-sessions-6a-6b).

## Editing maps

Maps are Tiled JSON with embedded tilesets, listed in `src/data/maps/index.json`. The layer and property conventions are in [`docs/DESIGN.md` §2.4](docs/DESIGN.md#24-maps-tiled); warps and spawn points are in [§2.12](docs/DESIGN.md#212-maps-warps-and-zones-session-4); delivery points and orders in [§2.13](docs/DESIGN.md#213-delivery-loop-session-5).

**The world map is generated, never edited by hand:** change `src/data/world/jackson-heights.json` or `scripts/generate-maps.mjs`, then run `npm run maps:generate` (it needs Tiled for the final write; `npm run maps:check` fails on any difference). See [`docs/DESIGN.md` §2.15](docs/DESIGN.md#215-map-generator-sessions-6c-6d). Only the test map is hand-made.

The maps' tilesets point at `public/assets/tilesets/tiles.png` and `overhead.png`, pixel-exact exports of the placeholder tilesets that the game draws at runtime (regression checks H6 and O4 fail if they drift). The game itself doesn't load the PNGs yet; it will once real tiles replace the placeholders. They're under `public/assets/**`, so they're CC BY-NC-SA by path, but they're also exports of MIT placeholder art, so the MIT grant for that art still applies.

## Changing the font

The font atlas is generated, not drawn: `node scripts/build-font-atlas.mjs` rebuilds `public/assets/fonts/spleen-6x12.png` from the BDF. To add characters (e.g. curly quotes), add their code point range to the script and to `FONT_RANGES` in `src/systems/font.ts`; regression check N2 fails if the two disagree.

The map opens and saves cleanly in Tiled 1.12 (round trip verified in session 3). The workflow, NPC layer and flip rules are in [`docs/DESIGN.md` §2.4](docs/DESIGN.md#24-maps-tiled). Keep the tileset **embedded**; Phaser ignores external tilesets.

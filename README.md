# Jackson Heights RPG

An EarthBound-inspired browser RPG set in Jackson Heights, Queens. Built with Phaser 4, Vite and TypeScript.

Play it: <https://jcnyc90.github.io/jackson-heights-rpg/>

> **Status: early scaffold.** There's a walkable test map and two rough stub zones (Roosevelt Avenue, Diversity Plaza) connected by warps with fades, collision, keyboard and touch controls, placeholder art generated in code, and placeholder NPCs you can talk to (EarthBound-style text window, Spleen pixel font). No story, quests, battles or saves yet. See [`docs/DESIGN.md`](docs/DESIGN.md) for locked design decisions and the roadmap.

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
| Move (4-way) | Arrow keys / WASD | On-screen D-pad |
| Action (talk / next page) | Space / Enter / Z | Round button |

Touch controls appear only on touch devices. Face an NPC and press Action to talk; Action finishes the current page, then turns the page, then closes the window. You can't walk while the window is open.

Walk onto a warp to change maps: on the test map, the east end of the street leads to Roosevelt Avenue, and the gap in Roosevelt Avenue's north side leads to Diversity Plaza. Input is locked during the fade, and a key or D-pad held through it has to be pressed again.

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
  main.ts                  Phaser game config
  config.ts                resolution, tile size, texture keys, sprite layout
  style.css                full-screen layout, touch controls
  scenes/
    BootScene.ts           load maps and the font atlas, generate placeholder art, register animations
    MapScene.ts            plays any registered map: movement, NPCs, talking, depth sorting, warps + fades
    DialogueScene.ts       text window (typewriter, pages), launched over the map
  systems/
    controls.ts            keyboard + touch -> direction / action
    touchControls.ts       on-screen D-pad + action button (DOM)
    placeholderArt.ts      code-drawn placeholder tiles, sprites and window frame
    font.ts                registers the Spleen 6x12 atlas as a bitmap font; character set
    maps.ts                map registry, spawn points and warps from Tiled, link checks
    strings.ts             t(id, params) lookup for all player-facing text
    textLayout.ts          word wrap + pagination for the text window
    npcs.ts                reads and validates NPCs from the Tiled "npcs" layer
  data/
    strings/en.json        every player-facing string, keyed by ID
    dialogue.json          dialogue ID -> list of string IDs
    maps/index.json        map registry: id, file, display-name string ID; start point
    maps/*.json            Tiled maps (30x20), saved by Tiled 1.12: test-map, roosevelt-ave, diversity-plaza-74th
public/assets/tilesets/    tiles.png + overhead.png: placeholder tilesets exported for Tiled (see Editing maps)
public/assets/fonts/spleen-6x12.png  font atlas, generated from the BDF (third-party, BSD-2-Clause)
third_party/spleen-2.2.0/  Spleen 6x12 BDF and LICENSE, unmodified from the 2.2.0 release (SOURCE.txt)
scripts/build-font-atlas.mjs  BDF -> PNG atlas converter (no dependencies)
tests/browser/             regression, render, touch and live-site checks
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

## Editing maps

Maps are Tiled JSON with embedded tilesets, listed in `src/data/maps/index.json`. The layer and property conventions are in [`docs/DESIGN.md` §2.4](docs/DESIGN.md#24-maps-tiled); warps and spawn points are in [§2.12](docs/DESIGN.md#212-maps-warps-and-zones-session-4).

The maps' tilesets point at `public/assets/tilesets/tiles.png` and `overhead.png`, pixel-exact exports of the placeholder tilesets that the game draws at runtime (regression checks H6 and O4 fail if they drift). The game itself doesn't load the PNGs yet; it will once real tiles replace the placeholders. They're under `public/assets/**`, so they're CC BY-NC-SA by path, but they're also exports of MIT placeholder art, so the MIT grant for that art still applies.

## Changing the font

The font atlas is generated, not drawn: `node scripts/build-font-atlas.mjs` rebuilds `public/assets/fonts/spleen-6x12.png` from the BDF. To add characters (e.g. curly quotes), add their code point range to the script and to `FONT_RANGES` in `src/systems/font.ts`; regression check N2 fails if the two disagree.

The map opens and saves cleanly in Tiled 1.12 (round trip verified in session 3). The workflow, NPC layer and flip rules are in [`docs/DESIGN.md` §2.4](docs/DESIGN.md#24-maps-tiled). Keep the tileset **embedded**; Phaser ignores external tilesets.

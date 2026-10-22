# Jackson Heights RPG

An EarthBound-inspired browser RPG set in Jackson Heights, Queens. Built with Phaser 4, Vite and TypeScript.

Play it: <https://jcnyc90.github.io/jackson-heights-rpg/>

> **Status: early scaffold.** There's a walkable test map with collision, keyboard and touch controls, placeholder art generated in code, and three placeholder NPCs you can talk to (EarthBound-style text window). No story, quests, battles or saves yet. See [`docs/DESIGN.md`](docs/DESIGN.md) for locked design decisions and the roadmap.

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
    BootScene.ts           load data, generate placeholder art and font, register animations
    TestMapScene.ts        walkable test map, NPCs, talking, depth sorting
    DialogueScene.ts       text window (typewriter, pages), launched over the map
  systems/
    controls.ts            keyboard + touch -> direction / action
    touchControls.ts       on-screen D-pad + action button (DOM)
    placeholderArt.ts      code-drawn placeholder tiles, sprites and window frame
    placeholderFont.ts     code-drawn placeholder pixel font
    strings.ts             t(id, params) lookup for all player-facing text
    textLayout.ts          word wrap + pagination for the text window
    npcs.ts                reads and validates NPCs from the Tiled "npcs" layer
  data/
    strings/en.json        every player-facing string, keyed by ID
    dialogue.json          dialogue ID -> list of string IDs
    maps/test-map.json     Tiled map (30x20), saved by Tiled 1.12
public/assets/tilesets/tiles.png  placeholder tileset exported for Tiled (see Editing maps)
tests/browser/             regression, render and touch checks (run in the dev server)
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
| **MIT** ([`LICENSE`](LICENSE)) — code | `src/**` except `src/data/**` (including `src/systems/placeholderArt.ts` and `src/systems/placeholderFont.ts`: their code-drawn placeholder art and font are MIT like the rest of the code, and replacing them later doesn't revoke that), `tests/**`, `src/style.css`, `index.html`, build and tooling files (`package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `.github/**`, dotfiles), and this `README.md` |
| **CC BY-NC-SA 4.0** ([`LICENSE-CONTENT`](LICENSE-CONTENT)) — content | `src/data/**` (maps now; dialogue, story text and other game data later), `public/assets/**` (art, audio), and `docs/**` (design and narrative documents) |

Content paths take precedence over code paths. Anything not listed under content is code and falls under MIT, except the licence and notice files themselves (`LICENSE`, `LICENSE-CONTENT`, `public/THIRD-PARTY-NOTICES.txt`), which keep their own terms. `package.json` declares `"license": "MIT"` for the code.

The built game in `dist/` bundles both kinds of material, so redistributing the build means following both licences, including CC BY-NC-SA's non-commercial and share-alike terms for the content.

Third-party: the build bundles [Phaser](https://phaser.io) (MIT), along with code Phaser itself includes: eventemitter3, Matter.js, poly-decomp (MIT), Earcut (ISC), Simplify.js (BSD-2-Clause), psrdnoise (MIT) and a few attributed snippets. Their notices ship with the game in [`public/THIRD-PARTY-NOTICES.txt`](public/THIRD-PARTY-NOTICES.txt), and a banner at the top of the built JS points to it.

When Phaser or other dependencies change, update that file. Check the installed `LICENSE` files, and look for vendored code inside Phaser's build with:

```bash
grep -nE "ISC License|Redistribution and use|Copyright \(c\)|@license" node_modules/phaser/dist/phaser.esm.js | grep -v "Phaser Studio"
```

## Editing maps

Maps are Tiled JSON with embedded tilesets. The layer and property conventions are in [`docs/DESIGN.md` §2.4](docs/DESIGN.md#24-maps-tiled).

The map's tileset points at `public/assets/tilesets/tiles.png`, a pixel-exact export of the placeholder tileset that the game draws at runtime (a regression check fails if they drift apart). The game itself doesn't load the PNG yet; it will once real tiles replace the placeholder. The PNG is under `public/assets/**`, so it's CC BY-NC-SA by path, but it's also an export of MIT placeholder art, so the MIT grant for that art still applies.

The map opens and saves cleanly in Tiled 1.12 (round trip verified in session 3). The workflow, NPC layer and flip rules are in [`docs/DESIGN.md` §2.4](docs/DESIGN.md#24-maps-tiled). Keep the tileset **embedded**; Phaser ignores external tilesets.

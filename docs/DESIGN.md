# Jackson Heights RPG — Design

An EarthBound-inspired browser RPG set in Jackson Heights, Queens. A community love letter.

- **Repo:** `jcnyc90/jackson-heights-rpg`, deployed to GitHub Pages.
- **Stack:** Phaser 4 (4.2.1) + Vite + TypeScript, static site, no backend. Live at <https://jcnyc90.github.io/jackson-heights-rpg/>.
- **Licences:** code MIT (`LICENSE`); content CC BY-NC-SA 4.0 (`LICENSE-CONTENT`). README.md lists which paths fall under each.

This document has three parts:

1. **Locked decisions:** set by the project owner. Change them only on purpose.
2. **Technical conventions:** set in session 1 to keep future work cheap. They're cheap to change now and get more expensive later.
3. **Roadmap and open questions.**

Section 2.10 records what changed when the engine moved from Phaser 3.90.0 to 4.2.1.

---

## 1. Locked decisions

Status column: **Session 1** = applied in the scaffold; **Later** = recorded only, not implemented yet.

| # | Area | Decision | Status |
|---|------|----------|--------|
| 1 | World structure | The **Roosevelt Ave corridor** is an overworld map connecting small explorable **mini-zones**: **74th St / Diversity Plaza**, **Roosevelt Ave under the 7 train**, **37th Ave / Pride route**, **Historic District / co-op gardens**. | Later |
| 2 | Communities represented | **Latin American**, **South Asian**, **Himalayan** (Tibetan/Sherpa, centred on the 74th St momo spots), **LGBTQ+ / Jackson Heights Pride history**. | Later |
| 3 | Protagonist | An **adult local delivery worker**. | Later (the placeholder sprite is a delivery worker with a cap and an insulated bag) |
| 4 | Core loop | **Delivery orders drive quests** and move the player between zones. | Later |
| 5 | Antagonist theme | **Gentrification**, rendered with EarthBound-style absurdity. **All developers, landlords, and businesses must be fictional: no real names, logos, or identifiable people.** | Later |
| 6 | Battles | **EarthBound-style first-person menu battles** with a **rolling HP meter**. Special abilities are **tenant-organizing moves** (e.g. rent strike, petition, block party). | Later |
| 7 | Language | **English only for now**, but **all player-facing strings live in external JSON data files, keyed by ID**, so localization can be added without refactoring. | Later (session 1 shows no in-game text) |
| 8 | Saves | **localStorage**. | Later |
| 9 | Art | Placeholder sprites and tiles **generated in code**. **EarthBound-like pastel palette, chunky dark outlines, 16×16 tiles**, scaled with **crisp pixel rendering (no smoothing)**. Real art replaces placeholders later, so **asset keys and sizes must be swap-friendly**. | Session 1 |
| 10 | IP | Emulate EarthBound's **style and mechanics only**. **No Nintendo/EarthBound sprites, music, names, fonts, or enemy designs.** | Applies always (all session 1 art is original) |
| 11 | Platform | **Desktop browser** (keyboard) and **mobile browser** (on-screen **D-pad + action button**, shown **only on touch devices**). | Session 1 |

### Guardrails that follow from the locked decisions

- **Fiction boundary (#5):** real *places* (streets, avenues, Diversity Plaza, the 7 train) set the scene. Every *business, developer, landlord and antagonist* is invented. Real restaurants (e.g. the 74th St momo spots) get fictional stand-ins, not real names or logos.
- **Strings (#7):** no player-facing text is hard-coded anywhere, in TypeScript or HTML. See convention 2.6.
  - Session 1 shows no in-game text.
  - The only exceptions are `index.html`'s `<title>` and `<html lang="en">`. Once the strings lookup exists (session 3), these are set from the strings file at boot.
- **IP (#10):** no ripped assets, no soundalike music, no EarthBound font clones.
  - No EarthBound names: character and place names (e.g. "Ness", "Onett"), ability systems ("PSI"), and menu labels ("Bash", "Goods", "Auto Fight").
  - Mechanics such as the rolling HP meter aren't copyrightable; specific expression is.
  - Avoid using "EarthBound" in the game's title or logo.

---

## 2. Technical conventions (session 1)

### 2.1 Architecture

- Plain Phaser scenes plus small TypeScript modules. **No ECS, no DI container, no state library.** Add structure only when a second real use case appears.
- `src/scenes/`: one file per Phaser scene. `BootScene` loads data, generates placeholder textures and registers animations. `TestMapScene` is the walkable test map.
- `src/systems/`: reusable logic that isn't a scene (input, placeholder art).
- `src/data/`: JSON game data, bundled with the code and validated at build time (a malformed JSON file fails `npm run build`).
- `public/assets/`: binary assets served as-is (real art, audio). Empty for now.

### 2.2 Rendering and scaling

- Internal resolution is **256×224** (EarthBound's SNES resolution), set in `src/config.ts`.
- `Phaser.Scale.FIT` scales the canvas to the largest size that fits, centred, with letterboxing. `pixelArt: true` gives nearest-neighbour filtering and whole-pixel positions; the canvas also has `image-rendering: pixelated`.
- Phaser 4 achieves whole-pixel output by rounding each sprite and tile vertex, not by rounding the camera scroll as v3 did; see 2.10. Keep positions whole-pixel: integer speeds per step, no camera zoom, no sprite scaling or rotation.
- The game renders at 256×224 and the browser upscales it, so tile seams can't appear. On some screens the scale factor isn't a whole number, which makes a few pixel columns 1 device-pixel wider than others. If that's visible on real devices, switch to integer scaling later.

### 2.3 Asset keys and sizes (swap contract)

All keys live in `src/config.ts` (`TEXTURES`, `PLAYER_FRAME`).

| Key | Kind | Size / layout |
|-----|------|---------------|
| `tiles` | Tileset image | 16×16 tiles, 4 columns × 2 rows (ids 0–7: grass, sidewalk, road, road marking, wall, tree, planter, water) |
| `player` | Spritesheet | 16×24 frames; **rows** = down, left, right, up; **columns** = stand, step A, step B. Frame index = `row * 3 + col` |
| `emote` | Image | 10×10 "!" bubble shown above the player's head when Action is pressed |

The player's collision box (`PLAYER_FEET`, 10×8) is centred at the bottom of the frame. It's derived from the frame size, so a different sprite size keeps the box at the feet.

**To replace placeholder art:**
1. Put the PNG in `public/assets/…`; the tileset goes at `public/assets/tilesets/tiles.png`, where the map already points.
2. Load it in `BootScene.preload()` under the **same key, frame size and layout**.

`generatePlaceholderTextures()` skips any key that already exists, so no other code changes are needed. The walk animation plays frames `[step A, stand, step B, stand]` at 8 fps.

### 2.4 Maps (Tiled)

- Maps are **Tiled JSON** (Tiled 1.10+ format), orthogonal, 16×16 tiles, **uncompressed array layer data**, and **embedded tilesets**. Phaser can't read external `.tsx`/`.tsj` tilesets.
- **Tileset name = texture key.** The scene adds every tileset in the map by its name, so a tileset named `tiles` draws with texture `tiles`.
- Required layers:
  - `ground`: tile layer, no collision.
  - `obstacles`: tile layer. Any tile whose tileset entry has the bool property **`collides: true`** blocks movement.
  - `objects`: object layer containing a **point** named **`player-spawn`**, placed at the player's feet.
- The player collides with a 10×8 box at its feet, so the head can overlap things above it, giving a top-down 3/4 view.
- The test map is `src/data/maps/test-map.json` (30×20 tiles). It has a street with trees, a plaza with a fountain and planters, building blocks with a 1-tile alley, and a 1-tile-wide serpentine corridor for collision testing.
- The embedded tileset's `image` is `../../../public/assets/tilesets/tiles.png`, relative to the map file. Phaser ignores the path because it uses the tileset name as the texture key, but Tiled uses it.
  - That PNG doesn't exist yet, because the placeholder is drawn at runtime, so Tiled shows missing-image tiles. Adding the PNG (real or exported placeholder) is a session 3 task.
- The test map was generated by a script, not saved by Tiled. Its fields follow Tiled's 1.10 JSON format, but a full open-and-save round trip in Tiled is **untested**.
  - Phaser ignores external tilesets with only a warning. The scene throws if a map has no embedded tileset.

### 2.5 Input

- **Keyboard:** arrows or WASD to move; Space, Enter or Z for action.
  - Movement is 4-way at 60 px/s, which is exactly 1 px per physics step. Other speeds should be multiples of 60 so scrolling stays even.
  - When several direction keys are held, the **most recently pressed** one wins.
  - Keys pressed with Cmd held are ignored, because macOS browsers drop their keyup and the player would otherwise keep walking.
- **Touch:** DOM elements in `index.html`, wired in `src/systems/touchControls.ts`.
  - The D-pad tracks one pointer. Its position relative to the pad centre picks the direction, so a thumb can roll between arms. There's a small neutral deadzone in the centre.
  - The action button works while the D-pad is held (multi-touch).
  - Controls show only when `navigator.maxTouchPoints > 0` or `(any-pointer: coarse)` matches, or after the first touch event.
  - **Portrait:** the game is pinned to the top and the controls fill a strip below it.
  - **Landscape:** the controls float over the letterbox bars. The D-pad shrinks to fit the bar, down to a 32 px floor. On 4:3 tablets, foldables and near-square windows the bars are narrower than that, so the controls overlap the edge of the game.
- `src/systems/controls.ts` merges both sources into `direction()` and `actionPressed()`; touch overrides keyboard. Game code reads only that class.
- In session 1 the action button has no gameplay; it shows a "!" bubble to confirm the input works.

### 2.6 Strings (proposed for when text arrives; not implemented)

- `src/data/strings/en.json`: flat map of stable IDs to text, e.g. `"npc.plaza.vendor.greeting": "…"`.
- A single lookup `t(id, params?)` with `{name}`-style interpolation. Missing IDs render as the ID itself so they're easy to spot.
- IDs never change meaning; reworded text keeps its ID. Text widths must tolerate about 40% expansion for future locales.

### 2.7 Saves (proposed; not implemented)

- One localStorage key per slot, e.g. `jhrpg.save.1`, holding JSON with a `version` field and a migration function per version bump.
- Saves are untrusted input: validate them on load and never pass their contents to `innerHTML`.

### 2.8 Dependencies and supply chain

- Exact versions in `package.json` (`.npmrc` sets `save-exact=true`). `package-lock.json` is committed and CI uses `npm ci`.
- Packages are installed with a **14-day release cooldown** (`npm install --before=<date>`). **Security fixes override the cooldown.** Session 1 made two exceptions:
  - `source-map-js` 1.2.2, for advisory GHSA-68fv-2mgg-jv7q.
  - `vite` 8.3.3, which fixes a dev-server `fs.allow` check bypass for `?vite-wasm-instance`; no advisory has been published yet.
  - Session 2 needed no override: `phaser` 4.2.1 was released 2026-07-09, well before the cutoff.
- GitHub Actions are pinned to full commit SHAs. Nothing bumps these pins automatically. Update them by hand under the same cooldown policy; no Dependabot.
- Node 20 reached end of life on 2026-04-30. `engines` requires Node 22.12 or later, and CI uses Node 24.

### 2.9 Known issues and tech debt

- **Uneven frame pacing on 90/144 Hz screens:** Arcade physics uses a fixed 60 Hz step. Revisit in the polish session.
- **Keyboard action during a hitch:** a key press shorter than one frame can be missed (`JustDown`). Touch presses are queued and can't be missed.
- **Pixel-perfect scaling:** `Scale.FIT` can produce non-integer scale factors (see 2.2).
- **No Content Security Policy:** GitHub Pages can't send headers. A `<meta>` CSP is possible once there's any dynamic content.
- **No Canvas fallback on rare GPUs:** see 2.10.

### 2.10 Phaser 4 notes (port from 3.90.0 to 4.2.1, session 2)

**Result:** no game code needed changing. The one code change is the keyboard blur fix below.

Behaviour parity was verified against Phaser 3 baselines recorded in the same session. The suite steps frames at exactly 60 fps, so results are deterministic.
- 45-check regression suite. With the engine swapped and no code changes it gave the same result as v3: 44 pass / 1 fail, where the fail is the keyboard blur bug below. Animation and collision-fuzz fingerprints are byte-identical to v3.
- Pixel-render hashes: all four captured gameplay states (spawn, both map corners, the emote) render byte-identical to v3, as do whole-pixel positions generally. No shot contains off-palette (blended) pixels.
- Touch checks in portrait 375×812 and landscape 667×375: identical results.

**API differences that affect this project:**

| Area | Phaser 3.90 | Phaser 4.2.1 | What we do |
|------|-------------|--------------|------------|
| Package entry | No `exports`, so Vite bundled the UMD build. `window.Phaser` existed. | The `exports` map resolves to `dist/phaser.esm.js`, which has a real default export (since 4.1.0). **No `window.Phaser` global.** | Keep `import Phaser from 'phaser'`, pinned to 4.2.1 or later. Use `window.game` (dev only) in console snippets, never `Phaser.*`. A file that forgets the import still type-checks but throws at runtime. |
| Whole-pixel rendering | With `roundPixels`, the camera scroll was floored and sprite positions were floored. | Camera scroll stays fractional. Each sprite and tile **vertex** is `Math.round`ed when `vertexRoundMode: 'safeAuto'` (the default) and the camera has `roundPixels`. | `pixelArt: true` still forces `roundPixels`, `antialias: false` and NEAREST filtering. Output is identical to v3 at whole-pixel positions. At fractional positions of .5 or more, v3 floors and v4 rounds, a 1 px difference. The game can't reach those positions, because movement is whole pixels per step. Keep speeds whole pixels per step, with no zoom, scale or rotation. Don't add a lerped camera follow without re-checking. |
| Pixel art options | — | New `smoothPixelArt` option (LINEAR filtering plus a shader). | Don't use it; the Pixel Art Guide recommends `pixelArt: true` for 1:1 pixels. |
| Renderer | Canvas only if a WebGL context can't be created; the extensions below were optional. | Canvas renderer **deprecated**. WebGL **throws** if `ANGLE_instanced_arrays` or `OES_vertex_array_object` is missing, instead of falling back. | Accepted: very rare hardware. Optional hardening later is to retry with `type: Phaser.CANVAS` on that error. |
| Textures | `flipY` false. | Textures upload with `flipY: true`, and frame UVs are inverted to match. | Transparent for us. Never call `source.setFlipY(false)`, read `frame.v0`/`v1`, or write custom shaders with v3 UV assumptions. |
| `map.createLayer` | Returns `TilemapLayer \| null`. | Gains a 5th `gpu` parameter. The type is `TilemapLayer \| TilemapGPULayer` and drops `null` from the signature, but it can still return `null` at runtime. | Keep the runtime null guard and never pass `gpu`. Narrow with `instanceof Phaser.Tilemaps.TilemapLayer` before calling TilemapLayer-only methods. |
| Data structures | `Phaser.Structs.Set` and `Phaser.Structs.Map`. | `Structs.Set` became a native `Set` (e.g. `world.bodies`, `group.children`). `Structs.Map` is **unchanged** (e.g. `game.anims.anims`, cache entries). | Native Sets: `.size`, `.forEach`, `Array.from()`. `Structs.Map`: `.each()`, `.getArray()`, `.keys()`. |
| Bundle | App chunk 1,210 kB (323 kB gzip). | App chunk 1,388 kB (362 kB gzip). | Still under the 1,500 kB warning limit. Phaser's ESM build isn't tree-shakeable. |

**Keyboard blur bug (still present upstream, fixed in our code):** `KeyboardPlugin.shutdown()` in both 3.90 and 4.2.1 calls `game.events.off(BLUR, this.resetKeys)` without a context. Stopping any scene therefore strips every scene's blur listener, and held keys stick after alt-tab. `Controls` now registers its own blur→`resetKeys` handler with its own function reference and removes it on scene shutdown. Regression check G2 starts and stops a probe scene, then blurs while a key is held. It fails on unpatched 3.90 and 4.2.1 and passes now.

**Gotchas for upcoming sessions:**
- **Flipping tiles in code (session 3):** v4's `TransformerTile` has a vertical-flip bug (it adjusts x instead of y). It only triggers through runtime `Tile.setFlipY` / `toggleFlipY` / `setFlip(_, true)`, or by copying such a tile. Tiled's own flips and rotations are parsed into `rotation` + `flipX` and render correctly. Don't flip tiles on Y in code.
- **Tiled tile animations now play:** v4 animates tiles that have Tiled `animation` data, where v3 drew a still frame.
- **Sprite-vs-sprite physics changed:** fixes in `ProcessX` and `separateCircle`. Sprite-vs-tile is byte-identical. Re-check push behaviour when NPC colliders arrive.
- **Licence notices:** minification strips all licence comments, including those of the libraries Phaser inlines (Matter.js, poly-decomp, Earcut, Simplify.js, psrdnoise, eventemitter3 and a few snippets). Keeping legal comments would add about 294 KB and still miss Earcut and Simplify. Instead, `vite.config.ts` adds one `postBanner`, and `public/THIRD-PARTY-NOTICES.txt` carries every required text. Re-check it on each Phaser upgrade (README → License).
- **Other v4 changes we don't use:** FX/masks became filters, the tint API changed (`setTintFill` was removed), `Geom.Point` became `Vector2`, `Math.TAU` is now 2π, DynamicTexture needs `render()`, Mesh/Plane were removed. See the migration guide in `node_modules/phaser/skills/v3-to-v4-migration/`.

---

## 3. Roadmap

Each session should produce one small, testable result and end with a report.

| Session | Goal | Scope |
|---------|------|-------|
| **1** ✅ | Scaffold | Vite + TS + Phaser 3, placeholder art, walkable Tiled test map with collision, keyboard and touch input, deploy config, docs. |
| **2** ✅ | Licence, engine, ship | MIT + CC BY-NC-SA 4.0 licensing; Phaser 3.90.0 → 4.2.1 with verified behaviour parity; keyboard blur fix; public repo and GitHub Pages deploy. |
| **3** | Talk to someone + Tiled pipeline | Strings JSON and `t()` (also setting `<title>` and `lang`); EarthBound-style text window (typewriter text, original or open-licence pixel font); NPCs placed from Tiled objects; action button checks the faced tile; y-sorted depth. Tiled pipeline: a real or exported tileset PNG at `public/assets/tilesets/tiles.png`, a verified Tiled open-and-save round trip, and an object-layer convention for NPCs. |
| **4** | Zones and travel | Map registry, door/warp objects in Tiled, fade transitions, spawn points per entrance. First layout pass of the Roosevelt Ave corridor stub and one mini-zone (74th St / Diversity Plaza). |
| **5** | Delivery loop v1 | Order data model (JSON): pickup, dropoff, item, reward. Accept, pick up and deliver flow; on-screen order ticket. Orders send the player across zones. |
| **6** | Saves and title | Versioned localStorage saves, autosave on zone change or delivery, title screen with Continue/New, settings stub (text speed). |
| **7** | Battle system v1 | Encounter trigger; first-person menu battle scene; rolling HP counter; fictional gentrification-themed enemies from JSON; basic attack, defend and flee commands with original labels. |
| **8** | Organizing moves and progression | Tenant-organizing specials (rent strike, petition, block party), a resource meter, XP and levels, status effects, balance pass. |
| **9–10** | Zone content | 37th Ave / Pride route, Historic District / co-op gardens, under-the-7 Roosevelt Ave. Community-informed writing and review for each represented community. |
| **11** | Audio | Original music and SFX, mobile audio unlock, volume settings. |
| **12** | Art pass | Real tilesets and sprites through the swap contract (2.3); title art. |
| **13** | Polish and accessibility | Key remapping, text speed, reduced motion, contrast check, low-end Android performance, pseudo-locale test of string expansion. Lint and unit-test tooling if not added earlier. |
| **14+** | Localization | First additional language. Needs fonts that cover the target scripts (e.g. Bengali, Devanagari, Tibetan). Pixel fonts for those are scarce; budget for this early. |

## 4. Open questions (not locked; owner's call)

1. **Protagonist identity:** name, look and backstory, and whether there's a party (EarthBound has four characters).
2. **Encounters:** visible enemies on the map (EarthBound-style) or random encounters?
3. **Real people in Pride history:** the "no identifiable people" rule is written for antagonists and businesses. Does it also cover respectful references to real historical figures and events? For example, the 1990 killing of Julio Rivera, which helped spur Queens Pride.
4. **Community review:** who reviews each community's portrayal, and when in the pipeline?
5. ~~**Licence**~~ Decided in session 2: MIT for code, CC BY-NC-SA 4.0 for content, copyright jcnyc90.
6. ~~**Engine**~~ Decided in session 2: Phaser 4.

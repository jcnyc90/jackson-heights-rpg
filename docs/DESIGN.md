# Jackson Heights RPG — Design

An EarthBound-inspired browser RPG set in Jackson Heights, Queens. A community love letter.

- **Repo:** `jcnyc90/jackson-heights-rpg`, deployed to GitHub Pages.
- **Stack:** Phaser 4 (4.2.1) + Vite + TypeScript, static site, no backend. Live at <https://jcnyc90.github.io/jackson-heights-rpg/>.
- **Licences:** code MIT (`LICENSE`); content CC BY-NC-SA 4.0 (`LICENSE-CONTENT`). README.md lists which paths fall under each.

This document has three parts:

1. **Locked decisions:** set by the project owner. Change them only on purpose.
2. **Technical conventions:** set in session 1 to keep future work cheap. They're cheap to change now and get more expensive later.
3. **Roadmap and open questions.**

Section 2.10 records what changed when the engine moved from Phaser 3.90.0 to 4.2.1. Section 2.11 covers dialogue and NPCs (session 3), 2.12 maps, warps and zones (session 4), 2.13 the delivery loop (session 5), and 2.14 the world dataset (sessions 6a and 6b).

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
| 7 | Language | **English only for now**, but **all player-facing strings live in external JSON data files, keyed by ID**, so localization can be added without refactoring. | Session 3 (`t()` + `src/data/strings/en.json`; see 2.6) |
| 8 | Saves | **localStorage**. | Later |
| 9 | Art | Placeholder sprites and tiles **generated in code**. **EarthBound-like pastel palette, chunky dark outlines, 16×16 tiles**, scaled with **crisp pixel rendering (no smoothing)**. Real art replaces placeholders later, so **asset keys and sizes must be swap-friendly**. | Session 1 |
| 10 | IP | Emulate EarthBound's **style and mechanics only**. **No Nintendo/EarthBound sprites, music, names, fonts, or enemy designs.** | Applies always (all session 1 art is original) |
| 11 | Platform | **Desktop browser** (keyboard) and **mobile browser** (on-screen **D-pad + action button**, shown **only on touch devices**). | Session 1 |

### Guardrails that follow from the locked decisions

- **Fiction boundary (#5):** real *places* (streets, avenues, Diversity Plaza, the 7 train) set the scene. Every *business, developer, landlord and antagonist* is invented. Real restaurants (e.g. the 74th St momo spots) get fictional stand-ins, not real names or logos.
- **Strings (#7):** no player-facing text is hard-coded anywhere, in TypeScript or HTML. See convention 2.6.
  - No exceptions since session 3: `index.html`'s `<title>` and `<html lang>` hold `%t:<id>%` placeholders that a Vite plugin fills from `en.json` at build time, and `main.ts` sets them again from `t()` at boot.
- **IP (#10):** no ripped assets, no soundalike music, no EarthBound font clones.
  - No EarthBound names: character and place names (e.g. "Ness", "Onett"), ability systems ("PSI"), and menu labels ("Bash", "Goods", "Auto Fight").
  - Mechanics such as the rolling HP meter aren't copyrightable; specific expression is.
  - Avoid using "EarthBound" in the game's title or logo.

---

## 2. Technical conventions (session 1)

### 2.1 Architecture

- Plain Phaser scenes plus small TypeScript modules. **No ECS, no DI container, no state library.** Add structure only when a second real use case appears.
- `src/scenes/`: one file per Phaser scene. `BootScene` loads the maps and the font atlas, generates placeholder textures, and registers animations. `MapScene` plays any registered map (movement, NPCs, warps; 2.12). `DialogueScene` is the text window, launched over the map (2.11).
- `src/systems/`: reusable logic that isn't a scene (input, placeholder art, font, strings, text layout, NPC parsing, map registry and warps).
- `src/data/`: JSON game data, bundled with the code and validated at build time (a malformed JSON file fails `npm run build`).
- `public/assets/`: binary assets served as-is (real art, audio). Holds `tilesets/tiles.png` and `tilesets/overhead.png`, the exported placeholder tilesets Tiled uses (2.4), and `fonts/spleen-6x12.png`, the font atlas (third-party, BSD-2-Clause).
- `third_party/`: unmodified third-party source files with their licences (the Spleen BDF). `scripts/`: build helpers run by hand (`build-font-atlas.mjs`).
- `tests/browser/`: the regression, render and touch checks, run in the dev server (`tests/browser/README.md`).

### 2.2 Rendering and scaling

- Internal resolution is **256×224** (EarthBound's SNES resolution), set in `src/config.ts`.
- `Phaser.Scale.FIT` scales the canvas to the largest size that fits, centred, with letterboxing. `pixelArt: true` gives nearest-neighbour filtering and whole-pixel positions; the canvas also has `image-rendering: pixelated`.
- Phaser 4 achieves whole-pixel output by rounding each sprite and tile vertex, not by rounding the camera scroll as v3 did; see 2.10. Keep positions whole-pixel: integer speeds per step, no camera zoom, no sprite scaling or rotation.
- The game renders at 256×224 and the browser upscales it, so tile seams can't appear. On some screens the scale factor isn't a whole number, which makes a few pixel columns 1 device-pixel wider than others. If that's visible on real devices, switch to integer scaling later.

### 2.3 Asset keys and sizes (swap contract)

All keys live in `src/config.ts` (`TEXTURES`, `PLAYER_FRAME`).

| Key | Kind | Size / layout |
|-----|------|---------------|
| `tiles` | Tileset image | 16×16 tiles, 4 columns × 2 rows (ids 0–7: grass, sidewalk, road, road marking, wall, tree trunk and lower crown, planter, water) |
| `overhead` | Tileset image | 16×16 tiles, 1 column × 1 row (id 0: tree canopy). Tiles that draw over sprites; used only in a map's `above` layer (2.4) |
| `player` | Spritesheet | 16×24 frames; **rows** = down, left, right, up; **columns** = stand, step A, step B. Frame index = `row * 3 + col` |
| `emote` | Image | 10×10 "!" bubble shown above the player's head when Action is pressed with nobody to talk to |
| `npc` | Spritesheet | 16×24 frames; **rows** = looks (3), **columns** = standing frame per direction (down, left, right, up). Frame index = `look * 4 + direction` |
| `font` | Bitmap font (fixed cell) | Loaded from `public/assets/fonts/spleen-6x12.png` (Spleen 6x12, see 2.11). `FONT` in `config.ts`: 6×12 cells (ascent 9, descent 3), 16 per row, in `FONT_CHARS` order (`src/systems/font.ts`): printable ASCII U+0020–U+007E, then printable Latin-1 U+00A0–U+00FF; 191 glyphs, 96×144. `#fffaf0` glyphs on transparent |
| `text-window` | Image | `TEXT_WINDOW` size (240×56): dark panel, 2 px light frame, rounded corners |
| `text-cursor` | Image | 5×3 "more" triangle that blinks once a page is fully typed |
| `delivery-point` | Image | 16×16 door-with-parcel marker drawn at each delivery point (2.13), bottom-centred on its rectangle |

The player's collision box (`PLAYER_FEET`, 10×8) is centred at the bottom of the frame. It's derived from the frame size, so a different sprite size keeps the box at the feet.

**To replace placeholder art:**
1. Put the PNG in `public/assets/…`. For the tileset, overwrite `public/assets/tilesets/tiles.png`, where the map already points, and delete the H6 drift check (it compares that file with the placeholder).
2. Load it in `BootScene.preload()` under the **same key, frame size and layout**.
3. For another font: point `FONT.atlas` at a fixed-cell atlas in `FONT_CHARS` order (or load a BMFont with `this.load.bitmapFont` under `FONT.key`) and update the `FONT` metrics. `DialogueScene` recomputes characters per line and lines per page from them. The Spleen atlas is generated from its BDF by `scripts/build-font-atlas.mjs`; regression check N2 compares the two pixel for pixel.

`generatePlaceholderTextures()` skips any key that already exists, so no other code changes are needed. The walk animation plays frames `[step A, stand, step B, stand]` at 8 fps.

### 2.4 Maps (Tiled)

- Maps are **Tiled JSON** (Tiled 1.10+ format), orthogonal, 16×16 tiles, **uncompressed array (CSV) layer data**, and **embedded tilesets**. Phaser can't read external `.tsx`/`.tsj` tilesets; the scene throws if a map has none embedded.
- **Tileset name = texture key.** The scene adds every tileset in the map by its name, so a tileset named `tiles` draws with texture `tiles`.
- **Tilesets:** `tiles` (ground and obstacle tiles) and, if the map has an `above` layer, `overhead`. Both embedded.
- Required layers:
  - `ground`: tile layer, no collision.
  - `obstacles`: tile layer. Any tile whose tileset entry has the bool property **`collides: true`** blocks movement.
  - `objects`: object layer with at least one **spawn point**, plus any **warps** (2.12) and **delivery points** (2.13). Session 4 replaced the old `player-spawn` point with a spawn point whose `spawnId` is `start`.
- Optional tile layer `above`: drawn **over every sprite** (tree canopies, awnings). It never collides; collision stays on `obstacles`. Put a canopy one tile **north** of its trunk: on the trunk's own tile it would also cover a player standing in front of the tree. Every tree on the test map is two tiles tall this way (trunk in `obstacles`, canopy in `above`).
- Optional layer `npcs`: object layer, one **point** per NPC at its feet, with custom properties:

  | Property | Type | Value |
  |----------|------|-------|
  | `npcId` | string | Unique per map. The name string is `npc.<npcId>.name` in `en.json`. |
  | `facing` | string | `down`, `left`, `right` or `up`: the way the NPC faces until talked to. |
  | `dialogueId` | string | A key of `src/data/dialogue.json`. |
  | `look` | int (optional, default 0) | Row of the `npc` sheet. |

  Object name and class are free text for the map author (the test map uses the npcId and class `npc`); the game ignores them. `readNpcSpawns()` throws on a missing or wrong property, an unknown `dialogueId`, a non-point object or a duplicate `npcId`, so map mistakes fail at load instead of silently dropping an NPC.
- The player and NPCs collide with a 10×8 box at their feet, so heads can overlap things above them, giving a top-down 3/4 view.
- The test map is `src/data/maps/test-map.json` (30×20 tiles). It has a street with trees, a plaza with a fountain and planters, building blocks with a 1-tile alley, a 1-tile-wide serpentine corridor for collision testing, and three NPCs: Neighbor A in the plaza west of the spawn, Neighbor B on the north sidewalk, Neighbor C in the south-west corner, whose second page is the accented font test. The east end of the street is a warp to Roosevelt Avenue.

**Tileset images.** The embedded tilesets' `image` paths are `../../../public/assets/tilesets/tiles.png` and `overhead.png`, relative to the map file. Phaser ignores these paths (it draws each tileset from its texture key); Tiled uses them. The PNGs are pixel-exact exports of the placeholder tilesets the game generates at boot. Regression checks H6 and O4 fail if they drift apart. To re-export after changing a tile painter, run `game.textures.getBase64('tiles')` (or `'overhead'`) in the dev-server console and save the decoded data URL over the PNG.

**Workflow.**
1. Open a map from `src/data/maps/` in Tiled (1.12.2 verified; `brew install --cask tiled`). A new map also needs an entry in `src/data/maps/index.json`.
2. Edit. Keep the tileset embedded. Place NPCs as points in the `npcs` layer with the properties above.
3. Save (Cmd+S) in place. Tiled writes the same JSON format the game reads.
4. Run `npm run build` (malformed JSON or type errors fail it) and the regression suite (`tests/browser/README.md`).
5. Commit the map as Tiled saved it. Don't hand-format it; re-saving an unchanged map from Tiled is byte-identical, so diffs stay small.

**Round trip (verified session 3, Tiled 1.12.2).** The script-written map was opened in the Tiled GUI (0 errors, 0 warnings; tileset image, all four layers and NPC points shown) and saved in place. Compared with the original, the only changes were `tiledversion` 1.11.2 → 1.12.2 and a new `"opacity": 1` on each object (Tiled 1.12 writes it; Phaser ignores it). Tile data, properties, objects and tileset metadata were identical. Tiled's headless writer (`tiled --export-map json`) gives the same output. A second save was byte-identical. In game, all 80 regression checks and the render hashes passed on the Tiled-saved file.

**Flip rules (Phaser 4.2.1).**
- **Flipping and rotating tiles in Tiled is fine.** Tiled stores H/V/diagonal flips as flag bits on the tile gid. Phaser parses them into each tile's `rotation` and `flipX`, which render correctly in v4. Use Tiled's flip (X, Y) and rotate (Z, Shift+Z) tools freely.
- **Never flip a tile vertically in code.** `Tile.setFlipY`, `toggleFlipY`, `setFlip(_, true)`, or copying a tile that has `flipY` set, hit v4's `TransformerTile` bug (it adjusts x instead of y) and render the tile in the wrong place. If code ever needs a mirrored tile, add a pre-flipped tile to the tileset instead. Horizontal `setFlipX` in code is unaffected.
- **Sprites are unaffected:** `Sprite.setFlipX/Y` is a different code path and works.
- **Animated tiles:** v4 plays Tiled tile `animation` data (v3 drew the first frame). Any tile animation added in Tiled will play in game.

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
- Action talks to the NPC in front of the player (2.11). With nobody there, it shows the "!" bubble from session 1. While the text window is open, Action drives the window and direction input is ignored.
- Exactly one scene reads input: `MapScene` owns `Controls` and forwards Action presses to `DialogueScene.advance()`. A second `Controls` in another scene would let one key press be seen twice (once per scene's key object), so the press that closes a window could immediately reopen it.

### 2.6 Strings (implemented in session 3)

- `src/data/strings/en.json`: flat map of stable IDs to text, e.g. `"npc.plaza.vendor.greeting": "…"`.
- A single lookup `t(id, params?)` in `src/systems/strings.ts` with `{name}`-style interpolation. Missing IDs render as the ID itself so they're easy to spot; dev builds also `console.warn` once per missing ID (the warning is compiled out of production builds).
- Dialogue structure lives apart from text: `src/data/dialogue.json` maps a dialogue ID to a list of string IDs. Each entry starts a new page; a long entry continues on the next page automatically, so a longer translation never overflows the window.
- Strings must use only characters the font has: printable ASCII plus printable Latin-1 (accented Latin letters, ¿ ¡ « » and so on). Regression checks H4 and N1 fail otherwise. Write straight quotes and apostrophes (curly quotes and dashes are outside the atlas; add them to `FONT_RANGES` and the atlas script if wanted). Store text in NFC: a decomposed accent (letter + combining mark) fails the checks.
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
  - Session 3: `vite` 8.3.3 → 8.3.4 (released 2026-10-08, installed 2026-10-22 with `--before` 14 days back; no override). 8.3.5 (2026-10-21) is inside the cooldown and was not taken.
- GitHub Actions are pinned to full commit SHAs. Nothing bumps these pins automatically. Update them by hand under the same cooldown policy; no Dependabot.
- Node 20 reached end of life on 2026-04-30. `engines` requires Node 22.12 or later, and CI uses Node 24.

### 2.9 Known issues and tech debt

- **Uneven frame pacing on 90/144 Hz screens:** Arcade physics uses a fixed 60 Hz step. Revisit in the polish session.
- **Keyboard action during a hitch:** a key press shorter than one frame can be missed (`JustDown`). Touch presses are queued and can't be missed.
- **Pixel-perfect scaling:** `Scale.FIT` can produce non-integer scale factors (see 2.2).
- **No Content Security Policy:** GitHub Pages can't send headers. A `<meta>` CSP is possible once there's any dynamic content.
- **No Canvas fallback on rare GPUs:** see 2.10.
- **Font covers Latin-1 only:** ASCII and Latin-1 (é, ñ, ü, ¿, ¡). No curly quotes, em dashes or ellipsis yet (Spleen has them; the atlas doesn't), and no non-Latin scripts (roadmap 15+).
- **Text window speed is fixed** at 30 characters/s; a text-speed setting belongs to the settings work (roadmap session 7).
- **Tiles don't y-sort:** sprites sort by feet y; `obstacles` tiles draw under every sprite and `above` tiles over every sprite. That covers trees and awnings. Anything that must be in front of some sprites and behind others at the same spot (e.g. a lamp post a player walks around on both sides) still needs a sprite, not a tile.
- **Map display name card** is plain text on a dark box, drawn by `MapScene` for 1.5 s after a warp. Placeholder UI.
- **World dataset is ahead of the maps:** `src/data/world/jackson-heights.json` is verified against LION 26C and covers all four zones (2.14), but the game still plays the session 4 stub maps until 6c builds the real ones.
- **Order ticket** is plain text on a dark box (placeholder UI, like the name card). It's sized to its text: a map name longer than about 30 characters makes it wider than the 4:3 safe area checked by touch-check.js (2.13).
- **Delivery state is in memory only:** a reload loses the active order and the reward total. Saves come later.
- **The tileset PNG is a copy** of generated art. H6 guards drift; it goes away when real tiles replace the placeholder.

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
- **Sprite-vs-sprite physics changed:** fixes in `ProcessX` and `separateCircle`. Sprite-vs-tile is byte-identical. Re-checked in session 3 for the NPC colliders (rectangular bodies, NPCs immovable and not pushable): the player stops flush against an NPC from all four sides at exact pixels, the NPC never moves, and a 1,024-frame fuzz walk around an NPC never overlaps bodies (checks L1–L4). Moving NPCs or dynamic-vs-dynamic pushing will need their own checks.
- **`RetroFont.Parse` typings are wrong (4.2.1):** they declare it returns the font data, but it returns the whole cache entry `{ data, texture, frame }`. Pass its result straight to `cache.bitmapFont.add()` (see `registerRetroFont`).
- **Licence notices:** minification strips all licence comments, including those of the libraries Phaser inlines (Matter.js, poly-decomp, Earcut, Simplify.js, psrdnoise, eventemitter3 and a few snippets). Keeping legal comments would add about 294 KB and still miss Earcut and Simplify. Instead, `vite.config.ts` adds one `postBanner`, and `public/THIRD-PARTY-NOTICES.txt` carries every required text. Re-check it on each Phaser upgrade (README → License).
- **Other v4 changes we don't use:** FX/masks became filters, the tint API changed (`setTintFill` was removed), `Geom.Point` became `Vector2`, `Math.TAU` is now 2π, DynamicTexture needs `render()`, Mesh/Plane were removed. See the migration guide in `node_modules/phaser/skills/v3-to-v4-migration/`.

### 2.11 Dialogue and NPCs (session 3)

**Text window** (`DialogueScene`):
- A separate scene, launched over the map with already-localized text and stopped on close. It reads no input (2.5).
- 240×56 window, 8 px from the top of the screen, or from the bottom when the player is in the top half of the screen (near the map's top edge the camera stops scrolling, and a top window would cover the speakers).
- Text is word-wrapped **before** typing starts, so a word never jumps to the next line mid-type. Characters per line and lines per page come from the font metrics: 36 × 3 with Spleen 6x12 (the same cell as the session 1–3 placeholder font).
- Typewriter at 30 characters/s. **Action:** while typing, show the rest of the page; on a complete page, turn the page; on the last complete page, close. A blinking triangle shows when a page is complete.
- Player movement is locked from the press that opens the window to the press that closes it. The closing press is consumed, so it never reopens the window or shows the emote.

**Talking:**
- Action checks a strip `TALK_RANGE` (16 px, one tile) deep directly in front of the player's feet box, as wide as the feet box, in the facing direction. The nearest NPC whose feet box overlaps that strip is the one you talk to. A gap of 15 px between feet boxes talks; 16 px doesn't (check K2).
- The NPC turns to face the player and keeps that facing afterwards.
- NPC names come from `npc.<npcId>.name` and are passed to every line as `{name}`.

**NPCs:** physics sprites with the same 10×8 feet box as the player, immovable and not pushable. They never move in session 3.

**Depth:** every sprite's depth is its feet y, updated every frame for the player, so whoever stands lower on screen draws in front. Tile layers sit at negative depth (below all sprites) and the emote at 1e6 (above all).

**Font (session 4):** Spleen 6x12 2.2.0 by Frederic Cambus, BSD-2-Clause, picked by the owner from the session 3 proposals. The BDF and its LICENSE are in `third_party/spleen-2.2.0/` (sha256s in `SOURCE.txt`, taken from the official release archive). `scripts/build-font-atlas.mjs` converts glyphs U+0020–U+007E and U+00A0–U+00FF to `public/assets/fonts/spleen-6x12.png`, one opaque pixel per BDF bit. It has the same 6×12 cell as the session 1–3 placeholder font, so the window stays 36 × 3; the session 3 dialogue screenshots differ only inside the text cells. The notice is in `public/THIRD-PARTY-NOTICES.txt` and the build banner. The placeholder font code is gone.

### 2.12 Maps, warps and zones (session 4)

**Registry.** `src/data/maps/index.json` lists every map: `id` (the loader key, used in warps), `file` (next to the registry), and `name`, the string ID of its display name (`map.<id>.name`, shown via `t()`). `start` names the map and spawn a new game begins at. `src/systems/maps.ts` bundles every listed map (`import.meta.glob`, eager) and reads its spawns and warps once at load.

**Objects** (layer `objects`; Tiled class, written as `type` in the JSON, tells them apart):

| Class | Shape | Property | Type | Value |
|-------|-------|----------|------|-------|
| `spawn` | point, at the player's feet | `spawnId` | string | Unique per map. |
| | | `facing` | string | `down`, `left`, `right` or `up`: the way the player faces on arrival. |
| `warp` | rectangle | `targetMap` | string | A registry `id`. |
| | | `targetSpawn` | string | A `spawnId` in that map. |

Name each object for the editor (`to-roosevelt-ave`, `from-test-map`); the game ignores names. Malformed objects (missing or wrong property, wrong shape, duplicate `spawnId`, a map with no spawn, an unknown class) throw at load in every build, like NPCs.

**Broken links.** An unknown `targetMap` or `targetSpawn` **throws in dev**: at boot (`validateLinks()` checks every warp, and that no spawn sits inside a warp) and again on use. In **production** it logs a warning and falls back: an unknown spawn to the target map's first spawn, an unknown map to the start point. A broken link in production costs a detour, never a crash.

**Warping.** A warp fires when the centre of the player's feet box enters its rectangle. Warps only fire after the player has stood clear of every warp since arriving, so a spawn placed near a warp can't bounce the player back. Then:
1. Input locks. The player stops; the camera fades to black over `WARP_FADE_MS` (250 ms).
2. `MapScene` restarts with `{ mapId, spawnId, viaWarp }`: new tilemap, NPCs and colliders, the player at the spawn, facing its way.
3. The camera fades in over 250 ms with input still locked, then unlocks and shows the map's name for 1.5 s.

**Input lock** (`Controls.setLocked`). While locked, direction is null and Action presses are swallowed. Every key or D-pad press that is down when the lock starts, or pressed during it, goes **stale**: it's ignored until released. Keyboard auto-repeat keydowns are stale too. That matters because Phaser destroys and recreates its Key objects when a scene restarts, so a held key's next auto-repeat would otherwise register as a fresh press on the new map. Touch uses a press counter (`touchState.dpadPresses`) for the same purpose. Losing window focus mid-fade releases everything as usual (2.10); the fade still completes.

**Zones.** `roosevelt-ave` (Roosevelt Avenue: road under the elevated train, pillars as wall tiles) and `diversity-plaza-74th` (Diversity Plaza: 37th Rd along the top, a paved plaza with trees and planters). Both are **rough, disposable placeholders** built from the existing tiles; the world dataset will replace their layouts. They contain no businesses, people or community content; each has one placeholder NPC with neutral dialogue (Neighbor D, Neighbor E).

| From | Warp (object) | To spawn | Lands at (feet), facing |
|------|---------------|----------|-------------------------|
| `test-map` | `to-roosevelt-ave` (5): east end of the street | `roosevelt-ave` / `from-test-map` | (24, 112), right |
| `roosevelt-ave` | `to-test-map` (1): west end of the avenue | `test-map` / `from-roosevelt-ave` | (440, 96), left |
| `roosevelt-ave` | `to-diversity-plaza-74th` (3): gap in the north buildings | `diversity-plaza-74th` / `from-roosevelt-ave` | (240, 304), up |
| `diversity-plaza-74th` | `to-roosevelt-ave` (1): gap in the south wall | `roosevelt-ave` / `from-diversity-plaza-74th` | (240, 48), down |

The test map's warp sits on tiles no session 1–3 check visits, so the old checks' walks never trigger it.


### 2.13 Delivery loop (session 5)

**Flow.** One active order at a time. Talk to the **Dispatcher** (an NPC with `role: dispatcher`, on the test map) to get the next order. Face the order's **pickup** point and press Action to pick it up, then face its **dropoff** point and press Action to deliver it. Every order needs at least one warp per leg. No choice menus: talking to the Dispatcher assigns the order.

| Action | Result (line shown in the text window) |
|--------|----------------------------------------|
| Dispatcher, no active order | Assigns the next order not yet delivered, in list order (`text.assign`). After the last one: `dispatcher.none-left`. |
| Dispatcher, order active | Reminder: `dispatcher.busy.assigned` or `dispatcher.busy.picked-up`. |
| Active order's pickup, not picked up yet | Picked up (`text.pickedUp`). |
| Active order's dropoff, picked up | Delivered (`text.delivered`); the reward is added to the total; no active order. |
| Active order's dropoff, not picked up yet | `delivery.not-picked-up` (where to pick it up). |
| Any other delivery point, or no active order | `delivery.nothing` ("Nothing here."). |

The Dispatcher's own `dialogueId` lines come first, then the order line. NPCs come first: a point behind an NPC isn't reachable with Action.

**Orders** (`src/data/orders.json`, `src/systems/orders.ts`): `id` (unique), `itemId`, `reward` (number ≥ 0), `pickup` and `dropoff` (`{ map, pointId }`), and `text`, the string IDs of everything the player reads about the order: `item` (its name), `assign`, `pickedUp`, `delivered`. Order strings can use `{item}`, `{pickup}`, `{dropoff}` (map display names) and `{reward}`. Validation: field types, unique `id`, a registered map, a delivery point on that map, pickup ≠ dropoff, every string ID present. **Dev builds throw** on the first problem when the module loads (the game doesn't start); **production** skips a bad order with a warning and keeps the rest, matching the warp-link policy (2.12).

**Delivery points** (layer `objects`, class `deliveryPoint`): a **rectangle** with the string property `pointId`, unique per map. Action reaches it the same way it reaches an NPC: the rectangle must overlap the 16 px strip in front of the player's feet. The stub maps put each point on a wall tile, so the player faces it from the sidewalk. A point, a missing `pointId` or a duplicate `pointId` throws at load in every build.

**State** (`src/systems/gameState.ts`): the active order and its status (`assigned` → `picked-up`), delivered order IDs and the reward total, in a module that lives outside `MapScene`, so it survives warps (the scene restarts on each one). Memory only: no saves yet (2.7). The reward total isn't shown anywhere yet (no money UI).

**Order ticket.** Shown only while an order is active: line 1 is the item and its status (`hud.order.assigned` / `hud.order.picked-up`), line 2 the map to go to next, the pickup's until it's picked up, then the dropoff's (`hud.go.*`). Plain text on a dark box at whole-pixel positions, centred horizontally, 24 px from the top, under the map name card's row. Near a map's top edge the camera stops scrolling and the player reaches the top of the screen, so while the ticket would cover the player's sprite it moves to 4 px from the bottom (like the text window, 2.11). It fades with the map and draws under the text window. The touch controls only ever sit below the game (portrait) or along the bottom corners (landscape), so the ticket clears them in both places; touch-check.js measures every order's ticket in both positions against the D-pad and Action button.

**Placeholder content (disposable with the stub zones).** Three orders, "Order #1" to "Order #3", no real food, businesses or people:

| Order | Pickup | Dropoff | Warps from the Dispatcher |
|-------|--------|---------|---------------------------|
| `order-1` (reward 10) | `roosevelt-ave` / `rav-a` (north wall) | `diversity-plaza-74th` / `plaza-b` (south wall) | test map → Roosevelt Ave; → Diversity Plaza |
| `order-2` (15) | `diversity-plaza-74th` / `plaza-a` (north wall) | `roosevelt-ave` / `rav-b` (south wall) | → Roosevelt Ave → Diversity Plaza; → Roosevelt Ave |
| `order-3` (20) | `roosevelt-ave` / `rav-b` | `diversity-plaza-74th` / `plaza-a` | → Roosevelt Ave; → Diversity Plaza |

The Dispatcher stands on the test map's south-east sidewalk at (440, 288), outside every session 1–4 render shot and walk.

### 2.14 World dataset (sessions 6a, 6b, 6c)

The real geography the maps are built from, kept as data: `src/data/world/jackson-heights.json` (schema version 3: 6c added the `layout` block). The game doesn't load it; session 6c turns it into Tiled maps. Check it with `npm run validate:world` (the validator, `scripts/validate-world.mjs`) and `npm run test:world` (its tests).

**Bounds (6b).** All four zones of locked decision #1, at their verified extent: west 73rd St, east 90th St, north 34th Ave (Northern Blvd only at the 78th Street Plaza), south Roosevelt Ave plus the station triangle down to Broadway at 74th–75th St. 6a's first-pass bounds were Roosevelt Ave 73rd–75th St with three zones; the owner's 6b brief widened them to all four zones at their real extent. The exact edges below are Claude's proposal within that brief.

**Source and licence decision (6a's own choice; the owner confirmed it in the 6b brief).** The maps are hand-drawn, using NYC city data as a reference, not OpenStreetMap. Why not OSM: under ODbL the dataset JSON would be a derived database, which must stay under ODbL share-alike. That can't carry CC BY-NC-SA's non-commercial term. What the dataset holds is facts: street names, which streets meet, their order, which segments are pedestrian-only or under the elevated 7, and LION ids that point back to the source records. It holds **no coordinates or geometry**. Facts aren't copyrightable, so the file is ours and sits under CC BY-NC-SA with the rest of `src/data/**`. NYC Open Data has no use restrictions (its FAQ: "There are no restrictions on the use of Open Data"); OPEN-NY (data.ny.gov, the MTA data) asks for no attribution or share-alike; DCP disclaims any warranty for LION. The README credits all of them anyway (README → License → World data).

**Sources read in 6b** (accessed 2026-10-23; raw downloads stay in the gitignored `logs/s6b-src/`, never committed):

| Source id | What | Version |
|-----------|------|---------|
| `dcp-lion` | DCP LION File Geodatabase, layer `lion`, generic features | 26C (August 2026), sha256 `9fdf0803…3dac31` |
| `lpc-historic-districts` | LPC Historic Districts, NYC Open Data `skyk-mpzq` | rows updated 2026-06-18 |
| `dot-ped-plazas` | DOT Pedestrian Plazas – Polygon, `k5k6-6jex` | rows updated 2026-10-01 |
| `parks-properties` | Parks Properties, `enfh-gkve` (Travers Park, Q303) | rows updated 2026-10-16 |
| `mta-stations` / `mta-entrances` | MTA Subway Stations `39hk-dx4f` / Entrances and Exits: 2024 `i9wp-a4ja` (data.ny.gov) | rows updated 2026-10-23 / 2025-12-05 |
| `nypd-advisory-2023-06`, `cbs-queens-pride-2026` | Queens Pride Parade closures: NYPD 2023 advisory; 2026 DOT closures as reported by CBS New York | 2023, 2026 |
| `dot-34ave-open-street`, `dot-projects-2025` | NYC DOT: 34th Avenue Open Street (nyc.gov/34ave) and Current Projects 2025 (6c; raw pages in `logs/s6c-src/`) | read 2026-10-23 |
| `nyc-opendata-faq`, `nyc-terms`, `open-ny-terms` | Licence terms | read 2026-10-23 |

The 6a search-summary sources (Wikipedia, the MTA line map, the CECM and DOT 2015 plaza pages, a StreetEasy building listing, and the "Queens grid" general-knowledge entry) were dropped: every fact they backed is now backed by a source read in full. The StreetEasy entry was a residential building listing tied to a street address, which the privacy rule keeps out of the repo.

**Model.** An abstract grid, not coordinates. x = 0 at 73rd St, +1 per numbered street east (90th St = 17); y = 0 at 37th Ave, −1 35th Ave, −2 34th Ave, −3 Northern Blvd, 1 37th Rd, 2 Roosevelt Ave. Fractions place Broadway and the streets that meet Roosevelt from the south (interpolated from LION, rounded to 0.01). Only order and topology are real; distances are stylized.

| Collection | Fields | Becomes (6c) |
|------------|--------|--------------|
| `sources` | `id`, `title`, `url`, `publisher`, `accessed`, `access` (`read` / `search-summary` / `not-downloaded` / `general-knowledge`), `usedFor`; optional `version`, `download`, `sha256`, `terms`, `role: licence` | Credits and this section |
| `streets` | `id`, `name`, `orientation` (`ns`, `ew`, `diagonal`), optional `stub: true` (only its mouth is in the bounds; no segments), fact fields | Street name signs, map names |
| `nodes` | `id`, `streets` (2+), `grid: [x, y]`, `lion` (LION node id) | Intersections |
| `segments` | `id`, `street`, `from`, `to`, `use` (`road`, `plaza`), optional `overhead` (transit id), `lion` (LION segment ids along it), optional `unmapped` (why it's in no zone), fact fields | Walkable street and plaza tiles |
| `transit` | `id`, `kind` (`elevated-line` with `segments`; `station` with `at`, `entrances`, `mtaComplexId`, `routes`), fact fields | El pillars, station stairs (scenery, not warps) |
| `areas` | `id`, `name`, `kind` (`historic-district`, `pedestrian-plaza`, `park`, `event-route`), `segments`, fact fields | Ground and building style, signage (real public place names only) |
| `zones` | `id`, `name`, `summary`, `segments`, `lockedDecision` | A set of maps (the split plan) |
| `connections` | `id`, `zones` (exactly 2), `at` (a node both touch), `kind` (`open` = a way through; `wall` = 6c blocks it) | Warp pairs plus spawns, or walls |
| `layout` (6c) | `tileX`, `rowsY`, `halfWidth`, `margin`, `stubLength`, `description` | Grid-to-tile scale (`scripts/world-layout.mjs`) |
| `maps` | `id`, `zone`, `tiles: [w, h]` (must equal the layout's node box plus margin), `status` (`proposed`, `built`), `summary`, `segments` | One Tiled map each |
| `mapConnections` | `id`, `maps` (2, same zone), `at` (every node both maps touch) | Edge warps between the maps of one zone |
| `anchors` | `id` (= `pointId`, unique across the dataset), `zone`, `segment`, `side`, `t` (0–1 along the segment), `uses` (`pickup`, `dropoff`, `dispatcher`), optional `landmark` | `deliveryPoint` objects; the Dispatcher's spot |
| `landmarks` | `id`, `zone`, `kind`, `fictional: true` (required), `placeholder` | Fictional storefronts (fiction boundary, section 1 #5) |

Fact fields: `sources`, `confidence` (`high`, `medium`, `low`) and `status` (`verified`, `corrected` = 6a had it wrong and it was fixed, `unverified`).

**Validation.** Every problem is reported, not just the first, and any error fails the run (exit 1). Checks: unique kebab-case ids; every fact has a known source, a confidence and a status, and `verified`/`corrected` need a source read in full; segments join nodes on their own street, along the grid for `ns`/`ew` streets; LION ids are 7 digits; stub streets have no segments and every other street has one; stations have entrances and the segment they're over; areas name known segments; a segment is in at most one zone, and a zone segment can't be `unmapped`; connections join two zones that both touch the node, at most one per zone pair and node; every zone is reachable through **open** connections; every zone segment is in exactly one map of its zone; maps are at most 64 tiles on a side (96 before 6c) and their `tiles` match the layout; the layout is well-formed, names known streets and covers every node's y; maps of one zone that share a node list it in a map connection, and every map is reachable within its zone; exactly one Dispatcher anchor; landmarks are `fictional: true` and used at one anchor at most. Warnings (no failure): a segment in no zone without an `unmapped` reason, zones sharing a node with neither an open nor a wall connection, zones or maps with no pickup/dropoff anchor, unused landmarks, uncited sources. It also lists every fact that isn't both verified and high confidence.

**Verification of 6a's 25 facts (6b, against LION 26C and the sources above).** All 25 checked; none left unverified.

| 6a fact | 6a | 6b | Confidence | Source | Finding |
|---------|----|----|------------|--------|---------|
| streets `st-73`, `st-74`, `st-75`, `ave-37`, `rd-37`, `roosevelt` | high, unverified | verified | high | `dcp-lion` | Names and order match. |
| street `broadway` | medium | corrected | high | `dcp-lion` | Meets 73rd St at the 37th Rd corner (one node), crosses Roosevelt between 73rd and 74th St, meets 74th and 75th St **south** of Roosevelt. |
| `seg-37ave-73-74`, `seg-37ave-74-75`, `seg-73-37ave-37rd`, `seg-74-37ave-37rd`, `seg-75-37ave-37rd`, `seg-75-37rd-roosevelt`, `seg-roosevelt-74-75` | high/medium | verified | high | `dcp-lion` | Same ids kept. |
| `seg-37rd-73-74` (plaza) | high | verified | high | `dcp-lion`, `dot-ped-plazas` | LION FeatureTyp W / TrafDir P; DOT's Diversity Plaza polygon is exactly 37th Rd, 73rd–74th St. |
| `seg-37rd-74-75` (low: does 37th Rd go east of 74th?) | low | verified | high | `dcp-lion` | **Yes.** It runs on to 77th St and ends there. |
| `seg-roosevelt-73-74` | high | corrected | high | `dcp-lion` | Split at the Broadway crossing: `seg-roosevelt-73-bway`, `seg-roosevelt-bway-74`. |
| `seg-73-37rd-bway` | medium | removed | — | `dcp-lion` | Zero length: 73rd St, 37th Rd and Broadway meet at one node. |
| `seg-73-bway-roosevelt` (plaza) | medium | verified | high | `dcp-lion` | Pedestrian-only in LION; now `seg-73-37rd-roosevelt`. Not in DOT's plaza polygon. |
| `seg-74-37rd-bway` | medium | corrected | high | `dcp-lion` | Broadway doesn't cross 74th St north of Roosevelt: `seg-74-37rd-roosevelt`. |
| `seg-74-bway-roosevelt` | medium | corrected | high | `dcp-lion` | South of Roosevelt: `seg-74-roosevelt-bway`. |
| `seg-75-37ave-37rd` | medium | verified | high | `dcp-lion` | |
| `seg-bway-73-74` | medium | corrected | high | `dcp-lion` | `seg-bway-73-roosevelt` + `seg-bway-roosevelt-74`. |
| `seg-bway-74-75` | medium | corrected | high | `dcp-lion` | Ends at 75th St south of Roosevelt, not at Roosevelt / 75th. |
| transit `elevated-7` | high | verified | high | `mta-stations`, `dcp-lion` | Extended to 90th St. |
| transit `station-74st` | medium | corrected | high | `mta-stations`, `mta-entrances` | Stairs at 73rd St / 37th Rd, 74th St / 37th Rd, Broadway / 74th St, Broadway / 75th St; three station houses mid-block (between Roosevelt Ave, 74th St, Broadway and 75th St). 6a listed 74th and 75th St at Roosevelt. |

6a's open warning on node `n-73-bway` is gone with the node itself (it merged into `n-73-37rd`).

**Second-pass check (6b).** An independent script, kept out of the repo because it reads the raw LION extract in `logs/`, re-walked every segment's LION ids from its `from` node to its `to` node, checked each node's LION id against its streets, compared `use` with LION's pedestrian codes, and recomputed the Historic District membership from the LPC polygon (53 of 53 segments match). It found one error, now fixed: `seg-78-34ave-northern` (the 78th Street Plaza) was `road`; it is `plaza`, with LION's short street piece by Northern Blvd noted.

**Current state (6b).** 30 streets (6 of them stubs: Northern Blvd and the five that meet Roosevelt from the south), 74 nodes, 120 segments (106 in zones, 14 `unmapped`), the elevated 7 and 3 stations (74 St-Broadway / Jackson Hts-Roosevelt Av, 82 St-Jackson Hts, 90 St-Elmhurst Av: every 7 station inside the bounds), 6 areas, 4 zones, 23 zone connections (8 open, 15 wall), 11 proposed maps with 9 map connections, 25 anchors (24 delivery, 1 Dispatcher), 11 fictional landmarks, 11 sources. `validate:world`: 0 errors, 0 warnings. 12 facts are verified but medium confidence: the ten 34th Ave segments (LION codes them as a one-way street, while DOT lists a "34th Avenue Plaza" from 69th to 94th St) and two areas (34th Avenue Plaza; the Pride route's west end, below).

**Session 6c changes (data).** The owner made three decisions for 6c; the dataset records them:

1. **Scale:** about 8 tiles per short block (6b planned 16), with fewer, smaller maps of at most about 64 tiles a side. The `layout` block holds the scale and the validator checks every map's size against it (below).
2. **34th Avenue as a paseo:** all eleven 34th Ave segments (77th–88th St) are `use: plaza`, drawn as a car-free pedestrian street. Sources: NYC DOT's 34th Avenue Open Street page (nyc.gov/34ave: DOT is making 34th Ave from 69th to 96th St the city's first permanent Open Street) and DOT's Current Projects 2025 page (the 2022–2025 work made it "a pedestrian and cyclist priority corridor" with shared streets, vehicle diverters and plaza blocks). DOT's own name is "34th Avenue Open Street"; "Paseo Park" is the name used by the Alliance for Paseo Park, which DOT's page mentions. **LION 26C still lists most of these blocks as a vehicular one-way street**, so the nine blocks that changed from `road` are `corrected` with medium confidence, and their notes say so. The area `area-34th-avenue-plaza` keeps its id, is renamed "34th Avenue Open Street (Paseo Park)" and is now high confidence (DOT's polygon and program page agree on the extent).
3. **Cross streets as connectors:** the cross streets between 37th Ave and Roosevelt Ave at 78th–88th and 90th St (12 segments, LION ids already in the dataset, source `dcp-lion`) are no longer `unmapped`. They join 89th St in zone `ave-37`, each with an **open** connection to `roosevelt-ave` at its Roosevelt Ave node (12 new connections). In game each is a short north–south path from 37th Ave down to Roosevelt Ave that ends in a warp to the Roosevelt Ave map: a delivery shortcut.

Still `unmapped`: `seg-35ave-88-89` (outside the zones) and `seg-89-35ave-37ave` (the north half of the formation street), both 6b's choices.

**Current state (6c).** 30 streets (6 stubs), 74 nodes, 120 segments (118 in zones, 2 `unmapped`), 3 stations, 6 areas, 4 zones, 35 zone connections (20 open, 15 wall), 9 maps with 5 map connections, 25 anchors (24 delivery, 1 Dispatcher), 11 fictional landmarks, 13 sources. `validate:world`: 0 errors, 0 warnings. 11 facts are verified or corrected but medium confidence: ten 34th Ave segments (DOT vs LION, above) and the Pride route's west end.

**Zones (6b; extents Claude's proposal within the owner's four zones).**

| Zone | Extent | Sources |
|------|--------|---------|
| `diversity-plaza-74th` | 73rd–77th St from 37th Ave to Roosevelt Ave; all of 37th Rd (73rd–77th St); pedestrian 37th Rd (73rd–74th) and 73rd St (37th Rd–Roosevelt); Roosevelt 73rd–74th St under the el; the station triangle south of Roosevelt (74th St, Broadway, 75th St). | LION, DOT plazas, MTA |
| `roosevelt-ave` | Roosevelt Ave 74th–90th St under the elevated 7, with the mouths of Baxter Ave, Forley St, Elbertson St, Britton Ave and Case St from the south; 82 St and 90 St stations. | LION, MTA |
| `ave-37` | 37th Ave 73rd–90th St, plus the cross streets from 37th Ave down to Roosevelt Ave at 78th–90th St (6c; 89th St, the parade formation street, since 6b). Pride route: 37th Ave from 89th St west to 75th St (2026 DOT closures); the NYPD 2023 advisory lists 79th–89th St but disperses at 75th St, so the west end is medium confidence. | LION, NYPD, CBS/DOT |
| `historic-district` | 77th–88th St between 37th Ave and 34th Ave (35th and 34th Ave included), plus Travers Park's frontage (34th Ave 77th–78th St) and the 78th Street Plaza to Northern Blvd. | LPC, LION, Parks, DOT plazas, DOT 34th Ave |

The LPC boundary (LP-01831, designated 1993-10-19) is recorded as `area-jh-historic-district`: segments with at least half their length inside the polygon. It also covers the north side of Roosevelt Ave around 79th–85th St and, under half of each street, parts of the blocks north of 34th Ave at 81st–82nd St. Travers Park is just outside the LPC polygon; it is in the `historic-district` zone as an adjacent real public place (6b, Claude's choice).

**Zone connections.** Open (20): Diversity Plaza ↔ Roosevelt at 74th and 77th St; Diversity Plaza ↔ 37th Ave at 74th and 75th St; 37th Ave ↔ Roosevelt at every cross street from 78th to 90th St (13; 89th St since 6b, the rest 6c); 37th Ave ↔ Historic District at 78th, 82nd and 86th St. Every other shared node is a wall (15).

**Layout (6c, Claude's choices within the owner's 8-tiles-per-short-block scale).** x: 8 tiles per numbered street (one short east–west block, about 80 m, so roughly 10 m a tile). y: 8 tiles per short north–south block (37th Ave → 37th Rd → Roosevelt Ave), 12 per long block (37th Ave → 35th Ave → 34th Ave → Northern Blvd, and Roosevelt Ave → Broadway at 75th St), so 37th Ave to Roosevelt Ave is 16 tiles. Fractional grid points (Broadway, the streets meeting Roosevelt from the south) round to the nearest tile. Street corridors, sidewalks included: 4 tiles wide by default, 6 for 37th Ave and the 34th Avenue paseo, 8 for Roosevelt Ave under the el. Every map is its outermost nodes plus an 8-tile margin, which leaves room for link stubs.

**Map split (6c).** Nine maps, all within 64 tiles a side; long avenues take three maps each. Map connections join maps of one zone at shared nodes; zone connections (open ones) join maps of different zones.

| Map id | Zone | Covers | Tiles (w × h) | Joins |
|--------|------|--------|---------------|-------|
| `diversity-plaza-74th` | diversity-plaza-74th | 73rd–77th St, 37th Ave to the station triangle | 48 × 44 | `roosevelt-ave` at 74th and 77th St; `ave-37` at 74th and 75th St |
| `roosevelt-ave` | roosevelt-ave | Roosevelt 74th–79th St, the Dispatcher | 56 × 16 | `roosevelt-ave-79-84` at 79th St; Diversity Plaza at 74th and 77th St; `ave-37` at 78th St; `ave-37-79-84` at 79th St |
| `roosevelt-ave-79-84` | roosevelt-ave | Roosevelt 79th–84th St, 82 St station, Baxter Ave mouth | 56 × 16 | both neighbours at 79th and 84th St; `ave-37-79-84` at 80th–83rd St; `ave-37-84-90` at 84th St |
| `roosevelt-ave-84-90` | roosevelt-ave | Roosevelt 84th–90th St, 90 St station, four street mouths | 64 × 16 | `roosevelt-ave-79-84` at 84th St; `ave-37-84-90` at 85th–90th St |
| `ave-37` | ave-37 | 37th Ave 73rd–79th St, 78th St connector | 64 × 32 | `ave-37-79-84` at 79th St; Diversity Plaza at 74th and 75th St; `historic-district` at 78th St; `roosevelt-ave` at 78th St |
| `ave-37-79-84` | ave-37 | 37th Ave 79th–84th St, 79th–83rd St connectors | 56 × 32 | both neighbours at 79th and 84th St; `historic-district-82-88` at 82nd St; Roosevelt maps at 79th–83rd St |
| `ave-37-84-90` | ave-37 | 37th Ave 84th–90th St, 84th–90th St connectors | 64 × 32 | `ave-37-79-84` at 84th St; `historic-district-82-88` at 86th St; Roosevelt maps at 84th–90th St |
| `historic-district` | historic-district | 77th–82nd St, 37th Ave to 34th Ave (35th Ave and the paseo), Travers Park frontage, 78th Street Plaza | 56 × 52 | `historic-district-82-88` at 82nd St / 35th Ave and 82nd St / 34th Ave; `ave-37` at 78th St |
| `historic-district-82-88` | historic-district | 82nd–88th St, 37th Ave to 34th Ave (35th Ave and the paseo) | 64 × 40 | `historic-district` at 82nd St (35th and 34th Ave); `ave-37-79-84` at 82nd St; `ave-37-84-90` at 86th St |

Changes from 6b's 11-map plan: the Historic District's four maps become two (the 35th Ave seam is gone; `historic-district-north` and `historic-district-north-82-88` are retired ids), and each avenue map gets smaller. Map ids `roosevelt-ave` and `diversity-plaza-74th` keep the session 4 stub ids, so string IDs and the warp registry keep working. Where a zone connection's node lies on two maps of one zone (79th and 84th St on Roosevelt Ave), it lands in the first of them in the dataset's map order (Claude's choice). The full segment lists per map are in the dataset.

**Anchors and landmarks (6b).** 24 delivery anchors, at least two in every map, and the Dispatcher's (`rav-dispatch`, Roosevelt 74th–75th St, north side, by the 74 St station). 11 fictional landmark slots (shops, food stalls, service counters, letters A–K), no real businesses. Historic District anchors sit on plain block faces with no building names; residential blocks stay generic.

---

## 3. Roadmap

Each session should produce one small, testable result and end with a report.

| Session | Goal | Scope |
|---------|------|-------|
| **1** ✅ | Scaffold | Vite + TS + Phaser 3, placeholder art, walkable Tiled test map with collision, keyboard and touch input, deploy config, docs. |
| **2** ✅ | Licence, engine, ship | MIT + CC BY-NC-SA 4.0 licensing; Phaser 3.90.0 → 4.2.1 with verified behaviour parity; keyboard blur fix; public repo and GitHub Pages deploy. |
| **3** ✅ | Talk to someone + Tiled pipeline | Strings JSON and `t()` (also setting `<title>` and `lang`); EarthBound-style text window (typewriter text, original or open-licence pixel font); NPCs placed from Tiled objects; action button checks the faced tile; y-sorted depth. Tiled pipeline: a real or exported tileset PNG at `public/assets/tilesets/tiles.png`, a verified Tiled open-and-save round trip, and an object-layer convention for NPCs. |
| **4** ✅ | Font, zones and travel | Spleen 6x12 font (Latin-1). `above` tile layer. Map registry, warp and spawn objects in Tiled, fade transitions with input lock. Two disposable stub zones (`roosevelt-ave`, `diversity-plaza-74th`) connected to the test map; a world dataset replaces their layouts later. |
| **5** ✅ | Delivery loop v1 | Order data model (JSON): pickup, dropoff, item, reward. Accept, pick up and deliver flow; on-screen order ticket. Orders send the player across zones. |
| **6a** ✅ | World dataset (data only) | Source and licence decision (hand-drawn from NYC city data, not OSM). Dataset schema, `src/data/world/jackson-heights.json` (first pass, Roosevelt Ave 73rd–75th St; widened to all four zones by the 6b brief), validator and tests (2.14). No game changes. |
| **6b** ✅ | Verify and expand the world dataset (data only) | PR #1 merged. Every 6a fact checked against LION 26C and the LPC, DOT, Parks and MTA datasets (Broadway corrected, 37th Rd confirmed east of 74th St). All four locked zones at their real extent, every elevated-7 station in the bounds, areas (Historic District, plazas, Travers Park, Pride route), open/wall connections, a proposed 11-map split plan, 24 anchors + the Dispatcher's, 11 fictional landmark slots. Validator schema v2 and 15 tests. README credits for the NYC data. No game changes (2.14). |
| **6c** | World maps | Generator or documented hand process from the dataset to the 11 Tiled maps in the split plan; replace the `roosevelt-ave` and `diversity-plaza-74th` stubs and add the other nine; decide the test map's fate; move the Dispatcher to `rav-dispatch`; re-point orders at the new pointIds; rewrite the layout-bound checks (P2, Q4, Q6c, the live-check route, the touch-check order). Decide how to draw 34th Ave (street or plaza) and which `unmapped` cross streets become links. |
| **7** | Saves and title | Versioned localStorage saves, autosave on zone change or delivery, title screen with Continue/New, settings stub (text speed). |
| **8** | Battle system v1 | Encounter trigger; first-person menu battle scene; rolling HP counter; fictional gentrification-themed enemies from JSON; basic attack, defend and flee commands with original labels. |
| **9** | Organizing moves and progression | Tenant-organizing specials (rent strike, petition, block party), a resource meter, XP and levels, status effects, balance pass. |
| **10–11** | Zone content | 37th Ave / Pride route, Historic District / co-op gardens, under-the-7 Roosevelt Ave. Community-informed writing and review for each represented community. |
| **12** | Audio | Original music and SFX, mobile audio unlock, volume settings. |
| **13** | Art pass | Real tilesets and sprites through the swap contract (2.3); title art. |
| **14** | Polish and accessibility | Key remapping, text speed, reduced motion, contrast check, low-end Android performance, pseudo-locale test of string expansion. Lint and unit-test tooling if not added earlier. |
| **15+** | Localization | First additional language. Needs fonts that cover the target scripts (e.g. Bengali, Devanagari, Tibetan). Pixel fonts for those are scarce; budget for this early. |

## 4. Open questions (not locked; owner's call)

1. **Protagonist identity:** name, look and backstory, and whether there's a party (EarthBound has four characters).
2. **Encounters:** visible enemies on the map (EarthBound-style) or random encounters?
3. **Real people in Pride history:** the "no identifiable people" rule is written for antagonists and businesses. Does it also cover respectful references to real historical figures and events? For example, the 1990 killing of Julio Rivera, which helped spur Queens Pride.
4. **Community review:** who reviews each community's portrayal, and when in the pipeline?
5. ~~**Licence**~~ Decided in session 2: MIT for code, CC BY-NC-SA 4.0 for content, copyright jcnyc90.
6. ~~**Engine**~~ Decided in session 2: Phaser 4.

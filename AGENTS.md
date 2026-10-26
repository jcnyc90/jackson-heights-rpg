# AGENTS.md — Jackson Heights RPG

Context and operating rules for coding agents (Antigravity CLI, Jules, and others) working in `jcnyc90/jackson-heights-rpg`. Antigravity CLI auto-loads `AGENTS.md` (and `GEMINI.md`) hierarchically from the working directory up to the repository root.

When anything in external notes or prompts conflicts with the repository, **trust the repository** (`docs/DESIGN.md`, `README.md`, `src/data/world/jackson-heights.json`, and the validation/test suites) and flag the conflict to the owner.

---

## 1. Project Summary

**Jackson Heights RPG** is an EarthBound-inspired 2D top-down pixel-art browser RPG set in Jackson Heights, Queens, framed as a community love letter to the neighborhood.

- **Repository:** `jcnyc90/jackson-heights-rpg` (public, deployed to GitHub Pages at <https://jcnyc90.github.io/jackson-heights-rpg/> via `.github/workflows/deploy.yml` on pushes to `main`).
- **Protagonist & Core Loop:** An adult local delivery worker. Accepting, picking up, and dropping off delivery orders moves the player across the neighborhood and drives quests.
- **Antagonist & Battles:** Gentrification rendered with EarthBound-style absurdity. First-person menu battles with a rolling HP meter and tenant-organizing moves (e.g., rent strike, petition, block party). *(Battle system is roadmap Session 8–9; not built yet.)*
- **Communities Represented:** Latin American, South Asian, Himalayan (Tibetan/Sherpa, centered around 74th St momo spots), and LGBTQ+ / Jackson Heights Pride history.
- **Licensing (Split):**
  - **Code — MIT** (`LICENSE`): `src/**` (except `src/data/**`), `scripts/**`, `tests/**`, `tools/**`, `index.html`, config/build files, `README.md`. Code-drawn placeholder art in `src/systems/placeholderArt.ts` and `src/systems/worldArt.ts` is MIT.
  - **Content — CC BY-NC-SA 4.0** (`LICENSE-CONTENT`): `src/data/**`, `public/assets/**` (except `public/assets/fonts/**`), `docs/**`.
  - **Third-Party Font — BSD-2-Clause** (`third_party/spleen-2.2.0/LICENSE`): Spleen 6x12 (`third_party/spleen-2.2.0/**` and generated `public/assets/fonts/spleen-6x12.png`). Notices ship in `public/THIRD-PARTY-NOTICES.txt`.

---

## 2. Tech Stack & Exact Commands

### Stack
- **Engine:** Phaser `4.2.1` (migrated from Phaser 3.90.0 in Session 2; ESM default import only, no `window.Phaser` global)
- **Bundler & Language:** Vite `8.3.4`, TypeScript `7.0.2` (`strict: true`, ES2022 target)
- **Runtime Requirements:** Node.js `>=22.12.0` (`.nvmrc` specifies `24`, used by CI), npm `10+`
- **Architecture:** Plain Phaser scenes + small TypeScript modules in `src/systems/`. No ECS, no DI container, no external state library. Static client-side site with no backend.
- **Resolution & Rendering:** Internal resolution `256×224` (`Phaser.Scale.FIT`, `pixelArt: true`, integer/whole-pixel stepping).
- **Font:** Spleen 6x12 (`public/assets/fonts/spleen-6x12.png`), printable ASCII (`U+0020–U+007E`) + printable Latin-1 (`U+00A0–U+00FF`), NFC-normalized strings only.
- **Maps:** Tiled 1.12 JSON (`tiled --export-map json` used by generator).

### Scripts (from `package.json`)

| Command | Exact Script | Purpose |
|---|---|---|
| `npm run dev` | `vite` | Start local dev server at `http://localhost:5173` (`?debug` draws collision boxes; `?features=...` overrides feature flags in dev). |
| `npm run build` | `tsc --noEmit && vite build` | Type-check and build production bundle to `dist/` (1,500 kB chunk warning limit). |
| `npm run preview` | `vite preview` | Serve `dist/` locally at `http://localhost:4173`. |
| `npm run validate:world` | `node scripts/validate-world.mjs` | Validate `src/data/world/jackson-heights.json` (schema v6, topology, citations, walk-time caps, privacy scan). Zero dependencies. |
| `npm run test:world` | `node --test tests/world/*.test.mjs` | Run all 44 Node test assertions covering the world dataset validator, map generator, privacy rules, and bike docks. No Tiled binary required. |
| `npm run maps:generate` | `node scripts/generate-maps.mjs` | Generate `public/assets/maps/jackson-heights.json` from the world dataset and normalize via `tiled --export-map json` (requires `tiled` CLI). |
| `npm run maps:check` | `node scripts/generate-maps.mjs --check` | Regenerate the world map through Tiled and fail on any byte difference against the committed map. |

### Browser Verification Suites (`tests/browser/README.md`)
Browser scripts step frames deterministically at 60 fps and must be run in a **visible** browser tab or headless Chrome (hidden in-app panes throttle timers and fail WebGL canvas readback):
- **Dev server (`http://localhost:5173`, requires `window.game`):**
  - `tests/browser/regression-suite.js` — `153 pass / 0 fail` (A–Y suites: config, movement, collision, blur fix, strings, font, dialogue, NPCs, warps, delivery loop, world map reachability, 150 px/s 8-way walk, thumbstick, radar/HUD/signs/edge, oblique depth/land use/parks/paseo, bike share, and speed buttons x1–x8).
  - `tests/browser/render-check.js` — Pixel hashes and `0` off-palette pixel verification.
  - `tests/browser/touch-check.js` — Thumbstick, Action button, speed buttons, HUD overlap checks, and full touch delivery completion at `375×812` and `667×375`.
  - `tests/browser/stream-check.js` — Full map crossings walking and riding at x1–x8 (`0` unbuilt-visible-bin frames).
- **Production build (`http://localhost:4173` or live GitHub Pages):**
  - `tests/browser/live-check.js` — Paste twice in console; dead-reckons start → Dispatcher → Order #1 completion and checks font glyphs, radar, Spleen notices, and page errors without dev hooks.

---

## 3. Directory Map

```text
.
├── .github/workflows/deploy.yml  # GitHub Pages CI/CD (builds & deploys dist/ on push to main; SHA-pinned actions)
├── docs/
│   └── DESIGN.md                 # Authoritative locked decisions, technical conventions (§2.1–2.18), and roadmap
├── index.html                    # App shell + touch-control DOM markup (%t:...% localized placeholders)
├── public/
│   ├── THIRD-PARTY-NOTICES.txt   # Shipped license texts for Phaser, vendored libs, and Spleen font
│   └── assets/
│       ├── fonts/spleen-6x12.png # Bitmap font atlas generated from third_party/spleen-2.2.0
│       ├── maps/jackson-heights.json # Generated 554×436 world map (Tiled JSON, base64+zlib tile layers)
│       └── tilesets/             # tiles.png + overhead.png (pixel-exact exports of runtime placeholder tiles)
├── scripts/
│   ├── build-font-atlas.mjs      # Converts Spleen BDF -> public/assets/fonts/spleen-6x12.png
│   ├── generate-maps.mjs         # Generates public/assets/maps/jackson-heights.json from world dataset
│   ├── validate-world.mjs        # Validates src/data/world/jackson-heights.json + privacy scan
│   └── world-layout.mjs          # Shared grid-to-tile coordinate math used by validator and generator
├── src/
│   ├── main.ts                   # Entry point: fetches & inflates external world map, then boots Phaser
│   ├── game.ts                   # Phaser.Game configuration
│   ├── config.ts                 # Resolution (256×224), speeds, texture keys, sprite/HUD metrics
│   ├── style.css                 # Fullscreen layout, pixelation, portrait/landscape touch controls
│   ├── scenes/
│   │   ├── BootScene.ts          # Preloads maps/font, generates placeholder textures, registers animations
│   │   ├── MapScene.ts           # Overworld gameplay: 8-way movement, physics stepping, NPCs, deliveries,
│   │   │                         # bike share rent/ride/return, speed multiplier, radar, HUD, warps
│   │   └── DialogueScene.ts      # EarthBound-style typewriter text window + Yes/No choice box
│   ├── systems/
│   │   ├── controls.ts           # Merges keyboard + touch input, speed buttons (0–3), blur handler, input lock
│   │   ├── touchControls.ts      # DOM 8-way round thumbstick, Action button, and 0–3 speed buttons
│   │   ├── worldView.ts          # Sliding 48×40 ground/collision window + streamed 32-tile sprite bins
│   │   ├── worldArt.ts           # Procedural oblique buildings (storefronts, walk-ups, co-ops, houses, civic),
│   │   │                         # street furniture, corner signs, and bike-share dock/bike sprites
│   │   ├── placeholderArt.ts     # Procedural base tileset, player, rider, NPC, delivery door, and HUD textures
│   │   ├── radar.ts              # Circular top-left radar (roads, parks, walk edge, docks, player, target blip)
│   │   ├── maps.ts               # Map registry, Tiled layer/object parsers, link validation
│   │   ├── mapLoader.ts          # Runtime fetch + DecompressionStream inflation for external zlib map layers
│   │   ├── npcs.ts               # Tiled NPC object reader & validator
│   │   ├── orders.ts             # Delivery orders loader, validator, and intersection place-name formatter
│   │   ├── gameState.ts          # In-memory session state (active order, completed orders, bike counts, riding)
│   │   ├── strings.ts            # t(id, params) string lookup and interpolation
│   │   ├── textLayout.ts         # Word-wrap and pagination for DialogueScene
│   │   └── font.ts               # Registers Spleen 6x12 bitmap font and character ranges
│   └── data/
│       ├── features.json         # Feature flags (bikeDocks, riding, speedButtons — all true as of 6f Stage 5)
│       ├── tiles.json            # Shared 57-tile ID list for runtime painters and map generator (append-only)
│       ├── orders.json           # 3 placeholder delivery orders across zones
│       ├── dialogue.json         # Dialogue ID -> array of string IDs
│       ├── strings/en.json       # All player-facing English strings (flat key-value map)
│       ├── maps/
│       │   ├── index.json        # Map registry (start: jackson-heights/start; maps: test-map, jackson-heights)
│       │   └── test-map.json     # Hand-made 30×20 test fixture (kept hidden from normal gameplay)
│       └── world/
│           └── jackson-heights.json # Schema v6 world dataset (streets, nodes, segments, zones, blockFaces,
│                                    # parks, trees, bikeLanes, bikeDocks, anchors, landmarks, sources)
├── tests/
│   ├── browser/                  # Deterministic 60 fps browser checks (regression, render, touch, stream, live)
│   └── world/                    # Node test suites (validate-world, generate-maps, bike-docks)
├── third_party/spleen-2.2.0/     # Unmodified Spleen 6x12 BDF source + BSD-2-Clause license
└── tools/                        # Offline Python/Node scripts that derive world data from gitignored logs/
```

*(Note: `logs/`, `dist/`, `node_modules/`, and `.claude/` are gitignored. Never commit files from `logs/`.)*

---

## 4. Decisions Log (Verified Against Repo)

Where older sequencing notes conflict with the repository, the table below records both and marks the **Repo Truth** as authoritative:

| Area | Decision & Repo Status |
|---|---|
| **World Structure & Zones** | **One continuous external world map** (`public/assets/maps/jackson-heights.json`, 554×436 tiles, walkable area 538×420 tiles) covering **73rd St to 90th St** and **Roosevelt Ave (plus the 74th–75th St / Broadway triangle) north to 31st Ave**. Contains **5 named zones**: the 4 locked zones (`diversity-plaza-74th`, `roosevelt-ave`, `ave-37`, `historic-district`) plus `northern-blvd` (added in 6d when bounds extended two avenues north of Northern Blvd to 32nd & 31st Ave). *(Conflict note: Session 6c used 9 warp-connected maps; Session 6d retired the split into one continuous map.)* |
| **Block Scale & View** | **30 tiles per short east–west block** in a **hybrid oblique view** with north–south long blocks compressed so the full walkable area is under 60 s east–west (57.4 s) and 45 s north–south (44.8 s) at 150 px/s walking speed. Corridors are 12 tiles wide (side streets), 18 tiles (avenues/Broadway), and 24 tiles (Northern Blvd/Roosevelt Ave), with 3-tile sidewalks. *(Conflict note: Session 6c used 8 tiles/block and 6d used 10 tiles/block; Session 6e superseded both with 30 tiles/block.)* |
| **34th Ave (Paseo Park) & Cross-Street Connectors** | **Implemented (6c–6e):** All 17 blocks of 34th Ave (73rd–90th St) are a car-free pedestrian paseo with sidewalks, green bike lanes on both sides, and a grassy center strip running unbroken across side streets. Cross streets from 78th to 90th St connect 37th Ave and Roosevelt Ave directly. |
| **World Data Sources & Licensing** | **NYC Open Data + MTA (OPEN-NY) + one-time Citi Bike GBFS exception (6f):** Street topology from DCP LION 26C; Historic District from LPC; Pedestrian Plazas and Bike Routes from NYC DOT; Parks outlines and 2015 Street Tree Census from NYC Parks; stations/entrances from MTA; land use per block face from PLUTO 26v2; bike-share dock positions from Citi Bike GBFS `station_information` (one-time exception in 6f for station positions only). **No coordinates, BBLs, street addresses, owners, or lot geometry are committed** (enforced by `privacyProblems()` in `scripts/validate-world.mjs`). |
| **Businesses & Landmarks** | **Repo vs. Owner Notes Conflict — STOP BEFORE CHANGING:** Currently, `docs/DESIGN.md` (§1 #5) and `scripts/validate-world.mjs` enforce that all businesses and landmarks in the repo are **fictional** (`"fictional": true` required on every landmark; storefront signs in `scripts/generate-maps.mjs` only show generic category words like `Bakery`, `Deli`, `Pharmacy`). The owner's newer context notes state: *"Businesses: real local businesses from OpenStreetMap, no chains. Chains and Citi Bike get generic names."* **Do not ingest OSM or remove the fictional-landmark validator check without explicit owner approval of the data source, ODbL vs. CC BY-NC-SA licensing handling, and schema changes.** |
| **Courtyards (Historic District)** | **Repo vs. Owner Notes Conflict:** Currently (`scripts/generate-maps.mjs` lines 569–579), Historic District `garden-coop` blocks draw an interior lawn/path/flower garden that is completely enclosed (`solid[k] = 1`, private/non-walkable). The owner's context notes state: *"Real courtyards are entered via game-placed gates, not real gate positions."* Gate entry into co-op courtyards has **not** been built yet. |
| **Bike Share & Speed (Session 6f)** | **Implemented & Merged (`41e1d75`):** 26 docks snapped from real Citi Bike GBFS stations onto legal curb/paseo/plaza footprints (`5×1` tiles: kiosk + 4 slots, 3 bikes at start). Generic `"Bike Share"` branding (`t()`). Action + Yes rents/returns bikes; riding is `300 px/s` (2× walking `150 px/s`). Speed buttons/keys `0–3` (`x1`, `x2`, `x4`, `x8`) scale physics step rate (`60 Hz` up to `960 Hz`) so per-step movement stays 2–3 px (max 4 px on initial diagonal wall-slide transition) with zero tunneling. |
| **Test Map & Old Prototype** | `src/data/maps/test-map.json` is kept as a **hidden test-only fixture** (no map warps to it; regression suites A–P use it). Any older GTA-style prototype outside this repo (e.g., in `~/Downloads`) is ignored. |

---

## 5. Current State (As of Commit `41e1d75`)

### Sessions Completed
- **Sessions 1–5:** Scaffold, Phaser 4.2.1 migration & dual licensing, dialogue & Tiled NPC pipeline, Spleen 6x12 font & warps, Delivery Loop v1.
- **Sessions 6a–6f:** World dataset & verification (6a–6b), generated world maps (6c), single continuous map + 31st/32nd Ave extension + 8-way thumbstick + wayfinding (6d), 30-tile hybrid oblique map + PLUTO land use + Parks + census trees + external streamed map + circular radar + 150 px/s walk (6e), bike-share docks + riding + speed buttons 0–3 (6f, merged to `main` at `41e1d75`).

### Status of Delivery Loop: **Partly Done (v1 Mechanics Complete; Placeholder Content Only)**
- **Done:**
  - Data model and strict validator (`src/data/orders.json`, `src/systems/orders.ts`).
  - In-memory state tracking (`src/systems/gameState.ts`: active order, `assigned` → `picked-up` → delivered, completed order list, reward total).
  - Full gameplay flow in `MapScene`: talking to the Dispatcher (`rav-dispatch`, north sidewalk of Roosevelt Ave between 74th & 75th St) assigns orders sequentially; facing a `deliveryPoint` door and pressing Action picks up or delivers (works both on foot and while riding a bike).
  - Wayfinding & HUD: bottom order ticket naming pickup/dropoff intersections (`"Pick up: 73rd St & 37th Rd"`), top-left radar target blip (clamped to rim when off-radar), screen-edge target arrow, bobbing parcel tag beacon over target doors, and bright orange/yellow delivery doors.
- **Not Done Yet:**
  - Content is 3 placeholder orders (`order-1`, `order-2`, `order-3` using generic `"Order #1"`–`"#3"` strings and fictional anchors).
  - No money/reward HUD display, no quest chains or narrative triggers, no choice menus at the Dispatcher, and no persistence across reloads (`localStorage` saves are Session 7).

### Status of World Dataset (`src/data/world/jackson-heights.json`): **Done Through Schema v6 (Pending Any 6g / OSM Business Scope)**
- **Done (Schema v6, `0` errors / `0` warnings in `validate:world`, `44/44` in `test:world`):**
  - `32` streets (5 southern stubs), `138` nodes (`49` continuing street ends past bounds), `246` segments (`235` in `5` zones), `3` elevated-7 stations (`74 St`, `82 St`, `90 St`), `6` special areas, `27` anchors (`26` delivery + `1` Dispatcher), `13` fictional landmarks, `492` PLUTO/Parks block faces, `8` park outlines (including walkable Travers Park), `2,279` thinned street trees (`2,083` placed), `17` 34th Ave bike-lane blocks, `26` snapped bike-share docks, and `17` cited sources.
- **Not Started / Needs Owner Approval Before Building:**
  - Session 6g road/lane/sign refinements and whether bike riding is restricted to roads/bike lanes/plazas (`logs/s6f-report.md` §12).
  - Any switch from fictional landmarks/generic shop words to real local businesses from OpenStreetMap (and how ODbL vs. CC BY-NC-SA 4.0 licensing is handled).
  - Adding game-placed gates to enter Historic District garden co-op courtyards.

---

## 6. Working Agreements & Guardrails

1. **Blunt Review & Scope Control:**
   - The owner reviews all scope changes and prefers direct, blunt reporting.
   - Flag **security issues, privacy leaks, over-engineering, and scope creep** unprompted.
   - Do not add abstractions (ECS, state libraries, DI) without an immediate second use case.
2. **Stop for Dataset / Data-Source Approval:**
   - Before adding any new external dataset (especially OpenStreetMap, which is ODbL-licensed) or changing dataset/privacy rules, **stop and get explicit owner approval**.
   - Never commit raw external downloads; keep raw files in gitignored `logs/` and commit only derived facts/tiles in `src/data/world/jackson-heights.json` via reproducible scripts in `tools/`.
3. **Privacy Rule (Strict):**
   - Never commit tax-lot BBLs, BINs, street/house addresses (`"12-34 56 St"`), property owner names, lot polygons/footprints, or raw lat/lon coordinates into `src/data/**` or `public/assets/**`. Always run `npm run validate:world` and `npm run test:world` after any data change.
4. **Never Hand-Edit Generated Maps:**
   - `public/assets/maps/jackson-heights.json` is generated by `scripts/generate-maps.mjs` and normalized by Tiled (`npm run maps:generate`). Modify the dataset or generator instead, then verify with `npm run maps:check`.
   - Only `src/data/maps/test-map.json` is hand-authored.
5. **No Hard-Coded Strings:**
   - Every player-facing string in TypeScript or `index.html` must live in `src/data/strings/en.json` and be accessed via `t(id, params)` (or `%t:id%` in `index.html`).
   - Strings must use NFC normalization and only characters in `FONT_RANGES` (printable ASCII + Latin-1; straight quotes/apostrophes only, no curly quotes or em dashes unless added to `build-font-atlas.mjs` and `src/systems/font.ts`).
6. **Phaser 4 & Rendering Invariants:**
   - Keep `import Phaser from 'phaser'`; never use `window.Phaser`.
   - Never flip tiles vertically in code (`Tile.setFlipY` triggers a Phaser 4.2.1 `TransformerTile` bug).
   - Keep positions whole-pixel (no camera zoom, no fractional resting positions, no sprite rotation).
7. **Supply Chain & Dependencies:**
   - `.npmrc` enforces `save-exact=true`.
   - New or updated npm packages and GitHub Actions pins must follow the **14-day release cooldown** (`npm install --before=<date>`), unless overriding for a documented security fix.
   - If dependencies or fonts change, update `public/THIRD-PARTY-NOTICES.txt`.

---

## 7. Open Questions (Owner's Call)

1. **Local Businesses & OpenStreetMap (Conflict with `DESIGN.md` §1 #5 & §2.14):**
   - Should the repo retire the fictional-business rule (`"fictional": true` in `validate-world.mjs`) in favor of real local businesses from OpenStreetMap (with generic names for chains)?
   - How should OSM's **ODbL** share-alike requirement be reconciled with the repo's **CC BY-NC-SA 4.0** content license (which `DESIGN.md` §2.14 previously cited as the reason for avoiding OSM)?
2. **Co-op Courtyard Gates:**
   - Should `scripts/generate-maps.mjs` place walkable gates into Historic District `garden-coop` interior courtyards now, and what visual/placement rule should govern gate positions?
3. **Session 6g Scope (Roads, Lanes, Signs, & Bike Riding Surface):**
   - Should bike riding be restricted to roads, green bike lanes, crosswalks, and plazas (requiring dismount on sidewalks/park lawns), or remain allowed everywhere walkable?
   - Confirm or adjust Claude's choices from 6e/6f (e.g., `validate-world.mjs` walk-time caps replacing the 256-tile cap; north-fronting building lip appearance; landscape speed button overlap on 667×375 viewports).
4. **Session 7 (Saves & Title Screen):**
   - Since warps/multiple world maps were retired in 6d, should `localStorage` autosaves store the player's exact tile coordinates `(tileX, tileY)` on `jackson-heights`, or snap to the nearest anchor/intersection/Dispatcher?
5. **Narrative & Design Questions (`docs/DESIGN.md` §4):**
   - Protagonist identity (name, look, backstory, solo vs. party).
   - Battle encounters (visible on-map EarthBound-style vs. random encounters).
   - Whether the "no identifiable real people" rule allows respectful references to historical figures in Jackson Heights Pride history (e.g., Julio Rivera).
   - Community review process and timing for represented communities.

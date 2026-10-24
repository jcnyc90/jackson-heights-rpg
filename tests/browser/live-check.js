// Live-site check for the production build, which has no window.game hook (session 3's
// technique, versioned in session 4). Run on https://jcnyc90.github.io/jackson-heights-rpg/
// or on `npm run preview`, in TWO evaluations of this script:
//   1st: re-writes the page with a requestAnimationFrame shim and a cache-busted bundle URL,
//        then returns 'reloaded'. (A hidden browser pane pauses real rAF; the shim lets the
//        check pump frames itself, at exactly 60 fps, so the walk below is deterministic.)
//   2nd: drives the game with real KeyboardEvents and checks pixels on the canvas.
// Session 6c: every route is derived from map data. The script fetches the map registry, the orders and
// the strings (default: this repo's main branch on raw.githubusercontent.com; set window.__dataBase, e.g.
// to 'http://localhost:5173/src/data/' with the dev server running, to check a local preview), and since
// 6e the world map itself from the page's own site (the deployed external asset, its zlib layers inflated
// here). It finds paths over the map's collision grid (BFS) and walks them by dead reckoning: from rest,
// holding a key n frames moves exactly floor(2.5 n) px (150 px/s, session 6e), so each straight run is
// split into holds of exact lengths; spawns sit on tile centres. Routes are 4-way here (diagonals move 1
// or 2 px per axis per step, which regression T2 covers). The world is one map with no warps: it walks
// from a new game's start to the Dispatcher and completes Order #1, and reports the walking time. It reads
// the start zone's name card, every text-window line and order ticket off the canvas, glyph by glyph
// against the shipped font atlas, and checks the radar is drawn, the Spleen notices and page errors.
// Top-level await: evaluate as an async function body. Returns a results object.
if (!window.__liveShim) {
  const html = await (await fetch(location.href, { cache: 'no-store' })).text();
  const shim = '<script>window.__liveShim=true;window.__cb=null;window.requestAnimationFrame=function(f){window.__cb=f;return 1};window.cancelAnimationFrame=function(){};' +
    'window.__errors=[];window.addEventListener("error",function(e){window.__errors.push(String(e.message))});window.addEventListener("unhandledrejection",function(e){window.__errors.push(String(e.reason))});' +
    'var ce=console.error;console.error=function(){window.__errors.push([].join.call(arguments," "));return ce.apply(console,arguments)};<\/script>';
  const base = window.__dataBase ? `<script>window.__dataBase=${JSON.stringify(window.__dataBase)}<\/script>` : '';
  document.open();
  document.write(html.replace('<head>', '<head>' + shim + base).replace(/(src="[^"]*index-[^"]+\.js)"/, `$1?live-check=${Date.now()}"`));
  document.close();
  'reloaded';
} else {
  const FRAME = 1000 / 60; let T = performance.now(); let frames = 0;
  const framesPumped = () => frames;
  const pump = (n) => { for (let i = 0; i < n; i++) { T += FRAME; const f = window.__cb; window.__cb = null; if (!f) return false; f(T); frames++; } return true; };
  const KC = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Space: 32 };
  const ev = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { key: code === 'Space' ? ' ' : code, code, keyCode: KC[code], which: KC[code], bubbles: true }));
  const press = () => { ev('keydown', 'Space'); pump(1); ev('keyup', 'Space'); pump(2); };
  const canvas = () => document.querySelector('#game canvas');
  const snap = () => { const c = canvas(); const cv = document.createElement('canvas'); cv.width = c.width; cv.height = c.height; const x = cv.getContext('2d'); x.drawImage(c, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
  const rgbAt = (px, x, y) => { const p = (y * 256 + x) * 4; return (px[p] << 16) | (px[p + 1] << 8) | px[p + 2]; };
  const R = {};
  try {
    // Data the routes come from.
    const BASE = window.__dataBase ?? 'https://raw.githubusercontent.com/jcnyc90/jackson-heights-rpg/main/src/data/';
    const getJson = async (path) => { const r = await fetch(BASE + path, { cache: 'no-store' }); if (!r.ok) throw new Error(`fetch ${BASE + path}: ${r.status}`); return r.json(); };
    const REG = await getJson('maps/index.json'); const EN = await getJson('strings/en.json'); const ORDERS = (await getJson('orders.json')).orders;
    // Bundled maps from the data base; external ones (the world map, 6e) from this site, as deployed.
    const inflate = async (b64) => { const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); return new Uint32Array(await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()); };
    const MAPS = {};
    for (const m of REG.maps) {
      if (!m.url) { MAPS[m.id] = await getJson(`maps/${m.file}`); continue; }
      const r = await fetch(m.url, { cache: 'no-store' }); if (!r.ok) throw new Error(`fetch ${m.url}: ${r.status}`);
      const d = await r.json(); MAPS[m.id] = d; d.__solid = await inflate(d.layers.find((l) => l.name === 'collision').data);
    }
    R.dataBase = BASE;
    const prop = (o, n) => o.properties?.find((p) => p.name === n)?.value;
    const objs = (id, type) => MAPS[id].layers.find((l) => l.name === 'objects').objects.filter((o) => o.type === type);
    const warpsOf = (id) => objs(id, 'warp');
    const spawnOf = (id, sid) => objs(id, 'spawn').find((o) => prop(o, 'spawnId') === sid);
    const nameOf = (id) => EN[REG.maps.find((m) => m.id === id).name];
    const grid = (id) => {
      const d = MAPS[id];
      // The world map: its collision layer; bundled maps: colliding tiles of "obstacles".
      let blocked;
      if (d.__solid) blocked = (tx, ty) => d.__solid[ty * d.width + tx] !== 0;
      else { const ts = d.tilesets.find((t) => t.name === 'tiles'); const solid = new Set((ts.tiles ?? []).filter((t) => t.properties?.some((p) => p.name === 'collides' && p.value === true)).map((t) => t.id + ts.firstgid)); const obs = d.layers.find((l) => l.name === 'obstacles').data; blocked = (tx, ty) => solid.has(obs[ty * d.width + tx]); }
      const npcs = new Set((d.layers.find((l) => l.name === 'npcs')?.objects ?? []).map((o) => `${Math.floor(o.x / 16)},${Math.floor((o.y - 1) / 16)}`));
      const inside = (r, tx, ty) => tx * 16 + 8 >= r.x && tx * 16 + 8 < r.x + r.width && ty * 16 + 8 >= r.y && ty * 16 + 8 < r.y + r.height;
      const wk = walkOf(id); const inWalk = (tx, ty) => !wk || (tx >= wk[0] && ty >= wk[1] && tx < wk[0] + wk[2] && ty < wk[1] + wk[3]);
      return { id, W: d.width, H: d.height, inside, warpAt: (tx, ty) => warpsOf(id).find((w) => inside(w, tx, ty)), open: (tx, ty) => tx >= 0 && ty >= 0 && tx < d.width && ty < d.height && inWalk(tx, ty) && !blocked(tx, ty) && !npcs.has(`${tx},${ty}`) };
    };
    const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]]; const KEY = { '1,0': 'ArrowRight', '-1,0': 'ArrowLeft', '0,1': 'ArrowDown', '0,-1': 'ArrowUp' };
    const bfs = (G, start, isGoal) => {
      const key = (t) => t[1] * G.W + t[0]; const prev = new Map([[key(start), null]]); const q = [start];
      while (q.length) {
        const cur = q.shift();
        if (isGoal(cur)) { const path = [cur]; let k = prev.get(key(cur)); while (k !== null) { path.unshift([k % G.W, Math.floor(k / G.W)]); k = prev.get(k); } return path; }
        if (G.warpAt(...cur) && cur !== start) continue;
        for (const [dx, dy] of STEPS) { const n = [cur[0] + dx, cur[1] + dy]; if (G.open(...n) && !prev.has(key(n))) { prev.set(key(n), key(cur)); q.push(n); } }
      }
      return null;
    };
    const mapRoute = (from, to) => { const prev = new Map([[from, null]]); const q = [from]; while (q.length) { const m = q.shift(); for (const w of warpsOf(m)) if (!prev.has(prop(w, 'targetMap'))) { prev.set(prop(w, 'targetMap'), { m, w }); q.push(prop(w, 'targetMap')); } } const hops = []; for (let t = to; prev.get(t); t = prev.get(t).m) hops.unshift(prev.get(t).w); return hops; };

    // Dead reckoning: where the player is (map, feet), from the spawn they arrived at plus every step.
    const startSpawn = spawnOf(REG.start.map, REG.start.spawn);
    const P = { map: REG.start.map, x: startSpawn.x, y: startSpawn.y };
    const tile = () => [Math.floor(P.x / 16), Math.floor((P.y - 1) / 16)];
    // The camera follows the feet, clamped to the map; the text window and ticket placement follow from it (MapScene).
    const scroll = () => { const d = MAPS[P.map]; return [Math.max(0, Math.min(d.width * 16 - 256, P.x - 128)), Math.max(0, Math.min(d.height * 16 - 224, P.y - 112))]; };
    let darkest = 765; let walkFrames = 0;
    // Where the player can walk (map properties walkX/Y/Width/Height, in tiles; since 6d).
    const walkOf = (id) => { const p = Object.fromEntries((MAPS[id].properties ?? []).map((q) => [q.name, q.value])); return p.walkX === undefined ? null : [p.walkX, p.walkY, p.walkWidth, p.walkHeight]; };
    const hold = (code, n, watchFade = false) => { ev('keydown', code); for (let i = 0; i < n; i++) { pump(1); if (watchFade) { const c = rgbAt(snap(), 128, 112); darkest = Math.min(darkest, (c >> 16) + ((c >> 8) & 255) + (c & 255)); } } ev('keyup', code); pump(1); };
    const DELTA = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
    // Moves exactly d px in a straight line (6e): a hold of n frames from rest moves floor(2.5 n) px, which is
    // 0 or 2 mod 5; the rest is made up with 1-frame taps of 2 px. Returns the frames held.
    const PX = (n) => Math.floor((5 * n) / 2);
    const holdFor = (px) => { for (let n = 1; PX(n) <= px; n++) if (PX(n) === px) return n; return 0; };
    const moveExact = (code, d) => {
      let taps = 0; while (taps < 5 && !holdFor(d - 2 * taps)) taps++;
      const n = holdFor(d - 2 * taps); if (n) hold(code, n); for (let t = 0; t < taps; t++) hold(code, 1);
      return n + taps;
    };
    // Walks a tile path; a warp tile at the end is stepped onto and the fade waited out, landing on its target spawn.
    const walkPath = (path) => {
      const arrivals = [];
      for (let i = 0; i < path.length - 1;) {
        const d = [path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]]; let j = i + 1;
        while (j < path.length - 1 && path[j + 1][0] - path[j][0] === d[0] && path[j + 1][1] - path[j][1] === d[1]) j++;
        const code = KEY[d.join(',')]; const w = grid(P.map).warpAt(...path[j]);
        if (w) {
          if (j - i > 1) { moveExact(code, 16 * (j - i - 1)); P.x += d[0] * 16 * (j - i - 1); P.y += d[1] * 16 * (j - i - 1); }
          hold(code, 7 + 45, true);
          const to = prop(w, 'targetMap'); const sp = spawnOf(to, prop(w, 'targetSpawn')); Object.assign(P, { map: to, x: sp.x, y: sp.y });
          arrivals.push({ map: to, warp: w.name, nameCard: nameCard(nameOf(to)) }); pump(2);
        } else { walkFrames += moveExact(code, 16 * (j - i)); P.x += d[0] * 16 * (j - i); P.y += d[1] * 16 * (j - i); }
        i = j;
      }
      return arrivals;
    };
    // Travel to the tile in front of [tx, ty] on map `to` (through warps); returns arrivals and the way to face.
    const travel = (to, [tx, ty], via) => {
      const arrivals = [];
      for (let hop = 0; P.map !== to && hop < 12; hop++) { const G = grid(P.map); const w = (via && warpsOf(P.map).find(via)) || mapRoute(P.map, to)[0]; arrivals.push(...walkPath(bfs(G, tile(), (t) => G.inside(w, ...t)))); }
      const G = grid(to); let face = null;
      walkPath(bfs(G, tile(), (t) => { const f = STEPS.find(([dx, dy]) => t[0] + dx === tx && t[1] + dy === ty); if (f && !G.warpAt(...t)) face = f; return !!f && !G.warpAt(...t); }));
      return { arrivals, face: KEY[face.join(',')] };
    };
    // Face a way with a 1-frame tap (moves exactly 2 px; the 3 px gap to a wall or NPC leaves room), and step back afterwards.
    const OPP = { ArrowUp: 'ArrowDown', ArrowDown: 'ArrowUp', ArrowLeft: 'ArrowRight', ArrowRight: 'ArrowLeft' };
    const faceTap = (code) => { hold(code, 1); P.x += 2 * DELTA[code][0]; P.y += 2 * DELTA[code][1]; pump(3); };
    const unTap = (code) => faceTap(OPP[code]);

    // Glyph checks against the shipped font atlas (FONT_CHARS order: ASCII 32-126, then 160-255).
    for (let i = 0; i < 100; i++) { pump(5); await new Promise((r) => setTimeout(r, 30)); const px = snap(); if (rgbAt(px, 128, 100) !== 0x1b1528 && rgbAt(px, 128, 100) !== 0) break; }
    pump(30); pump(24); // the zone name card shows after 300 ms in the zone
    R.bundle = document.querySelector('script[src*="index-"]')?.getAttribute('src');
    const atlas = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = 'assets/fonts/spleen-6x12.png'; });
    const acv = document.createElement('canvas'); acv.width = atlas.width; acv.height = atlas.height; const actx = acv.getContext('2d'); actx.drawImage(atlas, 0, 0);
    const apx = actx.getImageData(0, 0, atlas.width, atlas.height).data;
    const lit = (ch, x, y) => { const c = ch.charCodeAt(0); const i = c <= 126 ? c - 32 : 95 + c - 160; const p = (((Math.floor(i / 16) * 12) + y) * atlas.width + (i % 16) * 6 + x) * 4; return apx[p + 3] > 0; };
    const badGlyphs = (lines, x0, y0) => { const px = snap(); const bad = []; lines.forEach((line, row) => [...line].forEach((ch, col) => { for (let y = 0; y < 12; y++) for (let x = 0; x < 6; x++) if (rgbAt(px, x0 + col * 6 + x, y0 + row * 12 + y) !== (lit(ch, x, y) ? 0xfffaf0 : 0x2a1f3d)) { bad.push(ch); return; } })); return bad; };
    // Name cards sit at the top right (6e), under the corner-name row on the world map: 4 px margin, 3 px padding.
    function nameCard(name) { const w = [...name].length * 6 + 6; return badGlyphs([name], 256 - 4 - w + 3, 4 + 18 + 2 + 3); }
    // Text window: 36 columns, words never split (src/systems/textLayout.ts); at the bottom when the player is in the top half.
    const wrap = (text) => { const out = []; let line = ''; for (const w of text.split(' ')) { if (line && (line + ' ' + w).length > 36) { out.push(line); line = w; } else line = line ? line + ' ' + w : w; } out.push(line); return out; };
    const winText = (text) => { const atBottom = P.y - scroll()[1] < 112; return badGlyphs(wrap(text), 8 + 10, (atBottom ? 224 - 8 - 56 : 8) + 8); };
    // Ticket (6d): centred at the bottom, at the top while it would cover the player.
    const ticketCheck = (lines) => {
      const w = Math.max(...lines.map((l) => l.length)) * 6 + 6; const h = 30; const x = Math.floor((256 - w) / 2); const [sx, sy] = scroll();
      const by = 224 - 4 - h; const left = P.x - 8 - sx; const feet = P.y - sy; const covered = left < x + w && left + 16 > x && feet - 24 < by + h && feet > by;
      return badGlyphs(lines, x + 3, (covered ? 24 : by) + 3);
    };
    const fill = (id, params) => Object.entries(params).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), EN[id]);
    const talk = () => { press(); pump(2); press(); pump(5); }; // open, then finish typing the first page
    const next = () => { press(); pump(2); press(); pump(5); }; // turn the page, finish typing it
    const close = () => { press(); pump(10); };

    // 1. Start -> the Dispatcher (pathfound), face them, take Order #1.
    // Places (6d): a delivery point names its nearest intersection, "<street> & <cross>".
    const placeOf = (stop) => { const p = objs(stop.map, 'deliveryPoint').find((o) => prop(o, 'pointId') === stop.pointId); return fill('place.corner', { street: EN[prop(p, 'street')], cross: EN[prop(p, 'cross')] }); };
    const o1 = ORDERS[0]; const item = EN[o1.text.item]; const params = { item, pickup: placeOf(o1.pickup), dropoff: placeOf(o1.dropoff) };
    // The start zone's name card, once the player has stood there 300 ms (pumped above).
    R.startZoneCard = nameCard(EN['zone.roosevelt-ave.name']);
    // The radar (6e): a 43 px circle at the top left: white roads and ring, dark blocks; its corners show the map behind.
    { const px = snap(); let light = 0, dark = 0; for (let y = 4; y < 47; y++) for (let x = 4; x < 47; x++) { const c = rgbAt(px, x, y); if (c === 0xfffaf0) light++; if (c === 0x2a1f3d) dark++; } R.radarDrawn = light > 150 && dark > 150; }
    const dispNpc = MAPS[REG.start.map].layers.find((l) => l.name === 'npcs').objects.find((o) => prop(o, 'role') === 'dispatcher');
    const toDisp = travel(REG.start.map, [Math.floor(dispNpc.x / 16), Math.floor((dispNpc.y - 1) / 16)]);
    R.startToDispatcherTiles = `${startSpawn.x},${startSpawn.y} -> ${P.x},${P.y}`;
    faceTap(toDisp.face); talk();
    R.order_dispatcherGreeting = winText(fill('dialogue.dispatcher.hello.1', { name: EN['npc.dispatcher.name'] }));
    next(); R.order_assignLine = winText(fill(o1.text.assign, params)); close(); unTap(toDisp.face);
    const ticket1 = [fill('hud.order.assigned', { item }), fill('hud.go.assigned', { place: params.pickup })];
    R.order_ticketAssigned = ticketCheck(ticket1);

    // 2. To the pickup (one map, no warps since 6d), pick up.
    const pt = (stop) => { const p = objs(stop.map, 'deliveryPoint').find((o) => prop(o, 'pointId') === stop.pointId); return [p.x / 16, p.y / 16]; };
    const leg1 = travel(o1.pickup.map, pt(o1.pickup));
    R.leg1_warps = leg1.arrivals.length;
    R.order_ticketAfterLeg1 = ticketCheck(ticket1);
    faceTap(leg1.face); talk(); R.order_pickedUpLine = winText(fill(o1.text.pickedUp, params)); close(); unTap(leg1.face);
    const ticket2 = [fill('hud.order.picked-up', { item }), fill('hud.go.picked-up', { place: params.dropoff })];
    R.order_ticketPickedUp = ticketCheck(ticket2);

    // 3. To the dropoff, deliver; the ticket goes.
    const leg2 = travel(o1.dropoff.map, pt(o1.dropoff));
    R.leg2_warps = leg2.arrivals.length;
    R.order_ticketAfterLeg2 = ticketCheck(ticket2);
    faceTap(leg2.face); talk(); R.order_deliveredLine = winText(fill(o1.text.delivered, params)); close(); unTap(leg2.face);
    // Gone: the picked-up ticket's text is no longer drawn (most of its glyphs fail to match).
    R.order_ticketHiddenAfterDelivery = ticketCheck(ticket2).length > ticket2.join('').length / 2;
    R.walkingTime = `${walkFrames} frames walked = ${(walkFrames / 60).toFixed(1)} s (start -> Dispatcher -> pickup -> dropoff; ${framesPumped()} frames in all incl. dialogue)`;
    const notices = await (await fetch('THIRD-PARTY-NOTICES.txt', { cache: 'no-store' })).text();
    const js = await (await fetch(R.bundle, { cache: 'no-store' })).text();
    R.noticesHaveSpleen = notices.includes('Spleen 6x12 2.2.0') && notices.includes('Frederic Cambus');
    R.bannerMentionsSpleen = js.slice(0, 600).includes('Spleen');
  } catch (e) { R.ERROR = String(e && e.stack || e); }
  R.errors = window.__errors;
  R.framesPumped = frames;
  const glyphChecks = Object.keys(R).filter((k) => /^order_(?!ticketHidden)|^startZoneCard$/.test(k));
  R.summary = glyphChecks.every((k) => Array.isArray(R[k]) && R[k].length === 0) && R.order_ticketHiddenAfterDelivery && R.radarDrawn && R.leg1_warps === 0 && R.leg2_warps === 0 && R.noticesHaveSpleen && R.bannerMentionsSpleen && R.errors.length === 0 && !R.ERROR ? 'PASS' : 'FAIL';
  R;
}

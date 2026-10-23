// Live-site check for the production build, which has no window.game hook (session 3's
// technique, versioned in session 4). Run on https://jcnyc90.github.io/jackson-heights-rpg/
// or on `npm run preview`, in TWO evaluations of this script:
//   1st: re-writes the page with a requestAnimationFrame shim and a cache-busted bundle URL,
//        then returns 'reloaded'. (A hidden browser pane pauses real rAF; the shim lets the
//        check pump frames itself, at exactly 60 fps, so the walk below is deterministic.)
//   2nd: drives the game with real KeyboardEvents and checks pixels on the canvas.
// Session 6c: every route is derived from map data. The script fetches the map registry, the maps,
// the orders and the strings (default: this repo's main branch on raw.githubusercontent.com; set
// window.__dataBase, e.g. to 'http://localhost:5173/src/data/' with the dev server running, to check a
// local preview), finds paths over each map's collision grid (BFS), and walks them by dead reckoning:
// the player moves exactly 1 px per frame held, so a tile is 16 frames, and spawns sit on tile centres.
// It walks from the start to the Dispatcher, completes Order #1 across warps, then takes a cross-street
// connector from 37th Ave down to Roosevelt Ave. It reads every name card, text-window line and order
// ticket off the canvas, glyph by glyph against the shipped font atlas, and checks the fade reaches
// black, the Spleen notices and page errors. (6c dropped the accented font-test line: it's on test-map,
// which normal play can't reach; regression N4 covers it on the dev server.)
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
    const MAPS = {}; for (const m of REG.maps) MAPS[m.id] = await getJson(`maps/${m.file}`);
    R.dataBase = BASE;
    const prop = (o, n) => o.properties?.find((p) => p.name === n)?.value;
    const objs = (id, type) => MAPS[id].layers.find((l) => l.name === 'objects').objects.filter((o) => o.type === type);
    const warpsOf = (id) => objs(id, 'warp');
    const spawnOf = (id, sid) => objs(id, 'spawn').find((o) => prop(o, 'spawnId') === sid);
    const nameOf = (id) => EN[REG.maps.find((m) => m.id === id).name];
    const grid = (id) => {
      const d = MAPS[id]; const ts = d.tilesets.find((t) => t.name === 'tiles');
      const solid = new Set((ts.tiles ?? []).filter((t) => t.properties?.some((p) => p.name === 'collides' && p.value === true)).map((t) => t.id + ts.firstgid));
      const obs = d.layers.find((l) => l.name === 'obstacles').data;
      const npcs = new Set((d.layers.find((l) => l.name === 'npcs')?.objects ?? []).map((o) => `${Math.floor(o.x / 16)},${Math.floor((o.y - 1) / 16)}`));
      const inside = (r, tx, ty) => tx * 16 + 8 >= r.x && tx * 16 + 8 < r.x + r.width && ty * 16 + 8 >= r.y && ty * 16 + 8 < r.y + r.height;
      return { id, W: d.width, H: d.height, inside, warpAt: (tx, ty) => warpsOf(id).find((w) => inside(w, tx, ty)), open: (tx, ty) => tx >= 0 && ty >= 0 && tx < d.width && ty < d.height && !solid.has(obs[ty * d.width + tx]) && !npcs.has(`${tx},${ty}`) };
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
    let darkest = 765;
    const hold = (code, n, watchFade = false) => { ev('keydown', code); for (let i = 0; i < n; i++) { pump(1); if (watchFade) { const c = rgbAt(snap(), 128, 112); darkest = Math.min(darkest, (c >> 16) + ((c >> 8) & 255) + (c & 255)); } } ev('keyup', code); pump(1); };
    const DELTA = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
    // Walks a tile path; a warp tile at the end is stepped onto and the fade waited out, landing on its target spawn.
    const walkPath = (path) => {
      const arrivals = [];
      for (let i = 0; i < path.length - 1;) {
        const d = [path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]]; let j = i + 1;
        while (j < path.length - 1 && path[j + 1][0] - path[j][0] === d[0] && path[j + 1][1] - path[j][1] === d[1]) j++;
        const code = KEY[d.join(',')]; const w = grid(P.map).warpAt(...path[j]);
        if (w) {
          if (j - i > 1) { hold(code, (j - i - 1) * 16); P.x += d[0] * 16 * (j - i - 1); P.y += d[1] * 16 * (j - i - 1); }
          hold(code, 16 + 45, true);
          const to = prop(w, 'targetMap'); const sp = spawnOf(to, prop(w, 'targetSpawn')); Object.assign(P, { map: to, x: sp.x, y: sp.y });
          arrivals.push({ map: to, warp: w.name, nameCard: nameCard(nameOf(to)) }); pump(2);
        } else { hold(code, (j - i) * 16); P.x += d[0] * 16 * (j - i); P.y += d[1] * 16 * (j - i); }
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
    // Face a way with a 1-frame tap (moves exactly 1 px), and step back afterwards.
    const OPP = { ArrowUp: 'ArrowDown', ArrowDown: 'ArrowUp', ArrowLeft: 'ArrowRight', ArrowRight: 'ArrowLeft' };
    const faceTap = (code) => { hold(code, 1); P.x += DELTA[code][0]; P.y += DELTA[code][1]; pump(3); };
    const unTap = (code) => faceTap(OPP[code]);

    // Glyph checks against the shipped font atlas (FONT_CHARS order: ASCII 32-126, then 160-255).
    for (let i = 0; i < 100; i++) { pump(5); await new Promise((r) => setTimeout(r, 30)); const px = snap(); if (rgbAt(px, 128, 100) !== 0x1b1528 && rgbAt(px, 128, 100) !== 0) break; }
    pump(30);
    R.bundle = document.querySelector('script[src*="index-"]')?.getAttribute('src');
    const atlas = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = 'assets/fonts/spleen-6x12.png'; });
    const acv = document.createElement('canvas'); acv.width = atlas.width; acv.height = atlas.height; const actx = acv.getContext('2d'); actx.drawImage(atlas, 0, 0);
    const apx = actx.getImageData(0, 0, atlas.width, atlas.height).data;
    const lit = (ch, x, y) => { const c = ch.charCodeAt(0); const i = c <= 126 ? c - 32 : 95 + c - 160; const p = (((Math.floor(i / 16) * 12) + y) * atlas.width + (i % 16) * 6 + x) * 4; return apx[p + 3] > 0; };
    const badGlyphs = (lines, x0, y0) => { const px = snap(); const bad = []; lines.forEach((line, row) => [...line].forEach((ch, col) => { for (let y = 0; y < 12; y++) for (let x = 0; x < 6; x++) if (rgbAt(px, x0 + col * 6 + x, y0 + row * 12 + y) !== (lit(ch, x, y) ? 0xfffaf0 : 0x2a1f3d)) { bad.push(ch); return; } })); return bad; };
    function nameCard(name) { return badGlyphs([name], 7, 7); }
    // Text window: 36 columns, words never split (src/systems/textLayout.ts); at the bottom when the player is in the top half.
    const wrap = (text) => { const out = []; let line = ''; for (const w of text.split(' ')) { if (line && (line + ' ' + w).length > 36) { out.push(line); line = w; } else line = line ? line + ' ' + w : w; } out.push(line); return out; };
    const winText = (text) => { const atBottom = P.y - scroll()[1] < 112; return badGlyphs(wrap(text), 8 + 10, (atBottom ? 224 - 8 - 56 : 8) + 8); };
    const ticketCheck = (lines) => {
      const w = Math.max(...lines.map((l) => l.length)) * 6 + 6; const h = 30; const x = Math.floor((256 - w) / 2); const [sx, sy] = scroll();
      const left = P.x - 8 - sx; const feet = P.y - sy; const covered = left < x + w && left + 16 > x && feet - 24 < 24 + h && feet > 24;
      return badGlyphs(lines, x + 3, (covered ? 224 - 4 - h : 24) + 3);
    };
    const fill = (id, params) => Object.entries(params).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), EN[id]);
    const talk = () => { press(); pump(2); press(); pump(5); }; // open, then finish typing the first page
    const next = () => { press(); pump(2); press(); pump(5); }; // turn the page, finish typing it
    const close = () => { press(); pump(10); };

    // 1. Start -> the Dispatcher (pathfound), face them, take Order #1.
    const o1 = ORDERS[0]; const item = EN[o1.text.item]; const params = { item, pickup: nameOf(o1.pickup.map), dropoff: nameOf(o1.dropoff.map) };
    const dispNpc = MAPS[REG.start.map].layers.find((l) => l.name === 'npcs').objects.find((o) => prop(o, 'role') === 'dispatcher');
    const toDisp = travel(REG.start.map, [Math.floor(dispNpc.x / 16), Math.floor((dispNpc.y - 1) / 16)]);
    R.startToDispatcherTiles = `${startSpawn.x},${startSpawn.y} -> ${P.x},${P.y}`;
    faceTap(toDisp.face); talk();
    R.order_dispatcherGreeting = winText(fill('dialogue.dispatcher.hello.1', { name: EN['npc.dispatcher.name'] }));
    next(); R.order_assignLine = winText(fill(o1.text.assign, params)); close(); unTap(toDisp.face);
    const ticket1 = [fill('hud.order.assigned', { item }), fill('hud.go.assigned', { map: params.pickup })];
    R.order_ticketAssigned = ticketCheck(ticket1);

    // 2. To the pickup, through warps (each arrival's name card read), pick up.
    const pt = (stop) => { const p = objs(stop.map, 'deliveryPoint').find((o) => prop(o, 'pointId') === stop.pointId); return [p.x / 16, p.y / 16]; };
    const leg1 = travel(o1.pickup.map, pt(o1.pickup));
    R.leg1 = leg1.arrivals.map((a) => `${a.warp} -> ${a.map}`); R.leg1_nameCards = leg1.arrivals.flatMap((a) => a.nameCard);
    R.order_ticketAfterLeg1 = ticketCheck(ticket1);
    faceTap(leg1.face); talk(); R.order_pickedUpLine = winText(fill(o1.text.pickedUp, params)); close(); unTap(leg1.face);
    const ticket2 = [fill('hud.order.picked-up', { item }), fill('hud.go.picked-up', { map: params.dropoff })];
    R.order_ticketPickedUp = ticketCheck(ticket2);

    // 3. To the dropoff, deliver; the ticket goes.
    const leg2 = travel(o1.dropoff.map, pt(o1.dropoff));
    R.leg2 = leg2.arrivals.map((a) => `${a.warp} -> ${a.map}`); R.leg2_nameCards = leg2.arrivals.flatMap((a) => a.nameCard);
    R.order_ticketAfterLeg2 = ticketCheck(ticket2);
    faceTap(leg2.face); talk(); R.order_deliveredLine = winText(fill(o1.text.delivered, params)); close(); unTap(leg2.face);
    { const px = snap(); let box = 0; for (let y = 27; y < 51; y++) for (let x = 47; x < 209; x++) if (rgbAt(px, x, y) === 0x2a1f3d) box++; R.order_ticketHiddenAfterDelivery = box < 40; }

    // 4. A cross-street connector: from 37th Ave, take the nearest connector warp down to Roosevelt Ave.
    const conn = (w) => /^to-roosevelt-ave[a-z0-9-]*-n-\d+-roosevelt$/.test(w.name);
    if (!warpsOf(P.map).some(conn)) throw new Error(`no cross-street connector on ${P.map}`);
    const G = grid(P.map); const cw = bfs(G, tile(), (t) => { const w = G.warpAt(...t); return !!w && conn(w); });
    const crossed = walkPath(cw);
    R.crossStreet = crossed.map((a) => `${a.warp} -> ${a.map}`); R.crossStreet_nameCards = crossed.flatMap((a) => a.nameCard);
    R.crossStreetOk = crossed.length === 1 && crossed[0].map.startsWith('roosevelt-ave') && conn({ name: crossed[0].warp });

    R.fadeReachedBlack = darkest <= 3;
    const notices = await (await fetch('THIRD-PARTY-NOTICES.txt', { cache: 'no-store' })).text();
    const js = await (await fetch(R.bundle, { cache: 'no-store' })).text();
    R.noticesHaveSpleen = notices.includes('Spleen 6x12 2.2.0') && notices.includes('Frederic Cambus');
    R.bannerMentionsSpleen = js.slice(0, 600).includes('Spleen');
  } catch (e) { R.ERROR = String(e && e.stack || e); }
  R.errors = window.__errors;
  R.framesPumped = frames;
  const glyphChecks = Object.keys(R).filter((k) => /^order_(?!ticketHidden)|_nameCards$/.test(k));
  R.summary = glyphChecks.every((k) => Array.isArray(R[k]) && R[k].length === 0) && R.order_ticketHiddenAfterDelivery && R.crossStreetOk && R.fadeReachedBlack && R.noticesHaveSpleen && R.bannerMentionsSpleen && R.errors.length === 0 && !R.ERROR ? 'PASS' : 'FAIL';
  R;
}

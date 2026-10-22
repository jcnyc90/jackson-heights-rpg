// Live-site check for the production build, which has no window.game hook (session 3's
// technique, versioned in session 4). Run on https://jcnyc90.github.io/jackson-heights-rpg/
// or on `npm run preview`, in TWO evaluations of this script:
//   1st: re-writes the page with a requestAnimationFrame shim and a cache-busted bundle URL,
//        then returns 'reloaded'. (A hidden browser pane pauses real rAF; the shim lets the
//        check pump frames itself, at exactly 60 fps, so the walk below is deterministic.)
//   2nd: drives the game with real KeyboardEvents and checks pixels on the canvas:
//        all four warps (round trip test-map -> roosevelt-ave -> diversity-plaza-74th -> back),
//        each arrival's name card and the accented font-test line, matched glyph by glyph
//        against the shipped font atlas; plus no page errors and the Spleen notices.
// Walk distances are in frames (1 frame = 1 px) from the spawn; they follow the session 4 maps.
// Top-level await: evaluate as an async function body. Returns a results object.
if (!window.__liveShim) {
  const html = await (await fetch(location.href, { cache: 'no-store' })).text();
  const shim = '<script>window.__liveShim=true;window.__cb=null;window.requestAnimationFrame=function(f){window.__cb=f;return 1};window.cancelAnimationFrame=function(){};' +
    'window.__errors=[];window.addEventListener("error",function(e){window.__errors.push(String(e.message))});window.addEventListener("unhandledrejection",function(e){window.__errors.push(String(e.reason))});' +
    'var ce=console.error;console.error=function(){window.__errors.push([].join.call(arguments," "));return ce.apply(console,arguments)};<\/script>';
  document.open();
  document.write(html.replace('<head>', '<head>' + shim).replace(/(src="[^"]*index-[^"]+\.js)"/, `$1?live-check=${Date.now()}"`));
  document.close();
  'reloaded';
} else {
  const FRAME = 1000 / 60; let T = performance.now(); let frames = 0;
  const pump = (n) => { for (let i = 0; i < n; i++) { T += FRAME; const f = window.__cb; window.__cb = null; if (!f) return false; f(T); frames++; } return true; };
  const KC = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Space: 32 };
  const ev = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { key: code === 'Space' ? ' ' : code, code, keyCode: KC[code], which: KC[code], bubbles: true }));
  const walk = (code, n, after = 3) => { ev('keydown', code); pump(n); ev('keyup', code); pump(after); };
  const press = () => { ev('keydown', 'Space'); pump(1); ev('keyup', 'Space'); pump(2); };
  const canvas = () => document.querySelector('#game canvas');
  const snap = () => { const c = canvas(); const cv = document.createElement('canvas'); cv.width = c.width; cv.height = c.height; const x = cv.getContext('2d'); x.drawImage(c, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
  const rgbAt = (px, x, y) => { const p = (y * 256 + x) * 4; return (px[p] << 16) | (px[p + 1] << 8) | px[p + 2]; };
  const R = {};
  // Boot: the font atlas loads over the network, so give the loader real time between frames.
  for (let i = 0; i < 100; i++) { pump(5); await new Promise((r) => setTimeout(r, 30)); const px = snap(); if (rgbAt(px, 128, 100) !== 0x1b1528 && rgbAt(px, 128, 100) !== 0) break; }
  pump(30);
  R.bundle = document.querySelector('script[src*="index-"]')?.getAttribute('src');
  // Font atlas as shipped: glyph cell -> lit pixels (FONT_CHARS order: ASCII 32-126, then 160-255).
  const atlas = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = 'assets/fonts/spleen-6x12.png'; });
  const acv = document.createElement('canvas'); acv.width = atlas.width; acv.height = atlas.height; const actx = acv.getContext('2d'); actx.drawImage(atlas, 0, 0);
  const apx = actx.getImageData(0, 0, atlas.width, atlas.height).data;
  const lit = (ch, x, y) => { const c = ch.charCodeAt(0); const i = c <= 126 ? c - 32 : 95 + c - 160; const p = (((Math.floor(i / 16) * 12) + y) * atlas.width + (i % 16) * 6 + x) * 4; return apx[p + 3] > 0; };
  // Text drawn at (x0, y0) on a #2a1f3d panel: count characters whose 6x12 cell doesn't match the atlas.
  const badGlyphs = (lines, x0, y0) => { const px = snap(); const bad = []; lines.forEach((line, row) => [...line].forEach((ch, col) => { for (let y = 0; y < 12; y++) for (let x = 0; x < 6; x++) if (rgbAt(px, x0 + col * 6 + x, y0 + row * 12 + y) !== (lit(ch, x, y) ? 0xfffaf0 : 0x2a1f3d)) { bad.push(ch); return; } })); return bad; };
  const nameCard = (name) => badGlyphs([name], 7, 7);
  // Hold a key into a warp; keep it held through the fade (it must not carry over), then let the fade-in finish.
  let darkest = 765;
  const warpWalk = (code, n) => { ev('keydown', code); for (let i = 0; i < n + 40; i++) { pump(1); const c = rgbAt(snap(), 128, 112); darkest = Math.min(darkest, (c >> 16) + ((c >> 8) & 255) + (c & 255)); } ev('keyup', code); pump(3); };
  try {
    // test-map: spawn (232,268) -> down, west to the x=104 lane, north to the street, east into the warp.
    walk('ArrowDown', 20); walk('ArrowLeft', 128); walk('ArrowUp', 192); warpWalk('ArrowRight', 344);
    R.warp1_testMap_to_roosevelt = nameCard('Roosevelt Avenue');
    // roosevelt-ave: spawn (24,112) -> east to x=248, north through the 74th St gap.
    walk('ArrowRight', 224); warpWalk('ArrowUp', 93);
    R.warp2_roosevelt_to_plaza = nameCard('Diversity Plaza');
    // diversity-plaza-74th: spawn (240,304) -> south into the gap.
    warpWalk('ArrowDown', 4);
    R.warp3_plaza_to_roosevelt = nameCard('Roosevelt Avenue');
    // roosevelt-ave: spawn (240,48) -> east 8, south to the open lane, west into the warp.
    walk('ArrowRight', 8); walk('ArrowDown', 64); warpWalk('ArrowLeft', 233);
    R.warp4_roosevelt_to_testMap = nameCard('Test Map');
    R.fadeReachedBlack = darkest <= 3;
    // test-map: spawn (440,96) -> west to x=104, south to y=288, west to Neighbor C, face down, talk to page 2.
    walk('ArrowLeft', 336); walk('ArrowDown', 192); walk('ArrowLeft', 48); walk('ArrowDown', 1);
    press(); pump(30); press(); press(); pump(5); press(); pump(5);
    R.accentedText = badGlyphs(['Font test: ¿Qué tal? ¡Sí! Mañana,', 'pingüino, árbol, índice, ópera,', 'último.'], 18, 16);
    press(); pump(10);
    const notices = await (await fetch('THIRD-PARTY-NOTICES.txt', { cache: 'no-store' })).text();
    const js = await (await fetch(R.bundle, { cache: 'no-store' })).text();
    R.noticesHaveSpleen = notices.includes('Spleen 6x12 2.2.0') && notices.includes('Frederic Cambus');
    R.bannerMentionsSpleen = js.slice(0, 600).includes('Spleen');
  } catch (e) { R.ERROR = String(e && e.stack || e); }
  R.errors = window.__errors;
  R.framesPumped = frames;
  const glyphChecks = Object.keys(R).filter((k) => /^warp\d|^accentedText/.test(k));
  R.summary = glyphChecks.every((k) => Array.isArray(R[k]) && R[k].length === 0) && R.fadeReachedBlack && R.noticesHaveSpleen && R.bannerMentionsSpleen && R.errors.length === 0 && !R.ERROR ? 'PASS' : 'FAIL';
  R;
}

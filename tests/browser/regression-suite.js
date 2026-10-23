// Desktop behaviour regression suite. A-G: sessions 1-2 (45 checks). H-M: session 3
// (strings, font, tileset export, dialogue, NPC targeting/collision, depth sorting).
// N-P: session 4 (Spleen font, "above" tile layer, map registry, warps, fades, zones).
// Q: session 5 (delivery orders: data checks, state machine, end to end across warps, order ticket).
// S: session 6c (generated world maps: every map reachable from the start, every warp pair round-trips,
// every delivery point reachable and facing-accessible). Since 6c every route on the world maps is
// derived from map data (BFS over the collision grid), not hard-coded; A-O still run on test-map.
// Deterministic: pauses Phaser's rAF loop and advances frames manually at exactly 60 fps via
// game.step(time, delta), so results don't depend on the browser pane being visible.
// Run on the dev server (needs the DEV-only window.game hook); see tests/browser/README.md.
// Top-level await: evaluate as an async function body. Returns a results object.
const g = window.game; const s = g.scene.getScene('Map');
const FRAME = 1000 / 60; let T = performance.now(); let frames = 0;
g.loop.sleep();
const run = (ms) => { const n = Math.round(ms / FRAME); for (let i = 0; i < n; i++) { T += FRAME; g.step(T, FRAME); frames++; } };
const KC = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, KeyW: 87, KeyA: 65, KeyS: 83, KeyD: 68, Space: 32, Enter: 13, KeyZ: 90 };
const ev = (type, code, o = {}) => window.dispatchEvent(new KeyboardEvent(type, { key: code, code, keyCode: KC[code], which: KC[code], bubbles: true, ...o }));
const hold = (code, ms) => { ev('keydown', code); run(ms); ev('keyup', code); run(100); return [+s.player.x.toFixed(2), +s.player.y.toFixed(2)]; };
const at = (x, y) => { s.player.body.reset(x, y); run(100); };
// Since 6c the game starts on roosevelt-ave; A-O are written for test-map, so start there.
s.scene.restart({ mapId: 'test-map', spawnId: 'start' }); run(100);
const obstacles = s.children.list.find((o) => o.type === 'TilemapLayer' && o.layer.name === 'obstacles');
const R = {}; const check = (name, actual, expected) => { R[name] = JSON.stringify(actual) === JSON.stringify(expected) ? 'PASS' : { FAIL: { actual, expected } }; };
try {
  // A. Environment / config parity
  const c = g.canvas; const tex = (k) => [g.textures.get(k).source[0].width, g.textures.get(k).source[0].height];
  check('A1 internal resolution', [c.width, c.height], [256, 224]);
  check('A2 canvas image-rendering', getComputedStyle(c).imageRendering, 'pixelated');
  check('A3 config pixelArt/antialias/roundPixels', [g.config.pixelArt, g.config.antialias, g.config.roundPixels], [true, false, true]);
  check('A4 scale mode FIT + center both', [g.scale.scaleMode, g.scale.autoCenter], [3, 1]);
  check('A5 renderer WebGL', g.renderer.type, 2);
  check('A6 no audio', g.sound.constructor.name.includes('NoAudio'), true);
  check('A7 world bounds = map', [s.physics.world.bounds.width, s.physics.world.bounds.height], [480, 320]);
  check('A8 colliding tiles', obstacles.layer.data.flat().filter((t) => t.collides).length, 194);
  check('A9 feet body size/offset', [s.player.body.width, s.player.body.height, s.player.body.offset.x, s.player.body.offset.y], [10, 8, 3, 16]);
  check('A10 texture sizes tiles/player/emote', [tex('tiles'), tex('player'), tex('emote')], [[64, 32], [48, 96], [10, 10]]);
  check('A11 walk anims frames', ['down', 'left', 'right', 'up'].map((d) => { const a = g.anims.get(`player-walk-${d}`); return [a.frames.map((f) => f.frame.name), a.frameRate, a.repeat]; }),
    [[[1, 0, 2, 0], 8, -1], [[4, 3, 5, 3], 8, -1], [[7, 6, 8, 6], 8, -1], [[10, 9, 11, 9], 8, -1]]);
  check('A12 camera roundPixels + follows player', [s.cameras.main.roundPixels, s.cameras.main._follow === s.player], [true, true]);

  // B. Movement, speed, animation
  at(232, 268);
  check('B1 spawn idle frame (down stand)', [s.player.frame.name, s.player.anims.isPlaying], [0, false]);
  ev('keydown', 'ArrowUp'); run(300);
  check('B2 walking up plays anim', [s.player.anims.currentAnim?.key, s.player.anims.isPlaying], ['player-walk-up', true]);
  run(1000); ev('keyup', 'ArrowUp'); run(100);
  check('B3 blocked by fountain at y=216', s.player.y, 216);
  let x0 = s.player.x; hold('KeyD', 500);
  check('B4 speed: D for 30 frames = 30px', Math.round(s.player.x - x0), 30);
  check('B5 whole-pixel position after move', Math.abs(s.player.x - Math.round(s.player.x)) < 1e-6, true);
  check('B6 idle stand frame facing right', [s.player.frame.name, s.player.anims.isPlaying], [6, false]);
  ev('keydown', 'ArrowLeft'); run(150); ev('keydown', 'ArrowDown'); run(50);
  const both = s.controls.direction(); ev('keyup', 'ArrowDown'); run(50); const afterDown = s.controls.direction(); ev('keyup', 'ArrowLeft'); run(100);
  check('B7 last-pressed wins / falls back', [both, afterDown], ['down', 'left']);
  at(232, 268); ev('keydown', 'ArrowRight'); const seq = []; for (let i = 0; i < 40; i++) { run(FRAME); seq.push(s.player.frame.name); } ev('keyup', 'ArrowRight'); run(100);
  R['B8 walk-right frame per step, 40 steps (parity fingerprint)'] = seq.join(',');

  // C. Key handling: Cmd keys, action, emote, animationstop
  let stops = 0; const onStop = () => stops++; s.player.on('animationstop', onStop);
  at(232, 268); x0 = s.player.x;
  ev('keydown', 'KeyA', { metaKey: true }); run(300);
  check('C1 Cmd+A ignored (no stuck walk)', [s.controls.direction(), s.player.x - x0], [null, 0]);
  ev('keydown', 'KeyA'); run(300); ev('keyup', 'KeyA'); run(100);
  check('C2 real A after Cmd+A walks 18px then releases', [Math.round(x0 - s.player.x), s.controls.direction()], [18, null]);
  run(300);
  check('C3 animationstop fired once (not per idle frame)', stops, 1);
  s.player.off('animationstop', onStop);
  ev('keydown', 'Space', { metaKey: true }); run(50); const cmdSpace = s.emote.visible; ev('keyup', 'Space'); run(50);
  check('C4 Cmd+Space no emote', cmdSpace, false);
  for (const k of ['Space', 'Enter', 'KeyZ']) { ev('keydown', k); run(50); check(`C5 ${k} shows emote`, s.emote.visible, true); ev('keyup', k); run(600); }
  check('C6 emote hides after 500ms', s.emote.visible, false);
  ev('keydown', 'Space'); run(50);
  check('C7 emote anchored above head', [Math.round(s.emote.x - s.player.x), Math.round(s.player.y - s.emote.y)], [0, 25]);
  ev('keydown', 'ArrowLeft'); run(200);
  check('C7b emote tracks moving player (same frame)', [Math.round(s.emote.x - s.player.x), Math.round(s.player.y - s.emote.y)], [0, 25]);
  ev('keyup', 'ArrowLeft'); ev('keyup', 'Space'); run(600);
  for (const [k, dir] of [['KeyW', 'up'], ['KeyA', 'left'], ['KeyS', 'down'], ['KeyD', 'right']]) { ev('keydown', k); run(40); check(`C8 WASD ${k}`, s.controls.direction(), dir); ev('keyup', k); run(40); }

  // D. Targeted collision stops (exact pixels)
  at(56, 188); check('D1 alley: up blocked y=184', hold('ArrowUp', 400)[1], 184);
  check('D2 alley: down blocked y=192', hold('ArrowDown', 400)[1], 192);
  at(104, 188); check('D3 alley: walk west to border x=21', hold('ArrowLeft', 1600)[0], 21);
  at(88, 44); check('D4 north wall y=40', hold('ArrowUp', 400)[1], 40);
  at(104, 60); check('D5 street tree from left x=123', hold('ArrowRight', 600)[0], 123);
  at(392, 248); check('D6 1-tile corridor open going up (y=188)', hold('ArrowUp', 1000)[1], 188);

  // E. Camera clamps to map bounds
  at(24, 40); check('E1 camera clamps top-left', [s.cameras.main.scrollX, s.cameras.main.scrollY], [0, 0]);
  at(456, 304); check('E2 camera clamps bottom-right', [s.cameras.main.scrollX, s.cameras.main.scrollY], [224, 96]);
  at(232, 200); check('E3 camera centred on player mid-map', [s.cameras.main.scrollX, s.cameras.main.scrollY], [104, 88]);

  // F. Collision fuzz: 40 seeded random walks, body must never overlap a colliding tile or leave the map
  at(232, 268);
  const overlaps = () => { const b = s.player.body, e = 0.01; for (let ty = Math.floor(b.y / 16); ty <= Math.floor((b.y + b.height - e) / 16); ty++) for (let tx = Math.floor(b.x / 16); tx <= Math.floor((b.x + b.width - e) / 16); tx++) { const t = obstacles.getTileAt(tx, ty); if (t && t.collides) return true; } return b.x < 0 || b.y < 0 || b.right > 480 || b.bottom > 320; };
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; const dirs = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']; let violations = 0, samples = 0; const trail = [];
  for (let i = 0; i < 40; i++) { const d = dirs[Math.floor(rnd() * 4)]; ev('keydown', d); const n = Math.round((150 + rnd() * 900) / FRAME); for (let k = 0; k < n; k++) { run(FRAME); samples++; if (overlaps()) violations++; } ev('keyup', d); run(FRAME * 2); trail.push(`${s.player.x},${s.player.y}`); }
  check('F1 fuzz: 0 overlaps', violations, 0); R['F1 samples'] = samples; R['F2 fuzz end positions (parity fingerprint)'] = trail.join(' ');

  // G. Blur releases held keys — also after a second scene has been started and stopped (v3 bug scenario)
  at(232, 268);
  ev('keydown', 'KeyD'); run(100); window.dispatchEvent(new Event('blur')); run(100);
  const plainBlur = s.controls.direction(); window.dispatchEvent(new Event('focus')); ev('keyup', 'KeyD'); run(100);
  check('G1 blur releases held key (single scene)', plainBlur, null);
  if (!g.scene.getScene('BlurProbe')) g.scene.add('BlurProbe', {}, true); run(150); g.scene.stop('BlurProbe'); run(150);
  ev('keydown', 'KeyD'); run(100); window.dispatchEvent(new Event('blur')); run(100);
  const afterProbe = s.controls.direction(); window.dispatchEvent(new Event('focus')); ev('keyup', 'KeyD'); run(100);
  check('G2 blur releases held key after another scene stopped', afterProbe, null);
  g.scene.remove('BlurProbe'); run(50);

  // ---- Session 3 ----
  const FONT_MOD = await import('/src/systems/font.ts');
  const STR_MOD = await import('/src/systems/strings.ts');
  const LAYOUT = await import('/src/systems/textLayout.ts');
  const EN = (await import('/src/data/strings/en.json')).default;
  const DIALOGUE = (await import('/src/data/dialogue.json')).default;
  const D = () => g.scene.getScene('Dialogue');
  const open = () => s.talking && g.scene.isActive('Dialogue');
  const press = (code = 'Space') => { ev('keydown', code); run(FRAME); ev('keyup', code); run(FRAME); };
  const closeDialogue = () => { for (let n = 0; s.talking && n < 30; n++) press(); run(100); };
  const npc = (id) => s.npcs.find((n) => n.spawn.npcId === id);
  const nbox = (n) => [n.sprite.x, n.sprite.y, n.sprite.body.x, n.sprite.body.y];
  // Place the player (feet) and set the way it faces without walking.
  const place = (x, y, facing) => { at(x, y); s.facing = facing; };
  const bodiesOverlap = (a, b) => a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
  const A = npc('neighbor-a'); const B = npc('neighbor-b');

  // H. Strings, font, data integrity, tileset export
  check('H1 t() lookup + {param} interpolation', [STR_MOD.t('app.title'), STR_MOD.t('dialogue.neighbor-a.hello.1', { name: 'X' })], ['Jackson Heights RPG', "Hi there! I'm X."]);
  const warns = []; const origWarn = console.warn; console.warn = (...a) => warns.push(a.join(' '));
  const miss1 = STR_MOD.t('test.missing-id'); const miss2 = STR_MOD.t('test.missing-id'); console.warn = origWarn;
  check('H2 missing ID renders as ID, dev warns once', [miss1, miss2, warns.length, warns[0]?.includes('test.missing-id')], ['test.missing-id', 'test.missing-id', 1, true]);
  check('H3 <title> and <html lang> come from strings', [document.title, document.documentElement.lang], [EN['app.title'], EN['app.lang']]);
  check('H4 every string renders with the font (no missing glyphs)', Object.entries(EN).filter(([, v]) => !FONT_MOD.isRenderable(v)).map(([k]) => k), []);
  const missingIds = [...Object.values(DIALOGUE).flat(), ...s.npcs.map((n) => `npc.${n.spawn.npcId}.name`)].filter((id) => !(id in EN));
  check('H5 every dialogue/NPC-name string ID exists', missingIds, []);
  const pixels = (src) => { const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height; const c2 = cv.getContext('2d'); c2.drawImage(src, 0, 0); return Array.from(c2.getImageData(0, 0, cv.width, cv.height).data); };
  const png = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = '/assets/tilesets/tiles.png?' + Date.now(); });
  check('H6 public/assets/tilesets/tiles.png == generated tileset (pixel-exact)', JSON.stringify(pixels(png)) === JSON.stringify(pixels(g.textures.get('tiles').getSourceImage())), true);
  const pagesB = LAYOUT.paginate(DIALOGUE['neighbor-b.hello'].map((id) => STR_MOD.t(id, { name: 'Neighbor B' })), 36, 3);
  check('H7 wrap: lines <= 36 chars, 3 lines/page, long entry spills to a 2nd page', [pagesB.length, pagesB.every((p) => p.split('\n').length <= 3 && p.split('\n').every((l) => l.length <= 36))], [3, true]);
  check('H8 wrap: words never split, hard-split only over-long words', LAYOUT.wrapText('aaa bbb ccc', 7).concat(LAYOUT.wrapText('abcdefghij', 4)), ['aaa bbb', 'ccc', 'abcd', 'efgh', 'ij']);

  // I. Dialogue: open, typewriter, skip, advance, close, movement lock
  // NPC turns toward the player: Neighbor A faces right by default; talk from above.
  place(168, 240, 'down'); press(); const turned = A.sprite.frame.name; closeDialogue();
  place(186, 256, 'left'); // 8px right of Neighbor A's feet box, facing it
  press();
  check('I1 Action facing an NPC opens the window', [s.talking, g.scene.isActive('Dialogue'), s.emote.visible], [true, true, false]);
  check('I2 NPC turns to face the player (frame = look 0 * 4 + up)', turned, 3);
  const s0 = D().shown; run(500);
  const page0 = D().pages[0];
  check('I3 typewriter: ~30 chars/s, text = page prefix', [Math.abs(D().shown - s0 - 15) <= 1, D().text.text === page0.slice(0, D().shown), D().cursor.visible], [true, true, false]);
  press();
  check('I4 Action mid-page skips to end of page (stays open, same page)', [D().page, D().shown === page0.length, D().text.text === page0, open()], [0, true, true, true]);
  run(100);
  check('I5 "more" cursor shows once the page is complete', D().cursor.visible, true);
  press();
  check('I6 Action on a complete page turns the page', [D().page, D().shown <= 1, open()], [1, true, true]);
  // Movement lock: hold Right for 0.5 s with the window open.
  const lockPos = [s.player.x, s.player.y]; ev('keydown', 'ArrowRight'); run(500);
  check('I7 movement locked while open (no move, no walk anim, no facing change)', [s.player.x, s.player.y, s.player.anims.isPlaying, s.facing], [...lockPos, false, 'left']);
  ev('keyup', 'ArrowRight'); run(50);
  press(); press(); // finish page 2, then close
  check('I8 Action on the last complete page closes the window', [s.talking, g.scene.isActive('Dialogue')], [false, false]);
  run(200);
  check('I9 the closing press does not reopen or emote', [s.talking, g.scene.isActive('Dialogue'), s.emote.visible], [false, false, false]);
  ev('keydown', 'ArrowRight'); run(200); ev('keyup', 'ArrowRight'); run(50);
  check('I10 movement resumes after close', Math.round(s.player.x - lockPos[0]), 12);
  // Multi-page with auto-pagination; window moves to the bottom near the map's top edge.
  place(328, 64, 'up'); press();
  const pagesSeen = [D().page]; let presses = 0;
  while (open() && presses < 20) { press(); presses++; if (open()) pagesSeen.push(D().page); }
  check('I11 Neighbor B: 3 pages, 2 presses each (skip + advance/close)', [presses, [...new Set(pagesSeen)]], [6, [0, 1, 2]]);
  place(328, 64, 'up'); press(); run(50);
  const winY = D().children.list.find((o) => o.texture?.key === 'text-window')?.y; closeDialogue();
  place(168, 240, 'down'); press(); run(50);
  const winYTop = D().children.list.find((o) => o.texture?.key === 'text-window')?.y; closeDialogue();
  check('I12 window at bottom when player is in the top half, else at top', [winY, winYTop], [224 - 8 - 56, 8]);

  // J. Blur with the dialogue open. Stopping the Dialogue scene runs KeyboardPlugin.shutdown(),
  // which (upstream bug) strips every scene's own blur listener; Controls' listener must survive.
  place(186, 256, 'left'); press();
  ev('keydown', 'KeyD'); run(100); window.dispatchEvent(new Event('blur')); run(50);
  const blurOpen = s.controls.direction(); window.dispatchEvent(new Event('focus')); ev('keyup', 'KeyD'); run(50);
  check('J1 blur while dialogue is open releases held key', [blurOpen, open()], [null, true]);
  const kb = s.input.keyboard; const phaserListenerBefore = g.events.listeners('blur').includes(kb.resetKeys);
  closeDialogue();
  R['J info: Phaser blur listener before/after Dialogue stop (bug path)'] = [phaserListenerBefore, g.events.listeners('blur').includes(kb.resetKeys)];
  ev('keydown', 'KeyD'); run(100); window.dispatchEvent(new Event('blur')); run(50);
  const blurAfter = s.controls.direction(); window.dispatchEvent(new Event('focus')); ev('keyup', 'KeyD'); run(50);
  check('J2 blur after the Dialogue scene stopped still releases held key', blurAfter, null);
  place(186, 256, 'left'); press(); ev('keydown', 'KeyD'); run(50); window.dispatchEvent(new Event('blur')); run(50); window.dispatchEvent(new Event('focus'));
  closeDialogue(); run(100); const posAfter = s.player.x; run(300);
  check('J3 key held through blur + close does not walk afterwards', [s.controls.direction(), s.player.x - posAfter], [null, 0]);
  ev('keyup', 'KeyD'); run(50);

  // K. Facing-based targeting (TALK_RANGE = 16px between feet boxes)
  const talks = (x, y, facing) => { place(x, y, facing); press(); const r = s.talking; closeDialogue(); return r; };
  check('K1 talks from each side when facing the NPC', [talks(186, 256, 'left'), talks(150, 256, 'right'), talks(168, 240, 'down'), talks(168, 272, 'up')], [true, true, true, true]);
  check('K2 range: gap 14/15px talks, 16px does not', [talks(192, 256, 'left'), talks(193, 256, 'left'), talks(194, 256, 'left')], [true, true, false]);
  check('K3 adjacent but facing away: no talk (emote instead)', (() => { place(178, 256, 'right'); press(); const r = [s.talking, s.emote.visible]; closeDialogue(); run(600); return r; })(), [false, true]);
  check('K4 lateral offset: overlapping feet columns talk, beyond does not', [talks(177, 240, 'down'), talks(178, 240, 'down')], [true, false]);

  // L. NPC collision (Phaser 4 sprite-vs-sprite): player stops flush, NPC never moves
  const homeA = nbox(A);
  const push = (x, y, key, ms = 1000) => { at(x, y); ev('keydown', key); run(ms); ev('keyup', key); run(50); return [s.player.x, s.player.y]; };
  check('L1 walk into NPC from 4 sides: stops flush (exact px)', [push(200, 256, 'ArrowLeft'), push(136, 256, 'ArrowRight'), push(168, 228, 'ArrowDown'), push(168, 284, 'ArrowUp')], [[178, 256], [158, 256], [168, 248], [168, 264]]);
  check('L2 NPC position/body unchanged after being pushed', nbox(A), homeA);
  check('L3 NPC velocity 0, immovable, not pushable', [A.sprite.body.velocity.x, A.sprite.body.velocity.y, A.sprite.body.immovable, A.sprite.body.pushable], [0, 0, true, false]);
  // Fuzz around the NPC: diagonal-ish approaches with key switches; bodies must never overlap.
  at(200, 270); let seed2 = 11; const rnd2 = () => (seed2 = (seed2 * 16807) % 2147483647) / 2147483647; let npcOverlaps = 0, npcSamples = 0;
  for (let i = 0; i < 40; i++) { const d = dirs[Math.floor(rnd2() * 4)]; ev('keydown', d); const n = 10 + Math.floor(rnd2() * 30); for (let k = 0; k < n; k++) { run(FRAME); if (s.npcs.some((m) => bodiesOverlap(s.player.body, m.sprite.body))) npcOverlaps++; npcSamples++; } ev('keyup', d); run(FRAME); if (i % 8 === 7) { let x, y; do { x = 168 + Math.round(rnd2() * 40 - 20); y = 236 + Math.round(rnd2() * 40); } while (x - 5 < 173 && x + 5 > 163 && y - 8 < 256 && y > 248); at(x, y); } }
  check('L4 fuzz near NPC: 0 body overlaps, NPC never moved', [npcOverlaps, JSON.stringify(nbox(A)) === JSON.stringify(homeA)], [0, true]); R['L4 samples'] = npcSamples;

  // M. Depth sorting by feet y (render order = display list order after a rendered step)
  const order = () => { run(FRAME); const l = s.children.list; return l.indexOf(s.player) < l.indexOf(A.sprite) ? 'player-behind' : 'player-in-front'; };
  at(168, 240); check('M1 player above NPC is drawn behind it', [order(), s.player.depth < A.sprite.depth], ['player-behind', true]);
  at(168, 266); check('M2 player below NPC is drawn in front', [order(), s.player.depth > A.sprite.depth], ['player-in-front', true]);
  ev('keydown', 'ArrowUp'); run(400); ev('keyup', 'ArrowUp'); run(50);
  check('M3 depth follows the player while walking (stopped at NPC, in front)', [s.player.y, order()], [264, 'player-in-front']);
  // Session 4: the "above" layer is meant to draw over sprites, so M4 covers the other layers; O1 pins "above".
  const layers = s.children.list.filter((o) => o.type === 'TilemapLayer' && o.layer.name !== 'above');
  check('M4 tile layers (except "above", see O1) under all sprites, emote over all', [layers.every((l) => l.depth < 0), s.emote.depth > Math.max(...s.npcs.map((n) => n.sprite.depth), 320)], [true, true]);

  // ---- Session 4 ----
  const MAPS_MOD = await import('/src/systems/maps.ts');
  const snap = () => { const cv = document.createElement('canvas'); cv.width = 256; cv.height = 224; const c2 = cv.getContext('2d'); c2.drawImage(g.canvas, 0, 0); return c2.getImageData(0, 0, 256, 224).data; }; // call right after a step
  const rgbAt = (px, x, y) => { const p = (y * 256 + x) * 4; return (px[p] << 16) | (px[p + 1] << 8) | px[p + 2]; };
  const layerOf = (name) => s.children.list.find((o) => o.type === 'TilemapLayer' && o.layer.name === name);

  // N. Font: Spleen 6x12, pixel-exact from the BDF in third_party/
  const bdfText = await (await fetch('/third_party/spleen-2.2.0/spleen-6x12.bdf')).text();
  const BDF = new Map(); for (const m of bdfText.matchAll(/ENCODING (\d+)[\s\S]*?BBX (\d+) (\d+) (-?\d+) (-?\d+)\s+BITMAP\s+([\s\S]*?)ENDCHAR/g)) BDF.set(+m[1], m[6].trim().split(/\s+/).map((h) => parseInt(h, 16)));
  const bit = (code, x, y) => ((BDF.get(code)[y] >> (7 - x)) & 1) === 1; // every glyph is BBX 6 12 0 -3 (N2)
  const fontData = g.cache.bitmapFont.get('font').data;
  const enChars = [...new Set([...Object.values(EN).join('')])].filter((ch) => ch !== '\n');
  check('N1 every character used in en.json has a glyph in the loaded font', enChars.filter((ch) => !fontData.chars[ch.charCodeAt(0)]), []);
  const fontImg = g.textures.get('font').getSourceImage(); const fontPx = pixels(fontImg); const FCH = FONT_MOD.FONT_CHARS; const atlasBad = [];
  for (let i = 0; i < FCH.length; i++) {
    const code = FCH.charCodeAt(i), cx = (i % 16) * 6, cy = Math.floor(i / 16) * 12;
    outer: for (let y = 0; y < 12; y++) for (let x = 0; x < 6; x++) {
      const p = ((cy + y) * fontImg.width + cx + x) * 4;
      const ok = bit(code, x, y) ? fontPx[p] === 0xff && fontPx[p + 1] === 0xfa && fontPx[p + 2] === 0xf0 && fontPx[p + 3] === 255 : fontPx[p + 3] === 0;
      if (!ok) { atlasBad.push(FCH[i]); break outer; }
    }
  }
  check('N2 font atlas == Spleen 6x12 BDF, pixel-exact (ASCII + Latin-1, 191 glyphs)', [fontImg.width, fontImg.height, FCH.length, [...bdfText.matchAll(/BBX (.*)/g)].every((m) => m[1] === '6 12 0 -3'), atlasBad], [96, 144, 191, true, []]);
  s.scene.launch('Dialogue', { entries: ['x'.repeat(200)] }); run(50); const longPages = D().pages; s.scene.stop('Dialogue'); run(50);
  check('N3 text window layout unchanged: 36 chars x 3 lines', [longPages.map((pg) => pg.split('\n').map((l) => l.length))], [[[36, 36, 36], [36, 36, 20]]]);
  // Neighbor C's second page is the accented font test; compare every rendered cell with the BDF.
  place(56, 288, 'down'); press(); press(); press(); press(); run(FRAME);
  const accPage = D().pages[D().page]; const accPx = snap(); const tx0 = D().text.x, ty0 = D().text.y; const glyphBad = [];
  accPage.split('\n').forEach((line, row) => [...line].forEach((ch, col) => {
    for (let y = 0; y < 12; y++) for (let x = 0; x < 6; x++) if (rgbAt(accPx, tx0 + col * 6 + x, ty0 + row * 12 + y) !== (bit(ch.charCodeAt(0), x, y) ? 0xfffaf0 : 0x2a1f3d)) { glyphBad.push(ch); return; }
  }));
  check('N4 accented test string (é ñ á í ó ú ü ¿ ¡) renders pixel-exact in the window', [D().page, D().pageComplete(), [...'éñáíóúü¿¡'].every((ch) => accPage.includes(ch)), accPage.split('\n').length, glyphBad], [1, true, true, 3, []]);
  closeDialogue();
  check('N5 placeholder font code is gone', [await import('/src/systems/placeholderFont.ts').then(() => 'still there', () => 'gone'), 'generatePlaceholderFont' in FONT_MOD], ['gone', false]);

  // O. "above" tile layer (tree canopies draw over sprites; collision stays on "obstacles")
  const above = layerOf('above');
  const treeCells = obstacles.layer.data.flat().filter((tile) => tile.index === 6).map((tile) => `${tile.x},${tile.y - 1}`);
  const canopyCells = above.layer.data.flat().filter((tile) => tile.index !== -1).map((tile) => `${tile.x},${tile.y}`);
  check('O1 "above": one canopy north of each tree, no collision, over every sprite, under the emote',
    [treeCells.length, JSON.stringify(canopyCells) === JSON.stringify(treeCells), above.layer.data.flat().some((tile) => tile.collides), above.depth > 320 && above.depth > Math.max(s.player.depth, ...s.npcs.map((n) => n.sprite.depth)), above.depth < s.emote.depth],
    [9, true, false, true, true]);
  // Player pixels (drawn when "above" is hidden, gone when the player is hidden too) that change
  // when "above" is shown = player pixels the canopy covers. Returns [player pixels, covered].
  const coveredPixels = () => {
    run(FRAME); const all = snap(); above.setVisible(false); run(FRAME); const noAbove = snap();
    s.player.setVisible(false); run(FRAME); const neither = snap(); s.player.setVisible(true); above.setVisible(true); run(FRAME);
    const cam = s.cameras.main; const x0 = Math.round(s.player.x - 8 - cam.scrollX), y0 = Math.round(s.player.y - 24 - cam.scrollY); let drawn = 0, covered = 0;
    for (let y = Math.max(0, y0); y < Math.min(224, y0 + 24); y++) for (let x = Math.max(0, x0); x < Math.min(256, x0 + 16); x++) {
      if (rgbAt(noAbove, x, y) === rgbAt(neither, x, y)) continue;
      drawn++; if (rgbAt(all, x, y) !== rgbAt(noAbove, x, y)) covered++;
    }
    return [drawn, covered];
  };
  // Behind: walk west along the north sidewalk to just north of the first street tree's trunk.
  at(88, 44); const behindEnd = hold('ArrowLeft', 32 * FRAME); const behind = coveredPixels();
  check('O2 walking behind a tree: the canopy covers the player', [behindEnd, behind[0] > 100, behind[1] > 60], [[56, 44], true, true]); R['O2 info: player px drawn / covered'] = behind.join(' / ');
  // In front: walk north up the street until the same trunk stops the player.
  at(56, 100); const frontEnd = hold('ArrowUp', 600); const front = coveredPixels(); run(FRAME); const frontPx = snap();
  R['O3 info: player px drawn / covered'] = front.join(' / ');
  check('O3 walking in front of a tree: not covered, drawn over the trunk', [frontEnd, front[0] > 100, front[1], rgbAt(frontPx, 56 - s.cameras.main.scrollX, 60 - s.cameras.main.scrollY) !== 0xb07c62], [[56, 72], true, 0, true]);

  const overheadPng = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = '/assets/tilesets/overhead.png?' + Date.now(); });
  check('O4 public/assets/tilesets/overhead.png == generated overhead tileset (pixel-exact)', JSON.stringify(pixels(overheadPng)) === JSON.stringify(pixels(g.textures.get('overhead').getSourceImage())), true);

  // P. Map registry, warps, fades, zones
  const M = MAPS_MOD; const mapById = (id) => M.MAP_LIST.find((m) => m.id === id);
  const throwsMsg = (f) => { try { f(); return null; } catch (e) { return e.message; } };
  const WORLD = (await import('/src/data/world/jackson-heights.json')).default;
  const REAL = WORLD.maps.map((m) => m.id); // the generated world maps; test-map is a test-only fixture
  check('P1 registry: test-map + the 9 world maps, files and display names resolve, every warp link valid, start on a world map',
    [M.MAP_LIST.map((m) => m.id), M.MAP_LIST.map((m) => STR_MOD.t(m.nameId)), throwsMsg(M.validateLinks), [M.START.map.id, M.START.spawn.spawnId]],
    [['test-map', ...REAL], ['Test Map', 'Diversity Plaza', 'Roosevelt Avenue', 'Roosevelt at 82nd', 'Roosevelt at 87th', '37th Avenue', '37th Ave at 82nd', '37th Ave at 87th', 'Historic District', 'Historic District East'], null, ['roosevelt-ave', 'start']]);
  const gotoMap = (mapId, spawnId = mapById(mapId).spawns[0].spawnId) => { s.scene.restart({ mapId, spawnId }); run(100); };

  // ---- Map data helpers (6c): the collision grid, warps and NPCs of a map, read from its Tiled data ----
  const GRIDS = new Map();
  const grid = (mapId) => {
    if (GRIDS.has(mapId)) return GRIDS.get(mapId);
    const info = mapById(mapId); const d = info.data; const ts = d.tilesets.find((t) => t.name === 'tiles');
    const solid = new Set((ts.tiles ?? []).filter((t) => t.properties?.some((p) => p.name === 'collides' && p.value === true)).map((t) => t.id + ts.firstgid));
    const obs = d.layers.find((l) => l.name === 'obstacles').data;
    const npcTiles = new Set((d.layers.find((l) => l.name === 'npcs')?.objects ?? []).map((o) => `${Math.floor(o.x / 16)},${Math.floor((o.y - 1) / 16)}`));
    const W = d.width, H = d.height;
    const inside = (r, tx, ty) => tx * 16 + 8 >= r.x && tx * 16 + 8 < r.x + r.width && ty * 16 + 8 >= r.y && ty * 16 + 8 < r.y + r.height;
    const warpAt = (tx, ty) => info.warps.find((w) => inside(w, tx, ty));
    const open = (tx, ty) => tx >= 0 && ty >= 0 && tx < W && ty < H && !solid.has(obs[ty * W + tx]) && !npcTiles.has(`${tx},${ty}`);
    const G = { id: mapId, info, W, H, open, warpAt, inside };
    GRIDS.set(mapId, G); return G;
  };
  const tileAt = (x, y) => [Math.floor(x / 16), Math.floor((y - 1) / 16)];
  const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const KEY_OF = { '1,0': 'ArrowRight', '-1,0': 'ArrowLeft', '0,1': 'ArrowDown', '0,-1': 'ArrowUp' };
  const FACING_OF = { '1,0': 'right', '-1,0': 'left', '0,1': 'down', '0,-1': 'up' };
  // Breadth-first search over open tiles (4-way, fixed neighbour order, so deterministic). Warp tiles
  // are never walked through, only entered as the goal. Returns the tile path, start first, or null.
  const bfs = (G, start, isGoal) => {
    const key = (t) => t[1] * G.W + t[0]; const prev = new Map([[key(start), null]]); const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      if (isGoal(cur)) { const path = [cur]; let k = prev.get(key(cur)); while (k !== null) { path.unshift([k % G.W, Math.floor(k / G.W)]); k = prev.get(k); } return path; }
      if (G.warpAt(...cur) && cur !== start) continue;
      for (const [dx, dy] of STEPS) { const n = [cur[0] + dx, cur[1] + dy]; if (G.open(...n) && !prev.has(key(n))) { prev.set(key(n), key(cur)); queue.push(n); } }
    }
    return null;
  };
  // Walks a tile path with real key events: one straight run per key, held exactly 16 frames per tile
  // (60 px/s = 1 px a frame), so the player ends exactly on each tile centre. Stops at a warp.
  const walkPath = (path, input = 'key') => {
    for (let i = 0; i < path.length - 1 && !s.warping;) {
      const d = [path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]]; let j = i + 1;
      while (j < path.length - 1 && path[j + 1][0] - path[j][0] === d[0] && path[j + 1][1] - path[j][1] === d[1]) j++;
      const k = KEY_OF[d.join(',')]; ev('keydown', k); run((j - i) * 16 * FRAME); ev('keyup', k); i = j;
    }
  };
  const waitArrival = () => { for (let n = 0; n < 120 && s.warping; n++) run(FRAME); run(FRAME); };
  // Shortest chain of warps between two maps (BFS over the warp graph of the world maps).
  const mapRoute = (from, to, avoid = []) => {
    const prev = new Map([[from, null]]); const queue = [from];
    while (queue.length) {
      const m = queue.shift(); if (m === to) break;
      for (const w of mapById(m).warps) if (!prev.has(w.targetMap) && !avoid.includes(w.targetMap)) { prev.set(w.targetMap, { m, w }); queue.push(w.targetMap); }
    }
    if (!prev.has(to)) return null;
    const hops = []; for (let t = to; prev.get(t); t = prev.get(t).m) hops.unshift(prev.get(t).w); return hops;
  };
  // Walks from wherever the player is to a tile on another map, through warps, every step pathfound.
  const travel = (mapId, isGoal, { via } = {}) => {
    const log = [];
    for (let hop = 0; s.info.id !== mapId && hop < 12; hop++) {
      const G = grid(s.info.id); const w = (via && G.info.warps.find(via)) || mapRoute(s.info.id, mapId)[0];
      const path = bfs(G, tileAt(s.player.x, s.player.y), (t) => G.inside(w, ...t));
      if (!path) throw new Error(`travel: no path on ${s.info.id} to warp ${w.objectId}`);
      walkPath(path); waitArrival(); log.push(s.info.id);
    }
    const G = grid(mapId); const path = bfs(G, tileAt(s.player.x, s.player.y), isGoal);
    if (!path) throw new Error(`travel: no path on ${mapId} from ${tileAt(s.player.x, s.player.y)}`);
    walkPath(path); return { maps: log, tiles: path.length };
  };
  // The open tile next to a delivery point (or NPC) the player can stand on, and the way to face it.
  const facingSpot = (G, tx, ty, from) => {
    const path = bfs(G, from, (t) => STEPS.some(([dx, dy]) => t[0] + dx === tx && t[1] + dy === ty) && !G.warpAt(...t));
    if (!path) return null;
    const stand = path.at(-1); return { path, stand, facing: FACING_OF[[tx - stand[0], ty - stand[1]].join(',')] };
  };
  const pointTile = (mapId, pointId) => { const p = mapById(mapId).deliveryPoints.find((q) => q.pointId === pointId); return [p.x / 16, p.y / 16]; };
  // A warp's approach: the open tile next to it from which one step enters it (derived from the grid).
  const approachOf = (G, warp) => {
    for (let ty = warp.y / 16; ty < (warp.y + warp.height) / 16; ty++) for (let tx = warp.x / 16; tx < (warp.x + warp.width) / 16; tx++) {
      for (const [dx, dy] of STEPS) { const a = [tx - dx, ty - dy]; if (G.open(...a) && !G.warpAt(...a)) return { tile: a, key: KEY_OF[[dx, dy].join(',')] }; }
    }
    return null;
  };
  const allWarps = M.MAP_LIST.flatMap((m) => m.warps.map((w) => ({ from: m.id, warp: w })));
  // Walks onto a warp holding the key and steps until the next map has faded in. onFrame(i, phase) runs after each frame.
  const walkWarp = (from, warp, { onFrame, keepHeld = false, input = 'key' } = {}) => {
    gotoMap(from); const ap = approachOf(grid(from), warp); const key = ap.key; at(ap.tile[0] * 16 + 8, ap.tile[1] * 16 + 12);
    const dpadDir = { ArrowRight: [100, 0], ArrowLeft: [-100, 0], ArrowUp: [0, -100], ArrowDown: [0, 100] }[key];
    if (input === 'dpad') pe(dpadEl, 'pointerdown', ...dpadDir, 41); else ev('keydown', key);
    const trace = [];
    for (let i = 0; i < 240; i++) {
      run(FRAME);
      const phase = s.info.id === from ? (s.warping ? 'out' : 'walk') : (s.warping ? 'in' : 'done');
      trace.push({ phase, x: s.player.x, y: s.player.y, alpha: s.cameras.main.fadeEffect.alpha, emote: s.emote.visible, talking: s.talking });
      onFrame?.(i, phase, trace);
      if (phase === 'done') break;
    }
    if (!keepHeld) { if (input === 'dpad') pe(window, 'pointerup', ...dpadDir, 41); else ev('keyup', key); run(50); }
    return trace;
  };
  const dpadEl = document.getElementById('dpad');
  const pe = (target, type, x, y, id) => target.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  const landed = () => [s.info.id, s.player.x, s.player.y, s.facing];
  const expectLanding = (warp) => { const d = M.resolveDestination(warp.targetMap, warp.targetSpawn); return [d.map.id, d.spawn.x, d.spawn.y, d.spawn.facing]; };

  const pairResults = {}, pairExpected = {}; let firstTrace = null;
  for (const { from, warp } of allWarps) {
    const tr = walkWarp(from, warp); firstTrace ??= tr;
    pairResults[`${from}/${warp.objectId}`] = landed(); pairExpected[`${from}/${warp.objectId}`] = expectLanding(warp);
  }
  const pairedBack = allWarps.every(({ from, warp }) => mapById(warp.targetMap).warps.some((w) => w.targetMap === from));
  // test-map's exit is one-way (into roosevelt-ave's start): the test fixture can't be reached from play.
  const pairedReal = allWarps.filter(({ from }) => from !== 'test-map').every(({ from, warp }) => mapById(warp.targetMap).warps.some((w) => w.targetMap === from));
  check('P2 every warp (approach derived from the collision grid): lands on the target spawn, facing its way; world warps come in pairs',
    [allWarps.length, allWarps.every(({ from, warp }) => approachOf(grid(from), warp)), pairedReal, pairResults],
    [2 * (WORLD.connections.filter((c) => c.kind === 'open').length + WORLD.mapConnections.flatMap((mc) => mc.at).length) + 1, true, true, pairExpected]);
  void pairedBack;
  const count = (tr, ph) => tr.filter((f) => f.phase === ph).length;
  const outAlphas = firstTrace.filter((f) => f.phase === 'out').map((f) => f.alpha);
  check('P3 fade: ~250 ms out (to black) and ~250 ms in, player still throughout',
    [Math.abs(count(firstTrace, 'out') - 15) <= 2, Math.abs(count(firstTrace, 'in') - 15) <= 2, outAlphas.every((a, i) => i === 0 || a >= outAlphas[i - 1]), Math.max(...outAlphas) > 0.9, firstTrace.at(-1).alpha,
      new Set(firstTrace.filter((f) => f.phase === 'out').map((f) => `${f.x},${f.y}`)).size, new Set(firstTrace.filter((f) => f.phase === 'in').map((f) => `${f.x},${f.y}`)).size],
    [true, true, true, true, 0, 1, 1]);
  // Darkness at the switch: centre pixel (R+G+B) of the last old-map frame and the first new-map frame.
  const lum = () => { const c = rgbAt(snap(), 128, 112); return ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255); };
  let lastOut = null, firstIn = null; walkWarp('test-map', mapById('test-map').warps[0], { onFrame: (i, ph) => { if (ph === 'out') lastOut = lum(); if (ph === 'in' && firstIn === null) firstIn = lum(); } });
  check('P3b screen is black when the maps swap (last old frame black, first new frame near-black)', [lastOut, firstIn !== null && firstIn < 60], [0, true]);
  check('P3c name card shows the map name after arriving, then goes', [s.children.list.some((o) => o.type === 'BitmapText' && o.text === 'Roosevelt Avenue'), (run(1600), s.children.list.some((o) => o.type === 'BitmapText' && o.text === 'Roosevelt Avenue'))], [true, false]);

  // P4. Input lock: Action and a new direction during the fade-out and the fade-in do nothing, now or later.
  let lockLog = { dirs: [], emote: false, talking: false };
  walkWarp('test-map', mapById('test-map').warps[0], { onFrame: (i, ph) => {
    if (ph === 'out' || ph === 'in') { lockLog.dirs.push(s.controls.direction()); lockLog.emote ||= s.emote.visible; lockLog.talking ||= s.talking; }
    if ((ph === 'out' || ph === 'in') && !lockLog[ph]) { lockLog[ph] = true; ev('keydown', 'Space'); ev('keydown', 'ArrowDown'); }
    if (ph === 'in' && lockLog.in === true) { lockLog.in = 'released'; ev('keyup', 'Space'); }
  } });
  const fadeLockPos = [s.player.x, s.player.y]; run(400); // ArrowDown is still held from inside the fade
  check('P4 input locked during the fade: no move, no Action, nothing carried over', [lockLog.dirs.every((d) => d === null), lockLog.emote, lockLog.talking, s.emote.visible, [s.player.x, s.player.y], s.controls.direction()], [true, false, false, false, fadeLockPos, null]);
  ev('keyup', 'ArrowDown'); run(50); ev('keydown', 'Space'); run(FRAME); ev('keyup', 'Space'); run(FRAME);
  check('P4b a fresh Action after the fade works', s.emote.visible, true); run(600);

  // P5. A key held into the warp (with auto-repeat) or a D-pad held into it doesn't walk on the new map.
  const repeatKey = (i) => { if (i % 4 === 0) ev('keydown', 'ArrowRight', { repeat: true }); };
  walkWarp('test-map', mapById('test-map').warps[0], { keepHeld: true, onFrame: repeatKey });
  const kArrive = [s.player.x, s.player.y]; for (let i = 0; i < 30; i++) { repeatKey(i * 4); run(FRAME); }
  const kHeld = [[s.player.x, s.player.y], s.controls.direction(), s.player.anims.isPlaying];
  ev('keyup', 'ArrowRight'); run(50); ev('keydown', 'ArrowRight'); run(200); ev('keyup', 'ArrowRight'); run(50);
  check('P5 held key + auto-repeat: no walking after the warp until pressed again', [kHeld, s.player.x - kArrive[0]], [[kArrive, null, false], 12]);
  walkWarp('test-map', mapById('test-map').warps[0], { keepHeld: true, input: 'dpad' });
  const dArrive = [s.player.x, s.player.y]; run(500);
  const dHeld = [[s.player.x, s.player.y], dpadEl.dataset.dir ?? null, s.controls.direction()]; // data-dir = D-pad still held
  pe(window, 'pointerup', 100, 0, 41); run(50); pe(dpadEl, 'pointerdown', 100, 0, 42); run(200); pe(window, 'pointerup', 100, 0, 42); run(50);
  check('P5b D-pad held through the warp: no walking until pressed again', [dHeld, s.player.x - dArrive[0]], [[dArrive, 'right', null], 12]);

  // P6. The window loses focus during the fade-out and again during the fade-in.
  const blurAt = { out: 5, in: 5 }; const seen = { out: 0, in: 0 };
  const p6Warp = mapById('roosevelt-ave').warps[0];
  walkWarp('roosevelt-ave', p6Warp, { keepHeld: true, onFrame: (i, ph) => {
    if (ph in seen && ++seen[ph] === blurAt[ph]) { window.dispatchEvent(new Event('blur')); run(100); window.dispatchEvent(new Event('focus')); }
  } });
  const bArrive = landed(); run(400);
  check('P6 focus lost mid-fade (out and in): warp completes, unlocked, nothing stuck', [bArrive, s.warping, s.controls.isLocked(), s.controls.direction(), [s.player.x, s.player.y]], [expectLanding(p6Warp), false, false, null, [bArrive[1], bArrive[2]]]);
  for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) ev('keyup', k); run(50);

  // P7. Broken links: dev throws (at boot and on use), production falls back.
  const warns2 = []; const ow = console.warn; console.warn = (...a) => warns2.push(a.join(' '));
  const strictMsgs = [throwsMsg(() => M.resolveDestination('no-such-map', 'start', true)), throwsMsg(() => M.resolveDestination('roosevelt-ave', 'no-such-spawn', true))];
  const fb1 = M.resolveDestination('no-such-map', 'x', false), fb2 = M.resolveDestination('roosevelt-ave', 'no-such-spawn', false);
  console.warn = ow;
  const tmInfo = mapById('test-map'); tmInfo.warps.push({ objectId: 999, targetMap: 'nope', targetSpawn: 'x', x: 0, y: 0, width: 1, height: 1 }); const bootMsg = throwsMsg(M.validateLinks); tmInfo.warps.pop();
  check('P7 unknown map/spawn: throws in dev, falls back (with a warning) in production',
    [strictMsgs, bootMsg, [fb1.map.id, fb1.spawn.spawnId], [fb2.map.id, fb2.spawn.spawnId], warns2.length],
    [['Unknown map "no-such-map"', 'Map "roosevelt-ave" has no spawn "no-such-spawn"'], 'Map "test-map", warp object 999: Unknown map "nope"', ['roosevelt-ave', 'start'], ['roosevelt-ave', 'start'], 2]);

  // P8. Talk to the NPC in each map.
  const zoneTalk = {};
  for (const m of M.MAP_LIST) {
    gotoMap(m.id); const n0 = s.npcs[0]; if (!n0) continue; place(n0.spawn.x, n0.spawn.y + 16, 'up'); press(); run(50);
    const name = STR_MOD.t(`npc.${n0.spawn.npcId}.name`);
    zoneTalk[m.id] = [s.npcs.length, s.talking && g.scene.isActive('Dialogue'), D().pages[0].replace(/\n/g, ' ').includes(name), n0.sprite.frame.name % 4];
    closeDialogue(); zoneTalk[m.id].push(s.talking);
  }
  // 6c: the Dispatcher moved from test-map to roosevelt-ave; the stub maps' Neighbors D and E are gone with them.
  check('P8 dialogue works in each map with NPCs (opens, names the NPC, NPC turns, closes)', zoneTalk, { 'test-map': [3, true, true, 0, false], 'roosevelt-ave': [1, true, true, 0, false] });
  s.state.reset();

  // ---- Session 5 ----
  const ORD = await import('/src/systems/orders.ts');
  const GS = await import('/src/systems/gameState.ts');
  const NPCS = await import('/src/systems/npcs.ts');
  const ticketShown = () => s.ticketText.visible && s.ticketBox.visible;
  const ticket = () => (ticketShown() ? s.ticketText.text.split('\n') : null);
  const lastPage = () => D().pages.join(' ').replace(/\n/g, ' ');
  // Opens the window with Action, reads every page, closes it; returns the text shown.
  const talkAll = () => { press(); let text = ''; for (let n = 0; s.talking && n < 30; n++) { if (D().pageComplete() && !text.includes(D().pages[D().page])) text += D().pages[D().page].replace(/\n/g, ' ') + ' | '; press(); } run(100); return text; };
  s.state.reset(); gotoMap('roosevelt-ave', 'start');

  // Q1. Order data: 3 orders; the pickup is off the dispatcher's map and the dropoff off the pickup's map,
  // so each order needs at least one warp per leg; pickup and dropoff in different zones; every map's
  // delivery points are its anchors (from the world dataset).
  const dispatcherMap = 'roosevelt-ave';
  const zoneOf = (mapId) => WORLD.maps.find((m) => m.id === mapId)?.zone;
  const anchorsOf = (mapId) => { const segs = WORLD.maps.find((m) => m.id === mapId)?.segments ?? []; return WORLD.anchors.filter((a) => segs.includes(a.segment) && !a.uses.includes('dispatcher')).map((a) => a.id).sort(); };
  check('Q1 orders: 3 loaded, every leg crosses a warp, pickup and dropoff in different zones, the Dispatcher on roosevelt-ave, each map draws its anchors',
    [ORD.ORDERS.map((o) => o.id), ORD.ORDERS.every((o) => o.pickup.map !== dispatcherMap && o.dropoff.map !== o.pickup.map && zoneOf(o.pickup.map) !== zoneOf(o.dropoff.map)), s.npcs.filter((n) => n.spawn.role === 'dispatcher').map((n) => n.spawn.npcId),
      M.MAP_LIST.map((m) => m.deliveryPoints.map((p) => p.pointId).sort())],
    [['order-1', 'order-2', 'order-3'], true, ['dispatcher'], M.MAP_LIST.map((m) => anchorsOf(m.id))]);

  // Q2. State machine, on a fresh GameState over the real orders.
  const [o1, o2] = ORD.ORDERS; const P = o1.pickup, Dp = o1.dropoff; const other = { map: o2.pickup.map, pointId: o2.pickup.pointId };
  const st = new GS.GameState(ORD.ORDERS); const log = [];
  const k = (r) => r.kind + (r.order ? ':' + r.order.id : '');
  log.push(k(st.interact(P.map, P.pointId)));                 // no order yet
  log.push(k(st.assignNext()), k(st.assignNext()));          // assign, then busy
  log.push(k(st.interact(Dp.map, Dp.pointId)));               // dropoff before pickup
  log.push(k(st.interact(other.map, other.pointId)));         // some other point
  log.push(k(st.interact(Dp.map, P.pointId)));                // right pointId, wrong map
  log.push(k(st.interact(P.map, P.pointId)), st.active.status, k(st.interact(P.map, P.pointId)));  // pick up, then again
  log.push(k(st.interact(Dp.map, Dp.pointId)), st.active, st.rewardTotal);  // deliver
  for (const o of ORD.ORDERS.slice(1)) { st.assignNext(); st.interact(o.pickup.map, o.pickup.pointId); st.interact(o.dropoff.map, o.dropoff.pointId); }
  log.push(k(st.assignNext()), st.completed, st.rewardTotal, st.active);
  check('Q2 order state machine: assign -> busy -> pick up -> deliver, wrong points do nothing, then none left', log,
    ['nothing', 'assigned:order-1', 'busy', 'not-picked-up:order-1', 'nothing', 'nothing', 'picked-up:order-1', 'picked-up', 'nothing', 'delivered:order-1', null, 10,
      'none-left', ['order-1', 'order-2', 'order-3'], 45, null]);

  // Q3. Malformed or broken orders fail loudly in dev (strict) and are skipped with a warning in production.
  const good = JSON.parse(JSON.stringify(ORD.ORDERS[0]));
  const variant = (f) => { const o = JSON.parse(JSON.stringify(good)); f(o); return { orders: [o] }; };
  const BAD = {
    noArray: {},
    reward: variant((o) => { o.reward = '10'; }),
    unknownMap: variant((o) => { o.dropoff.map = 'no-such-map'; }),
    unknownPoint: variant((o) => { o.pickup.pointId = 'no-such-point'; }),
    missingString: variant((o) => { o.text.assign = 'order.no-such-string'; }),
    samePoint: variant((o) => { o.dropoff = { ...o.pickup }; }),
    duplicateId: { orders: [good, good] },
  };
  const strictMsgs3 = Object.fromEntries(Object.entries(BAD).map(([key, raw]) => [key, throwsMsg(() => ORD.parseOrders(raw, true))]));
  const warns3 = []; const ow3 = console.warn; console.warn = (...a) => warns3.push(a.join(' '));
  const lenient = ORD.parseOrders({ orders: [good, BAD.unknownMap.orders[0], BAD.reward.orders[0], good] }, false).map((o) => o.id);
  console.warn = ow3;
  check('Q3 bad orders throw in dev with a clear message', strictMsgs3, {
    noArray: 'orders.json: needs an "orders" array',
    reward: 'orders.json, order 0 ("order-1"): reward must be a number >= 0',
    unknownMap: 'orders.json, order 0 ("order-1"): dropoff names unknown map "no-such-map"',
    unknownPoint: `orders.json, order 0 ("order-1"): map "${P.map}" has no delivery point "no-such-point"`,
    missingString: 'orders.json, order 0 ("order-1"): text.assign names missing string "order.no-such-string"',
    samePoint: 'orders.json, order 0 ("order-1"): pickup and dropoff are the same point',
    duplicateId: 'orders.json, order 1 ("order-1"): duplicate id',
  });
  check('Q3b production: bad orders are skipped with one warning each, good ones kept', [lenient, warns3.length], [['order-1'], 3]);
  const objLayer = (objects) => ({ layers: [{ name: 'objects', type: 'objectgroup', objects: [{ id: 1, type: 'spawn', point: true, x: 8, y: 8, properties: [{ name: 'spawnId', value: 'a' }, { name: 'facing', value: 'up' }] }, ...objects] }] });
  const dp = (id, extra = {}) => ({ id, name: 'p', type: 'deliveryPoint', x: 0, y: 0, width: 16, height: 16, properties: [{ name: 'pointId', value: 'x' }], ...extra });
  const fakeMap = (props) => ({ getObjectLayer: () => ({ objects: [{ id: 9, point: true, x: 0, y: 0, properties: Object.entries(props).map(([name, value]) => ({ name, value })) }] }) });
  check('Q3c malformed delivery points and NPC roles throw at load',
    [throwsMsg(() => M.readObjects('fx', objLayer([dp(2, { point: true, width: 0, height: 0 })]))), throwsMsg(() => M.readObjects('fx', objLayer([dp(2, { properties: [] })]))),
      throwsMsg(() => M.readObjects('fx', objLayer([dp(2), dp(3)]))), throwsMsg(() => NPCS.readNpcSpawns(fakeMap({ npcId: 'q', dialogueId: 'neighbor-a.hello', facing: 'up', role: 'boss' })))],
    ['Map "fx", object 2 ("p"): a delivery point must be a rectangle', 'Map "fx", object 2 ("p"): needs string property "pointId"', 'Map "fx", object 3 ("p"): duplicate pointId "x"',
      'NPC object 9 in layer "npcs": role must be one of dispatcher']);

  // Q4. End to end in the game, walking every step with real key events along pathfound routes:
  // start -> Dispatcher -> warps -> pick up -> warps -> deliver. State and ticket survive each warp.
  const mapName = (id) => STR_MOD.t(mapById(id).nameId);
  s.state.reset(); gotoMap('roosevelt-ave', 'start');
  const e2e = { before: [ticket(), s.state.active] };
  const disp = s.npcs.find((n) => n.spawn.role === 'dispatcher');
  const dTile = tileAt(disp.spawn.x, disp.spawn.y);
  let spot = facingSpot(grid('roosevelt-ave'), ...dTile, tileAt(s.player.x, s.player.y));
  walkPath(spot.path); s.facing = spot.facing;
  e2e.reachedDispatcher = [tileAt(s.player.x, s.player.y).join(','), s.facing];
  e2e.dispatcher = talkAll(); e2e.afterAssign = [ticket(), s.state.active?.order.id, s.state.active?.status];
  e2e.dispatcherAgain = talkAll();
  const goFace = (stop) => {
    const [tx, ty] = pointTile(stop.map, stop.pointId); let found = null;
    const r = travel(stop.map, (t) => { const f = STEPS.find(([dx, dy]) => t[0] + dx === tx && t[1] + dy === ty); if (f && !grid(stop.map).warpAt(...t)) found = f; return !!f && !grid(stop.map).warpAt(...t); });
    s.facing = FACING_OF[found.join(',')]; return r;
  };
  const leg1 = goFace(o1.pickup);
  e2e.afterLeg1 = [s.info.id, ticket(), s.state.active?.status, leg1.maps.length >= 1];
  const fp = s.facing; s.facing = { up: 'down', down: 'up', left: 'right', right: 'left' }[fp]; e2e.facingAway = talkAll(); s.facing = fp;
  e2e.pickup = talkAll(); e2e.afterPickup = [ticket(), s.state.active?.status];
  const leg2 = goFace(o1.dropoff);
  e2e.afterLeg2 = [s.info.id, ticket(), s.state.active?.status, leg2.maps.length >= 1];
  e2e.deliver = talkAll();
  e2e.after = [ticket(), s.state.active, s.state.completed, s.state.rewardTotal];
  R['Q4 info: route maps (leg 1 / leg 2)'] = `${leg1.maps.join(' > ')} / ${leg2.maps.join(' > ')}`;
  check('Q4 end to end on the world maps (routes pathfound): Dispatcher, pick up and deliver across warps; state and ticket survive warps', e2e, {
    before: [null, null],
    reachedDispatcher: [[dTile[0], dTile[1] + 1].join(','), 'up'],
    dispatcher: `I'm the Dispatcher. I hand out delivery orders, one at a time. | Order #1 is ready for pickup at ${mapName(P.map)}. Bring it to ${mapName(Dp.map)}. | `,
    afterAssign: [['Order #1: not picked up', `Pick up at ${mapName(P.map)}`], 'order-1', 'assigned'],
    dispatcherAgain: `I'm the Dispatcher. I hand out delivery orders, one at a time. | You still have Order #1 to pick up at ${mapName(P.map)}. | `,
    afterLeg1: [P.map, ['Order #1: not picked up', `Pick up at ${mapName(P.map)}`], 'assigned', true],
    facingAway: '',
    pickup: `You picked up Order #1. Bring it to ${mapName(Dp.map)}. | `,
    afterPickup: [['Order #1: picked up', `Deliver to ${mapName(Dp.map)}`], 'picked-up'],
    afterLeg2: [Dp.map, ['Order #1: picked up', `Deliver to ${mapName(Dp.map)}`], 'picked-up', true],
    deliver: 'You delivered Order #1. Nice work! | ',
    after: [null, null, ['order-1'], 10],
  });
  // Q5. Dropoff before pickup, and the "nothing here" line with no active order (placed at the facing spot).
  const placeAt = (stop) => { gotoMap(stop.map); const [tx, ty] = pointTile(stop.map, stop.pointId); const f = facingSpot(grid(stop.map), tx, ty, tileAt(s.player.x, s.player.y)); place(f.stand[0] * 16 + 8, f.stand[1] * 16 + 12, f.facing); };
  s.state.assignNext(); placeAt(o2.dropoff); const early = talkAll();
  s.state.reset(); placeAt(o2.dropoff); const noOrder = talkAll();
  check('Q5 dropoff before pickup explains; a point with no active order says nothing here', [early, noOrder, s.state.active],
    [`Order #2 goes here, but you haven't picked it up yet. It's at ${mapName(o2.pickup.map)}. | `, 'Nothing here. | ', null]);

  // Q6. Order ticket: drawn pixel-exact at whole pixels, centred under the name card, over the map; hidden with no order.
  s.state.reset(); s.state.assignNext(); gotoMap('roosevelt-ave', 'start'); run(1600); run(FRAME);
  const tPx = snap(); const tLines = ticket(); const tBad = [];
  tLines.forEach((line, row) => [...line].forEach((ch, col) => {
    for (let y = 0; y < 12; y++) for (let x = 0; x < 6; x++) if (rgbAt(tPx, s.ticketText.x + col * 6 + x, s.ticketText.y + row * 12 + y) !== (bit(ch.charCodeAt(0), x, y) ? 0xfffaf0 : 0x2a1f3d)) { tBad.push(ch); return; }
  }));
  const tb = s.ticketBox; const tw = 6 * Math.max(...tLines.map((l) => l.length)) + 6;
  check('Q6 ticket: whole-pixel box centred at y=24 (under the name card row), pixel-exact text, fixed to the screen, over sprites and canopies, under the name card',
    [[tb.x, tb.y, tb.width, tb.height], tBad, [tb.scrollFactorX, s.ticketText.scrollFactorX], tb.depth > layerOf('above').depth && tb.depth > s.emote.depth, tb.y >= 4 + 12 + 6, tb.depth < 2e6],
    [[Math.floor((256 - tw) / 2), 24, tw, 2 * 12 + 6], [], [0, 0], true, true, true]);
  // Q6c. Near the map's top edge the camera stops scrolling and the player reaches the top of the screen:
  // walk (pathfound) up into a north link stub, stopping a tile short of its warp; the ticket moves to the bottom.
  const sprite = () => { const c = s.cameras.main; return [s.player.x - 8 - c.scrollX, s.player.y - 24 - c.scrollY, 16, 24]; };
  const hits = (a, b) => a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
  const tRect = () => [tb.x, tb.y, tb.width, tb.height];
  const Gr = grid('roosevelt-ave'); const northWarp = Gr.info.warps.find((w) => w.y === 16 && w.width > w.height);
  const topTile = [northWarp.x / 16 + 1, northWarp.y / 16 + 1];
  const upPath = bfs(Gr, tileAt(s.player.x, s.player.y), (t) => t[0] === topTile[0] && t[1] === topTile[1]);
  const ticketLog = [];
  for (let i = 0; i < upPath.length - 1; i++) {
    const d = [upPath[i + 1][0] - upPath[i][0], upPath[i + 1][1] - upPath[i][1]]; const kk = KEY_OF[d.join(',')];
    ev('keydown', kk); for (let f = 0; f < 16; f++) { run(FRAME); ticketLog.push([tb.y, hits(sprite(), tRect())]); } ev('keyup', kk);
  }
  run(50);
  const atTop = [s.info.id, s.player.y, tb.y, hits(sprite(), tRect())];
  walkPath([...upPath].reverse()); run(50);
  check('Q6c ticket moves to the bottom while the player is under it, never covers the player, and comes back',
    [atTop, ticketLog.every(([, hit]) => !hit), [...new Set(ticketLog.map(([y]) => y))], tb.y], [['roosevelt-ave', topTile[1] * 16 + 12, 224 - 4 - 30, false], true, [24, 190], 24]);
  s.state.reset(); gotoMap('roosevelt-ave', 'start'); run(FRAME);
  check('Q6b ticket hidden with no active order', [ticketShown(), s.ticketBox.visible, s.ticketText.visible], [false, false, false]);

  // ---- Session 6c: the generated world maps ----
  // S1. Reachability from the start, over the collision grids (flood fill per map, following warps).
  const reach = new Map(); // mapId -> Set of reachable tile keys
  const queueS = [[M.START.map.id, tileAt(M.START.spawn.x, M.START.spawn.y)]]; const warpsSeen = new Set();
  while (queueS.length) {
    const [mid, t0] = queueS.shift(); const G = grid(mid); const seen = reach.get(mid) ?? new Set(); reach.set(mid, seen);
    if (seen.has(`${t0}`)) continue;
    const q = [t0]; seen.add(`${t0}`);
    while (q.length) {
      const t = q.shift(); const w = G.warpAt(...t);
      if (w) { const key = `${mid}/${w.objectId}`; if (!warpsSeen.has(key)) { warpsSeen.add(key); const dst = M.resolveDestination(w.targetMap, w.targetSpawn, true); queueS.push([dst.map.id, tileAt(dst.spawn.x, dst.spawn.y)]); } continue; }
      for (const [dx, dy] of STEPS) { const n = [t[0] + dx, t[1] + dy]; if (G.open(...n) && !seen.has(`${n}`)) { seen.add(`${n}`); q.push(n); } }
    }
  }
  const realWarps = allWarps.filter(({ from }) => from !== 'test-map');
  check('S1 every world map is reachable from the start (pathfinding over the collision grid), every world warp too; test-map is not',
    [[...reach.keys()].sort(), realWarps.filter(({ from, warp }) => !warpsSeen.has(`${from}/${warp.objectId}`)).map(({ from, warp }) => `${from}/${warp.objectId}`), reach.has('test-map')], [[...REAL].sort(), [], false]);

  // S2. Every warp pair round-trips, walked with real keys: step into the warp from its approach, then walk
  // (pathfound) from the arrival spawn into the warp back at the same node; land next to the first warp.
  const roundTrips = {};
  const nearWarp = (x, y, warp) => Math.hypot(x - (warp.x + warp.width / 2), y - (warp.y + warp.height / 2)) <= 4 * 16;
  for (const { from, warp } of realWarps) {
    walkWarp(from, warp); const arrivedAt = s.info.id;
    // The way back: a warp to `from` whose landing spawn sits by the warp just taken.
    const G = grid(arrivedAt);
    const back = G.info.warps.find((w) => { const d = w.targetMap === from && M.resolveDestination(w.targetMap, w.targetSpawn); return d && nearWarp(d.spawn.x, d.spawn.y, warp); });
    let res = [arrivedAt === warp.targetMap, !!back];
    if (back) {
      const path = bfs(G, tileAt(s.player.x, s.player.y), (t) => G.inside(back, ...t));
      if (path) { walkPath(path); waitArrival(); }
      res = [arrivedAt === warp.targetMap, !!path, s.info.id === from, nearWarp(s.player.x, s.player.y, warp), !s.warping && !s.controls.isLocked()];
    }
    roundTrips[`${from}/${warp.objectId}`] = res.length === 5 && res.every(Boolean) ? 'ok' : res;
  }
  for (const kk of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) ev('keyup', kk); run(50);
  check('S2 every world warp pair round-trips when walked (there and back lands within 4 tiles of the first warp)',
    Object.entries(roundTrips).filter(([, v]) => v !== 'ok'), []); R['S2 info: warps walked both ways'] = Object.keys(roundTrips).length;

  // S3. Every delivery point: reachable from the start and facing-accessible (Action from the open tile in
  // front of it opens the delivery line; no order is active, so it's "Nothing here.").
  s.state.reset(); const pointsBad = []; let pointsOk = 0;
  for (const mid of REAL) for (const p of mapById(mid).deliveryPoints) {
    const G = grid(mid); const [tx, ty] = [p.x / 16, p.y / 16];
    const stands = STEPS.map(([dx, dy]) => [tx - dx, ty - dy]).filter((t) => G.open(...t) && !G.warpAt(...t) && reach.get(mid)?.has(`${t}`));
    if (!stands.length) { pointsBad.push(`${mid}/${p.pointId}: no reachable tile in front`); continue; }
    gotoMap(mid); const st0 = stands[0]; place(st0[0] * 16 + 8, st0[1] * 16 + 12, FACING_OF[[tx - st0[0], ty - st0[1]].join(',')]);
    const said = talkAll(); if (said === 'Nothing here. | ') pointsOk++; else pointsBad.push(`${mid}/${p.pointId}: said "${said}"`);
  }
  check('S3 every delivery point is reachable from the start and facing-accessible', [pointsOk, pointsBad], [WORLD.anchors.filter((a) => !a.uses.includes('dispatcher')).length, []]);
} catch (e) {
  R.ERROR = String(e && e.stack || e);
} finally {
  for (let n = 0; s.talking && n < 30; n++) { ev('keydown', 'Space'); run(FRAME); ev('keyup', 'Space'); run(FRAME); }
  s.state?.reset(); s.scene.restart({}); run(100);
  g.loop.wake();
}
R['frames stepped'] = frames;
R.summary = `${Object.values(R).filter((v) => v === 'PASS').length} pass / ${Object.values(R).filter((v) => v && typeof v === 'object' && 'FAIL' in v).length} fail`;
R;

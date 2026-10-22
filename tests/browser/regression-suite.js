// Desktop behaviour regression suite. A-G: sessions 1-2 (45 checks). H-M: session 3
// (strings, font, tileset export, dialogue, NPC targeting/collision, depth sorting).
// Deterministic: pauses Phaser's rAF loop and advances frames manually at exactly 60 fps via
// game.step(time, delta), so results don't depend on the browser pane being visible.
// Run on the dev server (needs the DEV-only window.game hook); see tests/browser/README.md.
// Top-level await: evaluate as an async function body. Returns a results object.
const g = window.game; const s = g.scene.getScene('TestMap');
const FRAME = 1000 / 60; let T = performance.now(); let frames = 0;
g.loop.sleep();
const run = (ms) => { const n = Math.round(ms / FRAME); for (let i = 0; i < n; i++) { T += FRAME; g.step(T, FRAME); frames++; } };
const KC = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, KeyW: 87, KeyA: 65, KeyS: 83, KeyD: 68, Space: 32, Enter: 13, KeyZ: 90 };
const ev = (type, code, o = {}) => window.dispatchEvent(new KeyboardEvent(type, { key: code, code, keyCode: KC[code], which: KC[code], bubbles: true, ...o }));
const hold = (code, ms) => { ev('keydown', code); run(ms); ev('keyup', code); run(100); return [+s.player.x.toFixed(2), +s.player.y.toFixed(2)]; };
const at = (x, y) => { s.player.body.reset(x, y); run(100); };
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
  const FONT_MOD = await import('/src/systems/placeholderFont.ts');
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
  const layers = s.children.list.filter((o) => o.type === 'TilemapLayer');
  check('M4 tile layers under all sprites, emote over all', [layers.every((l) => l.depth < 0), s.emote.depth > Math.max(...s.npcs.map((n) => n.sprite.depth), 320)], [true, true]);
} catch (e) {
  R.ERROR = String(e && e.stack || e);
} finally {
  for (let n = 0; s.talking && n < 30; n++) { ev('keydown', 'Space'); run(FRAME); ev('keyup', 'Space'); run(FRAME); }
  at(232, 268); s.facing = 'down';
  g.loop.wake();
}
R['frames stepped'] = frames;
R.summary = `${Object.values(R).filter((v) => v === 'PASS').length} pass / ${Object.values(R).filter((v) => v && typeof v === 'object' && 'FAIL' in v).length} fail`;
R;

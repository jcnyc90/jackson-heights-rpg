// Touch-control check for mobile emulation (run with a touch viewport, e.g. 375x812 or 667x375).
// Session 3 adds the Action button driving dialogue (open, skip, turn page, close, D-pad locked).
// Session 4 adds a warp taken with the D-pad held (and an Action tap during the fade).
// Session 5 adds the order ticket's placement against the controls (every order, both statuses,
// top and bottom positions) and one delivery order completed with touch input only.
// Session 6c: the game starts on the world maps, so the D-pad, dialogue and warp checks run on test-map
// (restarted first); the touch-only order walks routes pathfound over the world maps' collision grids.
// Deterministic frame stepping like regression-suite.js. Returns a results object.
const g = window.game; const s = g.scene.getScene('Map');
const FRAME = 1000 / 60; let T = performance.now();
g.loop.sleep();
const run = (ms) => { const n = Math.round(ms / FRAME); for (let i = 0; i < n; i++) { T += FRAME; g.step(T, FRAME); } };
const box = (el) => { const b = el.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round); };
const dpad = document.getElementById('dpad'); const act = document.getElementById('action-btn');
const pe = (target, type, x, y, id) => target.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true }));
const R = { viewport: [innerWidth, innerHeight], touchClass: document.documentElement.classList.contains('touch') };
try {
  s.scene.restart({ mapId: 'test-map', spawnId: 'start' }); run(100);
  R.canvas = box(g.canvas); R.dpad = box(dpad); R.action = box(act);
  const c = g.canvas.getBoundingClientRect(), d = dpad.getBoundingClientRect(), a = act.getBoundingClientRect();
  R.dpadOverlapsGamePx = Math.max(0, Math.round(Math.min(d.right + 3, c.right) - Math.max(d.left - 3, c.left)) * (d.bottom > c.top && d.top < c.bottom ? 1 : 0));
  R.actionOverlapsGamePx = Math.max(0, Math.round(Math.min(a.right + 3, c.right) - Math.max(a.left - 3, c.left)) * (a.bottom > c.top && a.top < c.bottom ? 1 : 0));
  const cx = d.left + d.width / 2, cy = d.top + d.height / 2;
  R.hitTestUpArm = document.elementFromPoint(cx, d.top + 8)?.className;
  R.hitTestAction = document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2)?.id;
  s.player.body.reset(232, 268); run(100);
  const x0 = s.player.x, y0 = s.player.y;
  pe(dpad, 'pointerdown', cx + d.width * 0.4, cy, 1); run(500);
  R.rightArm = { dir: s.controls.direction(), dataDir: dpad.dataset.dir, movedRightPx: Math.round(s.player.x - x0) };
  pe(window, 'pointermove', cx, cy - d.height * 0.4, 1); run(300);
  R.slideToUp = { dir: s.controls.direction(), movedUpPx: Math.round(y0 - s.player.y) };
  pe(act, 'pointerdown', a.left + 5, a.top + 5, 2); run(50);
  R.actionWhileHeld = { emote: s.emote.visible, pressedClass: act.classList.contains('pressed'), dir: s.controls.direction() };
  pe(act, 'pointerup', a.left + 5, a.top + 5, 2); R.pressedClassAfterUp = act.classList.contains('pressed');
  pe(window, 'pointermove', cx + 2, cy + 2, 1); run(50); R.deadzone = s.controls.direction();
  pe(window, 'pointermove', cx + 400, cy, 1); pe(window, 'pointerup', cx + 400, cy, 1); run(50);
  R.releaseOutside = [s.controls.direction(), dpad.dataset.dir ?? null];
  pe(dpad, 'pointerdown', cx - d.width * 0.4, cy, 3); run(50); R.leftHeld = s.controls.direction();
  window.dispatchEvent(new Event('blur')); run(50); R.afterBlur = s.controls.direction(); window.dispatchEvent(new Event('focus'));
  pe(window, 'pointerup', cx - d.width * 0.4, cy, 3); run(600);
  // Dialogue via the Action button: face Neighbor A from 8px to its right.
  const D = g.scene.getScene('Dialogue'); const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  const tap = (id) => { pe(act, 'pointerdown', ax, ay, id); run(1000 / 60); pe(act, 'pointerup', ax, ay, id); run(1000 / 60); };
  s.player.body.reset(186, 256); s.facing = 'left'; run(50);
  tap(10); R.dialogueOpened = s.talking && g.scene.isActive('Dialogue');
  run(100); tap(11); R.skipToPageEnd = [D.page, D.pageComplete()];
  tap(12); R.turnedPage = D.page;
  const lx = s.player.x, ly = s.player.y; pe(dpad, 'pointerdown', cx + d.width * 0.4, cy, 13); run(400);
  R.dpadLockedWhileOpen = [s.player.x - lx, s.player.y - ly, s.controls.direction()]; pe(window, 'pointerup', cx + d.width * 0.4, cy, 13); run(50);
  tap(14); tap(15); R.dialogueClosed = !s.talking && !g.scene.isActive('Dialogue');
  run(200); R.notReopened = !s.talking;
  // Warp with the D-pad held: test-map street exit -> Roosevelt Avenue. Tap Action mid-fade.
  s.player.body.reset(420, 96); run(50);
  pe(dpad, 'pointerdown', cx + d.width * 0.4, cy, 20); let n = 0, tapped = false, fadeDirs = new Set();
  while (!(s.info.id === 'roosevelt-ave' && !s.warping) && n++ < 240) {
    run(1000 / 60);
    if (s.warping) fadeDirs.add(s.controls.direction());
    if (s.warping && !tapped) { tapped = true; pe(act, 'pointerdown', ax, ay, 21); pe(act, 'pointerup', ax, ay, 21); }
  }
  const arrive = [s.player.x, s.player.y]; run(500);
  R.warpWithDpadHeld = { arrived: [s.info.id, ...arrive, s.facing], frames: n, dirsDuringFade: [...fadeDirs], movedWhileStillHeld: [s.player.x - arrive[0], s.player.y - arrive[1]], dpadStillHeld: dpad.dataset.dir ?? null, emoteFromFadeTap: s.emote.visible };
  pe(window, 'pointerup', cx + d.width * 0.4, cy, 20); run(50);
  pe(dpad, 'pointerdown', cx + d.width * 0.4, cy, 22); run(200); pe(window, 'pointerup', cx + d.width * 0.4, cy, 22); run(50);
  R.warpWithDpadHeld.freshPressMovedPx = s.player.x - arrive[0];

  // Order ticket vs the touch controls: every order and status, at the top and at the bottom.
  // Rects in CSS px; the controls grow by 3px for their outline (as above). PASS/FAIL per viewport.
  const cr = g.canvas.getBoundingClientRect(); const k = cr.width / 256;
  const grow = (r, n) => [r.left - n, r.top - n, r.right + n, r.bottom + n];
  const ctl = { dpad: grow(d, 3), action: grow(a, 3) };
  const inter = (p, q) => p[0] < q[2] && p[2] > q[0] && p[1] < q[3] && p[3] > q[1];
  const tb = s.ticketBox; const ticketRects = [];
  for (const order of s.state.orders) for (const status of ['assigned', 'picked-up']) {
    s.state.active = { order, status }; s.refreshTicket();
    for (const y of [24, 224 - 4 - tb.height]) ticketRects.push([order.id, status, y, [cr.left + tb.x * k, cr.top + y * k, cr.left + (tb.x + tb.width) * k, cr.top + (y + tb.height) * k]]);
  }
  s.state.reset(); s.refreshTicket();
  const hitsCtl = ticketRects.filter(([, , , r]) => inter(r, ctl.dpad) || inter(r, ctl.action)).map(([id, st, y]) => `${id}/${st}/y=${y}`);
  const outside = ticketRects.filter(([, , , r]) => r[0] < cr.left - 0.5 || r[1] < cr.top - 0.5 || r[2] > cr.right + 0.5 || r[3] > cr.bottom + 0.5).length;
  R.ticketVsControls = { checked: ticketRects.length, widestGamePx: Math.max(...ticketRects.map(([, , , r]) => Math.round((r[2] - r[0]) / k))), overlapping: hitsCtl, outsideCanvas: outside, result: hitsCtl.length === 0 && outside === 0 ? 'PASS' : 'FAIL' };

  // One order, touch only: Dispatcher (Action) -> D-pad along pathfound routes, through warps -> pick up -> deliver.
  const MAPS = await import('/src/systems/maps.ts');
  const grid = (mapId) => {
    const info = MAPS.getMap(mapId); const dd = info.data; const ts = dd.tilesets.find((t) => t.name === 'tiles');
    const solid = new Set((ts.tiles ?? []).filter((t) => t.properties?.some((p) => p.name === 'collides' && p.value === true)).map((t) => t.id + ts.firstgid));
    const obs = dd.layers.find((l) => l.name === 'obstacles').data; const npcTiles = new Set((dd.layers.find((l) => l.name === 'npcs')?.objects ?? []).map((o) => `${Math.floor(o.x / 16)},${Math.floor((o.y - 1) / 16)}`));
    const inside = (r, tx, ty) => tx * 16 + 8 >= r.x && tx * 16 + 8 < r.x + r.width && ty * 16 + 8 >= r.y && ty * 16 + 8 < r.y + r.height;
    return { info, W: dd.width, H: dd.height, inside, warpAt: (tx, ty) => info.warps.find((w) => inside(w, tx, ty)), open: (tx, ty) => tx >= 0 && ty >= 0 && tx < dd.width && ty < dd.height && !solid.has(obs[ty * dd.width + tx]) && !npcTiles.has(`${tx},${ty}`) };
  };
  const tileAt = (x, y) => [Math.floor(x / 16), Math.floor((y - 1) / 16)];
  const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]]; const DIR = { '1,0': 'right', '-1,0': 'left', '0,1': 'down', '0,-1': 'up' };
  const bfs = (G, start, isGoal) => {
    const key = (t) => t[1] * G.W + t[0]; const prev = new Map([[key(start), null]]); const q = [start];
    while (q.length) {
      const cur = q.shift();
      if (isGoal(cur)) { const path = [cur]; let k2 = prev.get(key(cur)); while (k2 !== null) { path.unshift([k2 % G.W, Math.floor(k2 / G.W)]); k2 = prev.get(k2); } return path; }
      if (G.warpAt(...cur) && cur !== start) continue;
      for (const [dx, dy] of STEPS) { const n = [cur[0] + dx, cur[1] + dy]; if (G.open(...n) && !prev.has(key(n))) { prev.set(key(n), key(cur)); q.push(n); } }
    }
    return null;
  };
  // D-pad held exactly 16 frames per tile, one straight run per press (1 px a frame).
  let pid = 200; const off = { right: [0.4, 0], left: [-0.4, 0], up: [0, -0.4], down: [0, 0.4] };
  const dpadWalk = (path) => {
    for (let i = 0; i < path.length - 1 && !s.warping;) {
      const step = [path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]]; let j = i + 1;
      while (j < path.length - 1 && path[j + 1][0] - path[j][0] === step[0] && path[j + 1][1] - path[j][1] === step[1]) j++;
      const o = off[DIR[step.join(',')]]; pe(dpad, 'pointerdown', cx + d.width * o[0], cy + d.height * o[1], ++pid);
      run((j - i) * 16 * 1000 / 60); pe(window, 'pointerup', cx, cy, pid); i = j;
    }
    for (let n = 0; n < 120 && s.warping; n++) run(1000 / 60);
    run(1000 / 60);
  };
  const route = (from, to) => { const prev = new Map([[from, null]]); const q = [from]; while (q.length) { const m = q.shift(); for (const w of MAPS.getMap(m).warps) if (!prev.has(w.targetMap)) { prev.set(w.targetMap, { m, w }); q.push(w.targetMap); } } const hops = []; for (let t = to; prev.get(t); t = prev.get(t).m) hops.unshift(prev.get(t).w); return hops; };
  // Walks to the open tile in front of a delivery point (or NPC tile) on any map, then faces it with a 1-frame D-pad tap.
  // Facing a wall or NPC with the D-pad nudges the player up to 4 px toward it; walk back to the tile
  // centre (1 px a frame) so the next route starts exactly on a tile.
  const recenter = () => {
    const [tx0, ty0] = tileAt(s.player.x, s.player.y); const ddx = tx0 * 16 + 8 - s.player.x, ddy = ty0 * 16 + 12 - s.player.y;
    for (const [n, dir] of [[ddx, ddx > 0 ? 'right' : 'left'], [ddy, ddy > 0 ? 'down' : 'up']]) {
      if (!n) continue; const o = off[dir]; pe(dpad, 'pointerdown', cx + d.width * o[0], cy + d.height * o[1], ++pid); run(Math.abs(n) * 1000 / 60); pe(window, 'pointerup', cx, cy, pid); run(1000 / 60);
    }
  };
  const goFace = (mapId, [tx, ty]) => {
    recenter();
    const maps = [];
    for (let hop = 0; s.info.id !== mapId && hop < 12; hop++) { const G = grid(s.info.id); const w = route(s.info.id, mapId)[0]; dpadWalk(bfs(G, tileAt(s.player.x, s.player.y), (t) => G.inside(w, ...t))); maps.push(s.info.id); }
    const G = grid(mapId); let face = null;
    const path = bfs(G, tileAt(s.player.x, s.player.y), (t) => { const f = STEPS.find(([dx, dy]) => t[0] + dx === tx && t[1] + dy === ty); if (f && !G.warpAt(...t)) face = f; return !!f && !G.warpAt(...t); });
    dpadWalk(path);
    // Face it: hold the D-pad toward it until flush (6 frames covers the 4 px gap).
    { const o = off[DIR[face.join(',')]]; pe(dpad, 'pointerdown', cx + d.width * o[0], cy + d.height * o[1], ++pid); run(6 * 1000 / 60); pe(window, 'pointerup', cx, cy, pid); run(50); }
    return { maps, facing: s.facing, wanted: DIR[face.join(',')], at: tileAt(s.player.x, s.player.y) };
  };
  const tapThrough = (id0) => { for (let i = 0; i < 20; i++) { tap(id0 + i); if (!s.talking) return i + 1; } return -1; };
  const tk = () => (s.ticketText.visible ? s.ticketText.text.replace(/\n/g, ' / ') : null);
  const pointTile = (stop) => { const p = MAPS.getMap(stop.map).deliveryPoints.find((q) => q.pointId === stop.pointId); return [p.x / 16, p.y / 16]; };
  const order = {}; s.state.reset(); s.scene.restart({}); run(100);
  const o1 = s.state.orders[0];
  const disp = s.npcs.find((n) => n.spawn.role === 'dispatcher');
  order.toDispatcher = goFace(s.info.id, tileAt(disp.spawn.x, disp.spawn.y));
  order.dispatcherTaps = tapThrough(30); order.assigned = [s.state.active?.order.id, s.state.active?.status, tk()];
  order.toPickup = goFace(o1.pickup.map, pointTile(o1.pickup));
  order.arrived1 = [s.info.id, tk()];
  order.pickupTaps = tapThrough(70); order.pickedUp = [s.state.active?.status, tk()];
  order.toDropoff = goFace(o1.dropoff.map, pointTile(o1.dropoff));
  order.arrived2 = [s.info.id, tk()];
  order.deliverTaps = tapThrough(100);
  order.done = [s.state.active, s.state.completed, s.state.rewardTotal, tk()];
  const faced = [order.toDispatcher, order.toPickup, order.toDropoff].every((f) => f.facing === f.wanted);
  order.result = faced && order.assigned[0] === 'order-1' && order.arrived1[0] === o1.pickup.map && order.arrived1[1] === order.assigned[2] && order.pickedUp[0] === 'picked-up' && order.arrived2[0] === o1.dropoff.map && order.arrived2[1] === order.pickedUp[1] && order.done[0] === null && order.done[2] === 10 && order.done[3] === null ? 'PASS' : 'FAIL';
  R.orderByTouch = order;
} catch (e) { R.ERROR = String(e && e.stack || e); } finally {
  s.state.reset(); s.scene.restart({}); run(100); g.loop.wake();
}
R;

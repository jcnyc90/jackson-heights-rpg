// Touch-control check for mobile emulation (run with a touch viewport, e.g. 375x812 or 667x375).
// Session 3 adds the Action button driving dialogue (open, skip, turn page, close, direction locked).
// Session 4 adds a warp taken with the direction held (and an Action tap during the fade).
// Session 5 adds the order ticket's placement against the controls (every order, both statuses,
// both positions) and one delivery order completed with touch input only.
// Session 6c: the stick, dialogue and warp checks run on test-map (restarted first).
// Session 6d: the D-pad became a round 8-way thumbstick; the minimap's placement is checked against the
// controls and the ticket; the touch-only order walks the one world map along 8-way pathfound routes,
// steering the stick closed-loop (each frame it points the stick toward the next waypoint).
// Session 6e: the radar (top-left) replaces the minimap and is checked the same way; the world map's
// collision comes from its decoded collision layer (external map, drawn in chunks).
// Deterministic frame stepping like regression-suite.js. Returns a results object.
const g = window.game; const s = g.scene.getScene('Map');
const FRAME = 1000 / 60; let T = performance.now();
g.loop.sleep();
const run = (ms) => { const n = Math.round(ms / FRAME); for (let i = 0; i < n; i++) { T += FRAME; g.step(T, FRAME); } };
const box = (el) => { const b = el.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round); };
const stick = document.getElementById('stick'); const act = document.getElementById('action-btn');
const pe = (target, type, x, y, id) => target.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true }));
const R = { viewport: [innerWidth, innerHeight], touchClass: document.documentElement.classList.contains('touch') };
try {
  s.scene.restart({ mapId: 'test-map', spawnId: 'start' }); run(100);
  R.canvas = box(g.canvas); R.stick = box(stick); R.action = box(act);
  const c = g.canvas.getBoundingClientRect(), d = stick.getBoundingClientRect(), a = act.getBoundingClientRect();
  R.stickOverlapsGamePx = Math.max(0, Math.round(Math.min(d.right + 3, c.right) - Math.max(d.left - 3, c.left)) * (d.bottom > c.top && d.top < c.bottom ? 1 : 0));
  R.actionOverlapsGamePx = Math.max(0, Math.round(Math.min(a.right + 3, c.right) - Math.max(a.left - 3, c.left)) * (a.bottom > c.top && a.top < c.bottom ? 1 : 0));
  const cx = d.left + d.width / 2, cy = d.top + d.height / 2, rad = d.width / 2;
  R.hitTestStick = document.elementFromPoint(cx, cy)?.id;
  R.hitTestAction = document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2)?.id;
  s.player.body.reset(232, 268); run(100);
  const x0 = s.player.x, y0 = s.player.y;
  pe(stick, 'pointerdown', cx + rad * 0.8, cy, 1); run(500);
  R.right = { dir: s.controls.direction(), dataDir: stick.dataset.dir, movedRightPx: Math.round(s.player.x - x0) };
  pe(window, 'pointermove', cx + rad * 0.6, cy - rad * 0.6, 1); run(300);
  R.slideToUpRight = { dir: s.controls.direction(), movedUpPx: Math.round(y0 - s.player.y) };
  pe(act, 'pointerdown', a.left + 5, a.top + 5, 2); run(50);
  R.actionWhileHeld = { emote: s.emote.visible, pressedClass: act.classList.contains('pressed'), dir: s.controls.direction() };
  pe(act, 'pointerup', a.left + 5, a.top + 5, 2); R.pressedClassAfterUp = act.classList.contains('pressed');
  pe(window, 'pointermove', cx + 2, cy + 2, 1); run(50); R.deadzone = s.controls.direction();
  pe(window, 'pointermove', cx + 400, cy, 1); pe(window, 'pointerup', cx + 400, cy, 1); run(50);
  R.releaseOutside = [s.controls.direction(), stick.dataset.dir ?? null, document.getElementById('stick-knob').style.transform];
  pe(stick, 'pointerdown', cx - rad * 0.8, cy, 3); run(50); R.leftHeld = s.controls.direction();
  window.dispatchEvent(new Event('blur')); run(50); R.afterBlur = s.controls.direction(); window.dispatchEvent(new Event('focus'));
  pe(window, 'pointerup', cx - rad * 0.8, cy, 3); run(600);
  // Dialogue via the Action button: face Neighbor A from 8px to its right.
  const D = g.scene.getScene('Dialogue'); const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  const tap = (id) => { pe(act, 'pointerdown', ax, ay, id); run(1000 / 60); pe(act, 'pointerup', ax, ay, id); run(1000 / 60); };
  s.player.body.reset(186, 256); s.facing = 'left'; run(50);
  tap(10); R.dialogueOpened = s.talking && g.scene.isActive('Dialogue');
  run(100); tap(11); R.skipToPageEnd = [D.page, D.pageComplete()];
  tap(12); R.turnedPage = D.page;
  const lx = s.player.x, ly = s.player.y; pe(stick, 'pointerdown', cx + rad * 0.8, cy, 13); run(400);
  R.stickLockedWhileOpen = [s.player.x - lx, s.player.y - ly, s.controls.direction()]; pe(window, 'pointerup', cx + rad * 0.8, cy, 13); run(50);
  tap(14); tap(15); R.dialogueClosed = !s.talking && !g.scene.isActive('Dialogue');
  run(200); R.notReopened = !s.talking;
  // Warp with the stick held: test-map street exit -> the world map's start. Tap Action mid-fade.
  s.player.body.reset(420, 96); run(50);
  const worldId = s.state.orders[0].pickup.map;
  pe(stick, 'pointerdown', cx + rad * 0.8, cy, 20); let n = 0, tapped = false, fadeDirs = new Set();
  while (!(s.info.id === worldId && !s.warping) && n++ < 240) {
    run(1000 / 60);
    if (s.warping) fadeDirs.add(s.controls.direction());
    if (s.warping && !tapped) { tapped = true; pe(act, 'pointerdown', ax, ay, 21); pe(act, 'pointerup', ax, ay, 21); }
  }
  const arrive = [s.player.x, s.player.y]; run(500);
  R.warpWithStickHeld = { arrived: [s.info.id, ...arrive, s.facing], frames: n, dirsDuringFade: [...fadeDirs], movedWhileStillHeld: [s.player.x - arrive[0], s.player.y - arrive[1]], stickStillHeld: stick.dataset.dir ?? null, emoteFromFadeTap: s.emote.visible };
  pe(window, 'pointerup', cx + rad * 0.8, cy, 20); run(50);
  pe(stick, 'pointerdown', cx + rad * 0.8, cy, 22); run(200); pe(window, 'pointerup', cx + rad * 0.8, cy, 22); run(50);
  R.warpWithStickHeld.freshPressMovedPx = s.player.x - arrive[0];

  // Order ticket and radar vs the touch controls: every order and status, the ticket at the bottom and
  // the top, and the radar (world map, top left). Rects in CSS px; the controls grow by 3px for their
  // outline. The radar must not overlap the ticket either. PASS/FAIL per viewport.
  const cr = g.canvas.getBoundingClientRect(); const k = cr.width / 256;
  const grow = (r, m) => [r.left - m, r.top - m, r.right + m, r.bottom + m];
  const ctl = { stick: grow(d, 3), action: grow(a, 3) };
  const inter = (p, q) => p[0] < q[2] && p[2] > q[0] && p[1] < q[3] && p[3] > q[1];
  const css = (x, y, w, h) => [cr.left + x * k, cr.top + y * k, cr.left + (x + w) * k, cr.top + (y + h) * k];
  const tb = s.ticketBox; const ticketRects = [];
  for (const order of s.state.orders) for (const status of ['assigned', 'picked-up']) {
    s.state.active = { order, status }; s.refreshTicket();
    for (const y of [224 - 4 - tb.height, 24]) ticketRects.push([order.id, status, y, css(tb.x, y, tb.width, tb.height), [tb.x, y, tb.width, tb.height]]);
  }
  s.state.reset(); s.refreshTicket();
  const hitsCtl = ticketRects.filter(([, , , r]) => inter(r, ctl.stick) || inter(r, ctl.action)).map(([id, st, y]) => `${id}/${st}/y=${y}`);
  const outside = ticketRects.filter(([, , , r]) => r[0] < cr.left - 0.5 || r[1] < cr.top - 0.5 || r[2] > cr.right + 0.5 || r[3] > cr.bottom + 0.5).length;
  R.ticketVsControls = { checked: ticketRects.length, widestGamePx: Math.max(...ticketRects.map(([, , , r]) => Math.round((r[2] - r[0]) / k))), overlapping: hitsCtl, outsideCanvas: outside, result: hitsCtl.length === 0 && outside === 0 ? 'PASS' : 'FAIL' };
  const mi = s.radar.image; const mmGame = [mi.x, mi.y, mi.width, mi.height]; const mmCss = css(...mmGame);
  const gameInter = (p, q) => p[0] < q[0] + q[2] && p[0] + p[2] > q[0] && p[1] < q[1] + q[3] && p[1] + p[3] > q[1];
  const mmTicket = ticketRects.filter(([, , y, , gr]) => y !== 24 && gameInter(gr, mmGame)).map(([id, st]) => `${id}/${st}`);
  R.radarVsControls = { gameRect: mmGame, cssRect: mmCss.map(Math.round), hitsStick: inter(mmCss, ctl.stick), hitsAction: inter(mmCss, ctl.action), outsideCanvas: mmCss[0] < cr.left - 0.5 || mmCss[1] < cr.top - 0.5 || mmCss[2] > cr.right + 0.5 || mmCss[3] > cr.bottom + 0.5, hitsTicket: mmTicket };
  R.radarVsControls.result = !R.radarVsControls.hitsStick && !R.radarVsControls.hitsAction && !R.radarVsControls.outsideCanvas && mmTicket.length === 0 ? 'PASS' : 'FAIL';

  // One order, touch only: Dispatcher (Action) -> thumbstick along pathfound 8-way routes -> pick up -> deliver.
  const MAPS = await import('/src/systems/maps.ts');
  const info = MAPS.getMap(worldId); const dd = info.data; const npcTiles = new Set((dd.layers.find((l) => l.name === 'npcs')?.objects ?? []).map((o) => `${Math.floor(o.x / 16)},${Math.floor((o.y - 1) / 16)}`));
  const wk = info.walk; const inWalk = (tx, ty) => tx * 16 >= wk.x && ty * 16 >= wk.y && tx * 16 < wk.x + wk.width && ty * 16 < wk.y + wk.height;
  const open = (tx, ty) => tx >= 0 && ty >= 0 && tx < dd.width && ty < dd.height && inWalk(tx, ty) && !info.world.solid[ty * dd.width + tx] && !npcTiles.has(`${tx},${ty}`);
  const tileAt = (x, y) => [Math.floor(x / 16), Math.floor((y - 1) / 16)];
  const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]]; const STEPS8 = [...STEPS, [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const DIR = { '1,0': 'right', '-1,0': 'left', '0,1': 'down', '0,-1': 'up' };
  const bfs = (start, isGoal) => {
    const key = (t) => t[1] * dd.width + t[0]; const prev = new Map([[key(start), null]]); const q = [start];
    while (q.length) {
      const cur = q.shift();
      if (isGoal(cur)) { const path = [cur]; let k2 = prev.get(key(cur)); while (k2 !== null) { path.unshift([k2 % dd.width, Math.floor(k2 / dd.width)]); k2 = prev.get(k2); } return path; }
      for (const [dx, dy] of STEPS8) {
        const nn = [cur[0] + dx, cur[1] + dy];
        if (!open(...nn) || prev.has(key(nn)) || (dx && dy && !(open(cur[0] + dx, cur[1]) && open(cur[0], cur[1] + dy)))) continue;
        prev.set(key(nn), key(cur)); q.push(nn);
      }
    }
    return null;
  };
  // Closed-loop steering: the stick stays down and slides to the sector toward the target, judging by where
  // the planned step lands (input acts on the next physics step); released on arrival (within 1 px).
  let pid = 200; let down = false; let walked = 0;
  const point = (sx, sy) => {
    if (!sx && !sy) { if (down) { pe(window, 'pointerup', cx, cy, pid); down = false; } return; }
    const px = cx + sx * rad * 0.6, py = cy + sy * rad * 0.6;
    if (!down) { pe(stick, 'pointerdown', px, py, ++pid); down = true; } else pe(window, 'pointermove', px, py, pid);
  };
  const goTo = ([tx, ty]) => {
    const X = tx * 16 + 8, Y = ty * 16 + 12; let stuck = 0, last = '';
    for (let i = 0; i < 4000; i++) {
      const v = s.player.body.velocity; const dx = X - (s.player.x + v.x / 60), dy = Y - (s.player.y + v.y / 60);
      const sx = dx >= 2 ? 1 : dx <= -2 ? -1 : 0, sy = dy >= 2 ? 1 : dy <= -2 ? -1 : 0;
      point(sx, sy); run(1000 / 60); walked++;
      if (!sx && !sy && Math.abs(X - s.player.x) <= 1 && Math.abs(Y - s.player.y) <= 1) return true;
      const here = `${s.player.x},${s.player.y}`; stuck = here === last ? stuck + 1 : 0; last = here; if (stuck > 30) break;
    }
    point(0, 0); run(1000 / 60); return false;
  };
  const walk = (path) => { for (let i = 0; i < path.length - 1;) { const st = [path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]]; let j = i + 1; while (j < path.length - 1 && path[j + 1][0] - path[j][0] === st[0] && path[j + 1][1] - path[j][1] === st[1]) j++; if (!goTo(path[j])) return false; i = j; } point(0, 0); run(1000 / 60); return true; };
  // Walks to an open tile in front of a delivery point (or NPC tile), then faces it with a short push of the stick.
  const goFace = ([tx, ty]) => {
    let face = null;
    const path = bfs(tileAt(s.player.x, s.player.y), (t) => { const f = STEPS.find(([dx, dy]) => t[0] + dx === tx && t[1] + dy === ty); if (f) face = f; return !!f; });
    const ok = walk(path);
    point(...face); run(3 * 1000 / 60); point(0, 0); run(50);
    return { ok, tiles: path.length, facing: s.facing, wanted: DIR[face.join(',')] };
  };
  const tapThrough = (id0) => { for (let i = 0; i < 20; i++) { tap(id0 + i); if (!s.talking) return i + 1; } return -1; };
  const tk = () => (s.ticketText.visible ? s.ticketText.text.replace(/\n/g, ' / ') : null);
  const pointTile = (stop) => { const p = info.deliveryPoints.find((q) => q.pointId === stop.pointId); return [p.x / 16, p.y / 16]; };
  const order = {}; s.state.reset(); s.scene.restart({}); run(100);
  const o1 = s.state.orders[0];
  const disp = s.npcs.find((nn) => nn.spawn.role === 'dispatcher');
  order.toDispatcher = goFace(tileAt(disp.spawn.x, disp.spawn.y));
  order.dispatcherTaps = tapThrough(30); order.assigned = [s.state.active?.order.id, s.state.active?.status, tk()];
  order.toPickup = goFace(pointTile(o1.pickup));
  order.pickupTaps = tapThrough(70); order.pickedUp = [s.state.active?.status, tk()];
  order.toDropoff = goFace(pointTile(o1.dropoff));
  order.deliverTaps = tapThrough(100);
  order.done = [s.state.active, s.state.completed, s.state.rewardTotal, tk()];
  order.framesSteered = walked;
  const faced = [order.toDispatcher, order.toPickup, order.toDropoff].every((f) => f.ok && f.facing === f.wanted);
  order.result = faced && order.assigned[0] === 'order-1' && /^Order #1: not picked up \/ Pick up: .+ & .+$/.test(order.assigned[2]) && order.pickedUp[0] === 'picked-up' && /\/ Deliver: .+ & .+$/.test(order.pickedUp[1]) && order.done[0] === null && order.done[2] === 10 && order.done[3] === null ? 'PASS' : 'FAIL';
  R.orderByTouch = order;
} catch (e) { R.ERROR = String(e && e.stack || e); } finally {
  s.state.reset(); s.scene.restart({}); run(100); g.loop.wake();
}
R;

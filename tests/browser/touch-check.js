// Touch-control check for mobile emulation (run with a touch viewport, e.g. 375x812 or 667x375).
// Session 3 adds the Action button driving dialogue (open, skip, turn page, close, D-pad locked).
// Session 4 adds a warp taken with the D-pad held (and an Action tap during the fade).
// Session 5 adds the order ticket's placement against the controls (every order, both statuses,
// top and bottom positions) and one delivery order completed with touch input only.
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

  // One order, touch only: Dispatcher (Action) -> D-pad into the warp -> pick up -> D-pad warp -> deliver.
  const tapThrough = (id0) => { for (let i = 0; i < 20; i++) { tap(id0 + i); if (!s.talking) return i + 1; } return -1; };
  const dpadHold = (dir, until, id, max = 240) => { const off = { right: [0.4, 0], left: [-0.4, 0], up: [0, -0.4], down: [0, 0.4] }[dir]; pe(dpad, 'pointerdown', cx + d.width * off[0], cy + d.height * off[1], id); let i = 0; while (!until() && i++ < max) run(1000 / 60); pe(window, 'pointerup', cx, cy, id); run(50); return i; };
  const tk = () => (s.ticketText.visible ? s.ticketText.text.replace(/\n/g, ' / ') : null);
  const order = {}; s.state.reset(); s.scene.restart({}); run(100);
  const disp = s.npcs.find((n) => n.spawn.role === 'dispatcher'); s.player.body.reset(disp.spawn.x - 16, disp.spawn.y); s.facing = 'right'; run(50);
  order.dispatcherTaps = tapThrough(30); order.assigned = [s.state.active?.order.id, s.state.active?.status, tk()];
  s.player.body.reset(420, 96); run(50); dpadHold('right', () => s.info.id === 'roosevelt-ave' && !s.warping, 60);
  order.arrived1 = [s.info.id, tk()];
  s.player.body.reset(104, 48); run(50); dpadHold('up', () => false, 61, 20); order.pickupTaps = tapThrough(70); order.pickedUp = [s.state.active?.status, tk()];
  s.player.body.reset(240, 48); run(50); dpadHold('up', () => s.info.id === 'diversity-plaza-74th' && !s.warping, 90);
  order.arrived2 = [s.info.id, tk()];
  s.player.body.reset(328, 296); run(50); dpadHold('down', () => false, 91, 20); order.deliverTaps = tapThrough(100);
  order.done = [s.state.active, s.state.completed, s.state.rewardTotal, tk()];
  order.result = order.assigned[0] === 'order-1' && order.arrived1[0] === 'roosevelt-ave' && order.arrived1[1] === order.assigned[2] && order.pickedUp[0] === 'picked-up' && order.arrived2[0] === 'diversity-plaza-74th' && order.arrived2[1] === order.pickedUp[1] && order.done[0] === null && order.done[2] === 10 && order.done[3] === null ? 'PASS' : 'FAIL';
  R.orderByTouch = order;
} catch (e) { R.ERROR = String(e && e.stack || e); } finally {
  s.state.reset();
  if (s.info.id !== 'test-map' || s.warping) { s.scene.restart({}); run(100); }
  s.facing = 'down'; s.player.body.reset(232, 268); run(50); g.loop.wake();
}
R;

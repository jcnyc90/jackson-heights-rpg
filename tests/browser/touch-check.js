// Touch-control check for mobile emulation (run with a touch viewport, e.g. 375x812 or 667x375).
// Session 3 adds the Action button driving dialogue (open, skip, turn page, close, D-pad locked).
// Session 4 adds a warp taken with the D-pad held (and an Action tap during the fade).
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
} catch (e) { R.ERROR = String(e && e.stack || e); } finally {
  if (s.info.id !== 'test-map' || s.warping) { s.scene.restart({}); run(100); }
  s.facing = 'down'; s.player.body.reset(232, 268); run(50); g.loop.wake();
}
R;

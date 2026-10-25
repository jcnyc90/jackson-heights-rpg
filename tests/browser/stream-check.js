// Streaming at speed (session 6f). Moves edge to edge across the world map at every speed (walking and riding,
// x1, x2, x4, x8), east-west along 37th Ave and north-south along 80th St, and counts per speed:
// - frames where part of the screen shows a 32-tile bin that isn't built (must be 0),
// - bins built only on the frame they came within a few tiles of the view (built "urgently": a hitch risk),
// - refills of the ground and collision window;
// and measures the per-frame work (game.step: update + render) at x1 walking and x8 riding: median, p95, worst.
// Needs the riding and speedButtons flags (or ?features=riding,speedButtons in dev). Deterministic 60 fps stepping
// like regression-suite.js; see tests/browser/README.md. Returns a results object.
const g = window.game; const s = g.scene.getScene('Map');
const FRAME = 1000 / 60; let T = performance.now();
g.loop.sleep();
const run = (ms) => { const n = Math.round(ms / FRAME); for (let i = 0; i < n; i++) { T += FRAME; g.step(T, FRAME); } };
const KC = { ArrowRight: 39, ArrowDown: 40 };
const ev = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { key: code, code, keyCode: KC[code], which: KC[code], bubbles: true }));
const R = {};
try {
  s.state.reset(); s.scene.restart({}); run(100);
  const wi = s.info; const WD = wi.world;
  const c = wi.corners.find((r) => r.street === 'street.st-80' && r.cross === 'street.ave-37');
  const [C80, R37] = [Math.floor((c.x + c.width / 2) / 16), Math.floor((c.y + c.height / 2) / 16)];
  const wx0 = wi.walk.x / 16, wy0 = wi.walk.y / 16, wy1 = (wi.walk.y + wi.walk.height) / 16;
  const open = (tx, ty) => !WD.solid[ty * WD.width + tx];
  const nsCol = [C80 - 3, C80 - 2, C80 - 1, C80, C80 + 1, C80 + 2].find((x) => { for (let y = wy0 + 1; y < wy1 - 1; y++) if (!open(x, y)) return false; return true; });
  const routes = [['ArrowRight', [wx0 + 1, R37 - 3]], ['ArrowDown', [nsCol, wy0 + 1]]];
  const stats = (a) => { const b = [...a].sort((x, y) => x - y); const q = (p) => b[Math.min(b.length - 1, Math.floor(p * b.length))]; return { frames: b.length, median: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), worst: +b.at(-1).toFixed(2) }; };
  const perSpeed = {}; const work = { walkx1: [], ridex8: [] };
  for (const riding of [false, true]) for (const level of [0, 1, 2, 3]) {
    const name = `${riding ? 'ride' : 'walk'}x${2 ** level}`;
    const r = { frames: 0, unbuiltVisibleFrames: 0, urgentBuilds: 0, refills: 0, px: 0 };
    s.state.reset(); s.scene.restart({}); run(100);
    s.state.riding = riding; s.applyRider(); s.setSpeedLevel(level); run(FRAME);
    for (const [key, [tx, ty]] of routes) {
      s.player.body.reset(tx * 16 + 8, ty * 16 + 12); run(500); // settle: the bins around the new spot are built
      const u0 = s.world.urgentBuilds, f0 = s.world.refills, p0 = [s.player.x, s.player.y];
      ev('keydown', key); let still = 0, last = '';
      for (let n = 0; n < 8000 && still < 10; n++) {
        const t0 = performance.now(); T += FRAME; g.step(T, FRAME); const dt = performance.now() - t0;
        if (name in work && still === 0) work[name].push(dt);
        r.frames++;
        const cam = s.cameras.main;
        if (s.world.unbuiltIn(cam.scrollX, cam.scrollY, cam.width, cam.height) > 0) r.unbuiltVisibleFrames++;
        const p = `${s.player.x},${s.player.y}`; still = p === last ? still + 1 : 0; last = p;
      }
      ev('keyup', key); run(50);
      r.urgentBuilds += s.world.urgentBuilds - u0; r.refills += s.world.refills - f0; r.px += Math.abs(s.player.x - p0[0]) + Math.abs(s.player.y - p0[1]);
    }
    r.speed = s.speed();
    perSpeed[name] = r;
  }
  R.perSpeed = perSpeed;
  R.unbuiltVisibleFramesTotal = Object.values(perSpeed).reduce((a, r) => a + r.unbuiltVisibleFrames, 0);
  R.workMs = { walkx1: stats(work.walkx1), ridex8: stats(work.ridex8) };
  R.liveSprites = s.world.liveObjects(); R.paintedTextures = s.world.paintedTextures();
  R.summary = R.unbuiltVisibleFramesTotal === 0 ? 'PASS' : 'FAIL';
} catch (e) {
  R.ERROR = String(e && e.stack || e);
} finally {
  for (const k of ['ArrowRight', 'ArrowDown']) ev('keyup', k);
  s.state?.reset(); s.scene.restart({}); run(100);
  g.loop.wake();
}
R;

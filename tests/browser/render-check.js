// Pixel-art render parity check. Renders fixed scenes (deterministic stepping), reads the
// canvas back, and reports per shot: an FNV-1a hash of the RGBA pixels, and how many pixels
// are NOT exact palette colours (any blending/smoothing/sub-pixel sampling shows up there).
// Session 3: hides NPCs for the session-2 parity shots, then adds an NPC + text-window shot.
// Async: returns a Promise of the results object.
const PALETTE = ["#2a1f3d","#a6e3a1","#7fc98a","#f6dccb","#dcb9a8","#9a98c2","#86849f","#fff1a6","#ef9f95","#cf7f7a","#b5e3f5","#7dd3a0","#58b07f","#b07c62","#c7a6e6","#a585c6","#ff9fc6","#ffe28a","#94d8f5","#e0f6ff","#fffaf0","#c98d63","#3b2a2a","#ff8f7a","#6fcfc4","#6a76b8","#ffd46e","#1b1528","#f0c39a","#8a5a3c"];
const g = window.game; const s = g.scene.getScene('TestMap');
const FRAME = 1000 / 60; let T = performance.now();
const pal = new Set(PALETTE.map((h) => parseInt(h.slice(1), 16)));
g.loop.sleep();
const settle = (n = 6) => { for (let i = 0; i < n; i++) { T += FRAME; g.step(T, FRAME); } };
const grab = () => g.canvas.toDataURL('image/png'); // same task as the render, so the WebGL buffer is intact
const shots = {};
s.npcs.forEach((n) => n.sprite.setVisible(false));
s.player.body.reset(232, 268); s.player.setFrame(0); settle(); shots['spawn'] = grab();
s.player.body.reset(100.5, 150.25); settle(1); shots['fractional-pos'] = grab();
// Integer neighbours of the fractional shot: v3 floors 100.5 -> 100, v4 rounds -> 101.
s.player.body.reset(100, 150); settle(); shots['int-100-150'] = grab();
s.player.body.reset(101, 150); settle(); shots['int-101-150'] = grab();
s.player.body.reset(24, 40); settle(); shots['corner-top-left'] = grab();
s.player.body.reset(456, 304); settle(); shots['corner-bottom-right'] = grab();
s.player.body.reset(232, 268); settle(); s.emote.setVisible(true); s.emoteHideAt = Infinity; T += FRAME; g.step(T, FRAME); shots['emote'] = grab(); s.emote.setVisible(false); s.emoteHideAt = 0;
s.npcs.forEach((n) => n.sprite.setVisible(true));
s.player.body.reset(186, 256); s.facing = 'left'; settle();
s.scene.launch('Dialogue', { entries: ['Render check: placeholder font, window frame and cursor.'] }); settle(2);
g.scene.getScene('Dialogue').advance(); settle(2); shots['npc-dialogue'] = grab();
s.scene.stop('Dialogue'); s.facing = 'down';
s.player.body.reset(232, 268); settle();
g.loop.wake();
const analyse = (url) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    let h = 0x811c9dc5, off = 0; const offColors = new Map();
    for (let i = 0; i < d.length; i += 4) {
      for (let k = 0; k < 4; k++) { h ^= d[i + k]; h = Math.imul(h, 0x01000193) >>> 0; }
      const rgb = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      if (!pal.has(rgb) || d[i + 3] !== 255) { off++; const key = '#' + rgb.toString(16).padStart(6, '0') + '/' + d[i + 3]; offColors.set(key, (offColors.get(key) || 0) + 1); }
    }
    resolve({ size: `${img.width}x${img.height}`, hash: h.toString(16), offPalettePixels: off, offColorsTop: [...offColors].sort((a, b) => b[1] - a[1]).slice(0, 5) });
  };
  img.src = url;
});
const out = {};
for (const [k, url] of Object.entries(shots)) out[k] = await analyse(url);
out;

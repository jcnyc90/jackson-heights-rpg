// Grid-to-tile layout for the world dataset (DESIGN.md 2.14). Shared by the validator, which
// checks the map's `tiles` against it, and by the map generator (scripts/generate-maps.mjs).
// No dependencies.

/**
 * Tile position of a grid point, as tile-corner coordinates (a street of half-width h along
 * x = X covers tile columns X - h to X + h - 1). x scales linearly; y is piecewise linear
 * between the layout's `rowsY` breakpoints ([gridY, tileY] pairs, both increasing).
 */
export function tileOf(layout, [gx, gy]) {
  const rows = layout.rowsY;
  let y = NaN;
  for (let i = 0; i + 1 < rows.length; i++) {
    const [g0, t0] = rows[i];
    const [g1, t1] = rows[i + 1];
    if (gy >= g0 && gy <= g1) {
      y = t0 + ((gy - g0) / (g1 - g0)) * (t1 - t0);
      break;
    }
  }
  return [Math.round(gx * layout.tileX), Math.round(y)];
}

/** Half-width in tiles of a street's corridor (sidewalks included). */
export function halfWidthOf(layout, streetId) {
  return layout.halfWidth[streetId] ?? layout.halfWidth.default;
}

/**
 * The map's boxes, in tile coordinates of the grid (x = 0 at the first street's centre line):
 * `walk`, every node plus the layout's `edge` on each side (the player can't leave it), and
 * `map`, that plus `viewMargin` (scenery, so the camera never stops scrolling while the player
 * can still move). Each is { x0, y0, width, height }.
 */
export function mapBoxes(layout, nodes) {
  const pts = nodes.map((n) => tileOf(layout, n.grid));
  const xs = pts.map(([x]) => x);
  const ys = pts.map(([, y]) => y);
  const grow = (m) => ({ x0: Math.min(...xs) - m, y0: Math.min(...ys) - m, width: Math.max(...xs) - Math.min(...xs) + 2 * m, height: Math.max(...ys) - Math.min(...ys) + 2 * m });
  return { walk: grow(layout.edge), map: grow(layout.edge + layout.viewMargin) };
}

/**
 * Smallest viewMargin, in tiles, that keeps the camera from ever stopping while the player
 * walks: half the screen (256 x 224 px; 8 x 7 tiles) on every side.
 */
export const MIN_VIEW_MARGIN = 8;

/** Problems with the layout block itself (empty when it's usable). */
export function layoutProblems(layout) {
  const p = [];
  if (layout === null || typeof layout !== 'object') return ['layout: must be an object'];
  const posInt = (v) => Number.isInteger(v) && v > 0;
  if (!posInt(layout.tileX)) p.push('layout.tileX: must be a positive integer');
  if (!posInt(layout.edge)) p.push('layout.edge: must be a positive integer');
  if (!Number.isInteger(layout.viewMargin) || layout.viewMargin < MIN_VIEW_MARGIN) p.push(`layout.viewMargin: must be an integer of at least ${MIN_VIEW_MARGIN} (half the screen)`);
  for (const old of ['margin', 'stubLength']) if (old in layout) p.push(`layout.${old}: retired in schema 4 (one map, no link stubs)`);
  const hw = layout.halfWidth;
  if (hw === null || typeof hw !== 'object' || !posInt(hw.default)) p.push('layout.halfWidth: needs a positive integer "default"');
  else for (const [k, v] of Object.entries(hw)) if (!posInt(v)) p.push(`layout.halfWidth.${k}: must be a positive integer`);
  const rows = layout.rowsY;
  if (!Array.isArray(rows) || rows.length < 2 || !rows.every((r) => Array.isArray(r) && r.length === 2 && r.every(Number.isFinite))) {
    p.push('layout.rowsY: must list at least two [gridY, tileY] pairs');
  } else {
    for (let i = 1; i < rows.length; i++) {
      if (!(rows[i][0] > rows[i - 1][0] && rows[i][1] > rows[i - 1][1])) p.push(`layout.rowsY: pair ${i} must be greater than pair ${i - 1} in both values`);
    }
  }
  return p;
}

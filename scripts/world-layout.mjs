// Grid-to-tile layout for the world dataset (DESIGN.md 2.14). Shared by the validator, which
// checks each map's `tiles` against it, and by the map generator (scripts/generate-maps.mjs).
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
 * A map's tile box: every node its segments touch, plus the margin on each side.
 * Returns { x0, y0, width, height } in tile coordinates (x0, y0 = the map's top-left tile).
 */
export function mapBox(layout, map, segmentsById, nodesById) {
  const xs = [];
  const ys = [];
  for (const sid of map.segments) {
    const s = segmentsById.get(sid);
    for (const nid of [s.from, s.to]) {
      const [x, y] = tileOf(layout, nodesById.get(nid).grid);
      xs.push(x);
      ys.push(y);
    }
  }
  const m = layout.margin;
  const x0 = Math.min(...xs) - m;
  const y0 = Math.min(...ys) - m;
  return { x0, y0, width: Math.max(...xs) + m - x0, height: Math.max(...ys) + m - y0 };
}

/** Problems with the layout block itself (empty when it's usable). */
export function layoutProblems(layout) {
  const p = [];
  if (layout === null || typeof layout !== 'object') return ['layout: must be an object'];
  const posInt = (v) => Number.isInteger(v) && v > 0;
  if (!posInt(layout.tileX)) p.push('layout.tileX: must be a positive integer');
  if (!posInt(layout.margin)) p.push('layout.margin: must be a positive integer');
  if (!posInt(layout.stubLength)) p.push('layout.stubLength: must be a positive integer');
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

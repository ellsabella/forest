// quantise.js — image -> 0..9 index grid.
// Mirrors tools/build_library.py exactly so user uploads and library grids match.
// No p5 dependency; works in the main thread or a Worker.

export const N_BUCKETS = 9;
export const DEFAULTS = { cF: 1.0, mP: 128, bgThreshold: 40 };

/** Port of color-extraction-worker.js. Returns Array<[r,g,b]> row-major, one per cell. */
export function extractGridColors(imageData, cols, rows) {
  const cw = imageData.width / cols, ch = imageData.height / rows;
  const out = new Array(cols * rows);
  const d = imageData.data, W = imageData.width;
  for (let y = 0; y < rows; y++) {
    const y0 = Math.floor(y * ch), y1 = Math.min(Math.floor((y + 1) * ch), imageData.height);
    for (let x = 0; x < cols; x++) {
      const x0 = Math.floor(x * cw), x1 = Math.min(Math.floor((x + 1) * cw), W);
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * W + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      }
      out[y * cols + x] = n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [0, 0, 0];
    }
  }
  return out;
}

/** Same as main.js adjustBrightnessContrast, clamped to 0..255. */
export function adjustBrightnessContrast(v, cF, mP) {
  return Math.max(0, Math.min(255, (v - mP) * cF + mP));
}

/**
 * Cell colours -> Uint8Array of indices 0..9.
 * 0 = background (cell mean too dark), 1..9 = luminance buckets dark -> light.
 */
export function toIndices(gridCellColors, opts = {}) {
  const { cF, mP, bgThreshold } = { ...DEFAULTS, ...opts };
  const out = new Uint8Array(gridCellColors.length);
  for (let i = 0; i < gridCellColors.length; i++) {
    const [r, g, b] = gridCellColors[i];
    if (Math.max(r, g, b) < bgThreshold) { out[i] = 0; continue; }
    const adj = adjustBrightnessContrast((r + g + b) / 3, cF, mP);
    out[i] = Math.min(N_BUCKETS, 1 + Math.floor(adj / 256 * N_BUCKETS));
  }
  return out;
}

/** 3x3 majority filter; ties keep the centre value. */
export function modeFilter(indices, cols, rows) {
  const out = new Uint8Array(indices);
  const counts = new Uint8Array(N_BUCKETS + 1);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    counts.fill(0);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < rows && xx >= 0 && xx < cols) counts[indices[yy * cols + xx]]++;
    }
    const centre = indices[y * cols + x];
    let best = centre, n = counts[centre];
    for (let k = 0; k <= N_BUCKETS; k++) if (counts[k] > n) { best = k; n = counts[k]; }
    out[y * cols + x] = best;
  }
  return out;
}

/** Full pipeline for a user-supplied image: ImageData -> indices (size x size). */
export function imageDataToIndices(imageData, size = 64, opts = {}) {
  const cells = extractGridColors(imageData, size, size);
  let idx = toIndices(cells, opts);
  if (opts.modeFilter) idx = modeFilter(idx, size, size);
  return idx;
}

/** Digit-string <-> Uint8Array (the on-disk / on-chain form). */
export function gridToString(indices) { let s = ""; for (const v of indices) s += v; return s; }
export function stringToGrid(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) - 48;
  return out;
}

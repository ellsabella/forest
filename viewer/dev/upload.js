// Dev harness: turn an uploaded image into a 64×64 index grid, the same way the pool is built.
//   1. crop to a square from the top-left (extra width on the right / height at the bottom is cut off)
//   2. key the white background out: alpha ramps 1 → 0 as min(R,G,B) goes keyLo → keyHi; RGB is
//      composited onto black (what pixelart's key_out does to every generated PNG)
//   3. cell mean colour + cell mean alpha (pfp-library/js/quantise.js = build_library.py)
//   4. luminance buckets 1..9 dark → light; alpha < 128 = background (0), else at least 1, so the
//      near-black pixels of a dark subject are never mistaken for background
//   5. optional 3×3 mode filter
// Nothing here ships on-chain.

import { extractGridColors, toIndices, modeFilter, gridToString } from '../../pixelart/pfp-library/js/quantise.js';

// tone: source contrast before bucketing — 'off' (pool default), 'stretch' (foreground 1st–99th
// luminance percentiles → 0..255), 'equalise' (histogram equalisation: every bucket gets an equal
// share of the foreground). build_library.py --tone mirrors it so the pool can match.
export const UPLOAD_DEFAULTS = { keyLo: 200, keyHi: 245, tone: 'stretch', cF: 1.0, mP: 128, bgThreshold: 40, modeFilter: false };
export const TONE_MODES = ['off', 'stretch', 'equalise'];
// [key, min, max, step, label]
export const UPLOAD_SLIDERS = [
  ['keyLo', 0, 255, 1, 'key from'], ['keyHi', 0, 255, 1, 'key to'],
  ['cF', 0.2, 3, 0.05, 'contrast'], ['mP', 0, 255, 1, 'midpoint'], ['bgThreshold', 0, 128, 1, 'bg thresh'],
];
const MAX_SIDE = 1024;                       // enough for 64 cells; keeps big uploads fast

/** File/Blob → square ImageData (top-left crop, downscaled to ≤ MAX_SIDE). */
export async function loadSquare(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const out = Math.min(s, MAX_SIDE);
  const c = document.createElement('canvas');
  c.width = c.height = out;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, s, s, 0, 0, out, out);   // source rect = top-left square
  bmp.close?.();
  return ctx.getImageData(0, 0, out, out);
}

/** Key white → alpha, composite on black. Returns { rgb: ImageData, alpha: ImageData } (alpha stored as grey). */
export function keyWhite(img, lo, hi) {
  const n = img.width * img.height, d = img.data;
  const rgb = new ImageData(img.width, img.height), al = new ImageData(img.width, img.height);
  const span = Math.max(1, hi - lo);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = d[p], g = d[p + 1], b = d[p + 2];
    const m = Math.min(r, g, b);
    const a = 1 - Math.min(1, Math.max(0, (m - lo) / span));
    rgb.data[p] = r * a; rgb.data[p + 1] = g * a; rgb.data[p + 2] = b * a; rgb.data[p + 3] = 255;
    const a8 = a * 255; al.data[p] = a8; al.data[p + 1] = a8; al.data[p + 2] = a8; al.data[p + 3] = 255;
  }
  return { rgb, alpha: al };
}

/** Square ImageData → digit string of size² indices. */
export function imageToGrid(img, size, opts = {}) {
  const o = { ...UPLOAD_DEFAULTS, ...opts };
  const { rgb, alpha } = keyWhite(img, o.keyLo, o.keyHi);
  let cells = extractGridColors(rgb, size, size);
  const cover = extractGridColors(alpha, size, size);
  if (o.tone === 'stretch') cells = stretchForeground(cells, cover);
  else if (o.tone === 'equalise') cells = equaliseForeground(cells, cover);
  let idx = toIndices(cells, { cF: o.cF, mP: o.mP, bgThreshold: o.bgThreshold });
  for (let i = 0; i < idx.length; i++) idx[i] = cover[i][0] < 128 ? 0 : Math.max(1, idx[i]);
  if (o.modeFilter) idx = modeFilter(idx, size, size);
  return gridToString(idx);
}

/** Auto-contrast: map the foreground's 1st–99th luminance percentiles onto 0..255 so a dark (or pale)
 *  subject uses all nine buckets. Not part of the pool pipeline — an authoring aid; leave off to match it. */
export function stretchForeground(cells, cover) {
  const lum = [];
  for (let i = 0; i < cells.length; i++) if (cover[i][0] >= 128) lum.push((cells[i][0] + cells[i][1] + cells[i][2]) / 3);
  if (lum.length < 2) return cells;
  lum.sort((a, b) => a - b);
  const lo = lum[Math.floor(lum.length * 0.01)], hi = lum[Math.floor(lum.length * 0.99)];
  if (hi - lo < 1) return cells;
  const k = 255 / (hi - lo);
  return cells.map(c => c.map(v => Math.max(0, Math.min(255, (v - lo) * k))));
}

/** Histogram equalisation of foreground luminance: cell luminance → its rank percentile × 255,
 *  so the nine buckets each get about a ninth of the foreground. RGB scaled to keep the hue. */
export function equaliseForeground(cells, cover) {
  const lumOf = c => (c[0] + c[1] + c[2]) / 3;
  const fg = [];
  for (let i = 0; i < cells.length; i++) if (cover[i][0] >= 128) fg.push(lumOf(cells[i]));
  if (fg.length < 2) return cells;
  fg.sort((a, b) => a - b);
  const rank = v => { let lo = 0, hi = fg.length; while (lo < hi) { const m = (lo + hi) >> 1; if (fg[m] < v) lo = m + 1; else hi = m; } return lo / (fg.length - 1); };
  return cells.map(c => { const l = lumOf(c); if (l < 1) return c; const k = rank(l) * 255 / l; return c.map(v => Math.min(255, v * k)); });
}

/** Preview of the keyed source (what the quantiser sees), as a data URL. */
export function keyedPreview(img, opts = {}, side = 128) {
  const o = { ...UPLOAD_DEFAULTS, ...opts };
  const { rgb } = keyWhite(img, o.keyLo, o.keyHi);
  const c = document.createElement('canvas'); c.width = c.height = img.width;
  c.getContext('2d').putImageData(rgb, 0, 0);
  const d = document.createElement('canvas'); d.width = d.height = side;
  d.getContext('2d').drawImage(c, 0, 0, side, side);
  return d.toDataURL();
}

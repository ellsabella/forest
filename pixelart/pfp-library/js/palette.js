// palette.js — seeded 10-entry palettes (index 0 = background) and grid rendering.
// hslToRgb is the production app's implementation (colorUtils.js), copied verbatim.

export function hslToRgb(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/** Deterministic 32-bit PRNG. Returns a function yielding floats in [0,1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash any string to a uint32 (FNV-1a), so text seeds work. */
export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * Build a 10-entry palette from a seed. Index 0 is always the background colour.
 * Buckets 1..9 are ordered dark -> light so shading survives any recolour:
 * lightness ramps up monotonically; hue drifts from a start hue by `hueSpan`
 * degrees across the ramp; saturation is a seeded constant with a mid-ramp bump.
 *
 * opts: { background: [r,g,b] = [0,0,0], hueSpan: degrees (default seeded 20..160),
 *         minL, maxL, sat } — all optional, seeded when omitted.
 */
export function seededPalette(seed, opts = {}) {
  const rnd = mulberry32(typeof seed === "string" ? hashSeed(seed) : seed);
  const h0 = rnd() * 360;
  const hueSpan = opts.hueSpan ?? (20 + rnd() * 140) * (rnd() < 0.5 ? -1 : 1);
  const sat = opts.sat ?? 55 + rnd() * 40;
  const minL = opts.minL ?? 10 + rnd() * 10;
  const maxL = opts.maxL ?? 85 + rnd() * 10;
  const palette = [opts.background ?? [0, 0, 0]];
  for (let i = 1; i <= 9; i++) {
    const t = (i - 1) / 8;
    const h = (h0 + hueSpan * t + 360) % 360;
    const s = Math.min(100, sat * (1 - 0.25 * Math.abs(t - 0.5) * 2));
    const l = minL + (maxL - minL) * t;
    palette.push(hslToRgb(h, s, l));
  }
  return palette;
}

/** indices (size*size) + palette -> ImageData at 1px per cell. */
export function gridToImageData(indices, size, palette) {
  const img = new ImageData(size, size);
  for (let i = 0; i < indices.length; i++) {
    const [r, g, b] = palette[indices[i]];
    const o = i * 4;
    img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
  }
  return img;
}

/** Draw a grid onto a canvas, scaled with crisp pixels. */
export function renderGrid(canvas, indices, size, palette, scale = 8) {
  canvas.width = size * scale; canvas.height = size * scale;
  const ctx = canvas.getContext("2d");
  const tmp = document.createElement("canvas");
  tmp.width = size; tmp.height = size;
  tmp.getContext("2d").putImageData(gridToImageData(indices, size, palette), 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
}

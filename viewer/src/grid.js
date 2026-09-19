// grid string → voxel placement (PLAN §5).
//
// Axes: image x → world X, image row → world Z (row 0 far, row G-1 near), depth k → world Y
// (k = G-1 is the canopy, nearest the flat-view camera). filled[] uses the reference layout
// voxelIdx(xi, yi, zi) = xi*G*G + yi*G + zi with (xi, yi, zi) = (x, k, row).
//
// Only + - * / and sqrt are used on the placement path so results are identical across engines.

import { G } from './params.js';
import { hashInt, seedParts } from './hash.js';
import { makeNoise3 } from './noise.js';

export const voxelIdx = (xi, yi, zi) => xi * G * G + yi * G + zi;

export function centroid(grid) {
  let sx = 0, sy = 0, n = 0;
  for (let row = 0; row < G; row++)
    for (let x = 0; x < G; x++)
      if (grid.charCodeAt(row * G + x) !== 48) { sx += x; sy += row; n++; }
  return n ? [sx / n, sy / n] : [(G - 1) / 2, (G - 1) / 2];
}

export function buildVoxels(grid, seedStr, P) {
  const [s0, s1] = seedParts(seedStr);
  const noise3 = makeNoise3(s0, s1);
  const [cx, cy] = centroid(grid);
  const filled = new Uint8Array(G * G * G);
  const voxels = [];                       // {x, k, row, c, w}
  const dens = new Float32Array(G);
  const s = G / 5;                         // base noise wavelength, in cells
  const rNorm = 1 / (G * 0.70710678);

  for (let row = 0; row < G; row++) {
    for (let x = 0; x < G; x++) {
      const c = grid.charCodeAt(row * G + x) - 48;
      if (c <= 0 || c > 9) continue;

      const dx = x - cx, dy = row - cy;
      const r = Math.sqrt(dx * dx + dy * dy) * rNorm;
      const dome = P.crownTop - P.crownDrop * r * r;
      for (let k = 0; k < G; k++) {
        const u = (k / (G - 1) - dome) / P.crownThick;
        const shell = u * u < 1 ? (1 - u * u) * (1 - u * u) : 0;
        const n = noise3(x / s, row / s, k / s) * 0.6
                + noise3(2 * x / s, 2 * row / s, 2 * k / s) * 0.3
                + noise3(4 * x / s, 4 * row / s, 4 * k / s) * 0.1;
        const j = hashInt(x ^ s1, k ^ s0, row) - 0.5;
        dens[k] = shell * ((1 - P.noiseWeight) + P.noiseWeight * n + P.jitter * j);
      }

      // Top-nMax depths by density, at least minGap apart. First is always placed.
      const picks = [];
      while (picks.length < P.nMax) {
        let best = -1, bestD = -Infinity;
        for (let k = 0; k < G; k++) {
          if (dens[k] <= bestD) continue;
          let ok = true;
          for (const p of picks) if (Math.abs(p - k) < P.minGap) { ok = false; break; }
          if (ok) { best = k; bestD = dens[k]; }
        }
        if (best < 0 || (picks.length > 0 && bestD <= P.thresh)) break;
        picks.push(best);
      }

      picks.sort((a, b) => b - a);         // canopy-most first
      let wSum = 0;
      const ws = picks.map((_, i) => P.alphaMode === 'frontWeighted' ? 1 / (2 << i) : 1);
      for (const w of ws) wSum += w;
      picks.forEach((k, i) => {
        filled[voxelIdx(x, k, row)] = 1;
        voxels.push({ x, k, row, c, w: ws[i] / wSum });
      });
    }
  }
  voxels.sort((a, b) => a.k - b.k);        // draw low → high: back-to-front for a camera above
  return { filled, voxels, cx, cy };
}

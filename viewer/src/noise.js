// Seeded 3D value noise: lattice hash at integer corners, smooth trilinear blend. Returns 0..1.

import { hashInt } from './hash.js';

export function makeNoise3(s0, s1) {
  const lat = (x, y, z) => hashInt(x ^ s0, y ^ s1, z);
  const fade = t => t * t * (3 - 2 * t);
  return function noise3(x, y, z) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz);
    const x00 = lat(ix, iy,     iz    ) * (1 - fx) + lat(ix + 1, iy,     iz    ) * fx;
    const x10 = lat(ix, iy + 1, iz    ) * (1 - fx) + lat(ix + 1, iy + 1, iz    ) * fx;
    const x01 = lat(ix, iy,     iz + 1) * (1 - fx) + lat(ix + 1, iy,     iz + 1) * fx;
    const x11 = lat(ix, iy + 1, iz + 1) * (1 - fx) + lat(ix + 1, iy + 1, iz + 1) * fx;
    const y0 = x00 * (1 - fy) + x10 * fy;
    const y1 = x01 * (1 - fy) + x11 * fy;
    return y0 * (1 - fz) + y1 * fz;
  };
}

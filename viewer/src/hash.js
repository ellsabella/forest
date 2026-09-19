// Deterministic integer hashing. No Math.random, no Math.sin — integer maths is
// bit-identical across JS engines, transcendental functions are not.

// Integer murmur-mix hash → [0,1]. Verbatim from reference/viewer/tree-walker.js.
export function hashInt(a, b = 0, c = 0) {
  let h = Math.imul((a + 0x9e3779b9) >>> 0, 0x85ebca6b) >>> 0;
  h ^= Math.imul((b + 0xc2b2ae35) >>> 0, 0x27d4eb2f) >>> 0;
  h ^= Math.imul((c + 0x165667b1) >>> 0, 0x9e3779b1) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 0xFFFFFFFF;
}

// uint256 decimal string → [lo32, hi32] (folds all 256 bits in).
export function seedParts(seedStr) {
  let n = BigInt(seedStr || '0');
  let lo = 0, hi = 0, i = 0;
  while (n > 0n) {
    const w = Number(n & 0xffffffffn);
    if (i++ % 2 === 0) lo = (lo ^ w) >>> 0; else hi = (hi ^ w) >>> 0;
    n >>= 32n;
  }
  return [lo, hi];
}

// mulberry32 stream keyed by (a, b, c).
export function makeRng(a, b = 0, c = 0) {
  let s = Math.floor(hashInt(a, b, c) * 0xFFFFFFFF) >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

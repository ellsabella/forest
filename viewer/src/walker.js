// Branch + trunk walks on the (G+1)³ lattice of voxel corner nodes (PLAN §7).
//
// Ported from reference/viewer/materials/stone-walker.js: glassColumnNodes, pickRandom,
// isOuterSurfaceEdge, nodeIsOnGlassSurface, runInitialRay and the surface half of
// runRandomWalk keep the reference logic, with grid literals → G, string edge keys →
// integer keys, and the sin-hash → an integer PRNG (cross-engine determinism).
// Flight mode is replaced by the biased step that makes walks descend and gather
// around the trunk axis.

import { G } from './params.js';
import { voxelIdx } from './grid.js';
import { makeRng, seedParts } from './hash.js';

const N = G + 1;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// The lattice extends P.trunkDepth cells below the voxel cube (y from -D to G) so the
// trunk has room to descend and converge; voxels only ever occupy y in 0..G-1. The ground
// is y = -D; roots may dip a further P.rootDip cells below it.
let D = 0, DIP = 0;
const ground = () => -D;
const yMin = () => -D - DIP;

// Canonical edge key: lower node id * 3 + axis.
function edgeKey(a, b, ax) {
  const m = a[ax] < b[ax] ? a : b;
  return ((m[0] * (N + D + DIP) + (m[1] + D + DIP)) * N + m[2]) * 3 + ax;
}

const inLattice = (v, ax) => v[ax] >= (ax === 1 ? yMin() : 0) && v[ax] <= G;

// Root mode: crawl outward across the floor (y within [ground - rootDip, ground]), turning
// at random, fading at every turn, until the edge of the square or another path.
// segs entries carry a 7th value: the fade (1 for canopy/trunk segments).
function runRoot(start, initAxis, initDir, rng, occupied, segs, ax0, az0, P, fade = 1) {
  let cur = [...start], curAxis = initAxis, curDir = initDir;
  let lastH = initAxis === 1 ? [-1, 0] : [initAxis, initDir];    // last horizontal heading
  for (let step = 0; step < P.maxSteps; step++) {
    if (rng() < P.rootTerminate) break;
    const dNow = Math.sqrt((cur[0] - ax0) ** 2 + (cur[2] - az0) ** 2);
    const opts = [];
    let total = 0;
    for (let ax = 0; ax < 3; ax++) {
      for (const d of [-1, 1]) {
        if (ax === curAxis && d === -curDir) continue;
        const nxt = [...cur];
        nxt[ax] += d;
        if (ax === 1) { if (nxt[1] > ground() || nxt[1] < yMin()) continue; }
        else if (nxt[ax] < 0 || nxt[ax] > G) { opts.push({ nxt, ax, d, w: 0.5, edge: true }); total += 0.5; continue; }
        let w = ax === 1 ? P.rootWiggle : 1;
        if (ax !== 1 && Math.sqrt((nxt[0] - ax0) ** 2 + (nxt[2] - az0) ** 2) > dNow) w *= P.rootOutward;
        if (ax === curAxis && d === curDir) w *= P.rootStraight;
        opts.push({ nxt, ax, d, w });
        total += w;
      }
    }
    if (total === 0) break;
    let t = rng() * total, pick = opts[opts.length - 1];
    for (const o of opts) { if ((t -= o.w) <= 0) { pick = o; break; } }
    if (pick.edge) break;                                          // reached the edge of the square
    const ek = edgeKey(cur, pick.nxt, pick.ax);
    if (occupied.has(ek)) break;                                   // merged into another root
    // A horizontal change of heading is a "turn away from the source" → dim. Vertical wiggles don't count.
    if (pick.ax !== 1 && curAxis !== 1 && (pick.ax !== curAxis || pick.d !== curDir)) fade *= P.rootFade;
    if (pick.ax !== 1 && curAxis === 1 && (pick.ax !== lastH[0] || pick.d !== lastH[1])) fade *= P.rootFade;
    if (pick.ax !== 1) lastH = [pick.ax, pick.d];
    occupied.add(ek);
    segs.push([...cur, ...pick.nxt, fade]);
    curAxis = pick.ax; curDir = pick.d; cur = pick.nxt;
  }
}

const inVoxelBounds = v => v[0] >= 0 && v[0] < G && v[1] >= 0 && v[1] < G && v[2] >= 0 && v[2] < G;

// Lattice nodes on face `faceIdx` of axis `axIdx` whose perpendicular column holds a voxel.
function glassColumnNodes(filled, axIdx, faceIdx) {
  const [p0, p1] = [0, 1, 2].filter(k => k !== axIdx);
  const nodes = [];
  for (let a = 0; a <= G; a++) {
    const va = Math.min(a, G - 1);
    for (let b = 0; b <= G; b++) {
      const vb = Math.min(b, G - 1);
      let hit = false;
      for (let k = 0; k < G && !hit; k++) {
        const vi = [0, 0, 0];
        vi[axIdx] = k; vi[p0] = va; vi[p1] = vb;
        if (filled[voxelIdx(vi[0], vi[1], vi[2])]) hit = true;
      }
      if (hit) {
        const node = [0, 0, 0];
        node[axIdx] = faceIdx; node[p0] = a; node[p1] = b;
        nodes.push(node);
      }
    }
  }
  return nodes;
}

// Deterministic Fisher-Yates pick of n items.
function pickRandom(arr, n, rng) {
  if (arr.length <= n) return [...arr];
  const idx = arr.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, n).map(i => arr[i]);
}

// Edge a→b along ax is an outer surface edge if its 4 adjacent voxels are a mix of filled and empty.
function isOuterSurfaceEdge(a, b, ax, filled) {
  const perp = [0, 1, 2].filter(k => k !== ax);
  const vAx = Math.min(a[ax], b[ax]);
  let hasFilled = false, hasEmpty = false;
  for (const d0 of [0, -1]) {
    for (const d1 of [0, -1]) {
      const v = [0, 0, 0];
      v[ax] = vAx; v[perp[0]] = a[perp[0]] + d0; v[perp[1]] = a[perp[1]] + d1;
      if (inVoxelBounds(v) && filled[voxelIdx(v[0], v[1], v[2])]) hasFilled = true;
      else hasEmpty = true;
    }
  }
  return hasFilled && hasEmpty;
}

function nodeIsOnGlassSurface(node, filled) {
  for (const dx of [0, -1]) for (const dy of [0, -1]) for (const dz of [0, -1]) {
    const v = [node[0] + dx, node[1] + dy, node[2] + dz];
    if (inVoxelBounds(v) && filled[voxelIdx(v[0], v[1], v[2])]) return true;
  }
  return false;
}

// The voxel a step cur→nxt along ax would enter (reference convention: clamped cur, min along ax).
function edgeVoxelFilled(cur, nxt, ax, filled) {
  const vi = [clamp(cur[0], 0, G - 1), clamp(cur[1], 0, G - 1), clamp(cur[2], 0, G - 1)];
  vi[ax] = clamp(Math.min(cur[ax], nxt[ax]), 0, G - 1);
  return filled[voxelIdx(vi[0], vi[1], vi[2])] === 1;
}

// Straight in from the face, stopping flush against the first voxel.
function runInitialRay(start, axIdx, dir, filled, occupied, segs) {
  let cur = [...start];
  for (let step = 0; step < G; step++) {
    const nxt = [...cur];
    nxt[axIdx] += dir;
    if (nxt[axIdx] < 0 || nxt[axIdx] > G) break;
    if (edgeVoxelFilled(cur, nxt, axIdx, filled)) break;
    const ek = edgeKey(cur, nxt, axIdx);
    if (occupied.has(ek)) break;
    occupied.add(ek);
    segs.push([...cur, ...nxt]);
    cur = nxt;
  }
  return cur;
}

// Surface mode = reference. Flight mode = weighted step: descend, drift toward the trunk
// axis, orbit once close, prefer straight runs. Walks end on contact with any earlier
// path (that merging is what bundles the trunk), at the ground, or by chance.
function runRandomWalkBiased(start, initAxis, initDir, rng, occupied, segs, filled, ax0, az0, P, clumps) {
  let cur = [...start];
  let curAxis = initAxis, curDir = initDir;
  let flying = false, surfaceSteps = 0, flightSteps = 0;

  for (let stepCount = 0; stepCount < P.maxSteps; stepCount++) {
    if (rng() < P.terminateProb) break;

    if (!flying) {
      const turns = [], straights = [];
      for (let ax = 0; ax < 3; ax++) {
        for (const d of [-1, 1]) {
          const nxt = [...cur];
          nxt[ax] += d;
          if (!inLattice(nxt, ax)) continue;
          const ek = edgeKey(cur, nxt, ax);
          if (occupied.has(ek)) continue;
          if (!isOuterSurfaceEdge(cur, nxt, ax, filled)) continue;
          (ax === curAxis ? straights : turns).push({ nxt, ek, ax, d });
        }
      }
      const pool = turns.length > 0 ? turns : straights;
      if (pool.length === 0) { flying = true; flightSteps = 0; continue; }

      const { nxt, ek, ax, d } = pool[Math.min(Math.floor(rng() * pool.length), pool.length - 1)];
      occupied.add(ek);
      segs.push([...cur, ...nxt]);
      curAxis = ax; curDir = d; cur = nxt;
      if (++surfaceSteps >= P.maxSurfaceSteps) { flying = true; flightSteps = 0; surfaceSteps = 0; }

    } else {
      const ddx = cur[0] - ax0, ddz = cur[2] - az0;
      const dNow = Math.sqrt(ddx * ddx + ddz * ddz);
      const attract = P.attract + (1 - P.attract) * P.canopyDamp * (Math.max(0, cur[1]) / G);
      // Nearest clump whose pull radius we are inside → steps that close on it are favoured,
      // so branch lines run out to the lower leaf clumps instead of only down the trunk.
      let clump = null, clumpD = Infinity;
      for (const c of clumps) {
        const dx = c.x + 0.5 - cur[0], dy = c.k + 0.5 - cur[1], dz = c.row + 0.5 - cur[2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < c.r * P.clumpPull && d < clumpD) { clump = c; clumpD = d; }
      }
      const opts = [];
      let total = 0;
      for (let ax = 0; ax < 3; ax++) {
        for (const d of [-1, 1]) {
          if (ax === curAxis && d === -curDir) continue;          // no U-turns
          const nxt = [...cur];
          nxt[ax] += d;
          if (!inLattice(nxt, ax) || nxt[1] < ground()) continue;   // roots handle below-ground
          let w = 1;
          if (ax === 1) w *= d < 0 ? P.downBias : P.upBias;
          else {
            const ex = nxt[0] - ax0, ez = nxt[2] - az0;
            if (Math.sqrt(ex * ex + ez * ez) < dNow) w *= dNow < P.orbitRadius ? P.repel : attract;
          }
          if (ax === curAxis && d === curDir) w *= P.straightBias;
          if (clump) {
            const dx = clump.x + 0.5 - nxt[0], dy = clump.k + 0.5 - nxt[1], dz = clump.row + 0.5 - nxt[2];
            if (Math.sqrt(dx * dx + dy * dy + dz * dz) < clumpD) w *= P.clumpAttract;
          }
          // Until minFlight steps have passed, steer around leaves instead of landing on them —
          // otherwise a dense canopy recaptures every walk and nothing descends to form a trunk.
          if (flightSteps < P.minFlight && edgeVoxelFilled(cur, nxt, ax, filled)) continue;
          opts.push({ nxt, ax, d, w });
          total += w;
        }
      }
      if (opts.length === 0) break;
      let t = rng() * total, pick = opts[opts.length - 1];
      for (const o of opts) { if ((t -= o.w) <= 0) { pick = o; break; } }

      if (edgeVoxelFilled(cur, pick.nxt, pick.ax, filled)) {       // ran into a leaf head-on
        flying = false; surfaceSteps = 0; curAxis = pick.ax; curDir = pick.d;
        continue;
      }
      const ek = edgeKey(cur, pick.nxt, pick.ax);
      if (occupied.has(ek)) break;                                 // merged into an earlier path
      occupied.add(ek);
      segs.push([...cur, ...pick.nxt]);
      curAxis = pick.ax; curDir = pick.d; cur = pick.nxt;
      flightSteps++;

      if (cur[1] === ground()) {                                   // reached the ground → become a root
        runRoot(cur, curAxis, curDir, rng, occupied, segs, ax0, az0, P);
        break;
      }
      if (flightSteps >= Math.max(1, P.minFlight) && nodeIsOnGlassSurface(cur, filled)) { flying = false; surfaceSteps = 0; }
    }
  }
}

// → { walks: [{ segs: [[x0,y0,z0,x1,y1,z1], …], cell: [x, row] }], touched: Set<voxelIdx> }
export function buildForestWalks(filled, seedStr, cx, cy, P, clumps = []) {
  D = Math.max(0, Math.round(P.trunkDepth));
  DIP = Math.max(0, Math.round(P.rootDip));
  const [s0, s1] = seedParts(seedStr);
  const occupied = new Set();
  const walks = [];
  const touched = new Set();
  // Launch from the canopy face only (axis Y, face G, heading down): leaves → trunk.
  const candidates = glassColumnNodes(filled, 1, G);
  const selected = pickRandom(candidates, P.walkCount, makeRng(s0, s1, 7));
  const ax0 = cx + 0.5, az0 = cy + 0.5;                            // trunk axis in node coords

  selected.forEach((start, i) => {
    const segs = [];
    // The ray only locates the leaf: a walk starts on top of its leaf, not at the cube ceiling,
    // so the ray's own segments are discarded.
    const end = runInitialRay(start, 1, -1, filled, new Set(), []);
    runRandomWalkBiased(end, 1, -1, makeRng(s0, s1, 1000 + i), occupied, segs, filled, ax0, az0, P, clumps);
    if (segs.length === 0) return;
    for (const sg of segs) {
      const v = [Math.min(sg[0], sg[3]), Math.min(sg[1], sg[4]), Math.min(sg[2], sg[5])].map(n => clamp(n, 0, G - 1));
      touched.add(voxelIdx(v[0], v[1], v[2]));
    }
    walks.push({ segs, cell: [Math.min(start[0], G - 1), Math.min(start[2], G - 1)] });
  });

  // Extra roots from around the trunk's foot (most walks merge before they reach the ground).
  // Spawn points are scattered within rootSpawn cells of the foot so they don't all collide
  // on the same four edges; each heads outward along its larger offset axis.
  const rootRng = makeRng(s0, s1, 5000);
  const leafCells = candidates.map(n => [Math.min(n[0], G - 1), Math.min(n[2], G - 1)]);
  for (let i = 0; i < P.rootExtra && leafCells.length; i++) {
    const segs = [];
    const ox = Math.round((rootRng() * 2 - 1) * P.rootSpawn), oz = Math.round((rootRng() * 2 - 1) * P.rootSpawn);
    const start = [clamp(Math.round(ax0) + ox, 0, G), ground(), clamp(Math.round(az0) + oz, 0, G)];
    const ax = Math.abs(ox) >= Math.abs(oz) ? 0 : 2;
    const d = (ax === 0 ? ox : oz) < 0 ? -1 : 1;
    runRoot(start, ax, d, makeRng(s0, s1, 6000 + i), occupied, segs, ax0, az0, P);
    if (segs.length) walks.push({ segs, cell: leafCells[Math.floor(rootRng() * leafCells.length)] });
  }
  return { walks, touched };
}

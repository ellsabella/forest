// Voxel mesh (PLAN §6). Port of buildVoxelMesh from reference/viewer/normie/voxels.js,
// restructured as one instanced unit cube: per-instance centre / colour / alpha / variant.
// The +Y face (the leaf, facing the flat-view camera) is its own VAO so it can be drawn
// as a separate pass from the five glass panels.

import { G } from './params.js';
import { voxelIdx } from './grid.js';
import { createBuffer, createVAO } from './gl.js';

// Unit-cube faces, CCW from outside — reference faceTriangles with h = 1.
const FACES = [
  { n: [ 1, 0, 0], t: [[ 1,-1, 1],[ 1, 1, 1],[ 1, 1,-1],  [ 1,-1, 1],[ 1, 1,-1],[ 1,-1,-1]] },
  { n: [-1, 0, 0], t: [[-1,-1,-1],[-1, 1,-1],[-1, 1, 1],  [-1,-1,-1],[-1, 1, 1],[-1,-1, 1]] },
  { n: [ 0, 1, 0], t: [[-1, 1, 1],[ 1, 1, 1],[ 1, 1,-1],  [-1, 1, 1],[ 1, 1,-1],[-1, 1,-1]] },
  { n: [ 0,-1, 0], t: [[-1,-1,-1],[ 1,-1,-1],[ 1,-1, 1],  [-1,-1,-1],[ 1,-1, 1],[-1,-1, 1]] },
  { n: [ 0, 0, 1], t: [[-1,-1, 1],[ 1,-1, 1],[ 1, 1, 1],  [-1,-1, 1],[ 1, 1, 1],[-1, 1, 1]] },
  { n: [ 0, 0,-1], t: [[ 1,-1,-1],[-1,-1,-1],[-1, 1,-1],  [ 1,-1,-1],[-1, 1,-1],[ 1, 1,-1]] },
];
const TOP = 2;

function faceBuffers(gl, faces) {
  const pos = [], nrm = [];
  for (const f of faces) for (const v of f.t) { pos.push(...v); nrm.push(...f.n); }
  return { pos: createBuffer(gl, new Float32Array(pos)), nrm: createBuffer(gl, new Float32Array(nrm)), count: pos.length / 3 };
}

// voxels: [{x, k, row, c, w}] · palette: [[r,g,b] 0..1] indexed by c · touched: Set<voxelIdx>
export function buildVoxelMesh(gl, voxels, palette, touched, P) {
  const n = voxels.length;
  const centers = new Float32Array(n * 3), colors = new Float32Array(n * 3);
  const alphas = new Float32Array(n), variants = new Float32Array(n);
  const vs = 2 / G;                                    // cube spans [-1, 1]³

  voxels.forEach((v, i) => {
    centers[i*3]   = -1 + (v.x   + 0.5) * vs;
    centers[i*3+1] = -1 + (v.k   + 0.5) * vs;
    centers[i*3+2] = -1 + (v.row + 0.5) * vs;
    colors.set(palette[v.c], i * 3);

    // Per-voxel random — reference recipe.
    let h = ((v.x * 73856093) ^ (v.k * 19349663) ^ (v.row * 83492791)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
    const rand = h / 0xFFFFFFFF;
    const variety = 0.35 + rand * 0.65;
    const walkerMult = touched.has(voxelIdx(v.x, v.k, v.row)) ? P.walkerBoost : 1.0;
    alphas[i]   = variety * walkerMult * (0.5 + 0.5 * v.w);
    variants[i] = rand;
  });

  const inst = [
    { buf: createBuffer(gl, colors),   loc: 2, size: 3, divisor: 1 },
    { buf: createBuffer(gl, centers),  loc: 3, size: 3, divisor: 1 },
    { buf: createBuffer(gl, alphas),   loc: 4, size: 1, divisor: 1 },
    { buf: createBuffer(gl, variants), loc: 5, size: 1, divisor: 1 },
  ];
  const top  = faceBuffers(gl, [FACES[TOP]]);
  const rest = faceBuffers(gl, FACES.filter((_, i) => i !== TOP));
  const vao = f => createVAO(gl, [{ buf: f.pos, loc: 0, size: 3 }, { buf: f.nrm, loc: 1, size: 3 }, ...inst]);

  const buffers = [...inst.map(a => a.buf), top.pos, top.nrm, rest.pos, rest.nrm];
  const mesh = {
    count: n,
    top:  { vao: vao(top),  verts: top.count },
    rest: { vao: vao(rest), verts: rest.count },
    dispose() {
      buffers.forEach(b => gl.deleteBuffer(b));
      gl.deleteVertexArray(mesh.top.vao); gl.deleteVertexArray(mesh.rest.vao);
    },
  };
  return mesh;
}

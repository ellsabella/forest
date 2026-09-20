// Walk segments → one quad mesh, drawn twice (glow, then core). Replaces the reference
// buildCoreLineMesh / buildGlowLineMesh pair: the quad is expanded toward the camera in
// LINE_VERT, so a single mesh serves both widths.

import { G } from './params.js';
import { createBuffer, createVAO } from './gl.js';

// Merge collinear consecutive unit steps so straight runs are one capsule (fewer joints, fewer verts).
// A segment's optional 7th value is its fade (roots dim at each turn); runs only merge within one fade.
function mergeRuns(segs) {
  const out = [];
  for (const s of segs) {
    const p = out[out.length - 1];
    if (p && p[3] === s[0] && p[4] === s[1] && p[5] === s[2] && (p[6] ?? 1) === (s[6] ?? 1)) {
      const pd = [Math.sign(p[3] - p[0]), Math.sign(p[4] - p[1]), Math.sign(p[5] - p[2])];
      const sd = [s[3] - s[0], s[4] - s[1], s[5] - s[2]];
      if (pd[0] === sd[0] && pd[1] === sd[1] && pd[2] === sd[2]) { p[3] = s[3]; p[4] = s[4]; p[5] = s[5]; continue; }
    }
    out.push([...s]);
  }
  return out;
}

// walks: [{ segs, cell: [x, row] }] · cellColour(x, row) → [r,g,b]
export function buildLineMesh(gl, walks, cellColour, P) {
  const pos = [], dir = [], uv = [], col = [], len = [], idx = [];
  const vs = 2 / G;
  let vi = 0;
  for (const w of walks) {
    const leaf = cellColour(w.cell[0], w.cell[1]);
    const c = [0, 1, 2].map(i => P.lineTint[i] * (1 - P.lineLeafColour) + leaf[i] * 2.2 * P.lineLeafColour);
    for (const s of mergeRuns(w.segs)) {
      const a = [-1 + s[0] * vs, -1 + s[1] * vs, -1 + s[2] * vs];
      const b = [-1 + s[3] * vs, -1 + s[4] * vs, -1 + s[5] * vs];
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const L = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
      const u = [d[0] / L, d[1] / L, d[2] / L];
      const f = s[6] ?? 1;
      for (const [p, e] of [[a, 0], [b, 1]]) for (const side of [-1, 1]) {
        pos.push(...p); dir.push(...u); uv.push(e, side); col.push(c[0] * f, c[1] * f, c[2] * f); len.push(L);
      }
      idx.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2);
      vi += 4;
    }
  }
  if (vi === 0) return null;

  const bufs = [
    { buf: createBuffer(gl, new Float32Array(pos)), loc: 0, size: 3 },
    { buf: createBuffer(gl, new Float32Array(dir)), loc: 1, size: 3 },
    { buf: createBuffer(gl, new Float32Array(uv)),  loc: 2, size: 2 },
    { buf: createBuffer(gl, new Float32Array(col)), loc: 3, size: 3 },
    { buf: createBuffer(gl, new Float32Array(len)), loc: 4, size: 1 },
  ];
  const ib = createBuffer(gl, new Uint32Array(idx), gl.ELEMENT_ARRAY_BUFFER);
  const vao = createVAO(gl, bufs, ib);
  return {
    vao, indexCount: idx.length, segments: vi / 4,
    dispose() { bufs.forEach(b => gl.deleteBuffer(b.buf)); gl.deleteBuffer(ib); gl.deleteVertexArray(vao); },
  };
}

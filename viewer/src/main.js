// Viewer entry. token = { grid: '<G² digits>', palette: ['#RRGGBB' × 9], seed: '<uint256 decimal>' }
// On-chain, the HTML shell sets window.FOREST and this module boots itself on <canvas id="c">.
//
// createViewer(canvas, token, params)            one tree (the token)
// createViewer(canvas, [token…], [params…], { cols }) several trees in one scene, laid out on a
//   cols-wide grid of 2-unit cells: seamless mosaic in flat view, a forest in explore view.

import { G, PARAMS } from './params.js';
import { buildVoxels } from './grid.js';
import { buildForestWalks } from './walker.js';
import { buildVoxelMesh, buildFallMesh } from './voxels.js';
import { buildLineMesh } from './lines.js';
import { createCamera } from './camera.js';
import { compileProgram } from './gl.js';
import { makeRng, seedParts } from './hash.js';
import { VOXEL_VERT, VOXEL_FRAG, LINE_VERT, LINE_CORE_FRAG, LINE_GLOW_FRAG } from './shaders.js';

const MAX_LIGHTS = 8;
const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16) / 255);

// Seeded choice of columns whose leaves "fall": cosmetic, never affects walks or the picture.
function fallColumns(voxels, grid, seed, P) {
  const top = new Map();                                   // column → highest k
  for (const v of voxels) { const key = v.row * G + v.x; if (!top.has(key) || v.k > top.get(key)) top.set(key, v.k); }
  const keys = [...top.keys()];
  const [s0, s1] = seedParts(seed);
  const rng = makeRng(s0, s1, 777);
  const out = [];
  for (let i = 0; i < Math.min(P.fallCount, keys.length); i++) {
    const key = keys.splice(Math.floor(rng() * keys.length), 1)[0];
    out.push({ x: key % G, row: Math.floor(key / G), c: grid.charCodeAt(key) - 48, kTop: top.get(key), phase: rng() });
  }
  return out;
}

export function createViewer(canvas, tokens, params = PARAMS, { cols = 1 } = {}) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 not available');
  const many = Array.isArray(tokens);
  let tokenList = many ? tokens : [tokens];
  const paramList = many ? params : [params];
  const n = tokenList.length;
  const rows = Math.ceil(n / cols);
  const extent = Math.max(cols, rows);                     // scene half-width: cells are 2 units wide
  // In a shared scene every tree is lifted by its own trunk depth so all floors sit on one ground
  // plane (y = -1) and canopy height follows trunk depth. A lone tree keeps its cube at the origin.
  const offsetOf = (i, P) => [((i % cols) - (cols - 1) / 2) * 2, many ? P.trunkDepth * 2 / G : 0, (Math.floor(i / cols) - (rows - 1) / 2) * 2];
  const trees = [];                                        // {token, P, offset, voxel, line, floor, fall, stats}
  const span = () => {                                     // vertical extent of the scene (world y)
    let lo = -1, hi = 1;
    for (const t of trees) if (t) { lo = Math.min(lo, t.offset[1] - 1 - (t.P.trunkDepth + t.P.rootDip) * 2 / G); hi = Math.max(hi, t.offset[1] + 1); }
    return [lo, hi];
  };

  const voxelProg = compileProgram(gl, VOXEL_VERT, VOXEL_FRAG);
  const coreProg  = compileProgram(gl, LINE_VERT, LINE_CORE_FRAG);
  const glowProg  = compileProgram(gl, LINE_VERT, LINE_GLOW_FRAG);
  const camera = createCamera(canvas, paramList[0], extent, span);
  const lightPos = new Float32Array(MAX_LIGHTS * 3), lightCol = new Float32Array(MAX_LIGHTS * 3);
  const stats = {};
  let raf = 0, last = 0;

  function disposeTree(t) { t.voxel?.dispose(); t.line?.dispose(); t.fall?.dispose(); }

  function buildTree(i, token) {
    const P = paramList[i];
    if (token.grid.length !== G * G) throw new Error(`grid must be ${G * G} digits, got ${token.grid.length}`);
    const t0 = performance.now();
    const palette = [[0, 0, 0], ...token.palette.map(hexToRgb)];
    const { filled, voxels, cx, cy, clumps } = buildVoxels(token.grid, token.seed, P);
    const { walks, touched } = buildForestWalks(filled, token.seed, cx, cy, P, clumps);
    const t = {
      token, P, offset: offsetOf(i, P),
      voxel: buildVoxelMesh(gl, voxels, palette, touched, P),
      line:  buildLineMesh(gl, walks, (x, row) => palette[token.grid.charCodeAt(row * G + x) - 48] || palette[0], P),
      fall:  buildFallMesh(gl, fallColumns(voxels, token.grid, token.seed, P), palette, Math.max(1, Math.round(P.fallGap)), -Math.round(P.trunkDepth)),
      stats: { voxels: voxels.length, walks: walks.length, segments: 0, clumps: clumps.length, centroid: [cx, cy], buildMs: Math.round(performance.now() - t0) },
    };
    t.stats.segments = t.line ? t.line.segments : 0;
    return t;
  }

  // rebuild(token) for one tree, rebuild([tokens]) for all, rebuild(token, i) for tree i.
  function rebuild(next, index) {
    if (Array.isArray(next)) { tokenList = next; for (let i = 0; i < n; i++) rebuild(tokenList[i], i); return stats; }
    const i = index ?? 0;
    if (next) tokenList[i] = next;
    if (trees[i]) disposeTree(trees[i]);
    trees[i] = buildTree(i, tokenList[i]);
    const sum = k => trees.reduce((s, t) => s + (t ? t.stats[k] : 0), 0);
    Object.assign(stats, { voxels: sum('voxels'), walks: sum('walks'), segments: sum('segments'), clumps: sum('clumps'),
      buildMs: sum('buildMs'), centroid: trees[0]?.stats.centroid, trees: trees.map(t => t?.stats) });
    return stats;
  }

  function resize() {
    const px = Math.round(canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 2));
    if (px && canvas.width !== px) canvas.width = canvas.height = px;
  }

  function drawVoxels(t, flat, now, eye) {
    const P = t.P, u = voxelProg.uniforms, cell = 2 / G;
    const dimL = many ? P.forestLight : 1, dimG = many ? P.forestGlow : 1;   // shared scene: nine trees' glow adds up
    gl.uniform3fv(u.uOffset, t.offset);
    gl.uniform1f(u.uHalf, cell * (P.shrink + (0.5 - P.shrink) * flat));
    gl.uniform3fv(u.uCamPos, eye);
    gl.uniform1f(u.uAlpha, P.glassAlpha * dimG);
    gl.uniform1f(u.uLightScale, P.lightScale * dimL);
    gl.uniform3fv(u.uCubeCenter, t.offset);                // each tree carries its own lights
    gl.uniform1f(u.uCubeHalfSize, 1);
    gl.uniform3f(u.uLightDir, 0.4, 1.0, 0.3);
    gl.uniform3f(u.uLightCol, 1, 1, 1);
    gl.uniform1f(u.uTime, now / 1000);
    gl.uniform1f(u.uFlat, flat);
    gl.uniform1f(u.uTopEmissive, P.topEmissive);
    gl.uniform1f(u.uTopAlpha, P.topAlpha);
    gl.uniform1f(u.uTopSpec, P.topSpec);
    gl.uniform1f(u.uLeafDiffuse, P.leafDiffuse);
    gl.uniform1f(u.uLeafLift, P.leafLift);
    gl.uniform1f(u.uEdgeMin, P.edgeMin);
    gl.uniform1f(u.uSideTint, P.sideTint);
    gl.uniform1f(u.uFacet, P.facet);
    gl.uniform1f(u.uSpecFresnel, P.specFresnel);
    gl.uniform1f(u.uTwinkleFrom, 1 - P.twinkle);
    gl.uniform1f(u.uTwinkleSpeed, P.twinkleSpeed);
    gl.uniform1f(u.uSparkle, P.sparkle);
    gl.uniform1f(u.uFall, 0);
    gl.uniform1f(u.uAdditive, 0);
    gl.uniform1f(u.uFallSpeed, P.fallSpeed);
    gl.uniform1f(u.uFallWidth, P.fallWidth);
    gl.uniform1f(u.uFallSway, P.fallSway * cell);
    const lights = P.lights.slice(0, MAX_LIGHTS);
    lights.forEach((l, i) => { for (let k = 0; k < 3; k++) { lightPos[i * 3 + k] = l.pos[k]; lightCol[i * 3 + k] = l.col[k] * P.lightIntensity * dimL; } });
    gl.uniform3fv(u.uPointLightPos, lightPos);
    gl.uniform3fv(u.uPointLightCol, lightCol);
    gl.uniform1i(u.uPointLightCount, lights.length);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Leaves first, writing depth (they occlude each other and everything behind them)…
    gl.depthMask(true);
    gl.uniform1f(u.uTop, 1);
    gl.bindVertexArray(t.voxel.top.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, t.voxel.top.verts, t.voxel.count);
    if (flat >= 1) return;
    gl.depthMask(false);
    // …then the glass panels: additive (they add reflected light and never darken the leaves behind
    // them — with alpha blending a dense canopy turned into dark smoke), depth-tested, not written…
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.uniform1f(u.uTop, 0);
    gl.uniform1f(u.uAdditive, 1);
    gl.bindVertexArray(t.voxel.rest.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, t.voxel.rest.verts, t.voxel.count);
    gl.uniform1f(u.uAdditive, 0);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    // …then the falling-leaf ghosts (leaf shading, time-windowed alpha, gone in flat view).
    if (t.fall.count) {
      gl.uniform1f(u.uTop, 1);
      gl.uniform1f(u.uFall, 1);
      gl.uniform1f(u.uTopAlpha, P.fallAlpha * (1 - flat));
      gl.bindVertexArray(t.fall.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, t.fall.verts, t.fall.count);
      gl.uniform1f(u.uFall, 0);
    }
  }

  function drawLines(t, flat) {
    if (!t.line) return;
    const P = t.P, cell = 2 / G, fade = (1 - flat) * (many ? P.forestGlow : 1);
    gl.depthMask(false);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(t.line.vao);
    for (const [p, width, cap, opacity] of [[glowProg, P.glowWidth, 1, P.glowOpacity], [coreProg, P.lineWidth, 0, P.lineOpacity]]) {
      gl.useProgram(p.prog);
      gl.uniformMatrix4fv(p.uniforms.uView, false, camera.view);
      gl.uniformMatrix4fv(p.uniforms.uProj, false, camera.proj);
      gl.uniform3fv(p.uniforms.uOffset, t.offset);
      gl.uniform1f(p.uniforms.uWidth, width * cell);
      gl.uniform1f(p.uniforms.uCap, cap);
      gl.uniform1f(p.uniforms.uFlat, flat);
      gl.uniform1f(p.uniforms.uOpacity, opacity * fade);
      gl.drawElements(gl.TRIANGLES, t.line.indexCount, gl.UNSIGNED_INT, 0);
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000 || 0); last = now;
    if (!canvas.clientWidth) return;                     // hidden (e.g. inactive dev tab): skip drawing
    resize();
    const eye = camera.update(dt);
    const flat = camera.flat;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);

    gl.useProgram(voxelProg.prog);
    gl.uniformMatrix4fv(voxelProg.uniforms.uView, false, camera.view);
    gl.uniformMatrix4fv(voxelProg.uniforms.uProj, false, camera.proj);
    for (const t of trees) if (t && t.voxel.count) { gl.useProgram(voxelProg.prog); drawVoxels(t, flat, now, eye); }
    if (flat < 1) for (const t of trees) if (t) drawLines(t, flat);
    gl.bindVertexArray(null);
  }

  for (let i = 0; i < n; i++) rebuild(tokenList[i], i);
  raf = requestAnimationFrame(frame);
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'f' || e.key === ' ') { e.preventDefault(); camera.toggle(); }
    if (e.key === 'r') camera.setFlat(true);
  });

  return { rebuild, camera, stats, gl, get trees() { return trees; }, dispose() { cancelAnimationFrame(raf); trees.forEach(t => t && disposeTree(t)); } };
}

if (typeof window !== 'undefined' && window.FOREST) {
  createViewer(document.getElementById('c'), window.FOREST);
}

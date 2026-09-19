// Viewer entry. token = { grid: '<G² digits>', palette: ['#RRGGBB' × 9], seed: '<uint256 decimal>' }
// On-chain, the HTML shell sets window.FOREST and this module boots itself on <canvas id="c">.
// dev.html calls createViewer directly.

import { G, PARAMS } from './params.js';
import { buildVoxels } from './grid.js';
import { buildForestWalks } from './walker.js';
import { buildVoxelMesh } from './voxels.js';
import { buildLineMesh } from './lines.js';
import { createCamera } from './camera.js';
import { compileProgram } from './gl.js';
import { VOXEL_VERT, VOXEL_FRAG, LINE_VERT, LINE_CORE_FRAG, LINE_GLOW_FRAG } from './shaders.js';

// reference/viewer/lights.js DEFAULT_LIGHTS — static, cube-relative, HDR.
const LIGHT_POS = new Float32Array([1.12, 0.80, 1.12,  -1.12, 0.48, 0.80,  0.32, 1.44, -1.12]);
const LIGHT_COL = new Float32Array([5, 0, 0,  0, 5, 0,  0, 0, 5]);

const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16) / 255);

export function createViewer(canvas, token, P = PARAMS) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 not available');

  const voxelProg = compileProgram(gl, VOXEL_VERT, VOXEL_FRAG);
  const coreProg  = compileProgram(gl, LINE_VERT, LINE_CORE_FRAG);
  const glowProg  = compileProgram(gl, LINE_VERT, LINE_GLOW_FRAG);
  const camera = createCamera(canvas, P);
  const stats = {};
  let voxelMesh = null, lineMesh = null, raf = 0, last = 0;

  function rebuild(next) {
    if (next) token = next;
    if (token.grid.length !== G * G) throw new Error(`grid must be ${G * G} digits, got ${token.grid.length}`);
    const t0 = performance.now();
    const palette = [[0, 0, 0], ...token.palette.map(hexToRgb)];
    const { filled, voxels, cx, cy } = buildVoxels(token.grid, token.seed, P);
    const { walks, touched } = buildForestWalks(filled, token.seed, cx, cy, P);
    voxelMesh?.dispose(); lineMesh?.dispose();
    voxelMesh = buildVoxelMesh(gl, voxels, palette, touched, P);
    lineMesh  = buildLineMesh(gl, walks, (x, row) => palette[token.grid.charCodeAt(row * G + x) - 48] || palette[0], P);
    Object.assign(stats, {
      voxels: voxels.length, walks: walks.length, segments: lineMesh ? lineMesh.segments : 0,
      centroid: [cx, cy], buildMs: Math.round(performance.now() - t0),
    });
    return stats;
  }

  function resize() {
    const px = Math.round(canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 2));
    if (px && canvas.width !== px) canvas.width = canvas.height = px;
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000 || 0); last = now;
    resize();
    const eye = camera.update(dt);
    const flat = camera.flat;
    const cell = 2 / G;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);

    if (voxelMesh && voxelMesh.count) {
      const u = voxelProg.uniforms;
      gl.useProgram(voxelProg.prog);
      gl.uniformMatrix4fv(u.uView, false, camera.view);
      gl.uniformMatrix4fv(u.uProj, false, camera.proj);
      gl.uniform1f(u.uHalf, cell * (P.shrink + (0.5 - P.shrink) * flat));
      gl.uniform3fv(u.uCamPos, eye);
      gl.uniform1f(u.uAlpha, P.glassAlpha);
      gl.uniform1f(u.uLightScale, P.lightScale);
      gl.uniform3f(u.uCubeCenter, 0, 0, 0);
      gl.uniform1f(u.uCubeHalfSize, 1);
      gl.uniform3f(u.uLightDir, 0.4, 1.0, 0.3);
      gl.uniform3f(u.uLightCol, 1, 1, 1);
      gl.uniform1f(u.uTime, now / 1000);
      gl.uniform1f(u.uFlat, flat);
      gl.uniform1f(u.uTopEmissive, P.topEmissive);
      gl.uniform1f(u.uTopAlpha, P.topAlpha);
      gl.uniform1f(u.uTopSpec, P.topSpec);
      gl.uniform1f(u.uSideTint, P.sideTint);
      gl.uniform3fv(u.uPointLightPos, LIGHT_POS);
      gl.uniform3fv(u.uPointLightCol, LIGHT_COL);
      gl.uniform1i(u.uPointLightCount, 3);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      // Leaves first, writing depth (they occlude each other and everything behind them)…
      gl.uniform1f(u.uTop, 1);
      gl.bindVertexArray(voxelMesh.top.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, voxelMesh.top.verts, voxelMesh.count);
      // …then the glass panels, blended, depth-tested but not written.
      if (flat < 1) {
        gl.depthMask(false);
        gl.uniform1f(u.uTop, 0);
        gl.bindVertexArray(voxelMesh.rest.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, voxelMesh.rest.verts, voxelMesh.count);
      }
    }

    if (lineMesh && flat < 1) {
      gl.depthMask(false);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindVertexArray(lineMesh.vao);
      const fade = 1 - flat;
      for (const [p, width, cap, opacity] of [[glowProg, P.glowWidth, 1, P.glowOpacity], [coreProg, P.lineWidth, 0, P.lineOpacity]]) {
        gl.useProgram(p.prog);
        gl.uniformMatrix4fv(p.uniforms.uView, false, camera.view);
        gl.uniformMatrix4fv(p.uniforms.uProj, false, camera.proj);
        gl.uniform1f(p.uniforms.uWidth, width * cell);
        gl.uniform1f(p.uniforms.uCap, cap);
        gl.uniform1f(p.uniforms.uFlat, flat);
        gl.uniform1f(p.uniforms.uOpacity, opacity * fade);
        gl.drawElements(gl.TRIANGLES, lineMesh.indexCount, gl.UNSIGNED_INT, 0);
      }
    }
    gl.bindVertexArray(null);
  }

  rebuild();
  raf = requestAnimationFrame(frame);
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'f' || e.key === ' ') { e.preventDefault(); camera.toggle(); }
    if (e.key === 'r') camera.setFlat(true);
  });

  return { rebuild, camera, stats, gl, dispose() { cancelAnimationFrame(raf); voxelMesh?.dispose(); lineMesh?.dispose(); } };
}

if (typeof window !== 'undefined' && window.FOREST) {
  createViewer(document.getElementById('c'), window.FOREST);
}

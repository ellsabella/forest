// Two view modes (PLAN §8).
//   flat    — orthographic, straight down the depth axis: reproduces the SVG.
//   explore — perspective orbit / zoom. Starts from the flat pose, so the first drag
//             "breaks" the magic eye.
// `flat` is animated 0..1; projection, voxel size and shading all blend on it.

import { G } from './params.js';
import { mat4, perspective, ortho, orbitView, orbitEye } from './math.js';

const FLAT_PITCH = Math.PI / 2;
const EXPLORE_POSE = { yaw: 0.55, pitch: 0.62 };
const EXPLORE_DIST = 1.6;                 // × the flat-fit distance, so the rotated cube stays in frame

// `extent` = half-width of the scene in world units: 1 for one tree, 3 for a 3×3 forest.
// `span()` → [lo, hi] world-y extent of the scene (cube + trunks), used to centre the explore orbit.
export function createCamera(canvas, P, extent = 1, span = () => [-1 - P.trunkDepth * 2 / G, 1]) {
  const fitDist = () => extent / Math.tan((P.fov * Math.PI / 180) / 2);   // scene mid-plane fills the frame
  // Explore view frames the whole scene: orbit its vertical centre, from a bit further back.
  const height = () => { const [lo, hi] = span(); return hi - lo; };
  const exploreDist = () => fitDist() * EXPLORE_DIST * (1 + 0.4 * (height() - 2) / (2 * extent));
  const cur = { yaw: 0, pitch: FLAT_PITCH, dist: fitDist(), flat: 1 };
  const tgt = { ...cur };
  const view = mat4(), proj = mat4(), pPersp = mat4(), pOrtho = mat4();
  const pointers = new Map();
  let pinch = 0;

  const setFlat = on => {
    tgt.flat = on ? 1 : 0;
    if (on) { tgt.yaw = Math.round(cur.yaw / (2 * Math.PI)) * 2 * Math.PI; tgt.pitch = FLAT_PITCH; tgt.dist = fitDist(); }
    else if (tgt.pitch > 1.4) { tgt.yaw = cur.yaw + EXPLORE_POSE.yaw; tgt.pitch = EXPLORE_POSE.pitch; tgt.dist = exploreDist(); }
  };

  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); pinch = 0; });
  const up = e => { pointers.delete(e.pointerId); pinch = 0; };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointermove', e => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 1) {
      tgt.flat = 0;
      tgt.yaw   += (e.clientX - prev[0]) * 0.008;
      tgt.pitch  = Math.max(-1.5, Math.min(FLAT_PITCH, tgt.pitch + (e.clientY - prev[1]) * 0.008));
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) zoom(pinch / d);
      pinch = d;
    }
  });
  const zoom = f => { tgt.flat = 0; tgt.dist = Math.max(1.3 * extent, Math.min(9 * extent, tgt.dist * f)); };
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
  canvas.addEventListener('dblclick', () => setFlat(true));

  return {
    view, proj,
    get flat() { return cur.flat; },
    get isFlat() { return tgt.flat === 1; },
    setFlat,
    toggle() { setFlat(tgt.flat !== 1); },
    pose(yaw, pitch, dist = exploreDist()) { Object.assign(tgt, { yaw, pitch, dist, flat: 0 }); Object.assign(cur, tgt); },
    update(dt) {
      if (tgt.flat === 0 && pointers.size === 0) tgt.yaw += P.autoRotate * dt;
      const k = 1 - Math.exp(-dt * 7);
      for (const key of ['yaw', 'pitch', 'dist', 'flat']) cur[key] += (tgt[key] - cur[key]) * k;
      if (Math.abs(tgt.flat - cur.flat) < 1e-3) cur.flat = tgt.flat;

      // Smoothstep the blend so the projection eases out of / into ortho.
      const f = cur.flat * cur.flat * (3 - 2 * cur.flat);
      const [lo, hi] = span();
      const target = [0, (lo + hi) / 2 * (1 - f), 0];        // flat: cube centre; explore: scene centre
      orbitView(view, cur.yaw, cur.pitch, cur.dist, target);
      perspective(pPersp, P.fov * Math.PI / 180, 1, 0.05, 40 * extent);
      ortho(pOrtho, -extent, extent, -extent, extent, 0.05, 40 * extent);
      for (let i = 0; i < 16; i++) proj[i] = pPersp[i] + (pOrtho[i] - pPersp[i]) * f;
      return orbitEye(cur.yaw, cur.pitch, cur.dist, target);
    },
  };
}

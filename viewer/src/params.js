// Grid size + every tunable. G is the only place the grid size is written down.

export const G = 64;

export const PARAMS = {
  // ---- voxel placement (grid.js) ----
  nMax: 4,              // max voxels per coloured column
  thresh: 0.55,        // extra voxels (2nd..nMax) need density above this
  minGap: 3,            // min depth separation between voxels of one column
  jitter: 0.30,         // per-voxel hash added to density → scatter instead of bars
  noiseWeight: 0.65,    // how much the 3D noise modulates the crown shell
  crownTop: 0.95,       // crown height at the trunk axis (0..1 of cube height)
  crownDrop: 0.60,      // how far the crown surface falls toward the rim
  crownThick: 0.20,     // thickness of the leafy shell
  alphaMode: 'equal',   // 'equal' | 'frontWeighted'

  // ---- voxel look (voxels.js + shaders) ----
  shrink: 0.46,         // half-extent as a fraction of a cell in explore view (flat view uses 0.5)
  topEmissive: 0.80,    // leaf (top face) colour strength
  topAlpha: 0.95,
  topSpec: 0.06,        // how much light specular lands on the coloured face
  sideTint: 0.20,       // side/bottom panels: cell colour × this
  glassAlpha: 0.55,
  lightScale: 0.5,      // RGB point-light strength (1.0 = blockcassone; washes out the palette here)
  walkerBoost: 2.8,     // alpha multiplier for voxels a walk touched

  // ---- walker ----
  walkCount: 110,
  terminateProb: 0.003,
  maxSteps: 700,
  maxSurfaceSteps: 3,   // edges traced on a leaf before departing (reference: 6)
  minFlight: 6,         // steps a departed walk must fly before it may land on a leaf again
  downBias: 3.2,
  upBias: 0.12,
  attract: 2.6,         // pull toward the trunk axis…
  canopyDamp: 0.75,     // …weakened high in the canopy
  orbitRadius: 2.5,     // inside this radius (in cells) inward moves are…
  repel: 0.35,          // …discouraged → paths orbit instead of collapsing to a spine
  straightBias: 2.4,

  // ---- lines ----
  lineWidth: 0.10,      // in cells
  glowWidth: 0.95,      // in cells
  lineOpacity: 0.65,
  glowOpacity: 0.12,
  lineTint: [1.6, 1.7, 1.9],
  lineLeafColour: 0.55, // 0 = all lineTint, 1 = each walk takes its launch leaf's colour

  // ---- camera ----
  fov: 40,
  autoRotate: 0.0,      // rad/s in explore view
};

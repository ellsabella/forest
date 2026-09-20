// Grid size + every tunable. G is the only place the grid size is written down.
//
// Values live in params-defaults.js (machine-written by the dev page's "save as defaults");
// this file documents what each key means. PARAMS is a live copy the viewer reads every frame.

import DEFAULTS, { RANGES as DEFAULT_RANGES } from './params-defaults.js';

export const G = 64;
export const PARAMS = structuredClone(DEFAULTS);
export const RANGES = structuredClone(DEFAULT_RANGES);

/* ---- key reference ---------------------------------------------------------------------
 lights[i].pos / .col   cube-relative point lights (cube = ±1); colours 0..1 × lightIntensity
 lightIntensity         HDR multiplier on the light colours (blockcassone used 5.0 pure RGB)

 paletteContrast        0 = palette as supplied, 1 = lightness exactly on the dark→light ramp
 paletteDark/Light      HSL lightness targets for slot 1 / slot 9
 paletteGamma           > 1 keeps more of the ramp dark (deeper shadows)
 paletteDesat           saturation loss reached at slot 9 (ramps in from paletteDesatFrom)
 paletteDesatHue        extra loss for highlights whose hue differs from the palette's base hue
 paletteDesatFrom       where along the ramp (0..1) desaturation starts

 nMax                   max voxels per coloured column
 thresh                 extra voxels (2nd..nMax) need density above this
 minGap                 min depth separation between voxels of one column
 jitter                 per-voxel hash added to density → scatter instead of bars
 noiseWeight            how much the 3D noise modulates the crown shell
 crownTop/Drop/Thick    crown height at the axis (0..1), fall toward the rim, shell thickness
 alphaMode              'equal' | 'frontWeighted' column alpha weighting

 clumpCount/Size        lower leaf clumps: number, radius in cells (each ×0.6..1.4)
 clumpStrength          density at a clump centre; must beat `thresh` to gather voxels
 clumpLo/Hi             clump centre heights, 0..1 of cube height
 clumpPull/Attract      walker: pull radius (× clump radius, 0 = off) and weight on closing steps

 shrink                 voxel half-extent as a fraction of a cell in explore view (flat uses 0.5)
 topEmissive/Alpha/Spec leaf face: colour strength, opacity, reflection share
 leafDiffuse            point lights illuminate leaf colour (0 = purely emissive)
 leafLift               explore-only brightening of dark palette slots (flat view is exact)
 edgeMin                floor on the glass rim tint so dark voxels keep an outline
 sideTint               glass panels: cell colour × this
 glassAlpha             glass panel opacity
 facet                  per-voxel normal tilt (0 = perfect planes → whole-plane flashes)
 specFresnel            point-light reflection head-on (grazing = 1)
 lightScale             point-light strength in the glass shader
 walkerBoost            alpha multiplier for voxels a walk touched

 trunkDepth             cells the walk lattice extends below the cube — room for the trunk
 walkCount, terminateProb, maxSteps, maxSurfaceSteps, minFlight
 downBias/upBias        flight weights on descending / ascending steps
 attract, canopyDamp    pull toward the trunk axis, weakened high in the canopy
 orbitRadius, repel     inside this radius inward moves are discouraged → orbiting bundle
 straightBias           weight on continuing straight
 lineLeafColour         0 = all lineTint, 1 = each walk takes its launch leaf's colour

 rootDip                cells a root may twist below the ground plane
 rootOutward/Straight   root weights on moving away from the axis / continuing straight
 rootWiggle             weight on vertical steps (0 = perfectly flat roots)
 rootFade               brightness multiplier at every horizontal turn
 rootTerminate          per-step chance a root just stops
 rootExtra/Spawn        extra roots from around the trunk's foot, scattered within N cells

 lineWidth/glowWidth    in cells;  lineOpacity/glowOpacity;  lineTint [r,g,b]

 twinkle/twinkleSpeed   fraction of voxels that blink, and how fast
 sparkle                per-voxel shimmer on reflections (0 = steady)
 fallCount/Gap          falling-leaf ghost columns and spacing (rebuild)
 fallSpeed/Width/Alpha/Sway   descent rate, lit window, opacity, sideways drift

 forestLight/forestGlow multiply light intensity / glow opacities when trees share a scene
 fov, autoRotate        camera
--------------------------------------------------------------------------------------- */

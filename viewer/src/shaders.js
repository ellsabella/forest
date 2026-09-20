// GLSL as JS strings (no fetch — the on-chain build inlines this file as-is).

// ---- Voxels -------------------------------------------------------------------------
// Instanced unit cube. Port of reference normie-voxel.{vert,frag}: env sampling removed
// (no textures on-chain), per-instance colour added, flat/explore blend added.

export const VOXEL_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3  aPosition;   // unit cube corner, ±1
layout(location = 1) in vec3  aNormal;
layout(location = 2) in vec3  aColor;      // per instance
layout(location = 3) in vec3  aCenter;     // per instance
layout(location = 4) in float aAlpha;      // per instance
layout(location = 5) in float aVariant;    // per instance
uniform mat4  uView;
uniform mat4  uProj;
uniform float uHalf;                       // voxel half-extent, world units
uniform float uFall;                       // 1 = falling-leaf ghosts: sway sideways over time
uniform float uFallSway;
uniform float uTime;
uniform vec3  uOffset;                     // where this tree stands (several trees share one scene)
out vec3  vWorldPos;
out vec3  vNormal;
out vec3  vColor;
out float vAlpha;
out float vVariant;
void main() {
  vec3 c = aCenter + uOffset;
  if (uFall > 0.5) {
    float t = uTime * 1.3 + aVariant * 40.0 + aAlpha * 9.0;
    c.xz += vec2(sin(t), cos(t * 0.8)) * uFallSway;
  }
  vec3 wp   = c + aPosition * uHalf;
  vWorldPos = wp;
  vNormal   = aNormal;
  vColor    = aColor;
  vAlpha    = aAlpha;
  vVariant  = aVariant;
  gl_Position = uProj * uView * vec4(wp, 1.0);
}`;

export const VOXEL_FRAG = `#version 300 es
precision highp float;
in vec3  vWorldPos;
in vec3  vNormal;
in vec3  vColor;
in float vAlpha;
in float vVariant;

uniform vec3  uCamPos;
uniform float uAlpha;
uniform float uLightScale;
uniform vec3  uCubeCenter;
uniform float uCubeHalfSize;
uniform vec3  uLightDir;
uniform vec3  uLightCol;
uniform float uTime;
uniform float uFlat;          // 1 = flat view (pure palette colour), 0 = explore
uniform float uTop;           // 1 = leaf pass (+Y faces), 0 = glass panels
uniform float uTopEmissive;
uniform float uTopAlpha;
uniform float uTopSpec;
uniform float uLeafDiffuse;   // how much the point lights illuminate leaf colour
uniform float uLeafLift;      // explore-only brightening of dark leaf colours (flat view is exact)
uniform float uEdgeMin;       // floor on the glass rim glow so dark voxels keep their outline
uniform float uSideTint;
uniform float uFacet;         // per-voxel normal tilt: breaks the whole-plane highlight into facets
uniform float uSpecFresnel;   // point-light reflection at head-on incidence (1 at grazing)
uniform float uTwinkleFrom;   // voxels with variant above this blink (reference: 0.96)
uniform float uTwinkleSpeed;
uniform float uSparkle;       // per-voxel shimmer on reflections, 0 = steady
uniform float uAdditive;      // 1 = premultiplied additive output (glass panels add light, never occlude)
uniform float uFall;          // falling-leaf ghost pass
uniform float uFallSpeed;     // falls per second along a chain
uniform float uFallWidth;     // lit window as a fraction of the chain

#define MAX_PT_LIGHTS 8
uniform vec3 uPointLightPos[MAX_PT_LIGHTS];
uniform vec3 uPointLightCol[MAX_PT_LIGHTS];
uniform int  uPointLightCount;

out vec4 fragColor;

float schlick(float cosTheta) {
  float x  = 1.0 - cosTheta;
  float x2 = x * x;
  float x5 = x2 * x2 * x;
  return mix(0.04, 1.0, x5);
}

void main() {
  // Each voxel is a slightly different pane of glass: tilt its normals by a hash of vVariant so
  // reflections sparkle across the cluster instead of flashing a whole plane at once.
  vec3 jitter = vec3(vVariant, fract(vVariant * 7.31), fract(vVariant * 13.17)) - 0.5;
  vec3 N = normalize(normalize(vNormal) + jitter * uFacet);
  vec3 V = normalize(uCamPos - vWorldPos);
  if (dot(N, V) < 0.0) N = -N;

  float NdotV = max(dot(N, V), 0.0);
  float fres  = schlick(NdotV);

  vec3 H      = normalize(normalize(uLightDir) + V);
  float specP = pow(max(dot(N, H), 0.0), 48.0);
  float inertMask  = 1.0 - step(0.26, vVariant);
  float brightMask = step(0.86, vVariant) * (1.0 - step(uTwinkleFrom, vVariant));
  float glitchMask = step(uTwinkleFrom, vVariant);
  float react = mix(0.48, 0.90, 1.0 - inertMask);
  react = mix(react, 1.18, brightMask);

  float glitchWave  = 0.5 + 0.5 * sin(uTime * uTwinkleSpeed * (7.0 + vVariant * 9.0) + vVariant * 53.0);
  float glitchBlink = mix(0.45, 1.35, smoothstep(0.22, 1.0, glitchWave));
  react = mix(react, glitchBlink, glitchMask);

  vec3 spec = uLightCol * specP * (2.2 + fres * 0.6) * uLightScale * react;

  vec3 ptSpec = vec3(0.0);
  vec3 diffuse = vec3(0.0);
  for (int i = 0; i < MAX_PT_LIGHTS; i++) {
    if (i >= uPointLightCount) break;
    vec3  lightPos = uCubeCenter + uPointLightPos[i] * uCubeHalfSize;
    vec3  Lp   = normalize(lightPos - vWorldPos);
    float dist = length(lightPos - vWorldPos);
    float att  = 1.0 / (1.0 + dist * dist * 0.08);
    vec3  Hp   = normalize(Lp + V);
    float sp   = pow(max(dot(N, Hp), 0.0), 18.0);
    ptSpec    += uPointLightCol[i] * sp * att * react;
    diffuse   += uPointLightCol[i] * max(dot(N, Lp), 0.0) * att;
  }
  diffuse = diffuse / (1.0 + diffuse);          // soft roll-off, keeps the light's hue
  // Glass reflects little head-on and strongly at grazing angles.
  ptSpec *= uLightScale * mix(uSpecFresnel, 1.0, fres);
  // Shimmer: every pane's reflection breathes on its own phase.
  float shimmer = 1.0 + uSparkle * sin(uTime * (3.0 + vVariant * 9.0) + vVariant * 97.0);
  ptSpec *= max(0.0, shimmer);
  spec   *= max(0.0, shimmer);

  // In 3D, dark palette slots would vanish against black: lift them (sqrt brightens darks most,
  // keeps hue and ordering). Flat view uses vColor untouched.
  vec3 leaf3d = mix(vColor, sqrt(vColor), uLeafLift);

  // Glass panel (sides / bottom): reference look, tinted by the dimmed cell colour, with a
  // neutral floor on the rim glow so every voxel keeps a visible outline.
  vec3 tint      = max(leaf3d * uSideTint, vec3(uEdgeMin));
  vec3 tintShift = mix(tint, tint.brg, glitchMask * 0.22 * glitchWave);
  vec3 base = tintShift * 0.06 * mix(0.55, 1.0, react);
  vec3 edge = tintShift * fres * fres * mix(0.92, 2.00, react);
  // Soft roll-off keeps stacked highlights from clipping to flat white (hue is preserved).
  vec3 refl = spec + ptSpec;
  refl = refl / (1.0 + refl);
  vec3 glassCol = base + edge + refl;
  float specBoost  = clamp(dot(refl, vec3(0.299, 0.587, 0.114)), 0.0, 1.0) * 0.45;
  float alphaReact = mix(0.58, 1.08, react);
  alphaReact = mix(alphaReact, glitchBlink, glitchMask);
  float glassA = uAlpha * vAlpha * alphaReact * mix(0.25, 0.98, fres) + specBoost;

  // Leaf (top face): carries the palette colour, catches a little of the lights.
  // Leaf = its own colour (emissive) + the coloured lights falling on it (diffuse) + a little reflection.
  vec3  leafCol = leaf3d * (uTopEmissive * mix(0.85, 1.1, react) + diffuse * uLeafDiffuse) + refl * uTopSpec;
  float leafA   = uTopAlpha;

  vec3  col = mix(glassCol, leafCol, uTop);
  float a   = mix(glassA,   leafA,   uTop);

  // Falling-leaf ghosts: vAlpha = position along the chain (0 top … 1 floor), vVariant = the
  // column's phase. A lit window travels down the chain; a fast flicker makes it glitch in and out.
  if (uFall > 0.5) {
    float p    = fract(uTime * uFallSpeed * (0.7 + 0.6 * vVariant) + vVariant);
    float env  = 1.0 - smoothstep(0.0, uFallWidth, abs(p - vAlpha));
    float flick = 0.55 + 0.45 * sin(uTime * (17.0 + vVariant * 13.0) + vAlpha * 40.0);
    a = leafA * env * flick;
  }

  // Flat view: leaves are exactly the palette colour; panels vanish.
  col = mix(col, vColor, uFlat);
  a   = mix(a, uTop * (1.0 - uFall), uFlat);
  a   = clamp(a, 0.0, 1.0);

  fragColor = uAdditive > 0.5 ? vec4(col * a, 1.0) : vec4(col, a);
}`;

// ---- Walk lines -----------------------------------------------------------------------
// One quad per segment, expanded toward the camera in the vertex stage (the reference
// used fixed world-space quads, which vanish edge-on). uCap = 1 adds the round-cap
// extension for the glow pass. Frags are the reference lines / normie-glow shaders
// plus per-vertex colour.

export const LINE_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3  aPosition;   // segment endpoint
layout(location = 1) in vec3  aNormal;     // unit segment direction
layout(location = 2) in vec2  aUv;         // x: 0 start / 1 end, y: side −1 / +1
layout(location = 3) in vec3  aColor;
layout(location = 4) in float aAlpha;      // segment length, world units
uniform mat4  uView;
uniform mat4  uProj;
uniform float uWidth;
uniform float uCap;
uniform float uFlat;
uniform vec3  uOffset;
out vec2  vUv;
out float vLengthHw;
out vec3  vColor;
void main() {
  float hw  = uWidth * 0.5;
  float end = aUv.x * 2.0 - 1.0;
  vec4 pv   = uView * vec4(aPosition + uOffset, 1.0);
  vec3 dv   = mat3(uView) * aNormal;
  vec3 toEye = normalize(mix(-pv.xyz, vec3(0.0, 0.0, 1.0), uFlat));
  vec3 side = cross(dv, toEye);
  float sl  = length(side);
  side = sl > 1e-4 ? side / sl : vec3(0.0);
  pv.xyz += dv * (end * hw * uCap) + side * (aUv.y * hw);
  vLengthHw = aAlpha / hw;
  vUv       = vec2(aUv.x * vLengthHw + end * uCap, aUv.y);
  vColor    = aColor;
  gl_Position = uProj * pv;
}`;

export const LINE_CORE_FRAG = `#version 300 es
precision highp float;
in vec2  vUv;
in float vLengthHw;
in vec3  vColor;
uniform float uOpacity;
out vec4 fragColor;
void main() {
  fragColor = vec4(vColor * uOpacity, 1.0);
}`;

export const LINE_GLOW_FRAG = `#version 300 es
precision highp float;
in vec2  vUv;
in float vLengthHw;
in vec3  vColor;
uniform float uOpacity;
out vec4 fragColor;
void main() {
  float clamped = clamp(vUv.x, 0.0, vLengthHw);
  float dist    = length(vec2(vUv.x - clamped, vUv.y));
  float intensity = exp(-dist * dist * 3.5);
  fragColor = vec4(vColor * (uOpacity * intensity), 1.0);
}`;

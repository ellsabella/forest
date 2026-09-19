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
out vec3  vWorldPos;
out vec3  vNormal;
out vec3  vColor;
out float vAlpha;
out float vVariant;
void main() {
  vec3 wp   = aCenter + aPosition * uHalf;
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
uniform float uSideTint;

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
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  if (dot(N, V) < 0.0) N = -N;

  float NdotV = max(dot(N, V), 0.0);
  float fres  = schlick(NdotV);

  vec3 H      = normalize(normalize(uLightDir) + V);
  float specP = pow(max(dot(N, H), 0.0), 48.0);
  float inertMask  = 1.0 - step(0.26, vVariant);
  float brightMask = step(0.86, vVariant) * (1.0 - step(0.96, vVariant));
  float glitchMask = step(0.96, vVariant);
  float react = mix(0.48, 0.90, 1.0 - inertMask);
  react = mix(react, 1.18, brightMask);

  float glitchWave  = 0.5 + 0.5 * sin(uTime * (7.0 + vVariant * 9.0) + vVariant * 53.0);
  float glitchBlink = mix(0.45, 1.35, smoothstep(0.22, 1.0, glitchWave));
  react = mix(react, glitchBlink, glitchMask);

  vec3 spec = uLightCol * specP * (2.2 + fres * 0.6) * uLightScale * react;

  vec3 ptSpec = vec3(0.0);
  for (int i = 0; i < MAX_PT_LIGHTS; i++) {
    if (i >= uPointLightCount) break;
    vec3  lightPos = uCubeCenter + uPointLightPos[i] * uCubeHalfSize;
    vec3  Lp   = normalize(lightPos - vWorldPos);
    float dist = length(lightPos - vWorldPos);
    float att  = 1.0 / (1.0 + dist * dist * 0.08);
    vec3  Hp   = normalize(Lp + V);
    float sp   = pow(max(dot(N, Hp), 0.0), 18.0);
    ptSpec    += uPointLightCol[i] * sp * att * (1.0 + fres) * react;
  }
  ptSpec *= uLightScale;

  // Glass panel (sides / bottom): reference look, tinted by the dimmed cell colour.
  vec3 tint      = vColor * uSideTint;
  vec3 tintShift = mix(tint, tint.brg, glitchMask * 0.22 * glitchWave);
  vec3 base = tintShift * 0.06 * mix(0.55, 1.0, react);
  vec3 edge = tintShift * fres * fres * mix(0.92, 2.00, react);
  vec3 glassCol = base + edge + spec + ptSpec;
  float specBoost  = clamp(dot(spec + ptSpec, vec3(0.299, 0.587, 0.114)), 0.0, 1.0) * 0.75;
  float alphaReact = mix(0.58, 1.08, react);
  alphaReact = mix(alphaReact, glitchBlink, glitchMask);
  float glassA = uAlpha * vAlpha * alphaReact * mix(0.25, 0.98, fres) + specBoost;

  // Leaf (top face): carries the palette colour, catches a little of the lights.
  vec3  leafCol = vColor * uTopEmissive * mix(0.85, 1.1, react) + (spec + ptSpec) * uTopSpec;
  float leafA   = uTopAlpha;

  vec3  col = mix(glassCol, leafCol, uTop);
  float a   = mix(glassA,   leafA,   uTop);

  // Flat view: leaves are exactly the palette colour; panels vanish.
  col = mix(col, vColor, uFlat);
  a   = mix(a, uTop, uFlat);

  fragColor = vec4(col, clamp(a, 0.0, 1.0));
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
out vec2  vUv;
out float vLengthHw;
out vec3  vColor;
void main() {
  float hw  = uWidth * 0.5;
  float end = aUv.x * 2.0 - 1.0;
  vec4 pv   = uView * vec4(aPosition, 1.0);
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

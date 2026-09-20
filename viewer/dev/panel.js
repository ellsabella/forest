// Reusable control panel for the dev pages. One panel drives one params object (single
// mode: a slider per param) or a ranges object (range mode: min/max per param, for the grid).
// Nothing here ships on-chain.

import { PARAMS } from '../src/params.js';
import { PALETTES, paletteByName, paletteSlots, shapePalette } from '../src/palettes.js';
import { seededPalette } from '../../pixelart/pfp-library/js/palette.js';
import { hashInt } from '../src/hash.js';

export const $ = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids); return el; };
export const hex = rgb => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
export const randomSeed = () => { const a = new Uint32Array(4); crypto.getRandomValues(a); return a.reduce((n, w) => (n << 32n) | BigInt(w), 0n).toString(); };
export const SEEDED = '(seeded ramp)';

// [key, min, max, step, needsRebuild, label?]
export const SLIDERS = {
  'Palette shaper': [
    ['paletteContrast', 0, 1, 0.01, true], ['paletteDark', 0, 0.5, 0.01, true], ['paletteLight', 0.5, 1, 0.01, true], ['paletteGamma', 0.4, 3, 0.05, true],
    ['paletteDesat', 0, 1, 0.01, true], ['paletteDesatHue', 0, 1, 0.01, true], ['paletteDesatFrom', 0, 1, 0.01, true],
  ],
  'Placement': [
    ['nMax', 1, 8, 1, true], ['thresh', 0, 1, 0.01, true], ['minGap', 1, 12, 1, true], ['jitter', 0, 1, 0.01, true],
    ['noiseWeight', 0, 1, 0.01, true], ['crownTop', 0.3, 1, 0.01, true], ['crownDrop', 0, 1.2, 0.01, true], ['crownThick', 0.03, 0.8, 0.01, true],
  ],
  'Lower clumps': [
    ['clumpCount', 0, 16, 1, true], ['clumpSize', 2, 20, 0.5, true], ['clumpStrength', 0, 2, 0.05, true],
    ['clumpLo', 0, 1, 0.01, true], ['clumpHi', 0, 1, 0.01, true], ['clumpPull', 0, 5, 0.1, true], ['clumpAttract', 1, 10, 0.1, true],
  ],
  'Walker': [
    ['trunkDepth', 0, 128, 1, true], ['walkCount', 0, 400, 1, true], ['terminateProb', 0, 0.03, 0.0005, true], ['maxSteps', 50, 2000, 10, true],
    ['maxSurfaceSteps', 0, 20, 1, true], ['minFlight', 0, 40, 1, true], ['downBias', 0.2, 10, 0.1, true], ['upBias', 0, 2, 0.01, true],
    ['attract', 1, 8, 0.1, true], ['canopyDamp', 0, 1, 0.01, true], ['orbitRadius', 0, 12, 0.1, true],
    ['repel', 0, 1.5, 0.01, true], ['straightBias', 0.5, 10, 0.1, true], ['lineLeafColour', 0, 1, 0.01, true],
  ],
  'Roots': [
    ['rootExtra', 0, 60, 1, true], ['rootSpawn', 0, 12, 1, true], ['rootOutward', 1, 10, 0.1, true], ['rootStraight', 0.5, 10, 0.1, true],
    ['rootWiggle', 0, 2, 0.01, true], ['rootDip', 0, 12, 1, true], ['rootFade', 0.5, 1, 0.01, true], ['rootTerminate', 0, 0.01, 0.0001, true],
  ],
  'Voxel look': [
    ['shrink', 0.1, 0.5, 0.01], ['topEmissive', 0, 1.5, 0.01], ['topAlpha', 0, 1, 0.01], ['topSpec', 0, 2, 0.01], ['leafDiffuse', 0, 3, 0.05],
    ['leafLift', 0, 1, 0.01], ['edgeMin', 0, 0.6, 0.01], ['sideTint', 0, 1, 0.01], ['glassAlpha', 0, 1.5, 0.01], ['facet', 0, 0.6, 0.01],
    ['specFresnel', 0, 1, 0.01], ['lightScale', 0, 3, 0.01], ['lightIntensity', 0, 8, 0.1], ['walkerBoost', 1, 5, 0.1, true],
  ],
  'Lines': [
    ['lineWidth', 0.01, 0.6, 0.01], ['glowWidth', 0.1, 4, 0.05], ['lineOpacity', 0, 1.5, 0.01], ['glowOpacity', 0, 0.6, 0.005],
  ],
  'Magic': [
    ['twinkle', 0, 0.5, 0.01], ['twinkleSpeed', 0, 4, 0.05], ['sparkle', 0, 1.5, 0.01],
    ['fallCount', 0, 400, 1, true], ['fallGap', 1, 10, 1, true], ['fallSpeed', 0, 0.5, 0.005], ['fallWidth', 0.02, 0.5, 0.01],
    ['fallAlpha', 0, 1, 0.01], ['fallSway', 0, 3, 0.05],
  ],
  'Forest scene': [['forestLight', 0, 1.5, 0.01], ['forestGlow', 0, 1.5, 0.01]],
  'Camera': [['fov', 15, 80, 1], ['autoRotate', 0, 1, 0.01]],
};
PARAMS.lights.forEach((_, i) => {
  SLIDERS[`Light ${i + 1}`] = [
    ...['R', 'G', 'B'].map((c, k) => [`lights.${i}.col.${k}`, 0, 1, 0.01, false, c]),
    ...['X', 'Y', 'Z'].map((c, k) => [`lights.${i}.pos.${k}`, -2.5, 2.5, 0.01, false, c]),
  ];
});
export const ALL_SLIDERS = Object.values(SLIDERS).flat();

export const getPath = (obj, key) => key.split('.').reduce((o, p) => o[p], obj);
export const setPath = (obj, key, v) => { const p = key.split('.'); p.slice(0, -1).reduce((o, q) => o[q], obj)[p.at(-1)] = v; };

// token palette (9 hex, shaped) for a palette choice: a PALETTES name or a seed for a ramp
export function resolvePalette(pal, params) {
  const named = paletteByName(pal);
  const raw = named ? paletteSlots(named)
                    : seededPalette(/^\d+$/.test(pal) ? Number(pal) : pal).slice(1).map(hex);
  return shapePalette(raw, params);
}

// POST the current values to the dev server, which rewrites viewer/src/params-defaults.js.
export async function saveDefaults(params, ranges) {
  const r = await fetch('/dev/save-params', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ params, ranges }) });
  const j = await r.json().catch(() => ({ ok: false, error: r.statusText }));
  if (!j.ok) throw new Error(j.error || 'save failed (is viewer/serve.py the server?)');
  return j.file;
}

// Range mode: a tile's value for `key` is hashed from its seed within [lo, hi], snapped to the slider step.
export function resolveRanges(ranges, base, seedStr) {
  const out = structuredClone(base);
  let h = 0;
  for (const ch of seedStr) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  for (const [key, lo, hi, step] of ALL_SLIDERS) {
    const r = ranges[key];
    if (!r) continue;
    let k = 0;
    for (const ch of key) k = (Math.imul(k, 31) + ch.charCodeAt(0)) >>> 0;
    const v = r[0] + (r[1] - r[0]) * hashInt(h, k, 1);
    setPath(out, key, Math.round(v / step) * step);
  }
  return out;
}

/**
 * buildPanel(container, opts)
 *   opts.state    {fixture, seed, pal}  (single/AB) — edited in place
 *   opts.params   params object (single/AB) — edited in place
 *   opts.ranges   {key: [lo, hi]} (grid) — edited in place; params then holds the base values
 *   opts.fixtures index.fixtures
 *   opts.onToken()   fixture/seed/palette changed  → caller rebuilds token
 *   opts.onRebuild() a rebuild-class param changed
 *   opts.onLive()    a live param changed
 *   opts.extra       optional DOM to put under the token block
 * returns { el, sync(), swatches }
 */
export function buildPanel(container, o) {
  const range = !!o.ranges;
  const panel = $('div', { className: 'panel' });
  const swatches = $('div', { className: 'swatches' });

  // ---- token block (single / AB) ----
  let fixtureSel, palSel, palSeed, seedInput;
  const syncPal = () => {
    if (!palSel) return;
    palSel.value = paletteByName(o.state.pal) ? paletteByName(o.state.pal).name : SEEDED;
    palSeed.parentElement.style.display = palSel.value === SEEDED ? '' : 'none';
  };
  if (o.state) {
    fixtureSel = $('select', {}, ...o.fixtures.map(f => $('option', { value: f.id, textContent: `${f.id}  ${f.label}` })));
    fixtureSel.value = o.state.fixture;
    fixtureSel.onchange = () => { o.state.fixture = fixtureSel.value; o.onToken(); };
    seedInput = $('input', { type: 'text', value: o.state.seed });
    seedInput.onchange = () => { o.state.seed = seedInput.value.trim() || '1'; o.onToken(); };
    palSel = $('select', {}, ...PALETTES.map(p => $('option', { value: p.name, textContent: p.name })), $('option', { value: SEEDED, textContent: SEEDED }));
    palSeed = $('input', { type: 'text', value: paletteByName(o.state.pal) ? '1' : o.state.pal });
    palSel.onchange = () => { o.state.pal = palSel.value === SEEDED ? (palSeed.value.trim() || '1') : palSel.value; syncPal(); o.onToken(); };
    palSeed.onchange = () => { o.state.pal = palSeed.value.trim() || '1'; o.onToken(); };
    panel.append(
      $('h2', { textContent: 'Token' }),
      $('label', { className: 'wide' }, 'fixture', fixtureSel),
      $('div', { className: 'row' }, $('button', { textContent: '◀', onclick: () => step(-1) }), $('button', { textContent: '▶', onclick: () => step(1) }),
        $('button', { textContent: 'random fixture', onclick: () => { o.state.fixture = o.fixtures[Math.floor(Math.random() * o.fixtures.length)].id; sync(); o.onToken(); } })),
      $('label', { className: 'wide' }, 'seed', seedInput),
      $('div', { className: 'row' }, $('button', { textContent: 'random seed', onclick: () => { o.state.seed = randomSeed(); sync(); o.onToken(); } })),
      $('label', { className: 'wide' }, 'palette', palSel),
      $('div', { className: 'row' }, palSeed, $('button', { textContent: 'random', onclick: () => { o.state.pal = String(Math.floor(Math.random() * 1e6)); sync(); o.onToken(); } })),
      swatches,
    );
    syncPal();
  }
  const step = d => {
    const i = o.fixtures.findIndex(f => f.id === o.state.fixture);
    o.state.fixture = o.fixtures[(i + d + o.fixtures.length) % o.fixtures.length].id;
    sync(); o.onToken();
  };
  if (o.extra) panel.append(o.extra);

  // ---- sliders ----
  const inputs = [];
  for (const [group, rows] of Object.entries(SLIDERS)) {
    panel.append($('h2', { textContent: group }));
    for (const [key, min, max, stp, rebuild, label] of rows) {
      const fire = () => (rebuild ? o.onRebuild() : o.onLive());
      if (!range) {
        const val = $('span', { className: 'val' });
        const input = $('input', { type: 'range', min, max, step: stp });
        input.oninput = () => { setPath(o.params, key, Number(input.value)); val.textContent = input.value; fire(); };
        inputs.push(() => { input.value = getPath(o.params, key); val.textContent = input.value; });
        panel.append($('label', {}, label || key, input, val));
      } else {
        const r = o.ranges[key] || (o.ranges[key] = [getPath(o.params, key), getPath(o.params, key)]);
        const lo = $('input', { type: 'range', min, max, step: stp }), hi = $('input', { type: 'range', min, max, step: stp });
        const val = $('span', { className: 'val' });
        const show = () => { val.textContent = r[0] === r[1] ? String(r[0]) : `${r[0]}–${r[1]}`; };
        lo.oninput = () => { r[0] = Number(lo.value); if (r[1] < r[0]) { r[1] = r[0]; hi.value = r[1]; } show(); fire(); };
        hi.oninput = () => { r[1] = Number(hi.value); if (r[0] > r[1]) { r[0] = r[1]; lo.value = r[0]; } show(); fire(); };
        inputs.push(() => { lo.value = r[0]; hi.value = r[1]; show(); });
        panel.append($('label', { className: 'range' }, label || key, $('div', { className: 'pair' }, lo, hi), val));
      }
    }
  }
  if (!range) {
    const modeSel = $('select', {}, $('option', { textContent: 'equal' }), $('option', { textContent: 'frontWeighted' }));
    modeSel.onchange = () => { o.params.alphaMode = modeSel.value; o.onRebuild(); };
    inputs.push(() => { modeSel.value = o.params.alphaMode; });
    panel.append($('h2', { textContent: 'Column alpha' }), modeSel);
  }

  function sync() {
    if (fixtureSel) { fixtureSel.value = o.state.fixture; seedInput.value = o.state.seed; syncPal(); if (!paletteByName(o.state.pal)) palSeed.value = o.state.pal; }
    inputs.forEach(f => f());
  }
  sync();
  container.append(panel);
  return { el: panel, sync, swatches, step };
}

// Paint the 9 swatches of a palette into a swatch strip.
export function paintSwatches(el, palette) {
  el.replaceChildren(...palette.map(c => $('div', { style: `background:${c}`, title: c })));
  el.title = palette.join(' ');
}

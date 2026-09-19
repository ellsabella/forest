// Dev-only harness around createViewer: fixture / seed / palette pickers and a slider per
// PARAM. None of this ships on-chain. Serve ~/forest over http and open /viewer/dev.html.
//
// URL params (for sharing a state or headless screenshots):
//   ?fixture=000649&seed=123&pal=7&explore=1

import { PARAMS } from '../src/params.js';
import { createViewer } from '../src/main.js';
import { gridToSvg } from '../src/svg.js';
import { seededPalette } from '../../pixelart/pfp-library/js/palette.js';

// [key, min, max, step, needsRebuild]
const SLIDERS = {
  'Placement': [
    ['nMax', 1, 8, 1, true], ['thresh', 0, 1, 0.01, true], ['minGap', 1, 12, 1, true], ['jitter', 0, 1, 0.01, true],
    ['noiseWeight', 0, 1, 0.01, true], ['crownTop', 0.3, 1, 0.01, true], ['crownDrop', 0, 1.2, 0.01, true], ['crownThick', 0.03, 0.8, 0.01, true],
  ],
  'Walker': [
    ['walkCount', 0, 400, 1, true], ['terminateProb', 0, 0.03, 0.0005, true], ['maxSteps', 50, 2000, 10, true],
    ['maxSurfaceSteps', 0, 20, 1, true], ['minFlight', 0, 40, 1, true], ['downBias', 0.2, 10, 0.1, true], ['upBias', 0, 2, 0.01, true],
    ['attract', 1, 8, 0.1, true], ['canopyDamp', 0, 1, 0.01, true], ['orbitRadius', 0, 12, 0.1, true],
    ['repel', 0, 1.5, 0.01, true], ['straightBias', 0.5, 10, 0.1, true], ['lineLeafColour', 0, 1, 0.01, true],
  ],
  'Voxel look': [
    ['shrink', 0.1, 0.5, 0.01], ['topEmissive', 0, 1.5, 0.01], ['topAlpha', 0, 1, 0.01], ['topSpec', 0, 2, 0.01],
    ['sideTint', 0, 1, 0.01], ['glassAlpha', 0, 1.5, 0.01], ['lightScale', 0, 3, 0.01], ['walkerBoost', 1, 5, 0.1, true],
  ],
  'Lines': [
    ['lineWidth', 0.01, 0.6, 0.01], ['glowWidth', 0.1, 4, 0.05], ['lineOpacity', 0, 1.5, 0.01], ['glowOpacity', 0, 0.6, 0.005],
  ],
  'Camera': [['fov', 15, 80, 1], ['autoRotate', 0, 1, 0.01]],
};

const DEFAULTS = structuredClone(PARAMS);
const STORE = 'forest-dev-v1';
const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
Object.assign(PARAMS, saved.params || {});
const q = new URLSearchParams(location.search);
const state = {
  fixture: q.get('fixture') || saved.fixture || null,
  seed: q.get('seed') || saved.seed || '1',
  pal: q.get('pal') || saved.pal || '1',
};

const $ = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids); return el; };
const hex = rgb => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
const randomSeed = () => { const a = new Uint32Array(4); crypto.getRandomValues(a); return a.reduce((n, w) => (n << 32n) | BigInt(w), 0n).toString(); };

const index = await (await fetch('./fixtures/index.json')).json();
if (!index.fixtures.some(f => f.id === state.fixture)) state.fixture = index.fixtures[0].id;
const grids = new Map();
async function loadGrid(id) {
  if (!grids.has(id)) grids.set(id, (await (await fetch(`./fixtures/${id}.json`)).json()).grid);
  return grids.get(id);
}

let viewer = null, timer = 0;
async function apply() {
  const grid = await loadGrid(state.fixture);
  const palette = seededPalette(/^\d+$/.test(state.pal) ? Number(state.pal) : state.pal).slice(1).map(hex);
  const token = { grid, palette, seed: state.seed };
  if (!viewer) viewer = createViewer(document.getElementById('c'), token, PARAMS);
  else viewer.rebuild(token);

  const svg = gridToSvg(grid, palette);
  document.getElementById('thumb').src = 'data:image/svg+xml;base64,' + btoa(svg);
  swatches.replaceChildren(...palette.map(c => $('div', { style: `background:${c}`, title: c })));
  const s = viewer.stats;
  document.getElementById('stats').textContent =
    `voxels    ${s.voxels}\nwalks     ${s.walks}\nsegments  ${s.segments}\nbuild     ${s.buildMs} ms\ncentroid  ${s.centroid.map(v => v.toFixed(1)).join(', ')}\nsvg       ${(svg.length / 1024).toFixed(1)} KB`;
  localStorage.setItem(STORE, JSON.stringify({ ...state, params: PARAMS }));
  window.__forestReady = true;
}
const applySoon = () => { clearTimeout(timer); timer = setTimeout(apply, 120); };

// ---- panel ----
const panel = document.getElementById('panel');
const fixtureSel = $('select', {}, ...index.fixtures.map(f => $('option', { value: f.id, textContent: `${f.id}  ${f.label}` })));
fixtureSel.value = state.fixture;
fixtureSel.onchange = () => { state.fixture = fixtureSel.value; apply(); };
const stepFixture = d => {
  const i = index.fixtures.findIndex(f => f.id === state.fixture);
  state.fixture = fixtureSel.value = index.fixtures[(i + d + index.fixtures.length) % index.fixtures.length].id;
  apply();
};

const textRow = (name, key, onRandom) => {
  const input = $('input', { type: 'text', value: state[key] });
  input.onchange = () => { state[key] = input.value.trim() || '1'; apply(); };
  return $('div', {}, $('label', { className: 'wide' }, name, input),
    $('div', { className: 'row' }, $('button', { textContent: 'random', onclick: () => { state[key] = input.value = onRandom(); apply(); } })));
};
const swatches = $('div', { id: 'swatches' });

panel.append(
  $('h2', { textContent: 'Token' }),
  $('label', { className: 'wide' }, 'fixture', fixtureSel),
  textRow('seed', 'seed', randomSeed),
  textRow('palette', 'pal', () => String(Math.floor(Math.random() * 1e6))),
  swatches,
  $('div', { className: 'row' },
    $('button', { textContent: 'flat ⇄ explore', onclick: () => viewer.camera.toggle() }),
    $('button', { textContent: 'copy PARAMS', onclick: () => navigator.clipboard.writeText(JSON.stringify(PARAMS, null, 2)) }),
    $('button', { textContent: 'reset PARAMS', onclick: () => { Object.assign(PARAMS, structuredClone(DEFAULTS)); localStorage.removeItem(STORE); location.reload(); } }),
  ),
);

for (const [group, rows] of Object.entries(SLIDERS)) {
  panel.append($('h2', { textContent: group }));
  for (const [key, min, max, step, rebuild] of rows) {
    const val = $('span', { className: 'val', textContent: PARAMS[key] });
    const input = $('input', { type: 'range', min, max, step, value: PARAMS[key] });
    input.oninput = () => { PARAMS[key] = Number(input.value); val.textContent = input.value; rebuild ? applySoon() : localStorage.setItem(STORE, JSON.stringify({ ...state, params: PARAMS })); };
    panel.append($('label', {}, key, input, val));
  }
}
const modeSel = $('select', {}, $('option', { textContent: 'equal' }), $('option', { textContent: 'frontWeighted' }));
modeSel.value = PARAMS.alphaMode;
modeSel.onchange = () => { PARAMS.alphaMode = modeSel.value; apply(); };
panel.append($('h2', { textContent: 'Column alpha' }), modeSel);

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === '[') stepFixture(-1);
  if (e.key === ']') stepFixture(1);
});

await apply();
if (q.get('explore')) viewer.camera.pose(Number(q.get('yaw') ?? 0.55), Number(q.get('pitch') ?? 0.62));
window.viewer = viewer;

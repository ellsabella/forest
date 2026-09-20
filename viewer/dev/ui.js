// Dev harness: three tabs over createViewer. Nothing here ships on-chain.
//   Viewer   — one tree, full controls, SVG thumbnail + stats.
//   A / B    — two independent trees side by side, each with its own controls.
//   Grid 3×3 — nine trees as separate views: random fixtures, nine distinct palettes; every
//              slider is a min–max range and each tree's value is hashed from its seed within it.
//   Forest   — the same nine trees in one scene: seamless mosaic flat, a forest when exploring.
// URL: ?tab=ab|grid|forest  ?fixture=000649&seed=42&pal=Golden&explore=1&yaw=&pitch=  ?p.<param>=value

import { PARAMS, RANGES } from '../src/params.js';
import { createViewer } from '../src/main.js';
import { gridToSvg } from '../src/svg.js';
import { PALETTES } from '../src/palettes.js';
import { $, buildPanel, resolvePalette, resolveRanges, paintSwatches, randomSeed, setPath, saveDefaults } from './panel.js';

const STORE = 'forest-dev-v2';
const DEFAULTS = structuredClone(PARAMS);
const q = new URLSearchParams(location.search);
const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
const index = await (await fetch('./fixtures/index.json')).json();
// "save as defaults" needs viewer/serve.py; on static hosting (Vercel) it is hidden — use export / import.
const canSave = await fetch('/dev/ping').then(r => r.ok).catch(() => false);
const fixtures = index.fixtures;
const grids = new Map();
async function loadGrid(id) {
  if (!grids.has(id)) grids.set(id, (await (await fetch(`./fixtures/${id}.json`)).json()).grid);
  return grids.get(id);
}
const fixtureOr = id => fixtures.some(f => f.id === id) ? id : fixtures[0].id;
const freshParams = over => { const p = structuredClone(DEFAULTS); Object.assign(p, over || {}); if (!Array.isArray(p.lights) || p.lights.length !== DEFAULTS.lights.length) p.lights = structuredClone(DEFAULTS.lights); return p; };
const copyInto = (target, src) => { for (const k of Object.keys(src)) target[k] = src[k]; };
let saveTimer = 0;
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => localStorage.setItem(STORE, JSON.stringify(model)), 150); };

// Export / import box: the raw JSON of params + ranges, to copy into an email or paste back in.
function exportBox(getParams, onLoad) {
  const ta = $('textarea', { rows: 6, spellcheck: false, style: 'width:100%;font:inherit;font-size:10px;background:#0e0e11;color:#b8bec7;border:1px solid #2c2c33;resize:vertical' });
  const refresh = () => { ta.value = JSON.stringify({ params: getParams(), ranges: model.grid.ranges }, null, 1); };
  const status = $('span', { className: 'val', style: 'text-align:left' });
  const load = () => {
    try {
      const j = JSON.parse(ta.value);
      if (j.params) onLoad(j.params);
      if (j.ranges) { for (const k of Object.keys(model.grid.ranges)) delete model.grid.ranges[k]; Object.assign(model.grid.ranges, j.ranges); rangePanels.forEach(p => p.sync()); gridApplySoon(true); }
      status.textContent = 'loaded'; save();
    } catch (e) { status.textContent = 'bad JSON: ' + e.message; }
    setTimeout(() => { status.textContent = ''; }, 4000);
  };
  const el = $('details', {},
    $('summary', { textContent: 'export / import (raw JSON)', style: 'cursor:pointer;color:#7d8590;margin:6px 0' }),
    ta,
    $('div', { className: 'row' },
      $('button', { textContent: 'refresh', onclick: refresh }),
      $('button', { textContent: 'copy', onclick: () => { refresh(); navigator.clipboard.writeText(ta.value); } }),
      $('button', { textContent: 'load', title: 'apply the JSON in the box', onclick: load }), status));
  el.addEventListener('toggle', () => { if (el.open) refresh(); });
  return el;
}

// "save as defaults": write params (+ the grid ranges) into viewer/src/params-defaults.js via serve.py.
// After a save the in-memory DEFAULTS follow, so "reset PARAMS" returns to what was just saved.
function saveButton(getParams) {
  const btn = $('button', { textContent: 'save as defaults', title: 'write these values into viewer/src/params-defaults.js' });
  if (!canSave) btn.style.display = 'none';
  btn.onclick = async () => {
    btn.textContent = 'saving…';
    try {
      const file = await saveDefaults(getParams(), model.grid.ranges);
      copyInto(DEFAULTS, structuredClone(getParams()));
      btn.textContent = `saved → ${file}`;
    } catch (e) { btn.textContent = `save failed: ${e.message}`; }
    setTimeout(() => { btn.textContent = 'save as defaults'; }, 4000);
  };
  return btn;
}

// ---- model (persisted) ----
const model = {
  tab: q.get('tab') || saved.tab || 'single',
  single: { state: { fixture: fixtureOr(q.get('fixture') || saved.single?.state?.fixture), seed: q.get('seed') || saved.single?.state?.seed || '1', pal: q.get('pal') || saved.single?.state?.pal || PALETTES[0].name },
            params: freshParams(saved.single?.params) },
  ab: {
    a: { state: { fixture: fixtureOr(saved.ab?.a?.state?.fixture), seed: saved.ab?.a?.state?.seed || '1', pal: saved.ab?.a?.state?.pal || PALETTES[0].name }, params: freshParams(saved.ab?.a?.params) },
    b: { state: { fixture: fixtureOr(saved.ab?.b?.state?.fixture), seed: saved.ab?.b?.state?.seed || '2', pal: saved.ab?.b?.state?.pal || PALETTES[1].name }, params: freshParams(saved.ab?.b?.params) },
  },
  grid: { params: freshParams(saved.grid?.params), ranges: saved.grid?.ranges || structuredClone(RANGES), tiles: saved.grid?.tiles || null },
};
for (const [k, v] of q.entries()) if (k.startsWith('p.')) setPath(model.single.params, k.slice(2), isNaN(Number(v)) ? v : Number(v));

async function makeToken(state, params) {
  return { grid: await loadGrid(state.fixture), palette: resolvePalette(state.pal, params), seed: state.seed };
}

// ---- one tree + its panel (Viewer and A/B) ----
function makeView(container, m, { side = null, abStage = false } = {}) {
  const canvas = $('canvas');
  const stage = $('div', { className: 'stage' + (abStage ? ' ab' : '') }, canvas);
  const thumb = $('img', { alt: 'SVG thumbnail' });
  const stats = $('pre');
  if (abStage) stage.append($('div', { className: 'thumbrow' }, thumb, stats));
  let viewer = null;
  const view = { canvas, m, get viewer() { return viewer; } };

  const extra = $('div', {},
    $('div', { className: 'row' },
      $('button', { textContent: 'flat ⇄ explore', onclick: () => viewer?.camera.toggle() }),
      $('button', { textContent: 'copy PARAMS', onclick: () => navigator.clipboard.writeText(JSON.stringify(m.params, null, 2)) }),
      $('button', { textContent: 'reset PARAMS', onclick: () => { copyInto(m.params, structuredClone(DEFAULTS)); panel.sync(); apply(); } })),
    $('div', { className: 'row' }, saveButton(() => m.params)),
    exportBox(() => m.params, p => { copyInto(m.params, freshParams(p)); panel.sync(); apply(); }),
  );
  const panel = buildPanel(container, { state: m.state, params: m.params, fixtures, extra, onToken: apply, onRebuild: () => applySoon(), onLive: save });
  container.append(stage);
  if (side) container.append(side.el);

  let timer = 0;
  const applySoon = () => { clearTimeout(timer); timer = setTimeout(apply, 120); };
  async function apply() {
    const token = await makeToken(m.state, m.params);
    if (!viewer) viewer = createViewer(canvas, token, m.params); else viewer.rebuild(token);
    const svg = gridToSvg(token.grid, token.palette);
    const dataUri = 'data:image/svg+xml;base64,' + btoa(svg);
    thumb.src = dataUri;
    if (side) side.thumb.src = dataUri;
    paintSwatches(panel.swatches, token.palette);
    const s = viewer.stats;
    const text = `voxels ${s.voxels} · walks ${s.walks} · segs ${s.segments} · clumps ${s.clumps}\nbuild ${s.buildMs} ms · svg ${(svg.length / 1024).toFixed(1)} KB`;
    stats.textContent = text;
    if (side) side.stats.textContent = text.replace(/ · /g, '\n');
    save();
  }
  view.apply = apply; view.panel = panel;
  return view;
}

// ---- Viewer tab ----
const singleSide = (() => {
  const thumb = $('img', { id: 'thumb', alt: 'SVG thumbnail' });
  const stats = $('div', { id: 'stats' });
  const el = $('div', { className: 'side' }, $('h2', { textContent: 'SVG thumbnail (image)' }), thumb, stats,
    $('h2', { textContent: 'Keys' }),
    $('div', { innerHTML: '<kbd>F</kbd>/<kbd>space</kbd> flat ⇄ explore · <kbd>R</kbd>/dbl-click reset<br>drag orbit · wheel/pinch zoom<br><kbd>[</kbd> <kbd>]</kbd> prev / next fixture · <kbd>P</kbd> / <kbd>⇧P</kbd> next / prev palette' }));
  return { el, thumb, stats };
})();
const single = makeView(document.getElementById('single'), model.single, { side: singleSide });

// ---- A/B tab ----
const abEl = document.getElementById('ab');
const viewA = makeView(abEl, model.ab.a, { abStage: true });
const viewB = makeView(abEl, model.ab.b, { abStage: true });

// ---- Grid 3×3 and Forest tabs: the same nine picks + ranges, two presentations ----
//   Grid   — nine separate views, each with its own camera
//   Forest — ONE scene: seamless 3×3 mosaic when flat, all trees together when exploring
const gridEl = document.getElementById('grid');
const forestEl = document.getElementById('forest');
const tilesEl = $('div', { id: 'tiles' });
const forestCanvas = $('canvas');
const legendEl = $('div', { id: 'legend' });
const forestStage = $('div', { className: 'stage forest' }, forestCanvas, legendEl);
let forest = null;                                       // the shared-scene viewer
const tiles = [];                                        // {state, params, canvas, viewer}
function rerollTiles({ fixtures: rf = true, seeds: rs = true, pals: rp = true } = {}) {
  const pals = [...PALETTES.map(p => p.name)].sort(() => Math.random() - 0.5);
  const fix = [...fixtures].sort(() => Math.random() - 0.5);            // without replacement: nine different faces
  model.grid.tiles = Array.from({ length: 9 }, (_, i) => ({
    fixture: rf || !model.grid.tiles ? fix[i % fix.length].id : model.grid.tiles[i].fixture,
    seed:    rs || !model.grid.tiles ? randomSeed() : model.grid.tiles[i].seed,
    pal:     rp || !model.grid.tiles ? pals[i % pals.length] : model.grid.tiles[i].pal,
  }));
}
if (!model.grid.tiles) rerollTiles();

const gridExtra = () => $('div', {},
  $('div', { className: 'row' },
    $('button', { textContent: 'reroll all', onclick: () => { rerollTiles(); buildTiles(); } }),
    $('button', { textContent: 'fixtures', onclick: () => { rerollTiles({ seeds: false, pals: false }); buildTiles(); } }),
    $('button', { textContent: 'seeds', onclick: () => { rerollTiles({ fixtures: false, pals: false }); buildTiles(); } }),
    $('button', { textContent: 'palettes', onclick: () => { rerollTiles({ fixtures: false, seeds: false }); buildTiles(); } })),
  $('div', { className: 'row' },
    $('button', { textContent: 'flat ⇄ explore', onclick: () => { forest?.camera.toggle(); tiles.forEach(t => t.viewer?.camera.toggle()); } }),
    $('button', { textContent: 'reset ranges', title: 'back to the saved default ranges', onclick: () => { copyInto(model.grid.params, structuredClone(DEFAULTS)); for (const k of Object.keys(model.grid.ranges)) delete model.grid.ranges[k]; Object.assign(model.grid.ranges, structuredClone(RANGES)); location.reload(); } })),
  $('div', { className: 'row' }, saveButton(() => DEFAULTS)),
  exportBox(() => DEFAULTS, p => { copyInto(DEFAULTS, freshParams(p)); copyInto(model.grid.params, freshParams(p)); gridApplySoon(true); }),
  $('div', { style: 'color:#7d8590;margin:6px 0 2px' }, 'Each slider is a min–max range; a tree\'s value is hashed from its seed within it. Equal min and max = fixed value. Grid 3×3 and Forest share these; "save as defaults" here stores the ranges (and the current single-value defaults).'),
);
// Two panels over one ranges object: a change in either re-syncs the other.
const rangePanels = [];
const rangeOpts = () => ({ params: model.grid.params, ranges: model.grid.ranges, fixtures, extra: gridExtra(),
  onRebuild: () => { gridApplySoon(true); rangePanels.forEach(p => p.sync()); },
  onLive:    () => { gridApplySoon(false); rangePanels.forEach(p => p.sync()); } });
rangePanels.push(buildPanel(gridEl, rangeOpts()));
gridEl.append(tilesEl);
rangePanels.push(buildPanel(forestEl, rangeOpts()));
forestEl.append(forestStage);

let gridTimer = 0;
const gridApplySoon = rebuild => { clearTimeout(gridTimer); gridTimer = setTimeout(() => applyTiles(rebuild), 150); };
function tileParams(t) { return resolveRanges(model.grid.ranges, model.grid.params, t.state.seed); }
async function applyTiles(rebuild) {
  for (const t of tiles) copyInto(t.params, tileParams(t));      // live params: viewers read them in place
  save();
  if (rebuild) {
    const tokens = await Promise.all(tiles.map(t => makeToken(t.state, t.params)));
    tiles.forEach((t, i) => t.viewer?.rebuild(tokens[i]));
    forest?.rebuild(tokens);
  }
  save();
}
const caption = (t, st) => [
  $('span', { textContent: `${st.fixture} · ${st.pal} · ${fixtures.find(f => f.id === st.fixture)?.label || ''}`, title: `seed ${st.seed}` }),
  $('button', { textContent: 'copy', title: 'copy this tree\'s resolved PARAMS', onclick: () => navigator.clipboard.writeText(JSON.stringify(t.params, null, 2)) }),
  $('button', { textContent: '↗', title: 'open in Viewer', onclick: () => { Object.assign(model.single.state, st); copyInto(model.single.params, t.params); single.panel.sync(); single.apply(); showTab('single'); } }),
];
// The nine tile viewers (and the forest) are created ONCE and rebuilt in place on reroll.
// Recreating them leaked WebGL contexts (browsers allow ~16 live ones) until the oldest —
// the Viewer / A/B / Forest — were lost and went black.
async function buildTiles() {
  legendEl.replaceChildren();
  model.grid.tiles.forEach((st, i) => {
    if (!tiles[i]) {
      tiles[i] = { state: st, params: freshParams(), canvas: $('canvas'), viewer: null, cap: $('div', { className: 'cap' }) };
      tilesEl.append($('div', { className: 'tile' }, tiles[i].canvas, tiles[i].cap));
    }
    const t = tiles[i];
    t.state = st;
    copyInto(t.params, tileParams(t));                      // same params object: the viewer reads it in place
    t.cap.replaceChildren(...caption(t, st));
    legendEl.append($('div', { className: 'cap' }, ...caption(t, st)));
  });
  const tokens = await Promise.all(tiles.map(t => makeToken(t.state, t.params)));
  tiles.forEach((t, i) => { if (t.viewer) t.viewer.rebuild(tokens[i]); else t.viewer = createViewer(t.canvas, tokens[i], t.params); });
  if (!forest) forest = createViewer(forestCanvas, tokens, tiles.map(t => t.params), { cols: 3 });
  else forest.rebuild(tokens);
  save();
}

// ---- tabs ----
function showTab(name) {
  model.tab = name;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === name));
  save();
}
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));

// keys that belong to the harness (viewer handles F / space / R itself)
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const v = model.tab === 'single' ? single : model.tab === 'ab' ? viewA : null;
  if (!v) return;
  if (e.key === '[') v.panel.step(-1);
  if (e.key === ']') v.panel.step(1);
  if (e.key === 'p' || e.key === 'P') {
    const i = PALETTES.findIndex(p => p.name === v.m.state.pal);
    v.m.state.pal = PALETTES[(i + (e.shiftKey ? -1 : 1) + PALETTES.length) % PALETTES.length].name;
    v.panel.sync(); v.apply();
  }
});

// ---- boot ----
showTab(model.tab);
await single.apply();
await viewA.apply();
await viewB.apply();
await buildTiles();
if (q.get('explore')) {
  const pose = v => v.camera.pose(Number(q.get('yaw') ?? 0.55), Number(q.get('pitch') ?? 0.62));
  pose(single.viewer); pose(viewA.viewer); pose(viewB.viewer); pose(forest); tiles.forEach(t => pose(t.viewer));
}
window.dev = { model, single, viewA, viewB, tiles, forest };
window.viewer = single.viewer;
window.__forestReady = true;

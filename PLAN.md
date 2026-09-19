# FOREST — Implementation Plan

Companion to `REQUIREMENTS.md` (the *what* and *why*). This file is the *how*: architecture, data flow, and pseudo-code for every component that does not already exist in the reference code under `reference/`.

Read `REQUIREMENTS.md` first. Read `reference/` before porting anything — port, do not reinvent.

---

## 0. Ground rules

- Minimal footprint. DRY. No per-token storage beyond what the seed needs.
- **`G = 64`** is the grid size (decided 2026-09-19, was 40). It is one named constant in Solidity, in `viewer/src/params.js` and in tooling. Never write `64`, `63`, `65`, `4096` or `262144` as literals — derive them from `G`. The reference code hardcodes `40`/`39`/`41`/`1600`/`64000` throughout; every port replaces those with `G`-derived values.
- Everything visual is derived in browser JS from three inputs: `seed`, `grid` (`G²` = 4096-char digit string), `palette` (≤ 10 colours). Solidity only assembles metadata, the SVG, and the HTML shell.
- Fully on-chain: grids come from a curated pool stored on-chain (§3), not from a server, IPFS or a model.
- Determinism: every random draw goes through a seeded hash. No `Math.random`, no `Date.now`, no `performance.now` in generation paths. `uTime` is allowed only for the glitch blink in the shader (cosmetic, non-structural).
- `animation_url` must be self-contained: no `fetch(`, no external URLs, no textures.

---

## 1. Architecture

```
ERC721SeaDrop (unchanged, OpenSea main)
   └─ ForestToken            src/extensions/ForestToken.sol
        · overrides tokenURI(uint256) → IRenderer(renderer).tokenURI(tokenId, seed(tokenId))
        · renderer address, setRenderer(), freezeRenderer()
        · seed source (RandomOffset pattern, see §2)
        · everything else inherited untouched

IRenderer
   └─ ForestRenderer         src/renderer/ForestRenderer.sol
        · tokenURI(tokenId, seed) → data:application/json;base64
        · builds: name, description, attributes, image (SVG data URI), animation_url (HTML data URI)
        · palettes stored here
        · HTML/JS chunks read from ForestAssets (SSTORE2) — see §9
        · grids read from ForestGrids (SSTORE2) — see §3

ForestAssets                 src/renderer/ForestAssets.sol
        · ordered immutable chunks of the viewer HTML/JS/GLSL, written once via SSTORE2

ForestGrids                  src/renderer/ForestGrids.sol
        · the curated grid pool: N compressed G×G grids packed into SSTORE2 pages + an offset index
        · append-only during setup, then sealed; grid(i) → bytes(G²) digits
```

Renderer is swappable by owner until `freezeRenderer()`; emit `BatchMetadataUpdate(1, totalSupply)` (ERC-4906) on every change.

---

## 2. Seed

Follow `src/extensions/ERC721SeaDropRandomOffset.sol` in the SeaDrop repo.

```
storage:
  uint256 randomOffset      // 0 until revealed
  bool    revealed

setRandomOffset():
  require(!revealed)
  require(totalSupply() == maxSupply || msg.sender == owner)   // owner may force early
  randomOffset = uint256(keccak256(abi.encode(block.prevrandao, blockhash(block.number-1), address(this)))) 
  revealed = true
  emit BatchMetadataUpdate(1, totalSupply())

seed(tokenId):
  if (!revealed) return 0                       // renderer shows placeholder
  return uint256(keccak256(abi.encode(tokenId, randomOffset, address(this))))

gridIndex(tokenId):                             // which pool grid this token shows
  return (tokenId + randomOffset) % N           // N = pool size ≥ maxSupply → a bijection, no two tokens share a grid
```

`gridIndex` must **not** be `seed % N` — that collides (birthday bound). `seed` drives palette choice and all 3D randomness; `gridIndex` only picks the image.

Open question (from REQUIREMENTS): whether a pre-reveal placeholder is shown or reveal is live from mint. Code above supports both; if live-from-mint is chosen, drop `revealed` and use `keccak256(tokenId, address(this))`.

---

## 3. Grid source — curated on-chain pool

Working decision (REQUIREMENTS → Decisions): grids are **not generated** on-chain; they are read from a curated pool of `N ≥ maxSupply` grids stored on-chain. The pool is authored off-chain in `pixelart/` (FLUX portraits → `build_library.py --size 64` → hand curation). A procedural generator remains possible later; it would replace only `ForestGrids.grid(i)`. Everything downstream consumes the `G²`-char digit string either way.

DRY rule unchanged: **Solidity decodes the grid once and injects the 4096-char string into the HTML.** JS never decodes pool storage; the SVG and the 3D view agree byte-for-byte because they consume the same string. Cost: 4096 bytes in the data URI. Acceptable.

### Encoding (to be fixed by measurement, not guesswork)

Raw: 10 symbols → 4 bits/cell → `G²/2` = 2048 bytes per grid. Candidates, in order of decoder simplicity:

```
A. nibble-pack                    2048 B/grid, trivial decoder
B. row-major RLE, 1 byte per run  hi nibble = colour 0..9, lo nibble = runLength-1 (1..16); long runs split
C. B + LZ over the byte stream    e.g. Solady LibZip.flzDecompress in the view path
```

Portraits have large background runs but dithered faces, so B's gain is unknown until measured. **First task on this track: `pixelart/tools/measure_encoding.py`** — run A/B/C over a few hundred real `--size 64` grids and report mean/95th-percentile bytes per grid. Pick the simplest encoding within ~20 % of the best.

**Measured 2026-09-19** on all 4 500 `v6_500` grids (`pixelart/docs/ENCODING_MEASUREMENTS.md`): the grids are noisy — ≈1 300 runs each — so B = 1 293 B (63 %), flz(A) = 1 254 B, flz(B) = 1 187 B (58 %), while DEFLATE reaches 817 B (40 %); the order-0 entropy floor is 1 248 B, i.e. DEFLATE's win is real spatial redundancy that RLE/FastLZ can't reach. The 3×3 mode filter (an *art* decision — it removes speckle) drops B to 872 B and zlib(B) to 637 B. So: (1) decide on despeckling visually first, it is worth ~30 %; (2) then choose between plain RLE (simplest, ~0.9–1.3 KB/grid) and an on-chain inflate (~0.65–0.8 KB/grid, more code + view gas). At 1 000 grids that is ≈ 180–280 M gas either way — pool size matters more than the codec.

Budget arithmetic (SSTORE2 ≈ 200 gas/byte + ~32 k per 24 KB page): at ~1 KB/grid a 1 000-grid pool ≈ 1 MB ≈ 42 pages ≈ 205 M gas — ≈ 0.2 ETH at 1 gwei, ≈ 2 ETH at 10 gwei. Pool size `N` and max supply are therefore a cost decision; settle after measuring.

### Storage

```
ForestGrids:
  address[] pages                       // SSTORE2 pointers, each ≤ 24,575 bytes of concatenated encoded grids
  bytes     index                       // per grid: uint16 page, uint16 offset, uint16 length  (6 bytes × N; itself SSTORE2)
  bool      sealed

  addPage(bytes data, bytes indexChunk) onlyOwner, !sealed
  seal()                                onlyOwner            // irreversible; N is fixed from here
  grid(uint256 i) view → bytes(G²)      // read slice via SSTORE2.read(ptr, start, end), decode to ASCII digits
```

Deploy script reads `pixelart/pool/*.json` (curated `{id, g}` entries), encodes, packs pages greedily, writes them, seals. A Foundry test round-trips every pool grid: `decode(encode(g)) == g`, and `encode` in the JS/Python tooling matches byte-for-byte.

### Until the pool exists

Viewer work (§12 steps 1–4) uses **fixtures**: 5–10 `{grid, palette}` JSON files exported from `pixelart/` at `--size 64` into `viewer/fixtures/`. No noise placeholder is needed any more.

### Palettes

`paletteIndex = seed % palettes.length`. Store palettes as `bytes` (27 bytes per palette = 9 × RGB for slots 1–9; slot 0 is implicit transparent/black) in the renderer. **Slots 1–9 must be ordered dark → light** — the pool's indices are luminance buckets (REQUIREMENTS, 2D artifact). `pixelart/pfp-library/js/palette.js` `seededPalette` already produces ramps of this shape and is the authoring tool for candidates.

---

## 4. SVG (Solidity)

At `G = 64` a `<rect>` per run is too heavy (dense portraits ≈ 1 500–2 500 runs × ~50 bytes ≈ 100 KB before base64). Instead emit **one `<path>` per colour**; each horizontal run is a 1-high sub-path (~12 bytes):

```
function svg(grid, palette) → string:
  head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 G G" shape-rendering="crispEdges">'
       + '<rect width="G" height="G" fill="#000"/>'
  d[1..9] = ""                                   // one path-data buffer per colour
  for y in 0..G-1:
    x = 0
    while x < G:
      c = grid[y*G+x]
      run = 1; while x+run < G and grid[y*G+x+run] == c: run++
      if c != '0': d[c] += 'M{x} {y}h{run}v1h-{run}z'
      x += run
  for c in 1..9: if d[c] != "": out += '<path fill="#RRGGBB" d="' + d[c] + '"/>'
  return head + out + '</svg>'
```

Implementation note: nine growing buffers are awkward in Solidity. Either do 9 passes over the grid (one colour per pass, single output buffer — simplest, ~9 × 4096 cheap iterations, view-only) or pre-count bytes per colour and write into one pre-sized buffer. Start with 9 passes; optimise only if §12 step 8 says so.

Emit as `data:image/svg+xml;base64,…`. Use a tight base64 lib (Solady `Base64` or OpenZeppelin). Expected size ≈ 20–30 KB before base64; measure on real fixtures.

---

## 5. JS: from grid to `filled` (voxel placement)

Inputs: `grid` (string), `seed` (uint256 as decimal string → split into two 32-bit ints for hashing), `N_MAX = 4`.

Coordinate convention (matches `reference/renderer/src/geometry.js`: +Y up, +Z toward viewer):
- Image x → world X.
- Image y → world Z (image row 0 = far, row `G-1` = near) — chosen so that the flat camera looks **down −Y** and sees the image the right way up. Adjust sign in the flat camera if mirrored.
- Depth axis = world **Y**. Canopy (leaves) at high Y, trunk region at low Y. Flat view camera sits at +Y looking down.

```
function seededHash(a, b, c):        // reuse hashInt from reference/viewer/tree-walker.js
  return hashInt(seedLo ^ a, seedHi ^ b, c)

function centroid(grid):
  sx = sy = n = 0
  for each cell (x,y) with grid[c] != '0': sx+=x; sy+=y; n++
  return [sx/n, sy/n]          // fall back to grid centre if n == 0

function density(x, y, k, cx, cy):   // k = depth index 0..G-1, G-1 = canopy
  // 3D value noise, seeded — lattice hash at integer corners, trilinear interpolation
  // Noise wavelengths are fractions of G so the look is resolution-independent: G/5, G/10, G/20 (= 8/4/2 at the old G=40)
  s = G / 5
  n = noise3(x/s, y/s, k/s) * 0.6 + noise3(2x/s, 2y/s, 2k/s) * 0.3 + noise3(4x/s, 4y/s, 4k/s) * 0.1
  r = hypot(x - cx, y - cy) / (G * 0.7071) // 0 at centroid, ~1 at far corner (G/√2)
  h = k / (G - 1)                          // 0 trunk end, 1 canopy
  canopy = smoothstep(0.35, 1.0, h)        // density rises toward canopy
  radial = 1 - 0.6 * r                     // soft falloff from centroid
  return n * canopy * radial

function buildFilled(grid, seed):
  filled = Uint8Array(G*G*G)               // index x*G*G + k*G + y  (x, depth, y) — same layout as voxelIdx in stone-walker.js, with G for 40
  [cx, cy] = centroid(grid)
  for each cell (x,y) with c = grid[y*G+x] != '0':
    scores = []
    for k in 0..G-1: scores.push([density(x,y,k,cx,cy), k])
    scores.sort desc by density
    count = 0
    for [d, k] of scores:
      if count == 0 or d > THRESH: filled[voxelIdx(x, k, y)] = 1; count++   // first always placed
      if count == N_MAX: break
  return filled
```

`THRESH` and the noise scales/weights are tunables. Expose them in a single `PARAMS` object at the top of the JS.

Centroid fallback is `[(G-1)/2, (G-1)/2]`. Scale check at `G = 64`: a dense portrait (~65 % coloured) × `N_MAX = 4` ≈ 10 k voxels ≈ 380 k non-indexed vertices — fine on desktop, verify on a phone; `N_MAX` is the lever.

---

## 6. JS: voxel mesh with colour

Port `buildVoxelMesh` from `reference/viewer/normie/voxels.js` (grid literals → `G`, as in §7; drop the `planePix` source-plane logic — our `filled` comes from §5) with two changes:

1. Add a per-vertex **colour** attribute (vec3, attribute location 2 — reuse the `aUv` slot since we have no UVs, or add location 6). The `normie-voxel` shader gets `in vec3 aColor; out vec3 vColor;` and uses `vColor` in place of `uTint` for the **camera-facing face only** in flat view.
2. Per-face tint: the face whose normal is +Y (the canopy/top face) carries the cell colour. The other five faces carry a "panel" tint — for the first pass, the cell colour at 20 % luminance; treatment TBD per REQUIREMENTS.

Alpha per voxel:

```
weight(k, count, mode):
  equal:         1 / count
  frontWeighted: geometric — top voxel 0.5, next 0.25, … normalised to sum 1
PARAMS.alphaMode selects. Multiply by walkerBoost (2.8 if touched, else 1) after the fact so the flat sum stays ≈ 1 on untouched columns.
```

Variant per voxel: `hashInt(x, k, y)` — same recipe as reference (`rand` → `variety`, `variant`).

Material: port `normie-voxel.frag.glsl` from reference, **deleting** `cubeFaceUV`, `crossLayoutUV`, `sampleEnv`, `uEnvTex`, `uEnvLayout` and the `env` term. Everything else unchanged.

---

## 7. JS: walker (branches + trunk)

Reuse `runInitialRay`, `runRandomWalk`, `isOuterSurfaceEdge`, `nodeIsOnGlassSurface`, `glassColumnNodes`, `pickRandom`, `edgeKey` from `reference/viewer/materials/stone-walker.js` — logic verbatim, but with every grid literal replaced (`40 → G`, `39 → G-1`, `1600 → G*G`, `64000 → G*G*G`; the node lattice is `(G+1)³`; the `step < 40` ray cap becomes `step < G`). `MIN_WALKS = 40` is a walk count, not a grid size — it becomes `PARAMS.walkCount`. Replace `buildWalkerItemsFromFilled` with:

```
buildForestWalks(filled, seed, cx, cy):
  allSegs = []; occupied = Set()
  // Launch only from the canopy face (top, axIdx = 1 (Y), faceIdx = G, dir = -1) so walks
  // travel from leaves downward toward the trunk end.
  candidates = glassColumnNodes(filled, 1, G)
  selected   = pickRandom(candidates, PARAMS.walkCount, seed)
  for i, start in selected:
    end = runInitialRay(start, 1, -1, filled, occupied, allSegs)
    runRandomWalkBiased(end, 1, -1, seed + i*0.5731, occupied, allSegs, filled, cx, cy)
  return allSegs
```

`runRandomWalkBiased` = `runRandomWalk` with one change in **flight mode**: instead of continuing straight, choose the next axis/direction by weighted draw:

```
  options = all 6 (axis, dir) moves that are in-bounds and whose edge is not occupied
  for each option:
    p = node after the move
    dNow  = hypot(cur.x - cx, cur.z - cy)      // horizontal distance to trunk axis
    dNext = hypot(p.x - cx, p.z - cy)
    w = 1
    if axis == Y and dir == -1:            w *= PARAMS.downBias        // keep descending
    if dNext < dNow:                        w *= PARAMS.attract         // pull toward axis…
    if dNow < PARAMS.orbitRadius and dNext < dNow: w *= PARAMS.repel    // …unless already close, then push out → orbiting
    if axis == curAxis and dir == curDir:   w *= PARAMS.straightBias    // straight runs look branch-like
    weights.push(w)
  pick option by seeded weighted draw
```

Surface mode, termination rules, and the shared `occupied` set are untouched — those give the network/cluster convergence.

Line meshes: `reference/viewer/materials/line-mesh.js` — `buildCoreLineMesh` (thin quads, alpha 1) and `buildGlowLineMesh` (wider quads with UVs, capsule-SDF glow in `normie-glow.frag.glsl`). Use `worldPerp` as the perpendicular function (we have no plane normal; blockcassone's `planePerpFn` was for face-aligned art). Widths from `stone-walker.js`: `LINE_WIDTH 0.0015`, `GLOW_WIDTH 0.014`, opacities `0.65` / `0.12`. Both drawn additive: glow pass first, core on top. These were tuned against 1/40-cube voxels; at `G = 64` voxels are 37 % smaller, so expect to retune widths, `walkCount`, `orbitRadius` and the surface-mode step cap (all in `PARAMS`, expressed in voxel units where possible).

`touched` set: same as reference — record `min` corner of each segment as a voxel index; used for alpha boost in §6.

---

## 8. JS: lights and camera

Lights: `reference/viewer/lights.js` `DEFAULT_LIGHTS` verbatim (R/G/B at intensity 5), static. Upload `posBuf`, `colBuf`, count. `uCubeCenter` = centre of the `G³` volume, `uCubeHalfSize` = half its extent. Skip the marker billboards (they need `edge-glow`, which we are not using).

Camera, two modes:

```
flat:   orthographic, eye = centre + (0, +H, 0), look at centre, up = (0,0,-1).
        left/right/top/bottom = ±(G/2 * voxelSize) so the G×G grid fills the square canvas exactly.
        Near/far cover the full depth. No orbit input accepted.
explore: perspective, fov ~40°, orbit (drag), zoom (wheel/pinch), reset. Initial pose = flat pose so
        switching is continuous; first drag "breaks" the magic eye.
```

Toggle: a single key/tap. Reset returns to flat.

Render order: opaque nothing → voxels (alpha, sorted back-to-front by depth along view) → walk lines (additive) → glow (additive).

Background: `gl.clearColor(0,0,0,1)`.

---

## 9. HTML assembly (Solidity → data URI)

```
html = CHUNK_HEAD                                   // <!doctype html><html><head><meta ...><style>…</style></head><body><canvas>
     + '<script>window.FOREST=' + json({grid, palette:[hex…], seed:'<decimal>'}) + '</script>'
     + CHUNK_SCRIPT_0 … CHUNK_SCRIPT_N               // GLSL as JS strings + viewer JS, minified
     + '</body></html>'
animation_url = 'data:text/html;base64,' + base64(html)
```

Chunks live in `ForestAssets` via SSTORE2 (`solady/utils/SSTORE2.sol`). Written once by a deploy script from `build/viewer.min.js`. Keep total under ~40 KB minified; measure.

---

## 10. Metadata JSON

```
{
  "name": "Forest #<id>",
  "description": "<static>",
  "image": "data:image/svg+xml;base64,…",
  "animation_url": "data:text/html;base64,…",
  "attributes": [
    {"trait_type":"Palette","value":"<name or index>"},
    {"trait_type":"Leaves","value":<count of non-zero cells>}
  ]
}
```

Attributes are recomputed from the grid at render time; nothing stored.

---

## 11. Repo layout (to create)

```
forest/
  contracts/            git clone --recurse-submodules https://github.com/ProjectOpenSea/seadrop  (submodule or vendored)
    src/extensions/ForestToken.sol
    src/renderer/IRenderer.sol
    src/renderer/ForestRenderer.sol
    src/renderer/ForestAssets.sol
    src/renderer/ForestGrids.sol
    test/Forest*.t.sol           foundry: seed determinism, gridIndex bijection, pool round-trip, tokenURI decodes, SVG well-formed, no per-token storage growth
    script/DeployForest.s.sol    deploy assets + grid pool → renderer → token; write chunks/pages; seal
  viewer/
    fixtures/                    {grid, palette} JSON exported from pixelart/ at --size 64 (dev input until the pool exists)
    src/params.js                G + PARAMS object (all tunables)
    src/hash.js                  hashInt, hash1 (from reference)
    src/noise.js                 3D value noise
    src/grid.js                  centroid, buildFilled
    src/voxels.js                buildVoxelMesh (+colour attr)
    src/walker.js                walk core (from reference) + buildForestWalks + biased flight
    src/gl.js                    compileProgram, createMeshGL (from reference, trimmed)
    src/shaders/                 voxel.vert/frag (trimmed normie-voxel), line.vert/frag
    src/camera.js                flat + explore
    src/main.js                  boot: read window.FOREST → build → render loop
    dev.html                     loads src/ unbundled with a hardcoded window.FOREST for iteration
    build.js                     bundle + minify → build/viewer.min.js, split into chunks
  reference/                     the 17 blockcassone files under their original viewer/… and renderer/… paths (read-only)
  pixelart/                      side quest: art authoring pipeline (NOT deployed; nothing here is a runtime dependency)
    notebooks/                   FLUX generation + quantiser + model training notebook (ROOT = ../pfp_data)
    pfp-library/                 build_library.py + quantise.js / palette.js / library.js / demo.html
    pfp_data/  library/          generated data + built library (gitignored)
    tools/                       measure_encoding.py, fixture/pool exporters (to write)
    pool/                        the curated grids chosen for mint (to create; committed — this IS the collection)
    docs/
  fenv/  .env                    Python venv + HF token for pixelart/ (gitignored)
  REQUIREMENTS.md
  PLAN.md
```

---

## 12. Build order

0. Fixtures: `build_library.py --size 64` on the best run, export 5–10 `{grid, palette}` JSONs to `viewer/fixtures/` (§14). In parallel, `measure_encoding.py` (§3) — its numbers decide pool size and supply.
1. `viewer/dev.html` loading a fixture + seed. Get voxels rendering in flat view matching the SVG of the same grid (JS twin of §4). **This is the correctness gate for the magic-eye** — and the first look at whether a portrait-as-canopy reads well in 3D.
2. Explore camera + toggle.
3. Walker + biased flight. Tune `PARAMS` against the "tree with twists" brief.
4. Lights + trimmed `normie-voxel` shader. Compare against blockcassone screenshots.
5. Solidity: `ForestGrids` (encode/decode, pages, seal) + SVG. Foundry tests: pool round-trip; Solidity SVG cell set == JS voxel column set for the same grid.
6. HTML assembly, SSTORE2 chunks, `tokenURI`. Test that decoded HTML contains no `fetch(` or `http`.
7. `ForestToken` on top of `ERC721SeaDrop`; seed/reveal; freeze.
8. Gas measurement of `tokenURI` on mainnet fork. Revisit §5 storage decision only if read gas is a problem.

---

## 13. Known gaps

Reference set is complete (17 files under `reference/`). Remaining decisions:

- Pre-reveal placeholder vs live-from-mint.
- Side/top/bottom panel treatment for voxels (first pass: 20 % luminance of cell colour).
- Grid source is a working decision (curated pool). Pool size `N`, max supply and the pool encoding wait on `measure_encoding.py` (§3).
- HTML size budget: the injected grid is now 4096 chars (was 1600); still small next to the ~40 KB viewer.

## 14. Art authoring pipeline — `pixelart/` (off-chain, not deployed)

Supersedes the earlier plan to modify `ellsabella/ascii-art-generator`: `pixelart/` already does that job with the same cell-extraction and brightness/contrast maths (`pfp-library/README.md`, "Index contract"). Nothing in `pixelart/` is a runtime dependency of the token — it only *authors* the data that gets written on-chain.

What exists:

- `notebooks/pixel_art_pfp_pipeline.ipynb` — FLUX.1-schnell portrait generation with attribute labels (`pfp_data/v*/raw` + `labels.jsonl`), quantiser, and a masked-diffusion transformer trained at 32/64 (`ckpt_*.pt`).
- `pfp-library/tools/build_library.py` — raw PNGs → `G×G` digit-string grids (0 = background, 1–9 = luminance buckets dark → light), sharded JSON + `preview.png`. `--size 64` is its default.
- `pfp-library/js/` — `quantise.js` (same quantiser in JS), `palette.js` (seeded luminance-ramp palettes), `library.js`, `demo.html`.

Role of the trained model: optional. The FLUX → quantise path already yields collection-quality grids; the model's samples (docs/images/output20k.png) are softer than its training data (docs/images/train64.png). For a fixed curated pool the model adds nothing on-chain. Keep it parked unless it is wanted for the browser app or for generating *more* candidates to curate from.

To build, in order:

1. `tools/export_fixtures.py` — pick ids from a built library → `viewer/fixtures/<id>.json` as `{ grid: "<G² digits>", palette: ["#RRGGBB" × 9] }` (palette from the same ramp recipe as `palette.js`). Feeds §12 steps 0–1.
2. `tools/measure_encoding.py` — §3 encodings A/B/C over a whole library; prints bytes/grid stats and projected deploy gas for a given `N`.
3. Curation: a contact-sheet/pick UI (extend `demo.html`: keyboard accept/reject over shards → `pool/accepted.json`). Criteria to settle while viewing fixtures in 3D, not before: silhouette reads at thumbnail size, foreground fraction (voxel budget), no near-duplicates.
4. `tools/build_pool.py` — accepted ids → `pool/pool.json` (ordered, final) + encoded pages for `DeployForest.s.sol`. Same encoder as the Foundry round-trip test vectors.

Quantiser settings (`--cf`, `--mp`, `--bg`, `--mode-filter`) are part of the art: fix them before curation and record them in `pool/pool.json`.

## 15. Reference file index

| File | Use |
|---|---|
| `viewer/materials/stone-walker.js` | Walk core — port `runInitialRay`, `runRandomWalk`, surface/edge tests, `pickRandom`, `edgeKey`, `voxelIdx` |
| `viewer/materials/line-mesh.js` | `buildCoreLineMesh`, `buildGlowLineMesh`, `worldPerp` |
| `viewer/normie/voxels.js` | `buildVoxelMesh` (add colour attribute), alpha/variant recipe |
| `viewer/lights.js` | `DEFAULT_LIGHTS`, flat buffer upload pattern |
| `viewer/tree-walker.js` | `hash1`, `hashInt` only |
| `viewer/cube-glass.js` | Not needed; kept for `pushBoxFaces` reference |
| `renderer/src/geometry.js` | `createMeshGL` (attribute locations 0–5), `disposeMeshGL` |
| `renderer/src/materials.js` | `compileProgram` only; drop fetch/include machinery |
| `renderer/src/math.js` | `mat4`, `identity`, `perspective`, `ortho`, `lookAt`, `multiply`, vec3 helpers |
| `renderer/shaders/normie-voxel.{vert,frag}` | Voxel material — trim env sampling, add `aColor` |
| `renderer/shaders/normie-glow.{vert,frag}` | Walk glow pass, verbatim |
| `renderer/shaders/lines.{vert,frag}` | Walk core pass, verbatim |
| `renderer/shaders/stone-glass.{vert,frag}` | Not needed; kept as the procedural-environment reference if the look is ever revisited |

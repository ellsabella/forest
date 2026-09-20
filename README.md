# FOREST

Fully on-chain generative art on OpenSea's SeaDrop (`ERC721SeaDrop`, Ethereum mainnet). Each token
is a 64×64 palette-index pixel-art grid, shown as an SVG thumbnail (`image`) and as a self-contained
WebGL piece (`animation_url`): the same cells lifted into a 64³ volume of glass voxels that collapse
back into the exact 2D image when viewed flat ("magic eye") and dissolve into a tree — voxel leaves,
random-walk line trunk — when orbited. No external dependencies at render time: grids, palettes,
SVG builder and the HTML/JS/GLSL viewer all live on-chain.

- [REQUIREMENTS.md](REQUIREMENTS.md) — what and why: SeaDrop constraints, decisions, art requirements.
- [PLAN.md](PLAN.md) — how: architecture, pseudo-code, repo layout (§11), build order (§12).

## Run the dev viewer

```
cd ~/forest && python3 viewer/serve.py
# open http://localhost:8000/viewer/dev.html
```

(`serve.py` is `http.server` with caching disabled, so edited modules load on a plain reload.
If you use another static server, hard-reload — Ctrl+Shift+R — after editing `viewer/src/`.)

Four tabs: **Viewer** (one tree, all sliders, SVG thumbnail), **A / B** (two independent trees side by
side), **Grid 3×3** (nine random fixtures × nine palettes as separate views; every slider is a min–max
range and each tree's value is hashed from its seed within it — `↗` sends a tree to the Viewer), and
**Forest** (the same nine in one scene: a seamless mosaic when flat, a forest when exploring). Drag to break the flat view,
tune the sliders; `copy PARAMS` puts the current values on the clipboard to paste into
[viewer/src/params.js](viewer/src/params.js). State is kept in localStorage (`reset PARAMS` clears it).
URL: `?tab=ab|grid`, `?fixture=&seed=&pal=`, `?explore=1&yaw=&pitch=`, and `?p.<param>=value` for any param.
More fixtures:
`cd pixelart && ../fenv/bin/python tools/export_fixtures.py --library library --out ../viewer/fixtures --ids 001234 …`

**Upload any image** (`upload image` in the Viewer and each A/B panel; `upload image → all 9` on Grid /
Forest): it is square-cropped from the top-left, the white background is keyed to black, and it goes through
the pool quantiser ([viewer/dev/upload.js](viewer/dev/upload.js) = `pfp-library/js/quantise.js`) to a 64×64
grid that then behaves like any fixture. `upload settings` (tone: off / stretch / equalise, key thresholds,
contrast, midpoint, mode filter) re-quantise the session's uploads live; `build_library.py --tone` mirrors the
tone step for the pool. Grids persist in localStorage; the source image does not.
Palettes are luminance ramps: a textured subject flips between adjacent buckets cell by cell, so a palette
whose adjacent slots differ a lot in hue reads as chromatic speckle, and one whose colours share a lightness
has no ramp at all. Fix it in the palette (the shaper re-sorts shaped colours by luminance so slot 1 is always
darkest); the `paletteHueSmooth` / `paletteHueLock` sliders (off by default) are a blunt fallback — blending
complementary hues passes through a third hue and muddies deliberately mixed palettes.

## Layout

```
REQUIREMENTS.md  PLAN.md
reference/     17 blockcassone source files to port from (read-only; original viewer/… renderer/… paths)
contracts/     (to create) SeaDrop clone + ForestToken / ForestRenderer / ForestAssets / ForestGrids
viewer/        raw-WebGL viewer: src/ (ships on-chain later), dev.html + dev/ (harness only), fixtures/
pixelart/      side quest — off-chain art authoring pipeline, not deployed (see below)
fenv/  .env    Python venv + HF_TOKEN used by pixelart/ (gitignored)
```

## Side quest: [pixelart/](pixelart/)

Authors the curated pool of 64×64 grids that FOREST stores on-chain (PLAN §3, §14). Nothing in it
is a runtime dependency of the token.

- [pixelart/notebooks/pixel_art_pfp_pipeline.ipynb](pixelart/notebooks/pixel_art_pfp_pipeline.ipynb) —
  FLUX portrait generation, quantiser, masked-diffusion model training. Run with `pixelart/notebooks/`
  as the working directory: it reads/writes `../pfp_data` and loads `../../.env`.
- [pixelart/pfp-library/](pixelart/pfp-library/README.md) — `tools/build_library.py` turns a generation
  run into digit-string grids under `pixelart/library/`; `js/` has the matching JS quantiser, seeded
  luminance-ramp palettes, loader and demo page.
- [pixelart/docs/](pixelart/docs/PIXEL_ART_GENERATION_PLAN.md) — the side quest's own plan + sample images.
- `pixelart/pfp_data/`, `pixelart/library/` — multi-GB generated data and build output (gitignored).

# PFP grid library

Precomputed pixel-art PFP library: generated portraits → 64×64 grids of palette indices 0–9
→ seeded palette applied client-side. Zero runtime generation cost.

```
pfp-library/
  tools/build_library.py   builds manifest.json + shards/*.json from a generation run
  js/quantise.js           image → 0..9 indices (ported from the production app's worker + brightness mapping)
  js/palette.js            seeded palettes, mulberry32, rendering (hslToRgb copied from colorUtils.js)
  js/library.js            fetch manifest, pick a portrait by attributes + seed
  js/demo.html             test page: dropdowns, seed, palette seed, upload-an-image comparison
```

## 1. Build the library (WSL, fenv active, from ~/forest/pixelart)

```
python pfp-library/tools/build_library.py \
  --raw pfp_data/v4_photo/raw --labels pfp_data/v4_photo/labels.jsonl \
  --vocab pfp_data/vocab.json --out library --size 64
```

Options: `--cf` / `--mp` (contrast factor and midpoint, same meaning as the app's `cF`/`mP`;
defaults 1.0 / 128 = identity — the app's 0.55 / 141 compresses the range and leaves buckets unused),
`--bg` (background threshold, default 40), `--mode-filter` (3×3 majority filter to remove specks),
`--preview N` (writes `preview.png` with the first N grids).

Look at `library/preview.png` and tune `--cf`/`--mp`/`--mode-filter` until the grids look right.
Whatever you choose is recorded in `manifest.json` and the JS reads it from there, so user-uploaded
images are quantised with identical settings.

## 2. Try it

Serve the folder (ES modules need http, not file://):

```
cd ~/forest/pixelart && python -m http.server 8000
# open http://localhost:8000/pfp-library/js/demo.html
```

`demo.html` expects the library at `../../library/` relative to itself (i.e. `~/forest/pixelart/library/`); edit `LIBRARY_URL` if you put it elsewhere.

## 3. Use in the app

```js
import { loadLibrary } from "./library.js";
import { seededPalette, renderGrid } from "./palette.js";

const lib = await loadLibrary("/library/");
const { grid } = await lib.pick({ hair: "mohawk", accessory: "sunglasses" }, seed);
renderGrid(canvas, grid, lib.size, seededPalette(paletteSeed), 8);
```

For the existing image-to-pixel-art path, `imageDataToIndices(imageData, 64, lib.manifest)` in
`quantise.js` gives the same 0–9 grid from any uploaded image; `gridToString` gives the digit string.

## Index contract

- `0` = background. `1–9` = luminance buckets, dark → light, from the cell's mean RGB via
  `(r+g+b)/3` → `adjustBrightnessContrast(cF, mP)` → equal-width buckets over 0–255.
- Background = cell mean with `max(r,g,b) < bgThreshold`.
- `build_library.py` and `quantise.js` implement the same steps in the same order; if you change one,
  change the other.

## Notes

- Shards are split by `hair` (8 files, ~2–3 MB each at 4,500 images / 64²); `library.pick` fetches
  only the shard(s) it needs and caches them. Serve with gzip/brotli — digit strings compress ~10×.
- `pick` relaxes filters from the last one backwards when there's no exact match and reports what it
  ignored (`relaxed`), so the UI can say so.
- Palettes: `seededPalette(seed)` returns 10 RGB triples, index 0 = background (black by default).
  Pass `{ background, hueSpan, sat, minL, maxL }` to constrain the generator.
- The equal-width bucket scheme can band on smooth skin. If that's visible after tuning `cF`/`mP`,
  the next step is per-image natural-breaks (Jenks) on luminance — still ordered and deterministic,
  but adaptive. Say the word and I'll add it to both implementations.

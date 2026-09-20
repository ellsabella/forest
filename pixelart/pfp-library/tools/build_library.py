#!/usr/bin/env python3
"""
build_library.py — turn a run of generated portraits into a PFP grid library.

Replicates the production app's cell extraction byte-for-byte
(color-extraction-worker.js: floor-based cell bounds, mean RGB per cell),
then applies the 9-colour clamp defined in js/quantise.js:

    luminance = (r+g+b)/3 of the cell mean            (as getAverageGrayscale)
    adj       = (lum - mP) * cF + mP, clamped 0..255   (as adjustBrightnessContrast)
    index     = 0                     if max(r,g,b) < bg_threshold   (background)
              = 1 + floor(adj/256*9)  otherwise, clamped to 9        (dark -> light)

Output: <out>/manifest.json + <out>/shards/<first attribute value>.json, each shard a JSON array of
    {"id": "000123", <one key per attribute in --vocab>, "g": "<size*size digits>"}
Attribute names are read from --vocab (v6 photo: hair/headwear/accessory/expression;
v7 shaman: figure/headgear/accessory/marking). Shards are keyed by the first attribute.

Usage:
    python build_library.py --raw pfp_data/v4_photo/raw --labels pfp_data/v4_photo/labels.jsonl \
        --vocab pfp_data/vocab.json --out library --size 64 [--cf 1.0 --mp 128 --bg 40 --bg-mode black --mode-filter]
    (v7 shaman runs: --raw pfp_data/v7_shaman/raw --labels pfp_data/v7_shaman/labels.jsonl --vocab pfp_data/v7_shaman/vocab.json --bg-mode white)
"""
import argparse, json
from collections import Counter
from pathlib import Path
import numpy as np
from PIL import Image

N_BUCKETS = 9   # attribute names come from --vocab (v6: hair/headwear/accessory/expression; v7 shaman: figure/headgear/accessory/marking)


def extract_grid_colors(rgb: np.ndarray, cols: int, rows: int) -> np.ndarray:
    """Port of extractGridColors/getDominantColor. rgb: (H,W,3) uint8 -> (rows,cols,3) float."""
    h, w = rgb.shape[:2]
    cw, ch = w / cols, h / rows
    out = np.zeros((rows, cols, 3), dtype=np.float64)
    for y in range(rows):
        y0, y1 = int(np.floor(y * ch)), int(np.floor((y + 1) * ch))
        for x in range(cols):
            x0, x1 = int(np.floor(x * cw)), int(np.floor((x + 1) * cw))
            cell = rgb[y0:y1, x0:x1].reshape(-1, 3)
            out[y, x] = np.round(cell.mean(axis=0)) if len(cell) else 0
    return out


def to_indices(cells: np.ndarray, cf: float, mp: float, bg_threshold: int, bg_mode: str = "black") -> np.ndarray:
    """Port of quantise.js toIndices. cells: (rows,cols,3) -> (rows,cols) uint8 in 0..9.
    bg_mode "black": background = max(R,G,B) < bg_threshold (v6 photo runs).
    bg_mode "white": background = min(R,G,B) > 255 - bg_threshold.
    RGBA sources (v7 shaman runs, keyed out onto black): the caller overrides with alpha < 128 = background."""
    lum = cells.mean(axis=2)
    adj = np.clip((lum - mp) * cf + mp, 0, 255)
    idx = 1 + np.floor(adj / 256 * N_BUCKETS).astype(int)
    idx = np.clip(idx, 1, N_BUCKETS)
    bg = cells.min(axis=2) > 255 - bg_threshold if bg_mode == "white" else cells.max(axis=2) < bg_threshold
    idx[bg] = 0
    return idx.astype(np.uint8)


def tone_map(cells: np.ndarray, fg: np.ndarray, mode: str) -> np.ndarray:
    """Source contrast before bucketing (port of viewer/dev/upload.js stretch/equalise).
    stretch:  foreground 1st..99th luminance percentiles -> 0..255.
    equalise: foreground luminance -> rank percentile * 255 (each bucket gets ~1/9 of the foreground).
    RGB is scaled per cell so the hue is kept."""
    if mode == "off" or fg.sum() < 2:
        return cells
    lum = cells.mean(axis=2)
    if mode == "stretch":
        lo, hi = np.percentile(lum[fg], [1, 99])
        if hi - lo < 1:
            return cells
        return np.clip((cells - lo) * (255.0 / (hi - lo)), 0, 255)
    if mode == "equalise":
        srt = np.sort(lum[fg])
        rank = np.searchsorted(srt, lum, side="left") / max(1, len(srt) - 1)
        k = np.where(lum < 1, 1.0, rank * 255.0 / np.maximum(lum, 1e-6))
        return np.clip(cells * k[..., None], 0, 255)
    raise ValueError(mode)


def mode_filter(idx: np.ndarray) -> np.ndarray:
    """3x3 majority filter; ties keep the centre. Port of quantise.js modeFilter."""
    rows, cols = idx.shape
    out = idx.copy()
    for y in range(rows):
        for x in range(cols):
            win = idx[max(0, y - 1):y + 2, max(0, x - 1):x + 2].ravel()
            counts = Counter(win.tolist())
            best, n = counts.most_common(1)[0]
            if n > counts[idx[y, x]]:
                out[y, x] = best
    return out


def grid_to_string(idx: np.ndarray) -> str:
    return "".join(str(int(v)) for v in idx.ravel())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True, type=Path)
    ap.add_argument("--labels", required=True, type=Path)
    ap.add_argument("--vocab", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--size", type=int, default=64)
    ap.add_argument("--cf", type=float, default=1.0, help="contrast factor (app default 0.55 compresses range)")
    ap.add_argument("--mp", type=float, default=128.0, help="midpoint (app default 141)")
    ap.add_argument("--bg", type=int, default=40, help="background threshold (distance from black or white) of cell mean")
    ap.add_argument("--bg-mode", choices=["black", "white"], default="black", help="background colour of the source images")
    ap.add_argument("--tone", choices=["off", "stretch", "equalise"], default="off", help="source contrast before bucketing (see tone_map)")
    ap.add_argument("--min-fg", type=float, default=0.10, help="reject images with less foreground than this")
    ap.add_argument("--mode-filter", action="store_true", help="apply 3x3 majority filter to remove specks")
    ap.add_argument("--preview", type=int, default=32, help="number of grids in preview.png (0 to skip)")
    args = ap.parse_args()

    vocab = json.load(open(args.vocab))
    attrs = list(vocab)                       # shard by the first attribute
    recs = [json.loads(l) for l in open(args.labels)]
    shards = {}
    kept = rejected = 0
    preview = []

    for r in recs:
        path = args.raw / r["file"]
        if not path.exists():
            continue
        im = Image.open(path)
        has_alpha = im.mode == "RGBA"                     # v7 runs: keyed-out PNGs, background = alpha
        arr = np.asarray(im.convert("RGBA" if has_alpha else "RGB"))
        s = min(arr.shape[:2])
        y0, x0 = (arr.shape[0] - s) // 2, (arr.shape[1] - s) // 2
        arr = arr[y0:y0 + s, x0:x0 + s]
        cells = extract_grid_colors(arr[..., :3], args.size, args.size)
        if has_alpha:
            alpha = extract_grid_colors(np.repeat(arr[..., 3:], 3, axis=2), args.size, args.size)[..., 0]
            fg = alpha >= 128
        else:
            fg = (cells.min(axis=2) <= 255 - args.bg) if args.bg_mode == "white" else (cells.max(axis=2) >= args.bg)
        cells = tone_map(cells, fg, args.tone)
        idx = to_indices(cells, args.cf, args.mp, args.bg, args.bg_mode)
        if has_alpha:
            idx = np.where(alpha < 128, 0, np.maximum(idx, 1)).astype(np.uint8)
        if (idx > 0).mean() < args.min_fg:
            rejected += 1
            continue
        if args.mode_filter:
            idx = mode_filter(idx)
        entry = {"id": Path(r["file"]).stem, **{a: r[a] for a in attrs}, "g": grid_to_string(idx)}
        shards.setdefault(r[attrs[0]], []).append(entry)
        kept += 1
        if len(preview) < args.preview:
            preview.append(idx)

    (args.out / "shards").mkdir(parents=True, exist_ok=True)
    counts = {}
    for hair, entries in shards.items():
        fn = args.out / "shards" / f"{hair.replace(' ', '_')}.json"
        json.dump(entries, open(fn, "w"), separators=(",", ":"))
        counts[hair] = len(entries)

    manifest = {
        "size": args.size, "buckets": N_BUCKETS, "cF": args.cf, "mP": args.mp,
        "bgThreshold": args.bg, "bgMode": args.bg_mode, "tone": args.tone, "modeFilter": args.mode_filter,
        "vocab": vocab, "shardBy": attrs[0],
        "shards": {h: f"shards/{h.replace(' ', '_')}.json" for h in shards},
        "counts": counts, "total": kept,
    }
    json.dump(manifest, open(args.out / "manifest.json", "w"), indent=2)
    print(f"kept {kept}, rejected {rejected}, shards: {counts}")

    if preview:
        pal = np.array([[0, 0, 0], [40, 20, 60], [90, 40, 90], [150, 60, 100], [200, 90, 90],
                        [230, 140, 80], [240, 190, 90], [250, 230, 140], [255, 250, 220], [255, 255, 255]], np.uint8)
        n, cols = len(preview), 8
        rows = -(-n // cols)
        sheet = np.zeros((rows * args.size, cols * args.size, 3), np.uint8)
        for i, g in enumerate(preview):
            y, x = divmod(i, cols)
            sheet[y * args.size:(y + 1) * args.size, x * args.size:(x + 1) * args.size] = pal[g]
        Image.fromarray(sheet).resize((sheet.shape[1] * 4, sheet.shape[0] * 4), Image.NEAREST) \
            .save(args.out / "preview.png")
        print("preview written to", args.out / "preview.png")


if __name__ == "__main__":
    main()

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

Output: <out>/manifest.json + <out>/shards/<hair>.json, each shard a JSON array of
    {"id": "000123", "hair": "...", "headwear": "...", "accessory": "...",
     "expression": "...", "g": "<size*size digits>"}

Usage:
    python build_library.py --raw pfp_data/v4_photo/raw --labels pfp_data/v4_photo/labels.jsonl \
        --vocab pfp_data/vocab.json --out library --size 64 [--cf 1.0 --mp 128 --bg 40 --mode-filter]
"""
import argparse, json
from collections import Counter
from pathlib import Path
import numpy as np
from PIL import Image

ATTRS = ["hair", "headwear", "accessory", "expression"]
N_BUCKETS = 9


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


def to_indices(cells: np.ndarray, cf: float, mp: float, bg_threshold: int) -> np.ndarray:
    """Port of quantise.js toIndices. cells: (rows,cols,3) -> (rows,cols) uint8 in 0..9."""
    lum = cells.mean(axis=2)
    adj = np.clip((lum - mp) * cf + mp, 0, 255)
    idx = 1 + np.floor(adj / 256 * N_BUCKETS).astype(int)
    idx = np.clip(idx, 1, N_BUCKETS)
    bg = cells.max(axis=2) < bg_threshold
    idx[bg] = 0
    return idx.astype(np.uint8)


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
    ap.add_argument("--bg", type=int, default=40, help="background threshold on max(R,G,B) of cell mean")
    ap.add_argument("--min-fg", type=float, default=0.10, help="reject images with less foreground than this")
    ap.add_argument("--mode-filter", action="store_true", help="apply 3x3 majority filter to remove specks")
    ap.add_argument("--preview", type=int, default=32, help="number of grids in preview.png (0 to skip)")
    args = ap.parse_args()

    vocab = json.load(open(args.vocab))
    recs = [json.loads(l) for l in open(args.labels)]
    shards = {}
    kept = rejected = 0
    preview = []

    for r in recs:
        path = args.raw / r["file"]
        if not path.exists():
            continue
        rgb = np.asarray(Image.open(path).convert("RGB"))
        s = min(rgb.shape[:2])
        y0, x0 = (rgb.shape[0] - s) // 2, (rgb.shape[1] - s) // 2
        rgb = rgb[y0:y0 + s, x0:x0 + s]
        cells = extract_grid_colors(rgb, args.size, args.size)
        idx = to_indices(cells, args.cf, args.mp, args.bg)
        if (idx > 0).mean() < args.min_fg:
            rejected += 1
            continue
        if args.mode_filter:
            idx = mode_filter(idx)
        entry = {"id": Path(r["file"]).stem, **{a: r[a] for a in ATTRS}, "g": grid_to_string(idx)}
        shards.setdefault(r["hair"], []).append(entry)
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
        "bgThreshold": args.bg, "modeFilter": args.mode_filter,
        "vocab": vocab, "shardBy": "hair",
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

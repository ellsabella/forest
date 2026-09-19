#!/usr/bin/env python3
"""
export_fixtures.py — copy a few grids from a built library into viewer/fixtures/.

Each fixture is {"id", "attrs", "grid"} where grid is the G*G digit string the FOREST
viewer consumes (0 = transparent, 1-9 = luminance buckets dark -> light). Palettes are
chosen in the viewer, not here. Also writes fixtures/index.json listing the files.

Usage (from ~/forest/pixelart):
    python tools/export_fixtures.py --library library --out ../viewer/fixtures [--per-shard 3] [--ids 000123 000456]
"""
import argparse, json
from pathlib import Path

ATTRS = ["hair", "headwear", "accessory", "expression"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--library", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--per-shard", type=int, default=3, help="evenly spaced picks per shard")
    ap.add_argument("--ids", nargs="*", default=[], help="explicit ids to export as well")
    args = ap.parse_args()

    manifest = json.load(open(args.library / "manifest.json"))
    size = manifest["size"]
    picked = []
    for shard in manifest["shards"].values():
        entries = json.load(open(args.library / shard))
        step = max(1, len(entries) // max(1, args.per_shard))
        chosen = entries[step // 2::step][:args.per_shard]
        chosen += [e for e in entries if e["id"] in args.ids and e not in chosen]
        picked += chosen

    args.out.mkdir(parents=True, exist_ok=True)
    index = []
    for e in sorted(picked, key=lambda e: e["id"]):
        assert len(e["g"]) == size * size
        fx = {"id": e["id"], "size": size, "attrs": {a: e[a] for a in ATTRS}, "grid": e["g"]}
        json.dump(fx, open(args.out / f"{e['id']}.json", "w"), separators=(",", ":"))
        index.append({"id": e["id"], "file": f"{e['id']}.json",
                      "label": " / ".join(e[a] for a in ATTRS if e[a] != "none")})
    json.dump({"size": size, "fixtures": index}, open(args.out / "index.json", "w"), indent=1)
    print(f"wrote {len(index)} fixtures ({size}x{size}) to {args.out}")


if __name__ == "__main__":
    main()

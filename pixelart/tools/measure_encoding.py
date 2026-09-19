#!/usr/bin/env python3
"""
measure_encoding.py — how many bytes does a curated G×G grid cost on-chain? (PLAN §3)

Runs every grid of a built library through the candidate encodings and reports
bytes/grid statistics plus projected SSTORE2 deploy gas for a pool of N grids.

Encodings
    A  nibble      4 bits/cell, row-major                        (G²/2 bytes, trivial decoder)
    B  rle         1 byte/run: hi nibble colour, lo nibble len-1  (runs > 16 split)
    C  flz(A|B)    FastLZ level 1 over A or B — the format Solady LibZip.flzDecompress reads
    Z  zlib(A|B)   raw DEFLATE level 9 — reference lower bound (needs an on-chain inflate)
  "paged" rows compress whole ~24 KB pages of concatenated grids instead of single grids:
  better ratio, but reading one grid means decompressing its whole page.

The FLZ compressor here is a straightforward greedy FastLZ-L1 encoder, round-trip checked
against the decoder below. Solady's own compressor may differ by a few bytes; treat the
numbers as estimates (±2 %) and confirm the chosen encoding in the Foundry round-trip test.

Usage (from ~/forest/pixelart):
    python tools/measure_encoding.py --library library [--sample 0] [--report docs/ENCODING_MEASUREMENTS.md]
"""
import argparse, json, zlib
from pathlib import Path
import numpy as np

PAGE = 24_575                      # max SSTORE2 payload (24,576 code bytes incl. the STOP prefix)
GAS_PER_BYTE = 200                 # code deposit
GAS_PER_PAGE = 32_000 + 21_000 + 16 * PAGE   # CREATE + tx base + calldata (upper bound: all non-zero bytes)


# ---------------------------------------------------------------- encodings

def enc_nibble(digits: np.ndarray) -> bytes:
    d = digits if len(digits) % 2 == 0 else np.append(digits, 0)
    return ((d[0::2] << 4) | d[1::2]).astype(np.uint8).tobytes()


def enc_rle(digits: np.ndarray) -> bytes:
    out = bytearray()
    change = np.flatnonzero(np.diff(digits)) + 1
    starts = np.concatenate(([0], change))
    lens = np.diff(np.concatenate((starts, [len(digits)])))
    for s, n in zip(starts, lens):
        c = int(digits[s]) << 4
        while n > 16:
            out.append(c | 15); n -= 16
        out.append(c | (n - 1))
    return bytes(out)


def dec_rle(data: bytes) -> np.ndarray:
    out = []
    for b in data:
        out += [b >> 4] * ((b & 15) + 1)
    return np.array(out, dtype=np.uint8)


def flz_compress(src: bytes) -> bytes:
    """Greedy FastLZ level-1 encoder (3-byte hash, 8191 window, min match 3)."""
    n, out, ht = len(src), bytearray(), {}
    anchor = i = 0

    def literals(a, b):
        while a < b:
            run = min(32, b - a)
            out.append(run - 1); out.extend(src[a:a + run]); a += run

    limit = n - 4                                  # FastLZ keeps a small literal tail
    while i < limit:
        key = src[i:i + 3]
        ref = ht.get(key, -1)
        ht[key] = i
        dist = i - ref
        if ref < 0 or dist > 8191:
            i += 1
            continue
        ml = 3
        while i + ml < n and src[ref + ml] == src[i + ml]:
            ml += 1
        literals(anchor, i)
        d, ln = dist - 1, ml - 2
        while ln > 262:
            out += bytes(((7 << 5) | (d >> 8), 253, d & 255)); ln -= 262
        if ln < 7:
            out += bytes(((ln << 5) | (d >> 8), d & 255))
        else:
            out += bytes(((7 << 5) | (d >> 8), ln - 7, d & 255))
        end = i + ml
        for j in (end - 2, end - 1):               # FastLZ re-seeds the table at the match tail
            if 0 <= j < limit:
                ht[src[j:j + 3]] = j
        i = anchor = end
    literals(anchor, n)
    return bytes(out)


def flz_decompress(data: bytes) -> bytes:
    out, i, n = bytearray(), 0, len(data)
    while i < n:
        c = data[i]; i += 1
        t = c >> 5
        if t == 0:
            out += data[i:i + c + 1]; i += c + 1
        else:
            ln = t
            if t == 7:
                ln += data[i]; i += 1
            off = ((c & 31) << 8) + data[i] + 1; i += 1
            for _ in range(ln + 2):
                out.append(out[-off])
    return bytes(out)


def deflate(b: bytes) -> bytes:
    c = zlib.compressobj(9, zlib.DEFLATED, -15)
    return c.compress(b) + c.flush()


# ---------------------------------------------------------------- measurement

def stats(sizes):
    a = np.array(sizes)
    return dict(mean=float(a.mean()), median=float(np.median(a)), p95=float(np.percentile(a, 95)), max=int(a.max()))


def paged(blobs, compress):
    """Greedy-pack raw blobs into pages so each *compressed* page fits PAGE; return mean bytes/grid."""
    total, cur, count = 0, [], 0
    for b in blobs:
        trial = compress(b"".join(cur + [b]))
        if cur and len(trial) > PAGE:
            total += len(compress(b"".join(cur))); count += 1
            cur = [b]
        else:
            cur.append(b)
    if cur:
        total += len(compress(b"".join(cur))); count += 1
    return total / len(blobs), count


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--library", required=True, type=Path)
    ap.add_argument("--sample", type=int, default=0, help="use only the first N grids per shard (0 = all)")
    ap.add_argument("--paged-sample", type=int, default=400, help="grids used for the (slow) paged rows")
    ap.add_argument("--mode-filter", action="store_true", help="apply build_library's 3x3 majority filter first (what-if)")
    ap.add_argument("--report", type=Path, default=None)
    args = ap.parse_args()

    manifest = json.load(open(args.library / "manifest.json"))
    size = manifest["size"]
    grids = []
    for shard in manifest["shards"].values():
        entries = json.load(open(args.library / shard))
        grids += [e["g"] for e in (entries[:args.sample] if args.sample else entries)]
    digits = [np.frombuffer(g.encode(), dtype=np.uint8) - 48 for g in grids]
    if args.mode_filter:                               # what-if: despeckle before encoding (changes the art!)
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pfp-library" / "tools"))
        from build_library import mode_filter
        digits = [mode_filter(d.reshape(size, size)).ravel() for d in digits]
        manifest["modeFilter"] = "applied here (3x3)"
    print(f"{len(grids)} grids, {size}x{size}, settings cF={manifest['cF']} mP={manifest['mP']} "
          f"bg={manifest['bgThreshold']} modeFilter={manifest['modeFilter']}")

    A = [enc_nibble(d) for d in digits]
    B = [enc_rle(d) for d in digits]
    assert all(np.array_equal(dec_rle(b), d) for b, d in zip(B[:50], digits[:50])), "RLE round-trip failed"
    rows = {"A nibble": [len(x) for x in A], "B rle": [len(x) for x in B]}
    for name, blobs in (("A", A), ("B", B)):
        fl = [flz_compress(x) for x in blobs]
        assert all(flz_decompress(c) == x for c, x in zip(fl[:200], blobs[:200])), "FLZ round-trip failed"
        rows[f"C flz({name})"] = [len(x) for x in fl]
        rows[f"Z zlib({name})"] = [len(deflate(x)) for x in blobs]
    def h0(d):                                         # order-0 entropy: floor for any per-cell symbol coder
        p = np.bincount(d, minlength=10) / len(d)
        p = p[p > 0]
        return int(np.ceil(-(p * np.log2(p)).sum() * len(d) / 8))
    rows["(H0 entropy floor, per-cell coder)"] = [h0(d) for d in digits]
    best = [min(v) for v in zip(*(rows[k] for k in ("B rle", "C flz(A)", "C flz(B)")))]
    rows["min(B, flz(A), flz(B)) +1 tag byte"] = [b + 1 for b in best]

    fg = np.array([(d > 0).mean() for d in digits])
    runs = np.array([len(b) for b in B])
    lines = [f"# Encoding measurements — {len(grids)} grids, {size}×{size}", "",
             f"Library settings: cF={manifest['cF']} mP={manifest['mP']} bg={manifest['bgThreshold']} "
             f"modeFilter={manifest['modeFilter']}. Foreground cells: mean {fg.mean():.1%} "
             f"(min {fg.min():.1%}, max {fg.max():.1%}). RLE runs/grid: mean {runs.mean():.0f}.", "",
             "## Bytes per grid (each grid independently readable)", "",
             "| encoding | mean | median | p95 | max | vs nibble |", "|---|---:|---:|---:|---:|---:|"]
    base = np.mean(rows["A nibble"])
    summary = {}
    for k, v in rows.items():
        s = stats(v); summary[k] = s
        lines.append(f"| {k} | {s['mean']:.0f} | {s['median']:.0f} | {s['p95']:.0f} | {s['max']} | {s['mean'] / base:.0%} |")

    ps = min(args.paged_sample, len(A))
    lines += ["", f"## Paged (whole ~24 KB page compressed together; first {ps} grids)", "",
              "| encoding | mean bytes/grid | grids/page |", "|---|---:|---:|"]
    for name, blobs, fn in (("flz(A) paged", A, flz_compress), ("zlib(A) paged", A, deflate), ("zlib(B) paged", B, deflate)):
        per, pages = paged(blobs[:ps], fn)
        summary[name] = dict(mean=per)
        lines.append(f"| {name} | {per:.0f} | {ps / pages:.1f} |")

    lines += ["", "## Deploy cost projection (SSTORE2: 200 gas/byte + ~446 k gas/page overhead incl. calldata)", "",
              "| encoding | N | MB | pages | gas (M) | ETH @0.5 gwei | @2 gwei | @10 gwei |", "|---|---:|---:|---:|---:|---:|---:|---:|"]
    for k in ("A nibble", "B rle", "C flz(A)", "min(B, flz(A), flz(B)) +1 tag byte", "zlib(A) paged"):
        for n in (1000, 2048, 4096):
            total = summary[k]["mean"] * n + 6 * n           # + 6-byte index entry per grid
            pages = int(np.ceil(total / PAGE))
            gas = total * GAS_PER_BYTE + pages * GAS_PER_PAGE
            eth = [gas * g * 1e-9 for g in (0.5, 2, 10)]
            lines.append(f"| {k} | {n} | {total / 1e6:.2f} | {pages} | {gas / 1e6:.0f} | {eth[0]:.2f} | {eth[1]:.2f} | {eth[2]:.2f} |")

    report = "\n".join(lines) + "\n"
    print("\n" + report)
    if args.report:
        args.report.write_text(report, encoding="utf-8")
        print("report written to", args.report)


if __name__ == "__main__":
    main()

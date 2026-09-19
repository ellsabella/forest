# Encoding measurements — 4500 grids, 64×64

Library settings: cF=1.0 mP=128.0 bg=40 modeFilter=False. Foreground cells: mean 53.8% (min 30.4%, max 85.2%). RLE runs/grid: mean 1293.

## Bytes per grid (each grid independently readable)

| encoding | mean | median | p95 | max | vs nibble |
|---|---:|---:|---:|---:|---:|
| A nibble | 2048 | 2048 | 2048 | 2048 | 100% |
| B rle | 1293 | 1275 | 1651 | 2095 | 63% |
| C flz(A) | 1254 | 1249 | 1511 | 1789 | 61% |
| Z zlib(A) | 817 | 811 | 1002 | 1255 | 40% |
| C flz(B) | 1187 | 1176 | 1494 | 1919 | 58% |
| Z zlib(B) | 831 | 824 | 1031 | 1314 | 41% |
| (H0 entropy floor, per-cell coder) | 1248 | 1246 | 1421 | 1591 | 61% |
| min(B, flz(A), flz(B)) +1 tag byte | 1185 | 1176 | 1486 | 1790 | 58% |

## Paged (whole ~24 KB page compressed together; first 400 grids)

| encoding | mean bytes/grid | grids/page |
|---|---:|---:|
| flz(A) paged | 1165 | 20.0 |
| zlib(A) paged | 811 | 28.6 |
| zlib(B) paged | 810 | 28.6 |

## Deploy cost projection (SSTORE2: 200 gas/byte + ~446 k gas/page overhead incl. calldata)

| encoding | N | MB | pages | gas (M) | ETH @0.5 gwei | @2 gwei | @10 gwei |
|---|---:|---:|---:|---:|---:|---:|---:|
| A nibble | 1000 | 2.05 | 84 | 448 | 0.22 | 0.90 | 4.48 |
| A nibble | 2048 | 4.21 | 172 | 918 | 0.46 | 1.84 | 9.18 |
| A nibble | 4096 | 8.41 | 343 | 1836 | 0.92 | 3.67 | 18.36 |
| B rle | 1000 | 1.30 | 53 | 283 | 0.14 | 0.57 | 2.83 |
| B rle | 2048 | 2.66 | 109 | 581 | 0.29 | 1.16 | 5.81 |
| B rle | 4096 | 5.32 | 217 | 1161 | 0.58 | 2.32 | 11.61 |
| C flz(A) | 1000 | 1.26 | 52 | 275 | 0.14 | 0.55 | 2.75 |
| C flz(A) | 2048 | 2.58 | 106 | 563 | 0.28 | 1.13 | 5.63 |
| C flz(A) | 4096 | 5.16 | 211 | 1126 | 0.56 | 2.25 | 11.26 |
| min(B, flz(A), flz(B)) +1 tag byte | 1000 | 1.19 | 49 | 260 | 0.13 | 0.52 | 2.60 |
| min(B, flz(A), flz(B)) +1 tag byte | 2048 | 2.44 | 100 | 532 | 0.27 | 1.06 | 5.32 |
| min(B, flz(A), flz(B)) +1 tag byte | 4096 | 4.88 | 199 | 1064 | 0.53 | 2.13 | 10.64 |
| zlib(A) paged | 1000 | 0.82 | 34 | 179 | 0.09 | 0.36 | 1.79 |
| zlib(A) paged | 2048 | 1.67 | 69 | 365 | 0.18 | 0.73 | 3.65 |
| zlib(A) paged | 4096 | 3.35 | 137 | 730 | 0.37 | 1.46 | 7.30 |

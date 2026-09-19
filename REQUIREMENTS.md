# Project Requirements — SeaDrop On-Chain Generative Art

## Baseline

1. **Extend SeaDrop contract functionality.** Do not remove any of the existing functions.
2. **Metadata (per OpenSea standards):**
   - `image` field of `tokenURI` → SVG thumbnail
   - `animation_url` field of `tokenURI` → animated HTML
3. **Custom renderer.** Pass in only the values needed to generate the artwork, keeping the token size minimal.
4. **Artwork outputs are unique and deterministic.**

## SeaDrop Contract Review (ProjectOpenSea/seadrop, `main`)

**Inheritance chain:** `ERC721SeaDrop` → `ERC721ContractMetadata` → `ERC721AConduitPreapproved` (ERC721A) + `ERC721TransferValidator` + `TwoStepOwnable`. Solidity `0.8.17`. Token IDs start at 1.

**Integration points relevant to us:**
- `tokenURI(uint256)` is `public view virtual override` in `ERC721SeaDrop` — this is the hook. Current impl just returns `_baseURI()` / `_baseURI() + tokenId`. We override it to return an on-chain `data:application/json;base64,…` JSON built by the renderer.
- `_baseURI()` / `setBaseURI()` remain intact (unused by us but not removed).
- `mintSeaDrop(address minter, uint256 quantity)` — `nonReentrant`, calls `_safeMint`. Do **not** modify. Seed generation for determinism can hook `_beforeTokenTransfers` (already overridden in `ERC721ContractMetadata` for the transfer validator; call `super`) or derive the seed at render time from immutable inputs.
- `emitBatchMetadataUpdate()` (ERC-4906) exists — useful if a renderer address is upgraded pre-freeze.
- `supportsInterface` is `virtual`; keep `super` chain intact.

**OpenSea's stated constraint:** inherit `ERC721SeaDrop`; do not override or modify SeaDrop-related functionality such as `getMintStats()`.

**Extensions dir pattern:** `src/extensions/ERC721SeaDropRandomOffset.sol` shows the idiomatic way to subclass — our contract will live alongside it.

**Repo setup:** `git clone --recurse-submodules https://github.com/ProjectOpenSea/seadrop`, Foundry (`forge`) + yarn/hardhat.

## Decisions

- **Branch:** `main` (Solidity 0.8.17).
- **Renderer:** separate contract, referenced by address from the token. Owner can swap the renderer address until an irreversible `freezeRenderer()` is called. Emit ERC-4906 `BatchMetadataUpdate` on renderer change.
- **Traits:** nothing stored per token. Renderer recomputes everything from the seed on each `tokenURI` call. Revisit if read gas becomes a problem.
- **Chain:** Ethereum mainnet. 24KB contract size limit applies; renderer may need to be split (e.g. SVG thumbnail vs HTML/JS held in separate contracts, or `SSTORE2` chunks).
- **HTML:** everything inlined in the `animation_url` data URI. WebGL, no external libraries.
- **Seed source:** OpenSea's only reference pattern in this repo is `ERC721SeaDropRandomOffset` — a single `randomOffset` set from block data after the collection is fully minted, so no token's output is predictable before mint. Seed = `keccak256(tokenId, randomOffset, contractAddress)`. Proposed as default; note this ties reveal to full mint-out (or an owner-triggered fallback).
- **Fully on-chain, no external dependencies (hard requirement).** Everything a token needs to render — grids, palettes, SVG builder, HTML/JS/GLSL — lives in contract code/storage. No IPFS, no servers, no off-chain model at render time.
- **Grid size: 64×64** (4096 cells, 64³ volume). Decided 2026-09-19; supersedes the original 40×40. The grid size is a single constant `G` everywhere (Solidity, JS, tooling) — never a literal.
- **Grid source: curated on-chain pool (working decision, 2026-09-19; still open to a procedural generator).** A fixed pool of `N ≥ maxSupply` hand-curated pixel-art grids, produced off-chain by the `pixelart/` pipeline (FLUX → quantise → curate), stored compressed on-chain as a shared renderer asset (SSTORE2). This is a shared library, not per-token storage — the "nothing stored per token" decision above still holds. A neural model can never run on-chain; `pixelart/`'s trained model is an off-chain authoring tool only.
- **Grid selection must be collision-free:** `gridIndex = (tokenId + randomOffset) % N` — the RandomOffset pattern itself. A keccak-derived `seed % N` would give two tokens the same image. The keccak `seed` drives everything else (palette choice, voxel depths, walks).

## Open Questions

- Reveal: live from mint vs placeholder until reveal. If we use RandomOffset, reveal is effectively post-mint-out unless the owner can force it early.
- Previous WebGL project: not found in past chats in this project — please share the HTML/JS if it should be used as a reference.

## Reference: ellsabella/blockcassone ("TheBLOCK")

Reviewed via docs (`Overview.md`, `FULLY_ONCHAIN_IMPLEMENTATION_PLAN.md`, `OPENSEA_COMPLIANCE_BRIEF.md`, `TOKEN_RENDERER_PARITY_PLAN.md`). GitHub blocks automated directory listing, so the actual `.sol`, `.js` and `.glsl` sources were **not** read — only their described behaviour.

### How the art works
- Subject: a 3D Hilbert curve world. 5th-order Hilbert cube = 4096 slots; each token is one cube at one slot. Slot → `plot / street / neighbourhood / region` traits via integer division (8 / 64 / 512).
- Each cube renders a source NFT (40×40 pixel grid from on-chain CC0 collections) as a voxel volume, plus: internal Hilbert line segments (neon), glass shell + wireframe, cardioid/"feather" translucent surfaces launched from Hilbert edge geometry, forest strands/particles, three orbiting RGB point lights, category-based styling (burned / base / edited / awakened / elite).
- Raw WebGL2, no Three.js. Scene-item system: `{mesh, material, transform, blend, transparentLayer, uniforms}`; render order opaque → alpha (back-to-front) → additive → alpha overlay.
- Art input is deliberately compact: a 200-byte packed 1-bit 40×40 bitmap (or 400-byte 2-bit tonal bands) decoded in browser JS; Solidity never builds meshes. Browser derives contours, walkers, voxel mesh.
- Renderer config injected as `window.BLOCKCASSONE_TOKEN = {...}` between HTML head chunk and script chunks.
- Metadata: `image` = deterministic default-view SVG thumbnail; `animation_url` = interactive HTML/WebGL with orbit/zoom/reset. Both `data:` URIs. Acceptance test: no `fetch(`, no remote URLs.

### Contract setup vs. ours — core differences
| Area | blockcassone | Our plan |
|---|---|---|
| Token base | Custom ERC-721, **not** `ERC721SeaDrop` / not ERC721A. Implements `INonFungibleSeaDropToken` from scratch. | Inherit `ERC721SeaDrop` unchanged, subclass in `src/extensions/`. |
| `mintSeaDrop` | Overridden to route into a minter module that assigns a specific artwork + world slot per mint (reservations, weighted random). | Untouched; sequential ERC721A mint. |
| Per-token storage | `CubeData` struct per token (slot, source contract/tokenId, seed, agentic, versions) + uniqueness mappings. | Zero per-token storage; everything derived from seed at `tokenURI` time. |
| Renderer | `CubeRendererV2` + `RendererAssetStore` holding ordered HTML/JS chunks; `RendererRegistry` for versioning/pinning. | Single swappable renderer address, frozen once. Chunk store may still be needed for size. |
| Randomness | VRF / commit-reveal considered; block variables discouraged because slot has market value. | RandomOffset-style block-data offset (proposed). |
| External deps | Reads other on-chain collections' pixel data via adapter contracts. | None — self-contained generative. |
| World state | Mutable `CubeWorld` (movement, consolidation, population). | None. |

### blockcassone source files reviewed
- `viewer/cube-glass.js` — glass **shell**, not per-voxel glass: outer 6-face box (`stone-glass` material, alpha blend), 5 nested offset wireframe boxes + 2 inner glass boxes, face-grid lines and corner sparkle billboards (`lines` / `edge-glow`, additive). Reusable: `pushBoxFaces`, `pushBoxWireEdges`, scene-item pattern.
- `viewer/tree-walker.js` — **not a random walk.** A fixed depth-3 binary fractal tree (`walkTree`: trunk → 2 → 4 → 8 tips, Rodrigues rotation by ±`spread`, length × `decay`), CPU mirror of an SDF shader. Also exports `hash1` (sin-hash, matches GLSL) and `hashInt` (murmur-style, better distribution). Useful for branch geometry but not for voxel-to-voxel walks.
- `viewer/normie/voxels.js` — per-voxel mesh builder. Each voxel = 36 verts (6 faces × 2 tris), non-indexed, shrunk to `0.46 × cell` so cubes float with gaps. Per-vertex attributes: `alpha` (float) and `variant` (float). Alpha = falloff-from-centre × per-voxel random × interior-neighbour damping × density damping × walker-boost (2.8× if a walk touched it) × tonal-band multiplier. Material `normie-voxel`, alpha blend, uniforms `uTint, uAlpha, uLightScale, uCubeCenter, uCubeHalfSize`. References `meshes['stone-walk-touched-…']` — the actual walk module is elsewhere.
- `renderer/src/materials.js` — program compile/link, fixed uniform-name list, shader fetch with `// #include` resolution. For on-chain use: replace fetch with inline source strings (`loadMaterialFromSource` already exists).
- `viewer/lights.js` — 3 HDR RGB point lights (R/G/B at colour intensity 5.0) positioned cube-relative (`world = center + pos × halfSize`), uploaded as flat `Float32Array(8×3)`. Marker billboards via `edge-glow`.
- `renderer/src/geometry.js` — `createMeshGL` (VAO, fixed attribute locations 0 pos / 1 normal / 2 uv / 3 tangent / 4 alpha / 5 variant, auto Uint16/Uint32 indices), `createLineNetwork` (GL_LINES with alpha fade 1.0→0.2 along each segment — directly reusable for walks), `createWireframeBox`, `createBillboard`.
- `viewer/materials/stone-walker.js` — **the random walk.** Walks on the 41³ lattice of voxel *corner nodes* (not voxel centres). Per walk: (1) pick a start node on a cube face whose perpendicular column contains a filled voxel; (2) `runInitialRay` — travel straight inward, stopping just before the first filled voxel; (3) `runRandomWalk` alternates **surface mode** (step along edges that lie on the outer surface of the filled cluster, preferring turns, max 6 steps) and **flight mode** (fly straight until touching another voxel's corner or the boundary). Termination: shared `occupied` edge set (walks stop when hitting any previously drawn edge), 0.6 % per-step random termination, boundary. Output: flat `[x0,y0,z0,x1,y1,z1]` segment list → core line mesh + wide additive glow mesh (`normie-glow`), plus the `touched` voxel set that boosts voxel alpha. ~40 walks per face. `buildWalkerItemsFromFilled` is the generic entry point: takes any `filled` Uint8Array(64000) — directly reusable with our voxel set.
- `renderer/shaders/stone-glass.{vert,frag}.glsl` — vert is trivial pass-through (pos, normal, `uM/uView/uProj`). Frag: Schlick Fresnel (F0 0.04), two-sided normals, tight Blinn-Phong specular (pow 160) from one directional light, procedural environment = sky gradient + 4 fixed directional "studio light" peaks sampled by the reflection vector, dim body (`tint × 0.08`), Fresnel edge (`tint × fres² × 1.3`), alpha ramps 0.4→0.95 with Fresnel + specular boost. ~60 lines, no textures, no point lights — all self-contained. **Does not use the RGB point lights**; those are in `normie-voxel`.
- `renderer/shaders/normie-voxel.{vert,frag}.glsl` — the RGB-light glass voxel look. Vert: pass-through with per-vertex `aAlpha` (loc 4) and `aVariant` (loc 5). Frag: Schlick Fresnel, two-sided normals; faint directional specular (pow 48); **point-light specular loop** over up to 8 lights — light pos = `uCubeCenter + pos × uCubeHalfSize`, attenuation `1/(1+0.08d²)`, Blinn-Phong pow 18, Fresnel-boosted; **environment reflection from `uEnvTex` sampler** (cube-face or 4×3 cross layout via `uEnvLayout`); body `tint × 0.06`, Fresnel edge `tint × fres²`; per-voxel "react" behaviour from `vVariant` (inert < 0.26, bright 0.86–0.96, glitch > 0.96 blinks with `uTime`); alpha = `uAlpha × vAlpha × react × Fresnel ramp 0.25→0.98 + specular boost`.
- **On-chain concern:** `uEnvTex` is a texture. Source/generation unknown — must be procedural (or swapped for `stone-glass`'s `fakeEnv`) to keep the HTML self-contained.
- **Recreation decisions:** keep the `vVariant` inert/bright/glitch behaviours; lights static (no pulse/orbit) for now. **Plain black background in production** — `uEnvTex` is obsolete; drop `sampleEnv` and the `uEnvTex`/`uEnvLayout` uniforms from the port. The glass look comes from Fresnel edge + directional/point-light specular only.



- Chunked HTML assembly pattern (head chunk → injected token JSON → script chunks).
- Compact packed-bitmap → browser decode approach for keeping token data tiny.
- WebGL scene/material structure and shader stack (once sources are available).
- Acceptance checks for a self-contained `animation_url`.

## Art Requirements

### Engineering principle
Clean, DRY, minimal footprint. No per-token storage beyond what is needed to derive the seed. All geometry derived in browser JS from the seed; Solidity only assembles metadata, SVG and the HTML shell with injected token data.

### 2D artifact (SVG thumbnail, `image`)
- 64×64 pixel-art grid (`G = 64`; was 40×40).
- On-chain array of colour palettes. Each palette has **exactly 10 slots**: slot `0` is reserved for transparent (rendered black in the SVG, no voxel in 3D); slots `1–9` are up to **9 real colours**. Palettes with fewer than 9 colours leave the trailing slots unused. Token selects one palette deterministically from the seed.
- **Palettes are luminance ramps: slots `1–9` ordered dark → light.** The curated grids' indices are luminance buckets (1 = darkest, 9 = lightest — see `pixelart/pfp-library/README.md`, "Index contract"), so an unordered palette would scramble the image. Hue may vary freely along the ramp.
- Palette storage: 27 bytes per palette (9 × RGB); slot 0 is implicit.
- Grid encoded as a `G²` = 4096-char string of digits `0–9` indexing the palette. `0` = transparent / alpha 0, rendered as black in the SVG. (This is the in-memory / injected-into-HTML form; on-chain storage is a compressed form of the same data — PLAN §3.)
- SVG = the grid drawn as coloured cells filling the square edge to edge, no gaps.
- Grid source: curated on-chain pool (see Decisions). Placeholder for viewer development before the pool exists: fixtures exported from `pixelart/` at `--size 64`.

### 3D artifact (HTML/WebGL, `animation_url`)
- Same `G²` cells lifted into 3D. Each non-zero cell becomes one or more glass voxels distributed along the depth axis inside an imaginary cube. Distribution pattern: **TBD**.
- The voxel face pointing at the viewer carries the cell's palette colour.
- **"Magic eye" concept:** viewed flat along the depth axis, the scattered voxels collapse into exactly the 2D image; orbiting away dissolves it into a 3D scatter.
- Two view modes, switchable:
  - **Flat / front view** — axis-aligned orthographic projection, no perspective, reproduces the SVG pixel-for-pixel (visually identical; bit-identical not required).
  - **Explore view** — perspective camera with orbit / zoom / reset navigation.
- **Depth splitting (optional):** a cell's colour may be spread across several voxels at different depths, each partially transparent, composited with additive blending so they sum to a solid colour in the flat view but read as translucent glass in 3D.
- Side and top/bottom faces of voxels get their own panels (treatment TBD), visible only outside the flat view.
- Lighting: RGB point-light aesthetic in the style of blockcassone.
- Connecting lines between voxels drawn by a random-walk algorithm in the style of blockcassone.
- Raw WebGL, no external libraries, everything inlined.

### Voxel distribution (agreed direction)
- **Constraint:** the flat view must reproduce the `G×G` image exactly. Column occupancy in x/y is therefore fixed by the grid; the distribution only decides, per coloured cell, how many voxels sit in that column and at what depths. Every coloured cell has ≥ 1 voxel.
- **Orientation:** the 2D image is the **top view** of the tree. Depth axis = world up. The trunk grows toward the viewer; the canopy (leaves = coloured voxel faces) is nearest the camera in flat view.
- **Density field:** 3D Perlin/simplex noise over a `G³` (64×64×64) volume, seeded from the token, multiplied by a tree-shaping function (canopy term increasing with height and a soft radial falloff from the central axis; trunk/branch bias near the axis lower down). Two or three tunable parameters.
- **Column fill:** for each coloured cell, place voxels where `density > threshold`, capped at N per column (start 1–4); fallback to argmax depth if none pass. Alpha per voxel = `1/count` so additive stacking sums to solid in flat view.
- **Image source is independent of the volume.** The grid comes first (from the curated pool), then the volume distributes it. The 3D density field never decides which cells are coloured.
- **Trunk axis = centroid of coloured cells**, not the grid centre. Keeps the tree under the leaves for arbitrary pixel art. Radial falloff is measured from this centroid.
- Consequence of top-view orientation: the trunk and branches are fully hidden behind the canopy in flat view and only appear when orbiting.

- **Colour distribution within a column:** undecided. Start with a varied/parameterised approach (per-voxel alpha weighting exposed as a tunable, e.g. equal share vs front-weighted) and refine visually against the reference of a 3D tree.
- **Every column floats at its own depth** — no front plane; true magic eye.
- **Cap N = 4 voxels per column** to start; refine later.
- **Trunk is walker lines, not voxels.** Voxels = leaves only; walker lines = trunk and branches. No colour-0 structure voxels. The walk launch/bias must therefore cluster paths toward the centroid axis at the trunk end so lines converge into a trunk-like bundle.
- **Trunk aesthetic:** not a single line. Keep blockcassone's network/cluster effect — multiple walks converge, break apart and orbit around where the trunk ought to be, with twists and turns like a real tree. Implementation direction: keep the existing surface/flight walk core and termination-on-contact rule; add a bias toward the centroid axis (and away from it once close) rather than forcing paths onto it. Walks launched from leaves inward; the trunk emerges from clustering density, not from a drawn spine.
- **Random walks (next step):** axis-aligned unit steps from voxel to voxel, biased toward the trunk axis / nearest unvisited voxel, terminating on contact — branch-like connections from leaves to trunk. Details TBD after reading blockcassone's walk code.

### Still open
- Grid source is a *working* decision: curated pool now; a procedural generator is not ruled out.
- Pool size `N`, on-chain grid encoding, and the resulting deploy cost (measure on real curated grids — PLAN §3).
- Voxel depth distribution pattern.
- Side/top/bottom panel treatment.
- Porting blockcassone glass-voxel, lights and random-walk code (sources now in `reference/`; every `40`/`41`/`1600`/`64000` literal in them must become `G`-derived).
- Performance at `G = 64`: dense portraits (~60–70 % coloured cells × up to 4 voxels) ≈ 10 k voxels ≈ 380 k vertices. Check on a mid-range phone before locking `N_MAX`.

## Status

- [x] Baseline requirements captured
- [x] SeaDrop contracts reviewed
- [x] Reference project (blockcassone) reviewed
- [x] Repo laid out (`reference/`, `pixelart/` side quest, git initialised — nothing committed yet)
- [ ] SeaDrop cloned and extended
- [~] Art requirements defined (64×64, curated pool, luminance-ramp palettes; depth distribution and panels TBD)

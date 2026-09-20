# Pixel Art Generation Plan

> **Context (2026-09-19):** this is a side quest of FOREST (see `../../REQUIREMENTS.md`, `../../PLAN.md` §14).
> FOREST is fully on-chain, so the model below can never be a runtime dependency of the token; this
> pipeline's role there is to *author* the curated 64×64 grid pool that is stored on-chain. The
> browser-app goal described in this document stands on its own and is parked until FOREST's viewer gate passes.

Goal: add prompt-conditioned PFP (head-and-shoulders) pixel-art generation to the existing
client-side pixeliser app at zero marginal cost per generation, by training a tiny open model
that runs in the browser.

## 1. Output contract

- Grid: **32×32** and **64×64** are both built and compared. 40×40 dropped for this experiment
  (not required by the model design; can be reinstated later since the transformer is size-agnostic).
- Each cell is a **palette index 0–9**:
  - `0` = background, rendered black.
  - `1–9` = colour slots, ordered **dark → light by luminance**. At most 9 non-background
    indices per image, enforced at data-preparation time so the model can only ever emit ≤ 9.
- The model never sees or emits RGB. Colour is applied afterwards by the app's existing
  seeded palette + nearest-neighbour stage (index → palette colour). This makes outputs
  palette-independent and matches the 0–9 digit-string convention used in the Forest project.
- Conditioning: four categorical attributes — `hair`, `headwear`, `accessory`, `expression` —
  each with a small closed vocabulary plus a `none` value where applicable.

## 2. Pipeline overview

```
[A] Source image generation (local GPU, one-off)
    templated prompts over attribute vocab  →  FLUX.1-schnell (or SD-Turbo fallback)
    →  512×512 RGB PNG + JSONL of {file, hair, headwear, accessory, expression}

[B] Pixelise + quantise (numpy/PIL, one-off, produces BOTH grid sizes from the same source)
    centre crop → box-downsample to 32 and 64
    → background detection (near-black → 0)
    → k-means (k ≤ 9) on remaining pixels → sort clusters by luminance → indices 1..k
    → save index grids as uint8 arrays

[C] Train masked discrete diffusion transformer (local GPU)
    one config per grid size, identical code

[D] Export
    ONNX of the single forward pass (tokens, attrs) → logits
    browser JS reproduces the ~10-step iterative decoding loop

[E] App integration
    UI: 4 attribute dropdowns + seed → index grid → existing seeded palette → canvas
    New app code needed regardless: ≤ 9-colour quantiser (same algorithm as step B) so the
    existing image-to-pixel-art path obeys the same contract.
```

## 3. Step A — training data generation

- **Model**: `black-forest-labs/FLUX.1-schnell` (Apache-2.0, 4 steps, guidance 0). If VRAM is
  insufficient even with CPU offload, fall back to `stabilityai/sd-turbo` (1–4 steps, much
  smaller). Both are run through `diffusers`; verify current API/version before running —
  the notebook was drafted without network access.
- **Resolution**: 512×512 is enough (target is ≤ 64px); saves time and VRAM.
- **Prompt template** (the prompt *is* the label):
  ```
  pixel art portrait, head and shoulders, centered, facing forward,
  {hair} hair, {headwear}, {accessory}, {expression} expression,
  solid black background, flat colours, limited palette, no text
  ```
  Attribute values are sampled uniformly at random per image; `none` values are omitted from
  the prompt text but kept in the label.
- **Vocabulary (initial; edit freely in the notebook config)**:
  - hair: short, long, curly, bald, mohawk, ponytail, afro, bob
  - headwear: none, cap, beanie, crown, hood, helmet, headband, top hat
  - accessory: none, glasses, sunglasses, earring, headphones, eyepatch, scarf, mask
  - expression: neutral, smiling, frowning, surprised, angry, winking
- **Quantity**: target 5–10k images. At 512px / 4 steps this is roughly 1–3 s per image on a
  modern NVIDIA card, i.e. a few hours. Start with ~1k to validate the whole pipeline end to end
  before committing to the full run.
- **Label noise**: prompt adherence is good but not perfect. v1 accepts the noise. Optional v2:
  CLIP zero-shot check per attribute, drop images whose predicted value disagrees.

## 4. Step B — pixelise + quantise

1. Centre-crop to square (already square at 512).
2. Downsample with **box/area filter** to 32×32 and 64×64. (Compare against the app's current
   downsampling so the training distribution matches what the app produces from user images.)
3. Background: pixel → index 0 if `max(R,G,B) < BG_THRESHOLD` (default 40/255). Tune by eye.
4. Foreground: k-means in RGB (k = min(9, distinct colours)). Reject images with too little
   foreground (< 10 % of cells) — those are failed generations.
5. Sort cluster centroids by luminance `0.299R + 0.587G + 0.114B`; assign 1 (darkest) … k.
6. Persist: `grids_32.npy` (N,32,32) uint8, `grids_64.npy` (N,64,64) uint8, `labels.npy`
   (N,4) int, plus the attribute vocab as JSON.

The same algorithm (steps 3–5) is what needs porting into the app's JS as the ≤ 9-colour clamp.

## 5. Step C — model

**Masked discrete diffusion (MaskGIT-style) bidirectional transformer.**

Why this and not the alternatives:
- Gaussian pixel-space diffusion: poor fit for categorical indices.
- Autoregressive transformer: one forward pass per cell; 4,096 sequential passes at 64×64 is
  too slow in a browser. Masked decoding predicts all cells in parallel and refines in ~8–12
  passes, so inference cost is nearly independent of grid size.

Design:
- Token vocab: 10 pixel classes + 1 `MASK` = 11. Output head predicts the 10 pixel classes.
- Sequence = 4 attribute prefix tokens + `grid²` pixel tokens. Learned positional embeddings.
- Each attribute embedding has an extra **null** id used for classifier-free guidance (CFG).
- Training: sample mask ratio `r = cos(π/2 · u)`, `u ~ U(0,1)`; mask that fraction of cells;
  cross-entropy on masked positions only; drop each attribute to null with p = 0.1.
- Sampling: start fully masked; at each of `T` steps predict all masked cells, sample with
  temperature, keep the most confident, re-mask the rest according to the cosine schedule;
  CFG weight ~3.
- Configs:
  | grid | seq len | dim | depth | heads | params (approx) | batch (fp16) |
  |------|---------|-----|-------|-------|-----------------|--------------|
  | 32   | 1,028   | 256 | 8     | 8     | ~6 M            | 64           |
  | 64   | 4,100   | 384 | 12    | 12    | ~21 M           | 16           |
  Attention at 4,100 tokens relies on PyTorch's fused SDPA (flash / memory-efficient) — keep
  `nn.TransformerEncoderLayer` on the fast path (bf16/fp16, no custom masks).
- Training budget: 32px converges usefully in ~30–60 min on a single consumer GPU; 64px is
  roughly 4–6× that. Use AdamW, lr 3e-4 with warmup + cosine decay, EMA weights for sampling.

## 6. Step D — export & browser inference

- `torch.onnx.export` of `forward(tokens[B,L] int64, attrs[B,4] int64) → logits[B,L,10]`,
  dynamic batch, opset ≥ 17. Quantise to int8/fp16 if size matters (6 M params fp16 ≈ 12 MB;
  21 M ≈ 42 MB — the 64px model is borderline for a casual web app; consider pruning
  dim/depth once you see how much capacity 64px actually needs).
- Browser: ONNX Runtime Web, `webgpu` execution provider with `wasm` fallback. The JS side
  implements the same ~10-step masked decoding loop (argmax/sampling, confidence ranking,
  cosine re-mask schedule, CFG = two forward calls per step, or one batched call of size 2).
- Seeded RNG in JS (e.g. mulberry32) so a given (attributes, seed) is reproducible.

## 7. Evaluation (32 vs 64)

- Visual grid of 64 samples per model at fixed attribute combos.
- Attribute adherence: sample 200 images per attribute value, eyeball or CLIP-check.
- Colour-count sanity: assert every sample uses ≤ 9 non-zero indices (guaranteed by design;
  check anyway).
- Diversity: nearest-neighbour distance of samples to training set (detect memorisation, which
  is a real risk for tiny datasets).
- Browser latency on a mid-range laptop for T = 8/10/12 steps.

## 8. Open items / assumptions to confirm

- GPU VRAM is unknown; the notebook enables CPU offload for FLUX by default and includes the
  SD-Turbo fallback. Check `nvidia-smi` first.
- Library versions (diffusers, torch, onnxruntime) were not verified at drafting time —
  run the notebook's environment cell and adjust.
- Whether the app's current downsampling filter matches the box filter used here.
- Licensing of generated training data: FLUX.1-schnell is Apache-2.0; SD-Turbo is under
  Stability's non-commercial licence — check before using SD-Turbo outputs commercially.
- If the tiny model under-delivers at 64×64, fallback remains option 3 from the research
  (Cloudflare Workers AI FLUX proxy, ~$0.0005/image beyond the free daily tier).

## 9. v7 — style runs from reference images (2026-09-20)

The notebook is now style-switched (`STYLE` in the config cell) and every run writes to
`pfp_data/<RUN_NAME>/` (raw, labels, vocab, grids, checkpoint) so runs never overwrite each other.

**"shaman" style** — 16 references in `pfp_data/new_ref/` (1254², white background): green
jade-pebble mosaic stone heads, moai-like, with antlers / crowns / horns / braids / nose rings / pipes /
gold face markings. Sixteen images are far too few to train the transformer on directly, so they are
used to steer FLUX instead:

- **Source generation = img2img from a reference.** Each image starts from a random reference (or its
  mirror), denoised from strength 0.72–0.92 with a prompt = fixed style description + attribute phrases.
  No LoRA: `peft` is not installed and schnell-NF4 LoRA training is fiddly; revisit only if img2img
  cannot hit the aesthetic. `gen_mode = "txt2img"` is a one-line switch to test the prompt alone.
- **Background = black, via keying.** Images are generated on white (nothing in the face is
  near-white, so the cut-out is clean), then `key_out` turns the white into alpha and composites on
  black; every raw PNG is RGBA on black and the quantiser / `build_library.py` use **alpha** as the
  background rule. Reason: the darkest jade pebbles are near-black (≈ 2,18,13), so a colour rule on a
  black background (`max(R,G,B) < 40`) turns about a quarter of the face into index 0 (references:
  foreground 0.37 vs 0.50); the alpha route keeps 0.49.
- **Style clamp = img2img strength.** The first 100-image check (strength 0.72–0.92, 3 effective steps)
  kept the attributes but drifted to FLUX's own smooth "polished jade Buddha": blocky moai geometry,
  ear blocks, pedestal neck and the discrete pebble texture were lost. Fixes now in the notebook: strength
  range 0.40–0.60 over a 10-step schedule (effective steps = steps × strength), a prompt that names those
  traits explicitly, and a **strength-sweep cell (2a)** — same reference, same seed, strength 0.3→0.7 —
  to pick the band before spending a check batch. Next escalation if that is not tight enough: a style
  LoRA (needs `pip install peft` and a training script; not built).
- **Vocabulary** (4 attributes, same model shape as before, values chosen from what the references
  actually show): `figure` male/female · `headgear` none/antlers/crown/horns/headband/hood/turban/braids/bun ·
  `accessory` none/nose ring/big earrings/glasses/sunglasses/pipe/necklace/flower ·
  `marking` none/beard/moustache/crescent/stripes/third eye/chin lines. Expression is deliberately
  omitted (every reference is serene, eyes closed); add it as a fifth attribute if wanted.
- **Procedure.** (1) `RUN_NAME="v7_shaman_check"`, `N_IMAGES=100` → generate → quantise → compare
  the 3c contact sheet against 3a (the references themselves through the quantiser). Tune strength,
  phrases, `bg_thresh`. (2) `RUN_NAME="v7_shaman"`, `N_IMAGES=3000+`. (3) Either build the pool directly
  with `build_library.py` (PLAN §14 — the model is optional) or train with
  `train(64, init_from=ROOT/"ckpt_64.pt", lr=1e-4)`: warm start copies every shape-matching tensor from
  the v6 model and re-initialises only the attribute embeddings; random horizontal flips double the
  effective dataset. Watch the §7 nearest-neighbour check — small datasets memorise.
- `build_library.py` now reads attribute names from `--vocab` and shards by the first attribute.

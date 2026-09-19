// library.js — fetch the precomputed grid library and pick deterministically.
//
//   const lib = await loadLibrary("/library/");
//   const { entry, grid } = await lib.pick({ hair: "mohawk", accessory: "sunglasses" }, seed);
//
// Attribute values may be omitted or "any". Selection is seeded, so the same
// (attributes, seed) always returns the same portrait. Shards are cached after first fetch.

import { mulberry32, hashSeed } from "./palette.js";
import { stringToGrid } from "./quantise.js";

export async function loadLibrary(baseUrl) {
  const base = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
  const manifest = await (await fetch(base + "manifest.json")).json();
  const cache = new Map();

  async function shard(hair) {
    if (!cache.has(hair)) {
      const p = fetch(base + manifest.shards[hair]).then(r => r.json());
      cache.set(hair, p);
    }
    return cache.get(hair);
  }

  async function candidates(attrs) {
    const hairs = attrs.hair && attrs.hair !== "any" ? [attrs.hair] : Object.keys(manifest.shards);
    const lists = await Promise.all(hairs.map(shard));
    const all = lists.flat();
    const filters = ["headwear", "accessory", "expression"].filter(k => attrs[k] && attrs[k] !== "any");
    // Progressive relaxation: try all filters, then drop from the last one backwards.
    for (let n = filters.length; n >= 0; n--) {
      const active = filters.slice(0, n);
      const hits = all.filter(e => active.every(k => e[k] === attrs[k]));
      if (hits.length) return { hits, relaxed: filters.slice(n) };
    }
    return { hits: all, relaxed: filters };
  }

  return {
    manifest,
    size: manifest.size,
    vocab: manifest.vocab,
    /** Returns { entry, grid: Uint8Array, relaxed: string[] } */
    async pick(attrs = {}, seed = 0) {
      const { hits, relaxed } = await candidates(attrs);
      const rnd = mulberry32(typeof seed === "string" ? hashSeed(seed) : seed);
      const entry = hits[Math.floor(rnd() * hits.length)];
      return { entry, grid: stringToGrid(entry.g), relaxed };
    },
    /** How many portraits match, without choosing one. */
    async count(attrs = {}) { return (await candidates(attrs)).hits.length; },
  };
}

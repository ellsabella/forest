// Named palettes. Slots 1..9 of the on-chain palette (slot 0 = background is implicit).
// The grid's digits are luminance buckets dark → light, so every palette is sorted by
// luminance before use (the order below is just how it was supplied). Lists with 8 or 10
// colours are resampled to 9 by nearest index — exact colours only, one dropped or repeated.
// The sorted 9-slot form (paletteSlots) is what goes on-chain.

export const PALETTES = [
  { name: 'Ocean Sunset',           colours: ['#001219','#005f73','#0a9396','#94d2bd','#e9d8a6','#ee9b00','#ca6702','#bb3e03','#ae2012','#9b2226'] },
  { name: 'Meadow Green',           colours: ['#d9ed92','#b5e48c','#99d98c','#76c893','#52b69a','#34a0a4','#168aad','#1a759f','#1e6091','#184e77'] },
  { name: 'Bright Green',           colours: ['#004b23','#006400','#007200','#008000','#38b000','#70e000','#9ef01a','#ccff33'] },
  { name: 'Ocean Blue Serenity',    colours: ['#03045e','#023e8a','#0077b6','#0096c7','#00b4d8','#48cae4','#90e0ef','#ade8f4','#caf0f8'] },
  { name: 'Pastel Fantasy',         colours: ['#ffadad','#ffd6a5','#fdffb6','#caffbf','#9bf6ff','#a0c4ff','#bdb2ff','#ffc6ff','#fffffc'] },
  { name: 'Oceanic Sunburst',       colours: ['#166281','#1e85ae','#4cb6e1','#8cd0ec','#cceaf6','#ffaf02','#fc9e02','#f88c01','#f06900'] },
  { name: 'Autumn Forest Hues',     colours: ['#437f97','#3a5867','#303036','#5a622d','#849324','#c2a31a','#ffb30f','#f68d0c','#ec6608'] },
  { name: 'Ocean Sunset Paradise',  colours: ['#00296b','#003f88','#00509d','#1a76bc','#1e91d0','#f37520','#f5841f','#f7941d','#faa819'] },
  { name: 'CandyFloss Skies',       colours: ['#cdb4db','#e6bedc','#ffc8dd','#ffbcd5','#ffafcc','#dec8e5','#bde0fe','#b0d9ff','#a2d2ff'] },
  { name: 'Golden',                 colours: ['#cca300','#e0b400','#f5c400','#ffcd00','#ffd633','#ffde5c','#ffe785','#ffefad','#fff7d6'] },
  { name: 'Magenta Dream',          colours: ['#b7094c','#a01a58','#892b64','#723c70','#5c4d7d','#455e89','#2e6f95','#1780a1','#0091ad'] },
  { name: 'Fiery Orange',           colours: ['#ff4800','#ff5400','#ff6000','#ff6d00','#ff7900','#ff8500','#ff9100','#ff9e00','#ffaa00','#ffb600'] },
  { name: 'Green Harmony',          colours: ['#10451d','#155d27','#1a7431','#208b3a','#25a244','#2dc653','#4ad66d','#6ede8a','#92e6a7','#b7efc5'] },
];

export const luminance = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

// → exactly 9 hex strings for slots 1..9, darkest first
export function paletteSlots(p) {
  const c = [...p.colours].sort((a, b) => luminance(a) - luminance(b));
  return Array.from({ length: 9 }, (_, i) => c[Math.round(i * (c.length - 1) / 8)]);
}

// ---- contrast shaper -------------------------------------------------------------------
// Most supplied palettes sit in a narrow lightness band, so after sorting the "dark" buckets
// are not dark and the picture goes flat. shapePalette keeps every colour's hue and
// saturation but pulls its HSL lightness toward a ramp from `dark` (slot 1) to `light`
// (slot 9) by `contrast` (0 = untouched, 1 = exactly on the ramp). `gamma` bends the ramp:
// > 1 keeps more slots dark (deeper shadows), < 1 lifts the mid-tones.
// The shaped 9 colours are what the SVG, the voxels and (later) the chain all use.

function hexToHsl(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, s, l];
}

function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

// Saturation: from `paletteDesatFrom` (0..1 along the ramp) upward, saturation is reduced by
// up to `paletteDesat`, plus up to `paletteDesatHue` more for colours whose hue is far from
// the palette's base hue (the saturation-weighted mean hue of the lower half) — so highlights
// in a foreign hue fade toward neutral light instead of reading as a second colour.

function baseHue(hsl) {
  let x = 0, y = 0;
  hsl.slice(0, Math.ceil(hsl.length / 2)).forEach(([h, s]) => { x += Math.cos(h * Math.PI / 180) * s; y += Math.sin(h * Math.PI / 180) * s; });
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function shapePalette(hexes, {
  paletteContrast = 0, paletteDark = 0.08, paletteLight = 0.85, paletteGamma = 1,
  paletteDesat = 0, paletteDesatHue = 0, paletteDesatFrom = 0.5,
} = {}) {
  const hsl = hexes.map(hexToHsl);
  const base = baseHue(hsl);
  const n = hexes.length - 1;
  return hsl.map(([h, s, l], i) => {
    const t = i / n;
    // lightness
    const target = paletteDark + (paletteLight - paletteDark) * Math.pow(t, paletteGamma);
    const l2 = l + (target - l) * paletteContrast;
    // saturation
    const k0 = Math.min(1, Math.max(0, (t - paletteDesatFrom) / Math.max(1e-6, 1 - paletteDesatFrom)));
    const k = k0 * k0 * (3 - 2 * k0);                                  // smoothstep up the ramp
    const hueDist = Math.min(Math.abs(h - base), 360 - Math.abs(h - base)) / 180;   // 0 same hue … 1 opposite
    const s2 = s * Math.max(0, 1 - k * (paletteDesat + paletteDesatHue * hueDist));
    return hslToHex(h, s2, l2);
  });
}

export const paletteByName = name => PALETTES.find(p => p.name.toLowerCase() === String(name).toLowerCase());

// Colour helpers: naming a colour and comparing two.

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function hexToHsl(hex) {
  let [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
}
const NAMED = [
  ['Black', '#1c1c1c'], ['Charcoal', '#3d3d3d'], ['Grey', '#8a8a8a'], ['Silver', '#c4c4c4'], ['White', '#f7f7f5'],
  ['Cream', '#f1e9d8'], ['Beige', '#d9c7a7'], ['Camel', '#c19a6b'], ['Tan', '#b48a64'], ['Brown', '#6b4a33'],
  ['Chocolate', '#3f2a1f'], ['Rust', '#a4532f'], ['Terracotta', '#c46d4e'], ['Red', '#b8312f'], ['Burgundy', '#6d1f2c'],
  ['Blush', '#e8bfb7'], ['Pink', '#e48aa6'], ['Coral', '#ee8466'], ['Orange', '#e5822e'], ['Mustard', '#d0a33a'],
  ['Yellow', '#ecd25a'], ['Butter', '#f3e3a1'], ['Olive', '#6f7240'], ['Sage', '#a3b18a'], ['Green', '#3f8a4f'],
  ['Forest', '#2c4a35'], ['Mint', '#b6dcc5'], ['Teal', '#2b7a78'], ['Sky', '#9cc3e0'], ['Denim', '#4f6d8f'],
  ['Blue', '#2f5fa8'], ['Navy', '#1f2b4a'], ['Lavender', '#b9a3d4'], ['Purple', '#6c3f8f'], ['Plum', '#5a2d47'],
  // vivid anchors: the list above is mostly muted, and without these a saturated colour
  // lands on the wrong neighbour (royal blue → "Purple", lime → "Yellow")
  ['Blue', '#1f45c4'], ['Blue', '#2440ff'], ['Blue', '#0a14e6'], ['Navy', '#0a0a78'], ['Purple', '#8a2be2'], ['Purple', '#6a1fd0'], ['Green', '#4caf50'],
  ['Green', '#33dd33'], ['Red', '#e8211d'], ['Yellow', '#ffe81a'], ['Orange', '#ff8c1a'], ['Pink', '#ff5fa2'], ['Teal', '#12b5b0'],
];
// CIE Lab, so a muted green reads as "Sage" rather than the nearest grey.
export function hexToLab(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; });
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const NAMED_LAB = NAMED.map(([n, h]) => { const [hue, sat] = hexToHsl(h); return { n, lab: hexToLab(h), hue: sat < 8 ? null : hue }; });
export function colorName(hex) {
  const [L, A, B] = hexToLab(hex);
  const [hue, sat, lig] = hexToHsl(hex);
  // A clearly chromatic colour is only compared with names of a similar hue: on its own, Lab
  // distance mixes up vivid blues and purples.
  let pool = NAMED_LAB;
  if (sat >= 40 && lig >= 15 && lig <= 85) {
    const near = NAMED_LAB.filter((c) => c.hue !== null && Math.abs(((c.hue - hue + 540) % 360) - 180) <= 20);
    if (near.length) pool = near;
  }
  let best = pool[0].n, bd = Infinity;
  for (const { n, lab: [l, a, b] } of pool) {
    const d = (L - l) ** 2 + (A - a) ** 2 + (B - b) ** 2;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

/** Perceptual-ish closeness 0..1 between two hexes (1 = same). */
export function closeness(a, b) {
  const [r, g, bl] = hexToRgb(a), [R, G, B] = hexToRgb(b);
  const d = Math.sqrt((2 * (r - R) ** 2 + 4 * (g - G) ** 2 + 3 * (bl - B) ** 2) / 3);
  return Math.max(0, 1 - d / 160);
}

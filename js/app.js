import { db, uid } from './db.js';
import { haptic } from './haptics.js';
import { loadImage, rasterize, computeMask, renderSticker, renderMaskPreview, guessCategory, DEFAULT_TOLERANCE, EDGE_DARK } from './cutout.js';
import { retintSticker } from './edge.js';
import { colorName, closeness, hexToHsl, hexToRgb, hexToLab } from './color.js';

/* ------------------------------------------------------------------ data */

const CATS = {
  top: { label: 'Tops', subs: ['T-shirts', 'Shirts', 'Blouses', 'Knits', 'Hoodies', 'Tanks', 'Dresses'] },
  outer: { label: 'Outerwear', subs: ['Jackets', 'Coats', 'Blazers', 'Puffers', 'Vests', 'Raincoats'] },
  bottom: { label: 'Bottoms', subs: ['Jeans', 'Trousers', 'Shorts', 'Skirts', 'Leggings', 'Sweatpants'] },
  shoes: { label: 'Shoes', subs: ['Sneakers', 'Boots', 'Loafers', 'Heels', 'Flats', 'Sandals'] },
  acc: { label: 'Accessories', subs: ['Bags', 'Hats', 'Jewelry', 'Belts', 'Scarves', 'Sunglasses', 'Watches'] },
};
const CAT_ORDER = ['top', 'outer', 'bottom', 'shoes', 'acc'];
// pieces typed as these were tops before Outerwear existed
const OUTER_SUBS = new Set(['Jackets', 'Coats']);
const BOARD = [['Linen', '#fdfcfa'], ['Sand', '#efe9df'], ['Sage', '#e9ede3'], ['Blush', '#f3e9e4'], ['Fog', '#e6ebee'], ['Night', '#2f2b27']];
const BOARD_COLORS = BOARD.map((b) => b[1]);

const ICON = {
  top: '<path d="M8 4 3.5 6.5l1.8 3.6L7.5 9v11h9V9l2.2 1.1 1.8-3.6L16 4c-.6 1.4-2.2 2.3-4 2.3S8.6 5.4 8 4z"/>',
  outer: '<path d="M9 3.5 4.5 5.6 3 13l2.3.5V21h13.4v-7.5L21 13l-1.5-7.4L15 3.5l-3 5.5zM12 9v12"/>',
  bottom: '<path d="M7 3h10l1.2 18h-4.4L12 10l-1.8 11H5.8zM7 6.5h10"/>',
  shoes: '<path d="M3 17v-6.5l4-.6 2.6 3 3.6.6 5.6 1.5c1.3.3 2.2 1.4 2.2 2.6V18H3zM3 15.5h18"/>',
  acc: '<path d="M5 8h14l-1.2 12H6.2zM9 8V6.5a3 3 0 0 1 6 0V8"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  flip: '<path d="M12 3v18M8 7 3 12l5 5zM16 7l5 5-5 5z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/>',
  look: '<rect x="3.5" y="3.5" width="7" height="9" rx="2"/><rect x="13.5" y="3.5" width="7" height="5" rx="2"/><rect x="13.5" y="11.5" width="7" height="9" rx="2"/><rect x="3.5" y="15.5" width="7" height="5" rx="2"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  eraser: '<path d="m4 15 9-9 7 7-6 6H8zM9 10l7 7M8 20h12"/>',
  undo: '<path d="M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  heart: '<path d="M12 20s-7-4.4-7-9.6A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7 2.4c0 5.2-7 9.6-7 9.6z"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
  share: '<path d="M12 15V4M8 8l4-4 4 4M6 12v7h12v-7"/>',
  swap: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
  minus: '<path d="M6 12h12"/>',
  select: '<circle cx="12" cy="12" r="8"/><path d="m8.5 12.2 2.4 2.4 4.6-4.8"/>',
  tag: '<path d="M4 12.5V5h7.5l8 8-7.5 7.5zM8 9h.01"/>',
  filter: '<path d="M4 7h16M7 12h10M10 17h4"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  drop: '<path d="M12 3.5c3 3.6 5.5 6.6 5.5 10a5.5 5.5 0 0 1-11 0c0-3.4 2.5-6.4 5.5-10z"/>',
  layers: '<path d="m12 4 8 4.5-8 4.5-8-4.5zM4 13l8 4.5 8-4.5"/>',
  tune: '<path d="M4 7h9M19 7h1M4 17h1M11 17h9"/><circle cx="16" cy="7" r="2.6"/><circle cx="8" cy="17" r="2.6"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  swatch: '<circle cx="12" cy="12" r="8"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  grip: '<path d="M5 8h14M5 12h14M5 16h14"/>',
  brush: '<path d="M18.6 3.4a2 2 0 0 1 2.9 2.9L12.5 15.3 9.6 12.4zM9.6 12.4l-2.2.4a3 3 0 0 0-2.4 2.4L4 20l4.8-1a3 3 0 0 0 2.4-2.4l.4-2.2"/>',
  zoom: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5M8.5 11h5"/>',
  sparkle: '<path d="M12 3c.6 4.4 2.6 6.4 7 7-4.4.6-6.4 2.6-7 7-.6-4.4-2.6-6.4-7-7 4.4-.6 6.4-2.6 7-7z"/>',
};
const svg = (name, extra = '') => `<svg viewBox="0 0 24 24" ${extra}>${ICON[name] || ''}</svg>`;

const state = {
  items: [],
  outfits: [],
  view: 'closet',
  filterCat: 'all',
  filterSub: null,
  search: '',
};

/* Appearance choices. Kept in localStorage so index.html can apply them before first paint. */
const PREFS_KEY = 'closet.prefs';
const prefs = { theme: 'system', tint: false }; // tint: each item's card (and each new look's board) takes a soft colour from it
try {
  const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
  if (['system', 'light', 'dark'].includes(saved.theme)) prefs.theme = saved.theme;
  prefs.tint = !!saved.tint;
} catch { /* private mode: defaults */ }
const isDark = () => prefs.theme === 'dark' || (prefs.theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
function applyPrefs(save = true) {
  const r = document.documentElement;
  if (prefs.theme === 'system') r.removeAttribute('data-theme'); else r.dataset.theme = prefs.theme;
  r.removeAttribute('data-contrast'); // an option that no longer exists
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', isDark() ? '#1b1917' : '#f6f3ee');
  if (save) {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* not stored, still applied */ }
    render();
  }
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => {
  const v = Number(n) || 0;
  const s = v % 1 === 0 ? v.toLocaleString() : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return '$' + s;
};
const itemById = (id) => state.items.find((i) => i.id === id);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// running inside the iOS app (ios/), which has its own haptics and share sheet
const inApp = () => !!window.webkit?.messageHandlers?.haptic;
// favourites and the wear log
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const wears = (x) => (x?.worn || []).length;
function agoText(ts) {
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(ts).setHours(0, 0, 0, 0)) / 86400000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 30 ? `${days} days ago` : new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const wornText = (x) => (wears(x) ? `Worn ${wears(x)} time${wears(x) === 1 ? '' : 's'}, last ${agoText(x.worn[x.worn.length - 1])}` : '');
async function toggleFav(x, store) {
  x.fav = !x.fav;
  await db.put(store, x);
  haptic('select');
}
/** Marks pieces (and the look they came from) as worn today. Once a day each. */
async function logWear(items, look = null) {
  const now = Date.now();
  let n = 0;
  for (const it of items) {
    if (!it || (it.worn || []).some((t) => sameDay(t, now))) continue;
    it.worn = [...(it.worn || []), now].slice(-400);
    await db.put('items', it); n++;
  }
  if (look && !(look.worn || []).some((t) => sameDay(t, now))) {
    look.worn = [...(look.worn || []), now].slice(-400);
    await db.put('outfits', look); n++;
  }
  haptic(n ? 'success' : 'light');
  toast(n ? 'Logged for today' : 'Already logged today');
}
/** How well two colours sit together, 0..1. Neutrals go with anything; clashing hues score low. */
function pairScore(a, b) {
  if (!a || !b) return 0.6;
  const [ha, sa, la] = hexToHsl(a), [hb, sb, lb] = hexToHsl(b);
  // black, white and grey; navy and denim; tan, beige and brown
  const neutral = (hue, sat, lig) => sat < 16 || lig < 14 || lig > 90 || (hue >= 200 && hue <= 250 && lig < 45) || (hue >= 15 && hue <= 50 && sat < 55);
  if (neutral(ha, sa, la) || neutral(hb, sb, lb)) return 0.85;
  const d = Math.abs(((ha - hb + 540) % 360) - 180); // hue distance, 0..180
  if (d < 28) return Math.abs(la - lb) > 12 ? 0.9 : 0.7;     // same family, better with some light/dark contrast
  if (d < 60) return 0.75;                                   // neighbours
  if (d > 150) return 0.7;                                   // opposites
  return 0.4;
}
const DAY = 86400000;
/** In the wash: left out of suggestions until it is back. The mark lifts by itself after a week, so a forgotten one cannot hide a piece for good. */
const inWash = (it) => !!it?.wash && Date.now() - it.wash < 7 * DAY;
const lookKey = (ids) => [...new Set(ids)].sort().join(' ');
const recentPicks = []; // the last few suggestions, so the next one differs

/**
 * One piece per category whose colours go together, built around the given piece(s) if any.
 * Colour comes first; among pieces that fit about equally, the ones that have rested longest, are in no
 * look yet or are favourites come forward, and a top or bottom worn in the last two days steps back.
 * A set that is already a saved look, or was just suggested, is rolled again.
 */
function suggestLook(seeds = []) {
  const seedIds = (Array.isArray(seeds) ? seeds : [seeds]).filter(Boolean);
  const now = Date.now();
  const inLooks = new Set();
  state.outfits.forEach((o) => o.pieces.forEach((p) => inLooks.add(p.itemId)));
  const saved = new Set(state.outfits.map((o) => lookKey(o.pieces.map((p) => p.itemId))));
  const lastWorn = (it) => (wears(it) ? it.worn[it.worn.length - 1] : 0);
  const roll = () => {
    const chosen = seedIds.map(itemById).filter(Boolean);
    for (const cat of CAT_ORDER) {
      if (chosen.some((x) => x.cat === cat)) continue;
      if (cat === 'outer' && Math.random() > 0.45) continue; // a jacket is a choice, not a must
      let pool = state.items.filter((it) => it.cat === cat);
      const clean = pool.filter((it) => !inWash(it));
      if (clean.length) pool = clean;
      if (!pool.length) continue;
      const fits = pool.map((it) => (chosen.length ? chosen.reduce((sum, x) => sum + pairScore(it.colors?.[0], x.colors?.[0]), 0) / chosen.length : 0.6));
      const bestFit = Math.max(...fits);
      let best = null, bestScore = -Infinity;
      pool.forEach((it, i) => {
        if (fits[i] < bestFit - 0.2) return;
        const rested = Math.min(60, Math.max(0, (now - (lastWorn(it) || it.created || 0)) / DAY)) / 60 * 0.2;
        const justWorn = (cat === 'top' || cat === 'bottom') && lastWorn(it) && now - lastWorn(it) < 2 * DAY ? 0.3 : 0;
        const score = fits[i] + rested + (inLooks.has(it.id) ? 0 : 0.08) + (it.fav ? 0.05 : 0) - justWorn + Math.random() * 0.25;
        if (score > bestScore) { bestScore = score; best = it; }
      });
      if (best) chosen.push(best);
    }
    return chosen.map((x) => x.id);
  };
  let ids = roll();
  for (let i = 0; i < 6 && ids.length > 1 && (saved.has(lookKey(ids)) || recentPicks.includes(lookKey(ids))); i++) ids = roll();
  if (ids.length) { recentPicks.push(lookKey(ids)); if (recentPicks.length > 6) recentPicks.shift(); }
  return ids;
}

/**
 * Where pieces go when the app lays a look out: tops high, bottoms under them, shoes at the foot and
 * accessories out at the edges, each with a small random tilt and nudge so it reads as laid out by hand.
 * `list` is [{ cat, ar }] (ar = the picture's height / width when known); `ratio` is the board's height / width.
 * Returns { at: [{ x, y, w, rot }] in the same order, order: indexes from the back of the pile to the front }.
 */
let lastStyle = -1;
function layoutLook(list, ratio = 1.5) {
  const by = { top: [], outer: [], bottom: [], shoes: [], acc: [] };
  list.forEach((e, i) => (by[e.cat] || by.acc).push(i));
  const AR = { top: 1.05, outer: 1.2, bottom: 1.5, shoes: 0.75, acc: 1 };
  const kind = (i) => (by.outer.includes(i) ? 'outer' : null);
  // outerwear is laid next to (and over) the tops, so the two share the top band
  by.top = [...by.top, ...by.outer];
  const jit = (a) => (Math.random() * 2 - 1) * a;
  const at = new Array(list.length);
  const main = ['top', 'bottom', 'shoes'].filter((k) => by[k].length);
  // each Arrange picks a way of laying things out (never the same twice running): a straight column, a zigzag
  // down the board, or a lean to one side; then every piece gets its own nudge, tilt and a little size change
  // styles: 0 a column, 1 a zigzag, 2 a lean to one side, 3 a loose scatter
  let style = Math.floor(Math.random() * 4);
  if (style === lastStyle) style = (style + 1 + Math.floor(Math.random() * 3)) % 4;
  lastStyle = style;
  const flipSide = Math.random() < 0.5 ? -1 : 1;
  const swing = 0.09 + Math.random() * 0.07;
  const shift = (b, nb) => (style === 1 ? (b % 2 ? 1 : -1) * swing * flipSide : style === 2 ? (b - (nb - 1) / 2) * swing * 1.4 * flipSide : style === 3 ? jit(0.16) : 0);
  const loose = style === 3 ? 1.6 : 1; // the scatter tilts and nudges more
  const grow = () => 0.86 + Math.random() * 0.26;
  // keeps a piece of width w on the board, with a small margin
  const inside = (x, w) => Math.max(0.03 + w / 2, Math.min(0.97 - w / 2, x));
  const hasAcc = by.acc.length > 0;
  if (!main.length) {
    // accessories only: a loose grid
    const n = by.acc.length, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
    by.acc.forEach((i, j) => {
      const cx = ((j % cols) + 0.5) / cols, cy = (Math.floor(j / cols) + 0.5) / rows;
      const w = Math.min(0.44, 0.78 / cols, (0.7 / rows) * ratio / (list[i].ar || AR.acc));
      at[i] = { x: 0.1 + cx * 0.8 + jit(0.02), y: 0.1 + cy * 0.8 + jit(0.02), w, rot: jit(9) };
    });
    return { at, order: [...by.acc] };
  }
  // bands down the board for the clothes that are there; they keep to a centre column when accessories need the edges
  const share = { top: 0.4, bottom: 0.4, shoes: 0.2 }, base = { top: 0.5, bottom: 0.4, shoes: 0.3 };
  const total = main.reduce((t, k) => t + share[k], 0);
  const left = hasAcc ? 0.2 : 0.1, right = hasAcc ? 0.8 : 0.9;
  let y = 0.05;
  main.forEach((k, b) => {
    const band = 0.9 * share[k] / total, cy = y + band / 2;
    y += band;
    const ids = by[k], n = ids.length, room = (right - left) / n;
    const dx = shift(b, main.length);
    const ws = ids.map((i) => {
      const ar = list[i].ar || AR[kind(i) || k];
      const wide = kind(i) === 'outer' ? base.top * 1.06 : base[k];
      // as wide as its kind usually is, but never so tall that it leaves its band by much, nor wider than its share of the row
      return Math.max(0.15, Math.min(0.6, Math.min(wide * (hasAcc ? 0.92 : 1), n > 1 ? room * 1.22 : 1, band * (k === 'bottom' ? 1.3 : 1.12) * ratio / ar) * grow()));
    });
    const xs = ids.map((i, j) => (n === 1 ? (left + right) / 2 : left + room * (j + 0.5)) + dx + jit((n > 1 ? 0.035 : 0.06) * loose));
    if (n > 1) {
      // however much the row leans or scatters, its items stay side by side: at least three quarters of a share apart,
      // and the whole row slides back onto the board rather than squeezing up at an edge
      const gap = room * 0.75;
      for (let j = 1; j < n; j++) xs[j] = Math.max(xs[j], xs[j - 1] + gap);
      const over = xs[n - 1] - (0.97 - ws[n - 1] / 2);
      if (over > 0) for (let j = 0; j < n; j++) xs[j] -= over;
      const under = 0.03 + ws[0] / 2 - xs[0];
      if (under > 0) for (let j = 0; j < n; j++) xs[j] += under;
    }
    ids.forEach((i, j) => {
      const w = ws[j];
      // tilts never go past what still reads as laid out by hand
      at[i] = { x: inside(xs[j], w), y: cy + (n > 1 ? (j % 2 ? 0.026 : -0.026) : 0) + jit(0.028 * loose), w, rot: jit((k === 'shoes' ? 16 : 11) * loose) };
    });
  });
  // accessories: alternate sides, top to bottom, clear of the foot of the board when shoes are there
  const floor = by.shoes.length ? 0.7 : 0.86;
  const slots = [[1, 0.42], [0, 0.5], [1, 0.14], [0, 0.16], [1, floor], [0, floor + 0.04], [1, 0.28], [0, 0.33]];
  // which side and height each accessory takes changes from one Arrange to the next
  const start = Math.floor(Math.random() * slots.length), mirror = Math.random() < 0.5;
  by.acc.forEach((i, j) => {
    const [side0, sy] = slots[(start + j) % slots.length], side = mirror ? 1 - side0 : side0, lap = Math.floor(j / slots.length);
    const w = Math.min(by.acc.length <= 2 ? 0.25 : 0.21, 0.2 * ratio / (list[i].ar || AR.acc)) * grow();
    at[i] = { x: inside((side ? 0.86 : 0.14) + (side ? -1 : 1) * lap * 0.08 + jit(0.035 * loose), w), y: Math.max(0.08, Math.min(0.92, sy + lap * 0.06 + jit(0.05 * loose))), w, rot: jit(18 * loose) };
  });
  return { at, order: [...by.bottom, ...by.top, ...by.shoes, ...by.acc] }; // by.top already ends with the outerwear
}
/** The same, for pieces by id (their pictures give the real proportions). Returns pieces ready for a look, back to front. */
async function layoutPieces(ids, ratio, dark = false) {
  const list = await Promise.all(ids.map(async (id) => {
    const it = itemById(id);
    let ar = null;
    try { const im = await getImg(it, dark); ar = im.naturalHeight / im.naturalWidth || null; } catch { /* a usual shape is assumed */ }
    return { cat: it?.cat, ar };
  }));
  const lay = layoutLook(list, ratio);
  return lay.order.map((i) => ({ itemId: ids[i], ...lay.at[i], flip: false }));
}

// the colours shown for a piece: its main two
const mainColors = (x) => (x?.colors || []).slice(0, 2);
/** A piece's picture. On dark backgrounds the version with the soft edge is used once it exists, so the white sticker edge does not glare. */
const stickerOf = (it, dark = isDark()) => (dark && it?.stickerDark) || it?.sticker || '';
const cutPreview = (res) => (isDark() && res.darkURL) || res.dataURL;
const darkBoard = (hex) => hexToHsl(hex || '#ffffff')[2] < 40;
const hslHex = (hh, ss, ll) => {
  const s1 = ss / 100, l1 = ll / 100, k = (n) => (n + hh / 30) % 12, a = s1 * Math.min(l1, 1 - l1);
  const f = (n) => Math.round(255 * (l1 - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
};
const deltaE = (a, b) => { const x = hexToLab(a), y = hexToLab(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
// how much of a look each kind of piece usually fills
const AREA = { outer: 1.3, bottom: 1.2, top: 1, shoes: 0.5, acc: 0.4 };
/**
 * An automatic board colour for a look: a soft tint of the colour its pieces share most (by how much of the
 * look each fills), pale on light screens and deep on dark ones. A look of neutrals gets a warm neutral.
 */
function autoBoard(o, dark = isDark()) {
  const hues = [];
  let total = 0;
  for (const p of o.pieces) {
    const it = itemById(p.itemId), col = it?.colors?.[0];
    if (!col) continue;
    const [hh, ss, ll] = hexToHsl(col), w = AREA[it.cat] || 1;
    total += w;
    if (ss < 14 || ll < 12 || ll > 92) continue; // neutrals set no hue
    hues.push([hh, w * Math.min(1, ss / 60)]);
  }
  const near = (a, b) => Math.abs(((a - b + 540) % 360) - 180) < 35; // hue distance under 35 degrees
  // the family of hues with the most weight wins (an average of red and blue would be a purple that is in neither)
  let best = null, bestW = 0;
  for (const [hh] of hues) {
    const w = hues.reduce((sum, [h2, k]) => sum + (near(hh, h2) ? k : 0), 0);
    if (w > bestW) { bestW = w; best = hh; }
  }
  if (!total || best === null || bestW < total * 0.18) return dark ? '#2b2724' : '#f2ede6';
  let x = 0, y = 0;
  for (const [hh, k] of hues) if (near(best, hh)) { x += Math.cos(hh * Math.PI / 180) * k; y += Math.sin(hh * Math.PI / 180) * k; }
  const hue = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  return dark ? hslHex(hue, 20, 17) : hslHex(hue, 32, 91);
}
/**
 * The outline for a piece on a board: a soft version of the piece's main colour, or of its second colour when
 * the main one would melt into the board.
 */
function edgeFor(it, board) {
  const dark = darkBoard(board);
  const tint = (col) => { const [hh, ss] = hexToHsl(col); return dark ? hslHex(hh, Math.min(ss, 38), 34) : hslHex(hh, Math.min(ss, 48), 79); };
  const cands = (it.colors || []).slice(0, 2).filter(Boolean).map(tint);
  if (!cands.length) return dark ? '#4e4841' : '#ffffff';
  const best = cands.find((c) => deltaE(c, board) > 9) || cands.reduce((a, b) => (deltaE(b, board) > deltaE(a, board) ? b : a));
  return best;
}
/** A piece's picture with its outline in `hex` (made once, then kept for the visit). Falls back to the usual picture. */
const tinted = new Map();
function tintedSticker(it, hex) {
  const key = `${it.id}|${it.sticker.length}|${hex}`;
  if (!tinted.has(key)) {
    tinted.set(key, retintSticker(it.sticker, hexToRgb(hex)).then((url) => url || null).catch(() => null));
    if (tinted.size > 400) tinted.delete(tinted.keys().next().value);
  }
  return tinted.get(key);
}
/** A soft background for one item's card, from its main colour (for "Colour backgrounds"). */
function tileTint(it, dark = isDark()) {
  const col = it?.colors?.[0];
  if (!col) return null;
  const [hh, ss, ll] = hexToHsl(col);
  if (ss < 14 || ll < 12 || ll > 92) return dark ? '#2b2724' : '#efe9e1'; // neutrals: a warm neutral
  return dark ? hslHex(hh, Math.min(ss, 24), 19) : hslHex(hh, Math.min(ss, 40), 90);
}
/** Which outline a piece wears on a look: tinted to the piece when the look's background is automatic, else white or soft dark. */
const edgeOf = (o, it) => (o.auto ? edgeFor(it, o.board) : darkBoard(o.board));
// keep digits and a single decimal separator (comma typed on some keyboards becomes a dot)
const cleanPrice = (v) => {
  const t = String(v).replace(/,/g, '.').replace(/[^0-9.]/g, '');
  const i = t.indexOf('.');
  return i < 0 ? t : t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, '').slice(0, 2);
};
// how a stored price reads inside an input: 68 → "68", 12.5 → "12.50"
const priceText = (n) => (Number(n) % 1 === 0 ? String(Number(n)) : Number(n).toFixed(2));
// '' / null → unpriced (null); otherwise a number rounded to cents
const parsePrice = (v) => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = parseFloat(cleanPrice(v));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

/* ------------------------------------------------------------------ press / long-press */

/**
 * Makes an element respond to tap and long-press with spring feedback + haptics.
 * Right-click on desktop maps to long-press too.
 */
function press(el, { tap, long, hapticTap = 'light', delay = 460 } = {}) {
  el.classList.add('pressable');
  let timer = null, fired = false, sx = 0, sy = 0, down = false;
  const clear = () => { clearTimeout(timer); timer = null; el.classList.remove('pressing'); down = false; };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    fired = false; down = true; sx = e.clientX; sy = e.clientY;
    el.classList.add('pressing');
    if (long) timer = setTimeout(() => {
      fired = true; el.classList.remove('pressing');
      el.classList.remove('long-fired'); void el.offsetWidth; el.classList.add('long-fired');
      haptic('long');
      long(e);
    }, delay);
  });
  el.addEventListener('pointermove', (e) => {
    if (down && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) clear();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => el.addEventListener(t, clear));
  el.addEventListener('click', (e) => {
    if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; return; }
    if (tap) { if (hapticTap) haptic(hapticTap); tap(e); }
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (long && !fired) { haptic('long'); long(e); fired = false; }
  });
  return el;
}

/* ------------------------------------------------------------------ overlays */

const layer = $('#layer');
const stack = [];
let sheetSeq = 0;

function sheet(content, { full = false, onClose } = {}) {
  const scrim = h('<div class="scrim"></div>');
  const el = h(`<div class="sheet ${full ? 'full' : ''}">${full ? '' : '<div class="grabber"></div>'}</div>`);
  el.append(content);
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.tabIndex = -1;
  const heading = el.querySelector('h2');
  if (heading) { heading.id = heading.id || `sheet-title-${++sheetSeq}`; el.setAttribute('aria-labelledby', heading.id); }
  const opener = document.activeElement;
  // cards are redrawn while a sheet is open (a favourite, a rename): find the same card again by its id
  const keyed = opener?.closest?.('#views [data-id]');
  const openerKey = keyed ? `[data-id="${CSS.escape(keyed.dataset.id)}"]` : null;
  const openerPart = keyed && opener !== keyed ? [...opener.classList].map((c) => '.' + CSS.escape(c)).join('') : '';
  // a page's own button (Rows on Mix, Mix rows on More) is drawn again too: find it by what it does
  const openerAct = !keyed && opener?.dataset?.a && opener.closest?.('#views') ? `#views .view.active [data-a="${CSS.escape(opener.dataset.a)}"]` : null;
  layer.append(scrim, el);
  requestAnimationFrame(() => requestAnimationFrame(() => { scrim.classList.add('show'); el.classList.add('show'); }));
  // only take focus if nothing inside asked for it already
  setTimeout(() => { if (!closed && !el.contains(document.activeElement)) el.focus({ preventScroll: true }); }, 60);
  let closed = false;
  const api = {
    el,
    close() {
      if (closed) return; closed = true;
      stack.splice(stack.indexOf(api), 1);
      scrim.classList.remove('show'); el.classList.remove('show');
      el.style.transform = '';
      setTimeout(() => { scrim.remove(); el.remove(); }, 520);
      const inside = el.contains(document.activeElement);
      el.inert = true;
      syncTabbar(); // what is underneath is reachable again before anything is focused there
      onClose?.();
      // hand focus back to whatever opened the sheet, unless closing it already moved focus somewhere
      const again = openerKey && $(`#views ${openerKey}`);
      const back = opener && opener !== document.body && document.contains(opener) ? opener : (again && ((openerPart && $(openerPart, again)) || again.querySelector('button') || again)) || (openerAct && $(openerAct));
      if ((inside || document.activeElement === document.body) && back) back.focus?.({ preventScroll: true });
    },
  };
  if (!full) {
    scrim.addEventListener('click', () => (api.dismiss || api.close)());
    // let go: far enough or fast enough puts the sheet away, otherwise it springs back
    const settle = (dy, v = 0) => {
      el.style.transition = '';
      scrim.style.opacity = '';
      el.style.transform = ''; // spring back first: a sheet that asks before closing may stay open
      if (dy > Math.min(130, el.offsetHeight * 0.28) || (dy > 24 && v > 0.4)) { haptic('light'); (api.dismiss || api.close)(); }
    };
    const follow = (dy) => {
      el.style.transform = `translateY(${dy}px)`;
      scrim.style.opacity = String(Math.max(0.2, 1 - dy / Math.max(1, el.offsetHeight)));
    };

    // touch: swipe down anywhere on the sheet while its content is scrolled to the top
    let t0 = null;
    el.addEventListener('touchstart', (e) => {
      if (t0 && t0.on) return; // a second finger must not strand a drag that is under way
      t0 = null;
      // not from the strength slider, and not from the photo while it is being tapped to erase
      if (closed || e.touches.length !== 1 || e.target.closest('input[type=range], .slider-row, .stage.erasing, .grip')) return;
      const t = e.touches[0];
      t0 = { x: t.clientX, y: t.clientY, on: false, d: 0, v: 0, lastY: t.clientY, lastT: performance.now(), t: performance.now(), ts0: e.timeStamp, ts1: e.timeStamp };
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (!t0) return;
      const t = e.touches[0];
      if (!t0.on) {
        const dx = t.clientX - t0.x, dy = t.clientY - t0.y;
        // decided on the very first move, before the browser starts a scroll of its own
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || el.scrollTop > 0) { t0 = null; return; }
        t0.on = true;
        el.style.transition = 'none';
      }
      if (e.cancelable) e.preventDefault();
      t0.d = Math.max(0, t.clientY - t0.y);
      t0.ts1 = e.timeStamp;
      const now = performance.now(), dt = now - t0.lastT;
      if (dt > 4) { t0.v = (t.clientY - t0.lastY) / dt; t0.lastY = t.clientY; t0.lastT = now; }
      follow(t0.d);
    }, { passive: false });
    const touchEnd = () => {
      if (!t0) return;
      const { on, d, v, t, ts0, ts1 } = t0; t0 = null;
      if (!on) return;
      // How long the finger really took: the events' own clock is the truth (it is not delayed by a
      // busy page); the page clock is the fallback when events carry no usable time.
      const took = ts1 > ts0 ? Math.min(ts1 - ts0, performance.now() - t) : performance.now() - t;
      // speed of the last stretch, or of the whole gesture when it was a short flick
      settle(d, Math.max(v, d / Math.max(1, took)));
    };
    el.addEventListener('touchend', touchEnd);
    el.addEventListener('touchcancel', touchEnd);

    // mouse: drag the grabber area
    let y0 = null, dy = 0;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      const r = el.getBoundingClientRect();
      if (e.clientY - r.top > 44 || el.scrollTop > 0) return;
      y0 = e.clientY; dy = 0; el.style.transition = 'none';
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (y0 === null) return;
      dy = Math.max(0, e.clientY - y0);
      follow(dy);
    });
    const end = () => {
      if (y0 === null) return;
      y0 = null;
      settle(dy);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
  stack.push(api);
  syncTabbar();
  return api;
}

// inside the iOS app a native tab bar replaces the web one; the page tells it which tab shows and when to step aside
const nativeChrome = () => window.webkit?.messageHandlers?.chrome;
const TAB_OF = { closet: 'closet', mix: 'mix', outfits: 'looks', more: 'more' };
function postChrome() {
  try { nativeChrome()?.postMessage({ type: 'state', tab: TAB_OF[state.view] || 'closet', bar: !(stack.length || menuOpen || menuActing || sel.on) }); } catch { /* not in the app */ }
  document.body.classList.toggle('choosing', sel.on);
  $('#tabbar').inert = sel.on; // out of sight while choosing: out of reach too
}
function syncTabbar() {
  postChrome();
  $('#tabbar').classList.toggle('hidden', stack.some((s) => s.el.classList.contains('full')));
  // only the sheet on top (or an open menu) can be reached, by touch, keyboard or screen reader
  $('#app').inert = stack.length > 0 || menuOpen;
  stack.forEach((s, i) => { s.el.inert = menuOpen || i < stack.length - 1; });
}

let menuOpen = false;
let menuActing = false; // a menu choice is about to run: the native bar waits for it rather than popping up
function contextMenu(anchor, title, actions, point) {
  if (menuOpen) return; // one menu at a time
  menuOpen = true;
  haptic('medium');
  const before = document.activeElement;
  const scrim = h('<div class="scrim"></div>');
  const menu = h(`<div class="ctx" role="menu">${title ? `<div class="ctx-title">${esc(title)}</div>` : ''}</div>`);
  if (title) menu.setAttribute('aria-label', title);
  let preview = null;
  const r = anchor?.getBoundingClientRect?.();
  if (anchor && r && r.width < window.innerWidth * 0.8 && r.height < window.innerHeight * 0.6) {
    // a picture of what was pressed, lifted above the dimmed page: not a second control
    preview = anchor.cloneNode(true);
    preview.classList.add('ctx-preview');
    preview.classList.remove('pressing', 'long-fired', 'sel');
    [preview, ...$$('[id]', preview)].forEach((n) => n.removeAttribute('id'));
    preview.inert = true;
    preview.setAttribute('aria-hidden', 'true');
    Object.assign(preview.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: 0, animation: 'none', transform: anchor.style.transform || '' });
  }
  let done = false, closed = false;
  for (const a of actions) {
    const b = h(`<button role="menuitem" class="${a.danger ? 'danger' : ''}">${svg(a.icon)}<span>${esc(a.label)}</span></button>`);
    // a second tap while the menu fades must not run the action again
    b.addEventListener('click', () => {
      if (done) return; done = true;
      haptic(a.danger ? 'warning' : 'select');
      menuActing = true; close();
      setTimeout(() => { try { a.run(); } finally { menuActing = false; postChrome(); } }, 120);
    });
    menu.append(b);
  }
  layer.append(scrim);
  if (preview) layer.append(preview);
  layer.append(menu);
  syncTabbar();
  // position, from the menu's real size
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let x, y;
  if (r && preview) {
    x = Math.min(Math.max(12, r.left + r.width / 2 - mw / 2), window.innerWidth - mw - 12);
    y = r.bottom + 10;
    if (y + mh > window.innerHeight - 12) y = r.top - mh - 10;
    y = Math.max(12, Math.min(y, window.innerHeight - mh - 12));
  } else {
    const px = point?.clientX ?? window.innerWidth / 2, py = point?.clientY ?? window.innerHeight / 2;
    x = Math.min(Math.max(12, px - mw / 2), window.innerWidth - mw - 12);
    y = Math.max(12, Math.min(py - mh - 16, window.innerHeight - mh - 12));
  }
  Object.assign(menu.style, { left: x + 'px', top: y + 'px', transformOrigin: `50% ${r && y < r.top ? '100%' : '0%'}` });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    scrim.classList.add('show'); menu.classList.add('show');
    if (preview) preview.style.transform = (anchor.style.transform || '') + ' scale(1.04)';
  }));
  $('button', menu)?.focus({ preventScroll: true });
  // Escape closes the menu before anything underneath it; arrows move through it
  function onKey(e) {
    if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = $$('button', menu), i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1) + (i < 0 && e.key === 'ArrowUp' ? 1 : 0)) % items.length]?.focus();
  }
  function close() {
    if (closed) return;
    closed = true; menuOpen = false;
    document.removeEventListener('keydown', onKey, true);
    scrim.style.pointerEvents = 'none'; menu.style.pointerEvents = 'none';
    scrim.classList.remove('show'); menu.classList.remove('show');
    if (preview) preview.style.transform = anchor.style.transform || '';
    setTimeout(() => { scrim.remove(); menu.remove(); preview?.remove(); }, 380);
    syncTabbar();
    // focus goes back to what was pressed, so whatever the action opens can hand it back there later
    const back = anchor && document.contains(anchor) ? anchor : before;
    if (menu.contains(document.activeElement) || document.activeElement === document.body) back?.focus?.({ preventScroll: true });
  }
  scrim.addEventListener('click', close);
  scrim.addEventListener('contextmenu', (e) => { e.preventDefault(); close(); });
  document.addEventListener('keydown', onKey, true);
}

let toastTimer;
/** A short note at the top. With `action` ({ label, run }) it carries one button, such as Undo, and stays a little longer. */
function toast(msg, action = null) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('act', !!action);
  if (action) {
    const b = h(`<button>${esc(action.label)}</button>`);
    b.addEventListener('click', () => { t.classList.remove('show'); clearTimeout(toastTimer); action.run(); }, { once: true });
    t.append(b);
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 4000 : 2000);
}

function confirmSheet(title, text, okLabel = 'Delete') {
  return new Promise((resolve) => {
    const c = h(`<div><h2>${esc(title)}</h2>${text ? `<p class="sub">${esc(text)}</p>` : ''}
      <div class="row-btns"><button class="btn soft" data-a="no">Keep</button><button class="btn danger" data-a="yes">${esc(okLabel)}</button></div></div>`);
    let answered = false;
    const s = sheet(c, { onClose: () => { if (!answered) resolve(false); } });
    press($('[data-a=no]', c), { tap: () => { answered = true; resolve(false); s.close(); } });
    press($('[data-a=yes]', c), { tap: () => { answered = true; haptic('warning'); resolve(true); s.close(); } });
  });
}

/* ------------------------------------------------------------------ navigation */

function setView(v) {
  if (state.view === v) return;
  state.view = v;
  // a search belongs to the page it was typed on
  state.search = '';
  markTab(v);
  $$('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + v));
  const title = $('#view-title');
  title.classList.add('swap');
  setTimeout(() => { title.textContent = $('#view-' + v).dataset.title; title.classList.remove('swap'); }, 200);
  render();
  postChrome();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Which tab the glass drop sits under.
function markTab(key) {
  $$('#tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.view === key));
  moveTabInd();
}
function moveTabInd() {
  const act = $('#tabs .tab.active'), ind = $('#tab-ind');
  if (!act || !ind) return;
  ind.style.width = act.offsetWidth + 'px';
  ind.style.transform = `translateX(${act.offsetLeft}px)`;
}

/** The header's right side: "Select" on the closet page (and "Done" while choosing). */
function syncSelectTitle() {
  const btn = $('#select-btn');
  if (!btn) return;
  const show = state.view === 'closet' && state.items.length > 0;
  btn.hidden = !show;
  btn.textContent = sel.on ? 'Done' : 'Select';
  if (state.view === 'closet') $('#view-title').textContent = sel.on ? (sel.ids.size ? `${sel.ids.size} chosen` : 'Choose items') : 'My closet';
}
function render() {
  if (state.view !== 'closet' && sel.on) { sel.on = false; sel.ids.clear(); $('#select-bar')?.remove(); }
  syncSelectTitle();
  if (state.view === 'closet') renderCloset();
  if (state.view === 'mix') renderMix();
  if (state.view === 'outfits') renderOutfits();
  if (state.view === 'more') renderMore();
}

/* ------------------------------------------------------------------ closet view */

// Names a piece from its main colour and what it is: "Sage knit", "Denim jeans", "Beige accessory".
const SINGULAR = { Blazers: 'blazer', Puffers: 'puffer', Vests: 'vest', Raincoats: 'raincoat', 'T-shirts': 't-shirt', Shirts: 'shirt', Blouses: 'blouse', Knits: 'knit', Hoodies: 'hoodie', Tanks: 'tank', Jackets: 'jacket', Coats: 'coat', Dresses: 'dress', Skirts: 'skirt', Bags: 'bag', Hats: 'hat', Belts: 'belt', Scarves: 'scarf', Watches: 'watch' };
const CAT_NOUN = { top: 'top', outer: 'jacket', bottom: 'bottoms', shoes: 'shoes', acc: 'accessory' };
function autoName(colors, cat, sub) {
  const noun = sub ? (SINGULAR[sub] || sub.toLowerCase()) : (CAT_NOUN[cat] || 'item');
  const n = `${colors?.[0] ? colorName(colors[0]) + ' ' : ''}${noun}`;
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/** Decode a photo once: a modest JPEG "original" (so the cut-out can be re-tuned later) plus working pixels. */
async function photoFromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const r = rasterize(img, 1000);
    const cc = document.createElement('canvas'); cc.width = r.width; cc.height = r.height;
    cc.getContext('2d').putImageData(r, 0, 0);
    return { original: cc.toDataURL('image/jpeg', 0.86), raster: rasterize(img, 900) };
  } finally { URL.revokeObjectURL(url); }
}

// A piece is "priced" once it has any number on it (0 counts: gifts, hand-me-downs).
const isPriced = (it) => it.price !== null && it.price !== undefined && it.price !== '' && Number.isFinite(Number(it.price));

function totals() {
  const by = Object.fromEntries(CAT_ORDER.map((c) => [c, { n: 0 }]));
  let v = 0, priced = 0;
  for (const it of state.items) {
    if (isPriced(it)) { v += Number(it.price); priced++; }
    if (by[it.cat]) by[it.cat].n++;
  }
  return { v: Math.round(v * 100) / 100, n: state.items.length, priced, by };
}

function renderCloset() {
  const root = $('#view-closet');
  root.innerHTML = '';

  if (!state.items.length) {
    resetClosetFilters();
    const e = h(`<div class="empty start"><h3>Start your closet</h3>
      <p>Lay each item flat, or hang it, against a plain background and take its photo. Choose many photos at once to add them together.</p>
      <div class="pick-btns">
        <button class="btn" data-a="cam">${svg('camera')}<span>Take photo</span></button>
        <button class="btn soft" data-a="lib">${svg('image')}<span>Choose photos</span></button>
      </div></div>`);
    press($('[data-a=cam]', e), { tap: () => quickPick('camera') });
    press($('[data-a=lib]', e), { tap: () => quickPick('library') });
    root.append(e);
    return;
  }

  // search, favourites, sort and filter
  const families = () => FAMILIES.map(([f]) => f).filter((f) => state.items.some((i) => family(mainColors(i)[0]) === f));
  root.append(toolbar('closet', 'Search your closet', () => drawGrid(), families));
  if (sel.on) selectBar(); else $('#select-bar')?.remove();

  // categories
  const chips = h('<div class="chips nav"></div>');
  const mk = (key, label) => {
    const c = h(`<button class="chip ${state.filterCat === key ? 'active' : ''}">${label}</button>`);
    press(c, {
      tap: () => { state.filterCat = key; state.filterSub = null; renderCloset(); },
      long: key === 'all' ? null : (e) => contextMenu(c, CATS[key].label, [
        { icon: 'plus', label: `Add ${CATS[key].label.toLowerCase()}`, run: () => openAdd({ cat: key }) },
        { icon: 'look', label: 'New look', run: () => { state.filterCat = key; openEditor(); } },
      ], e),
      hapticTap: 'select',
    });
    return c;
  };
  chips.append(mk('all', 'All'));
  CAT_ORDER.forEach((k) => chips.append(mk(k, CATS[k].label)));
  root.append(chips);

  // types within the chosen category (only those in use)
  const used = state.filterCat === 'all' ? [] : [...new Set(state.items.filter((i) => i.cat === state.filterCat).map((i) => i.sub).filter(Boolean))];
  const list = used.length ? [...new Set([...CATS[state.filterCat].subs.filter((s) => used.includes(s)), ...used])] : [];
  const subs = h(`<div class="subchips ${list.length ? 'open' : ''}"><div class="chips"></div></div>`);
  list.forEach((s) => {
    const c = h(`<button class="chip small ${state.filterSub === s ? 'active' : ''}">${esc(s)}</button>`);
    press(c, { tap: () => { state.filterSub = state.filterSub === s ? null : s; renderCloset(); }, hapticTap: 'select' });
    $('.chips', subs).append(c);
  });
  root.append(subs);

  const host = h('<div></div>');
  root.append(host);
  // redrawn on its own while typing in the search box, so the box keeps focus
  function drawGrid() {
    host.innerHTML = '';
    const q = state.search.trim();
    const items = sortFilter(state.items
      .filter((i) => state.filterCat === 'all' || i.cat === state.filterCat)
      .filter((i) => !state.filterSub || i.sub === state.filterSub)
      .filter((i) => matches(itemWords(i), q)), 'closet', mainColors, (i) => i.created);
    if (!items.length) {
      const why = view.closet.fav && !state.items.some((i) => i.fav) ? 'No favourites yet' : q || filtered('closet') ? 'Nothing matches' : 'No items here yet';
      host.append(h(`<div class="empty"><p>${why}</p></div>`));
      return;
    }
    const grid = h('<div class="grid"></div>');
    items.forEach((it, idx) => {
      const card = h(`<div class="piece ${inWash(it) ? 'wash' : ''}" data-id="${it.id}" style="animation-delay:${Math.min(idx, 12) * 35}ms;--d:${[1, -0.8, 0.6, -1.1, 0.9, -0.7][idx % 6]}">
        <button class="piece-open"><span class="tile"${prefs.tint ? ` style="background:${tileTint(it)}"` : ''}><img class="sticker" src="${stickerOf(it)}" data-st="${it.id}" alt="" loading="lazy" /></span>
        <span class="meta"><span class="name">${esc(it.name)}</span><span class="dots">${mainColors(it).map((c) => `<i style="background:${c}"></i>`).join('')}</span></span></button>
        ${heartBtn(it)}</div>`);
      const open = $('.piece-open', card);
      if (inWash(it)) open.setAttribute('aria-label', `${it.name}, in the wash`);
      if (sel.on) {
        card.classList.add('choosing'); card.classList.toggle('chosen', sel.ids.has(it.id));
        open.setAttribute('aria-pressed', String(sel.ids.has(it.id)));
        card.append(h(`<span class="tick-mark" aria-hidden="true">${svg('check')}</span>`));
        press(open, { tap: () => {
          if (sel.ids.has(it.id)) sel.ids.delete(it.id); else sel.ids.add(it.id);
          card.classList.toggle('chosen', sel.ids.has(it.id)); open.setAttribute('aria-pressed', String(sel.ids.has(it.id)));
          selectBar(); syncSelectTitle();
        }, hapticTap: 'select' });
      } else press(open, { tap: () => openDetail(it), long: (e) => itemMenu(it, card, e) });
      bindHeart($('.heart', card), it, 'items', () => { if (view.closet.fav) drawGrid(); });
      grid.append(card);
    });
    host.append(grid);
  }
  drawGrid();
}

/** A heart on a card: tap to favourite or not, without opening anything. */
const heartBtn = (x) => `<button class="heart" aria-label="Favourite" aria-pressed="${!!x.fav}">${svg('heart')}</button>`;
function bindHeart(btn, x, store, after) {
  press(btn, { tap: async () => {
    await toggleFav(x, store);
    btn.setAttribute('aria-pressed', String(!!x.fav));
    after?.();
  }, hapticTap: null });
}

/** An empty closet has no chips to show a filter, so none is kept. */
function resetClosetFilters() {
  state.filterCat = 'all'; state.filterSub = null;
  if (state.view === 'closet') state.search = '';
  resetView('closet');
}

/* ---------- colour families, for filtering and the rainbow order ---------- */
const FAMILIES = [['Red', '#c0392b'], ['Orange', '#e07b39'], ['Yellow', '#e9c46a'], ['Green', '#5f8f55'], ['Blue', '#3b6ea8'], ['Purple', '#7d5ba6'], ['Pink', '#e094b4'],
  ['Brown', '#7a5236'], ['Beige', '#d9c7a7'], ['White', '#f4f2ee'], ['Grey', '#9a9a9a'], ['Black', '#1c1c1c']];
const FAMILY_AT = Object.fromEntries(FAMILIES.map(([n], i) => [n, i]));
/** The colour family of a hex colour: one of FAMILIES' names. */
function family(hex) {
  if (!hex) return 'Grey';
  const [hu, sa, li] = hexToHsl(hex);
  if (li < 16 || (li < 24 && sa < 30)) return 'Black';
  if (li > 88 && sa < 40) return 'White';
  if (sa < 13) return li > 70 ? 'White' : li < 30 ? 'Black' : 'Grey';
  if (hu >= 15 && hu < 50 && sa < 60) return li >= 62 ? 'Beige' : 'Brown';
  if (hu < 12 || hu >= 345) return li > 72 ? 'Pink' : 'Red';
  if (hu < 40) return 'Orange';
  if (hu < 68) return 'Yellow';
  if (hu < 168) return 'Green';
  if (hu < 255) return 'Blue';
  if (hu < 292) return 'Purple';
  return 'Pink';
}
/** Rainbow order: red to pink, then browns, beige, white, grey, black; within a family by hue then lightness. */
function rainbowKey(hex) {
  const [hu, , li] = hexToHsl(hex || '#9a9a9a');
  return FAMILY_AT[family(hex)] * 1e6 + Math.round(((hu + 330) % 360)) * 1e3 + Math.round(100 - li);
}
const DAY_MS = 86400000;
const lastWear = (x) => (wears(x) ? x.worn[x.worn.length - 1] : 0);
/** Sort and filter choices for each page. The sort is remembered on this device; the filters are not. */
const SORTS = {
  closet: [['new', 'Newest'], ['old', 'Oldest'], ['colour', 'Colour'], ['name', 'Name'], ['most', 'Most worn'], ['least', 'Least worn']],
  outfits: [['new', 'Newest'], ['old', 'Oldest'], ['most', 'Most worn'], ['least', 'Least worn'], ['colour', 'Colour'], ['name', 'Name']],
};
const WORN = [['any', 'Any'], ['lately', 'Not lately'], ['never', 'Never']];
const view = { closet: { sort: 'new', colours: [], worn: 'any', fav: false, brands: [] }, outfits: { sort: 'new', colours: [], worn: 'any', fav: false, brands: [] } };
try {
  const saved = JSON.parse(localStorage.getItem('closet.sort') || '{}');
  for (const k of ['closet', 'outfits']) if (SORTS[k].some(([v]) => v === saved[k])) view[k].sort = saved[k];
} catch { /* newest first */ }
const filtered = (k) => view[k].fav || view[k].colours.length || view[k].brands.length || view[k].worn !== 'any';
const changed = (k) => filtered(k) || view[k].sort !== 'new';
function resetView(k) { Object.assign(view[k], { colours: [], worn: 'any', fav: false, brands: [] }); }

/** Applies a page's favourites, colour and worn filters and its sort. `cols(x)` gives a thing's colours, `created(x)` its date. */
function sortFilter(list, k, cols, created) {
  const v = view[k], now = Date.now();
  let out = list;
  if (v.fav) out = out.filter((x) => x.fav);
  if (v.colours.length) out = out.filter((x) => cols(x).some((c) => v.colours.includes(family(c))));
  if (v.brands.length) out = out.filter((x) => x.brand && v.brands.some((b) => b.toLowerCase() === x.brand.toLowerCase()));
  if (v.worn === 'never') out = out.filter((x) => !wears(x));
  if (v.worn === 'lately') out = out.filter((x) => now - lastWear(x) > 30 * DAY_MS);
  const by = {
    new: (a, b) => created(b) - created(a),
    old: (a, b) => created(a) - created(b),
    name: (a, b) => (a.name || '').localeCompare(b.name || ''),
    most: (a, b) => wears(b) - wears(a) || lastWear(b) - lastWear(a),
    least: (a, b) => wears(a) - wears(b) || lastWear(a) - lastWear(b),
    colour: (a, b) => rainbowKey(cols(a)[0]) - rainbowKey(cols(b)[0]),
  }[v.sort] || ((a, b) => created(b) - created(a));
  return [...out].sort(by);
}

/** Search, favourites and filters for the closet or the looks page. `redraw` repaints the list below it. */
function toolbar(k, label, redraw, families) {
  const tb = h(`<div class="toolbar">
    <label class="search">${svg('search')}<input type="search" placeholder="Search" aria-label="${label}" autocomplete="off" enterkeyhint="search" /><button class="clear" aria-label="Clear search" hidden>${svg('close')}</button></label>
    <button class="tb fav" aria-label="Favourites only" aria-pressed="${view[k].fav}">${svg('heart')}</button>
    <button class="tb filt" aria-label="Sort and filter" aria-haspopup="dialog">${svg('filter')}<i class="dot" ${filtered(k) || view[k].sort !== 'new' ? '' : 'hidden'}></i></button>
  </div>`);
  const inp = $('input', tb), clear = $('.clear', tb);
  inp.value = state.search;
  clear.hidden = !state.search;
  inp.addEventListener('input', () => { state.search = inp.value; clear.hidden = !inp.value; redraw(); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
  press(clear, { tap: () => { state.search = ''; inp.value = ''; clear.hidden = true; inp.focus(); redraw(); }, hapticTap: 'select' });
  const fav = $('.fav', tb);
  press(fav, { tap: () => { view[k].fav = !view[k].fav; fav.setAttribute('aria-pressed', String(view[k].fav)); sync(); redraw(); }, hapticTap: 'select' });
  const filt = $('.filt', tb);
  const sync = () => { $('.dot', filt).hidden = !changed(k); };
  press(filt, { tap: () => openFilters(k, families(), () => { fav.setAttribute('aria-pressed', String(view[k].fav)); sync(); redraw(); }), hapticTap: 'select' });
  return tb;
}

/** The sort and filter sheet. Changes apply at once; `onChange` repaints the page behind. */
function openFilters(k, families, onChange) {
  const v = view[k];
  // brands on the items there are now, plus any still switched on (so they can be switched off)
  const onItems = (b) => state.items.some((i) => i.brand && i.brand.toLowerCase() === b.toLowerCase());
  const fb = brandList().filter(onItems);
  v.brands.forEach((b) => { if (!fb.some((x) => x.toLowerCase() === b.toLowerCase())) fb.push(b); });
  const c = h(`<div class="filters"><h2>Sort and filter</h2>
    <div class="field"><label id="flt-sort">Sort by</label><div class="wrap-chips" role="group" aria-labelledby="flt-sort" data-sort>
      ${SORTS[k].map(([val, l]) => `<button class="chip small" data-v="${val}">${l}</button>`).join('')}</div></div>
    ${families.length > 1 ? `<div class="field"><label id="flt-col">Colour</label><div class="wrap-chips" role="group" aria-labelledby="flt-col" data-col>
      ${families.map((f) => `<button class="chip small col" data-v="${f}"><i style="background:${FAMILIES[FAMILY_AT[f]][1]}"></i>${f}</button>`).join('')}</div></div>` : ''}
    ${k === 'closet' && fb.length ? `<div class="field"><label id="flt-brand">Brand</label><div class="wrap-chips" role="group" aria-labelledby="flt-brand" data-brands>
      ${fb.map((b) => `<button class="chip small" data-v="${esc(b)}">${esc(b)}</button>`).join('')}</div></div>` : ''}
    <div class="field"><label id="flt-worn">Worn</label><div class="wrap-chips" role="group" aria-labelledby="flt-worn" data-worn>
      ${WORN.map(([val, l]) => `<button class="chip small" data-v="${val}">${l}</button>`).join('')}</div></div>
    <div class="row-btns"><button class="btn soft" data-a="reset">Reset</button><button class="btn" data-a="done">Done</button></div>
  </div>`);
  const s = sheet(c);
  const paint = () => {
    $$('[data-sort] button', c).forEach((b) => { const on = b.dataset.v === v.sort; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    $$('[data-col] button', c).forEach((b) => { const on = v.colours.includes(b.dataset.v); b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    $$('[data-worn] button', c).forEach((b) => { const on = b.dataset.v === v.worn; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    $$('[data-brands] button', c).forEach((b) => { const on = v.brands.includes(b.dataset.v); b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
  };
  const apply = () => {
    paint(); onChange();
    try { localStorage.setItem('closet.sort', JSON.stringify({ closet: view.closet.sort, outfits: view.outfits.sort })); } catch { /* this visit only */ }
  };
  $$('[data-sort] button', c).forEach((b) => press(b, { tap: () => { v.sort = b.dataset.v; apply(); }, hapticTap: 'select' }));
  $$('[data-col] button', c).forEach((b) => press(b, { tap: () => { v.colours = v.colours.includes(b.dataset.v) ? v.colours.filter((x) => x !== b.dataset.v) : [...v.colours, b.dataset.v]; apply(); }, hapticTap: 'select' }));
  $$('[data-worn] button', c).forEach((b) => press(b, { tap: () => { v.worn = b.dataset.v; apply(); }, hapticTap: 'select' }));
  $$('[data-brands] button', c).forEach((b) => press(b, { tap: () => { v.brands = v.brands.includes(b.dataset.v) ? v.brands.filter((x) => x !== b.dataset.v) : [...v.brands, b.dataset.v]; apply(); }, hapticTap: 'select' }));
  press($('[data-a=reset]', c), { tap: () => { resetView(k); v.sort = 'new'; apply(); }, hapticTap: 'select' });
  press($('[data-a=done]', c), { tap: () => s.close() });
  paint();
}

/* ---------- choosing several items at once ---------- */
const sel = { on: false, ids: new Set() };
// The closet is drawn again when choosing starts or ends. Focus that was on a card, the bar or a menu goes
// back to that card (or to the header's Select/Done), not to the top of the page.
function redrawSelect(focusId = null) {
  const a = document.activeElement;
  const id = focusId || a?.closest?.('#view-closet [data-id]')?.dataset.id;
  const lost = !a || a === document.body || !!a.closest?.('#view-closet, #select-bar, .ctx');
  if (!sel.on) $('#select-bar')?.remove();
  syncSelectTitle(); renderCloset(); postChrome();
  if (!lost) return;
  const card = id && $(`#view-closet [data-id="${CSS.escape(id)}"] .piece-open`);
  (card || $('#select-btn'))?.focus({ preventScroll: true });
}
function startSelect(firstId = null) {
  sel.on = true; sel.ids = new Set(firstId ? [firstId] : []);
  haptic('medium');
  redrawSelect(firstId);
}
function endSelect() {
  sel.on = false; sel.ids.clear();
  redrawSelect();
}
/** The bar at the bottom while choosing: how many, and what can be done to them all. */
function selectBar() {
  let bar = $('#select-bar');
  if (!bar) {
    bar = h(`<div class="select-bar glass" id="select-bar" role="toolbar" aria-label="Chosen items">
      <button data-a="s-edit">${svg('edit')}<span>Edit</span></button>
      <button data-a="s-fav">${svg('heart')}<span>Favourite</span></button>
      <button data-a="s-wash">${svg('drop')}<span>Wash</span></button>
      <button data-a="s-del" class="danger">${svg('trash')}<span>Delete</span></button>
    </div>`);
    $('#app').append(bar); // inside #app: unreachable while a sheet or menu is open, like the rest of the page
    const chosen = () => state.items.filter((i) => sel.ids.has(i.id));
    const need = (f) => () => { if (!sel.ids.size) { haptic('light'); toast('Choose items first'); return; } f(chosen()); };
    press($('[data-a=s-edit]', bar), { tap: need((list) => bulkEdit(list)) });
    press($('[data-a=s-fav]', bar), { tap: need(async (list) => {
      const on = !list.every((i) => i.fav);
      for (const it of list) { it.fav = on; await db.put('items', it); }
      haptic('success'); toast(on ? `${list.length} favourite${list.length === 1 ? '' : 's'}` : 'Favourites removed'); renderCloset();
    }) });
    press($('[data-a=s-wash]', bar), { tap: need(async (list) => { const on = !list.every(inWash); await setWash(list, on); toast(on ? 'In the wash' : 'Clean again'); }) });
    press($('[data-a=s-del]', bar), { tap: need(async (list) => {
      // say which looks are touched, and which go altogether, as deleting one item does
      const ids = new Set(list.map((i) => i.id));
      const used = state.outfits.filter((o) => o.pieces.some((p) => ids.has(p.itemId)));
      const gone = used.filter((o) => o.pieces.every((p) => ids.has(p.itemId))).length;
      const note = !used.length ? '' : `They are in ${used.length} look${used.length === 1 ? '' : 's'}.` + (gone ? ` ${gone === used.length && gone === 1 ? 'That look' : `${gone} look${gone === 1 ? '' : 's'}`} will be deleted too.` : '');
      if (!(await confirmSheet(`Delete ${list.length} item${list.length === 1 ? '' : 's'}?`, note))) return;
      // choosing ends first and the items leave the page at once, so nothing else can act on them meanwhile
      endSelect();
      state.items = state.items.filter((i) => !ids.has(i.id));
      render();
      for (const it of list) await deleteItem(it, true, true);
      render(); toast('Deleted');
    }) });
  }
  bar.classList.toggle('none', !sel.ids.size);
  return bar;
}
/** Change category, type and brand of several items in one go. Leaves what is not changed as it is. */
function bulkEdit(list) {
  const ch = { cat: undefined, sub: undefined, brand: undefined };
  const c = h(`<div><h2>Edit ${list.length} item${list.length === 1 ? '' : 's'}</h2>
    <div class="field"><label>Category</label><div class="seg" data-cats>${CAT_ORDER.map((k) => `<button data-cat="${k}">${svg(k)}${CATS[k].label}</button>`).join('')}</div></div>
    <div class="field" data-typef hidden><label>Type</label><div class="wrap-chips" data-subs></div></div>
    <div data-brand></div>
    <button class="btn sage block" data-a="apply">Save</button>
  </div>`);
  const s = sheet(c);
  // the category every chosen item already shares, if any
  const same = list.every((i) => i.cat === list[0].cat) ? list[0].cat : null;
  const paintCats = () => $$('[data-cat]', c).forEach((b) => { const on = b.dataset.cat === (ch.cat || same); b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
  const paintSubs = () => {
    const cat = ch.cat || same, f = $('[data-typef]', c), w = $('[data-subs]', c);
    f.hidden = !cat; w.innerHTML = '';
    if (!cat) return;
    const custom = state.items.filter((i) => i.cat === cat && i.sub && !CATS[cat].subs.includes(i.sub)).map((i) => i.sub);
    [...new Set([...CATS[cat].subs, ...custom])].forEach((sname) => {
      const b = h(`<button class="chip small ${ch.sub === sname ? 'active' : ''}" aria-pressed="${ch.sub === sname}">${esc(sname)}</button>`);
      press(b, { tap: () => { ch.sub = ch.sub === sname ? undefined : sname; paintSubs(); }, hapticTap: 'select' });
      w.append(b);
    });
  };
  $$('[data-cat]', c).forEach((b) => press(b, { tap: () => { ch.cat = b.dataset.cat; ch.sub = undefined; paintCats(); paintSubs(); }, hapticTap: 'select' }));
  $('[data-brand]', c).replaceWith(brandField(() => ch.brand, (v) => { ch.brand = v; }, { keepOption: true }));
  paintCats(); paintSubs();
  press($('[data-a=apply]', c), { tap: async () => {
    for (const it of list) {
      if (!state.items.includes(it)) continue; // deleted while this sheet was open
      const auto = it.name === autoName(it.colors, it.cat, it.sub); // a name the app made follows the new type
      if (ch.cat && ch.cat !== it.cat) { it.cat = ch.cat; it.sub = null; }
      if (ch.sub !== undefined) it.sub = ch.sub;
      if (ch.brand !== undefined) { if (ch.brand) it.brand = ch.brand; else delete it.brand; }
      if (auto) it.name = autoName(it.colors, it.cat, it.sub);
      await db.put('items', it);
    }
    haptic('success'); toast(`${list.length} item${list.length === 1 ? '' : 's'} saved`);
    s.close(); endSelect();
  }, hapticTap: null });
}

// what an item can be found by: its name, brand, type, category and colours
const itemWords = (i) => [i.name, i.brand, i.sub, CATS[i.cat]?.label, ...mainColors(i).map(colorName)].filter(Boolean).join(' ').toLowerCase();

/* ---------- brands: every brand used, plus ones added and not used yet (kept on this device) ---------- */
const BRANDS_KEY = 'closet.brands';
function brandList() {
  let extra = [];
  try { extra = JSON.parse(localStorage.getItem(BRANDS_KEY) || '[]'); } catch { /* none */ }
  const all = [...state.items.map((i) => i.brand).filter(Boolean), ...extra];
  const seen = new Map();
  for (const b of all) { const k = b.trim().toLowerCase(); if (k && !seen.has(k)) seen.set(k, b.trim()); }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
function rememberBrand(b) {
  b = (b || '').trim();
  if (!b) return;
  try {
    const extra = JSON.parse(localStorage.getItem(BRANDS_KEY) || '[]');
    if (!extra.some((x) => x.toLowerCase() === b.toLowerCase())) localStorage.setItem(BRANDS_KEY, JSON.stringify([...extra, b].slice(-300)));
  } catch { /* still on the item */ }
}
/**
 * A brand picker: the phone's own list of the brands used so far, with "None" and "Add a brand".
 * `get`/`set` read and write the chosen brand ('' = none, undefined = leave as it is, for editing many at once).
 */
function brandField(get, set, { keepOption = false } = {}) {
  const f = h(`<div class="field"><label for="brand-${++sheetSeq}">Brand</label><div class="select-wrap"><select class="input" id="brand-${sheetSeq}"></select>${svg('chev')}</div>
    <div class="brand-new" hidden><input class="input" placeholder="Brand name" maxlength="40" autocomplete="off" aria-label="New brand" /><button class="btn sage" type="button">Add</button></div></div>`);
  const sel = $('select', f), box = $('.brand-new', f), inp = $('input', box);
  const fill = () => {
    const cur = get();
    const list = brandList();
    if (cur && !list.some((b) => b.toLowerCase() === cur.toLowerCase())) list.push(cur);
    sel.innerHTML = (keepOption ? '<option value="__keep">Leave as they are</option>' : '')
      + '<option value="">None</option>'
      + list.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join('')
      + '<option value="__new">Add a brand…</option>';
    sel.value = cur === undefined ? '__keep' : (list.find((b) => b.toLowerCase() === (cur || '').toLowerCase()) || '');
  };
  fill();
  const canon = (typed) => brandList().find((b) => b.toLowerCase() === typed.toLowerCase()) || typed; // "zara" is "Zara"
  let prev; // the choice before "Add a brand…", kept while the box is empty
  sel.addEventListener('change', () => {
    if (sel.value === '__new') { prev = get(); box.hidden = false; inp.value = ''; setTimeout(() => inp.focus(), 30); return; }
    box.hidden = true;
    set(sel.value === '__keep' ? undefined : sel.value);
    haptic('select');
  });
  // what is typed already counts (Save before Add keeps it, and leaving asks first)
  inp.addEventListener('input', () => { const v = inp.value.trim(); set(v ? canon(v) : prev); });
  const add = () => {
    const typed = inp.value.trim();
    if (!typed) { inp.focus(); return; }
    const v = canon(typed);
    rememberBrand(v); set(v); box.hidden = true; fill(); haptic('success');
  };
  press($('button', box), { tap: add, hapticTap: null });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  return f;
}
/** Every word typed has to appear somewhere ("black shoes" finds black pieces among the shoes). */
const matches = (hay, q) => q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));

function itemMenu(it, anchor, e) {
  contextMenu(anchor, it.name, [
    { icon: 'edit', label: 'Edit', run: () => openAdd({ item: it }) },
    { icon: 'look', label: 'Style a look', run: () => openEditor(null, suggestLook(it.id)) },
    { icon: 'heart', label: it.fav ? 'Remove favourite' : 'Favourite', run: async () => { await toggleFav(it, 'items'); render(); } },
    { icon: 'drop', label: inWash(it) ? 'Clean again' : 'In the wash', run: () => setWash([it], !inWash(it)) },
    { icon: 'select', label: 'Select', run: () => startSelect(it.id) },
    ...(state.items.filter(inWash).length > 1 ? [{ icon: 'sparkle', label: 'All clean', run: () => setWash(state.items.filter(inWash), false, true) }] : []),
    { icon: 'copy', label: 'Duplicate', run: () => duplicateItem(it) },
    { icon: 'trash', label: 'Delete', danger: true, run: () => deleteItem(it) },
  ], e);
}

async function setWash(items, on, say = false) {
  for (const it of items) {
    if (on) it.wash = Date.now(); else delete it.wash;
    await db.put('items', it);
  }
  haptic(on ? 'light' : 'success');
  if (say) toast('All clean');
  render();
}

async function duplicateItem(it) {
  const copy = { ...it, id: uid(), created: Date.now(), name: it.name + ' (copy)', fav: false, worn: [] };
  delete copy.wash;
  await db.put('items', copy);
  state.items.push(copy);
  haptic('success'); toast('Duplicated');
  render();
}

async function deleteItem(it, asked = false, quiet = false) {
  const used = state.outfits.filter((o) => o.pieces.some((p) => p.itemId === it.id));
  if (!asked && !(await confirmSheet('Delete this item?', used.length ? `${it.name}. It is in ${used.length} look${used.length === 1 ? '' : 's'}.` : it.name))) return;
  await db.del('items', it.id);
  state.items = state.items.filter((i) => i.id !== it.id);
  forgetImgs(it.id);
  // take it out of the looks it was in, so their pictures match what they hold; a look left empty goes too
  for (const o of used) {
    o.pieces = o.pieces.filter((p) => p.itemId !== it.id);
    try {
      if (!o.pieces.length) { await db.del('outfits', o.id); state.outfits = state.outfits.filter((x) => x.id !== o.id); continue; }
      o.thumb = await renderThumb(o, await lookSize(o));
      await db.put('outfits', o);
    } catch { /* the look keeps its old picture */ }
  }
  if (!quiet) { toast('Deleted'); render(); }
}

/* ------------------------------------------------------------------ item detail */

function openDetail(it) {
  const cols = mainColors(it);
  const inLooks = state.outfits.filter((o) => o.pieces.some((p) => p.itemId === it.id));
  const c = h(`<div>
    <div class="detail-img${prefs.tint ? ' tinted' : ''}"${prefs.tint ? ` style="background:${tileTint(it)}"` : ''}><img src="${stickerOf(it)}" data-st="${it.id}" alt="" />
      <button class="fav-btn ${it.fav ? 'on' : ''}" data-a="fav" aria-label="Favourite" aria-pressed="${!!it.fav}">${svg('heart')}</button></div>
    <h2>${esc(it.name)}</h2>
    <div class="detail-meta">${it.brand ? `<span class="brand">${esc(it.brand)}</span>` : ''}<span>${esc(it.sub || CATS[it.cat]?.label || '')}</span><span class="dots">${cols.map((x) => `<i style="background:${x}"></i>`).join('')}</span><span>${cols.map(colorName).join(', ')}</span></div>
    <p class="worn" data-worn></p>
    ${inLooks.length ? `<div class="in-looks" role="group" aria-label="Looks with this item">${inLooks.slice(0, 8).map((o) => `<button data-look="${o.id}" aria-label="${esc(o.name)}"><img src="${o.thumb || ''}" alt="" /></button>`).join('')}</div>` : ''}
    <div class="row-btns" style="margin-bottom:10px"><button class="btn soft" data-a="edit">Edit</button><button class="btn" data-a="look">Style</button></div>
    <button class="btn ghost block" data-a="del">Delete</button>
  </div>`);
  const s = sheet(c);
  const syncWorn = () => { const w = $('[data-worn]', c); w.textContent = [inWash(it) && 'In the wash', wornText(it)].filter(Boolean).join('. '); w.hidden = !w.textContent; };
  syncWorn();
  const fav = $('[data-a=fav]', c);
  press(fav, { tap: async () => {
    await toggleFav(it, 'items');
    fav.classList.toggle('on', !!it.fav); fav.setAttribute('aria-pressed', String(!!it.fav));
    $$(`#views [data-id="${CSS.escape(it.id)}"] .heart`).forEach((b) => b.setAttribute('aria-pressed', String(!!it.fav)));
  }, hapticTap: null });
  $$('[data-look]', c).forEach((b) => press(b, { tap: () => { const o = state.outfits.find((x) => x.id === b.dataset.look); s.close(); if (o) openEditor(o); } }));
  // a look built around this piece, ready to adjust
  press($('[data-a=look]', c), { tap: () => { s.close(); openEditor(null, suggestLook(it.id)); } });
  press($('[data-a=edit]', c), { tap: () => { s.close(); openAdd({ item: it }); } });
  press($('[data-a=del]', c), { tap: () => { s.close(); deleteItem(it); } });
}

/* ------------------------------------------------------------------ cut-out editor (shared) */

const TOL_MIN = 6, TOL_MAX = 110;
const CUT_V = 2; // version of the remover a saved strength belongs to

/** Where a tap in "add back" lands: the tapped spot, if it was removed; or a removed spot right beside it (a nick in the edge). */
function addTarget(mask, w, h, nx, ny, reach) {
  const x0 = Math.min(w - 1, Math.max(0, Math.round(nx * w))), y0 = Math.min(h - 1, Math.max(0, Math.round(ny * h)));
  if (!mask[y0 * w + x0]) return [x0 / w, y0 / h, 1];
  const r = Math.max(1, reach >> 2);
  let best = -1, bd = r * r + 1;
  for (let y = Math.max(0, y0 - r); y <= Math.min(h - 1, y0 + r); y++) for (let x = Math.max(0, x0 - r); x <= Math.min(w - 1, x0 + r); x++) {
    if (mask[y * w + x]) continue;
    const d = (x - x0) * (x - x0) + (y - y0) * (y - y0);
    if (d < bd) { bd = d; best = y * w + x; }
  }
  return best < 0 ? null : [(best % w) / w, Math.floor(best / w) / h, 1];
}

/** Where a tap in "remove more" lands: the tapped spot if something is kept there, else a thin leftover just beside it. */
function eraseTarget(mask, w, h, nx, ny, reach) {
  const x0 = Math.min(w - 1, Math.max(0, Math.round(nx * w))), y0 = Math.min(h - 1, Math.max(0, Math.round(ny * h)));
  if (mask[y0 * w + x0]) return [x0 / w, y0 / h];
  let best = -1, bd = reach * reach + 1;
  for (let y = Math.max(0, y0 - reach); y <= Math.min(h - 1, y0 + reach); y++) for (let x = Math.max(0, x0 - reach); x <= Math.min(w - 1, x0 + reach); x++) {
    if (!mask[y * w + x]) continue;
    const d = (x - x0) * (x - x0) + (y - y0) * (y - y0);
    if (d < bd) { bd = d; best = y * w + x; }
  }
  if (best < 0) return null;
  // only thin things are picked up from beside them (a stray line, a speck): the body of the piece is not.
  // "Thin" = no solid block of kept pixels fits near the spot; a corner of the piece has one just inside it.
  const bx = best % w, by = (best - bx) / w, r = Math.max(4, reach >> 1), t = Math.max(2, reach >> 2);
  const R = r + t, side = 2 * R + 2, sat = new Int32Array(side * side), full = (2 * t + 1) * (2 * t + 1);
  for (let j = 1; j < side; j++) for (let i = 1; i < side; i++) {
    const x = bx - R + i - 1, y = by - R + j - 1;
    const v = x >= 0 && y >= 0 && x < w && y < h ? mask[y * w + x] : 0;
    sat[j * side + i] = v + sat[(j - 1) * side + i] + sat[j * side + i - 1] - sat[(j - 1) * side + i - 1];
  }
  for (let cy = R - r; cy <= R + r; cy++) for (let cx = R - r; cx <= R + r; cx++) {
    const x1 = cx - t, y1 = cy - t, x2 = cx + t + 1, y2 = cy + t + 1;
    if (sat[y2 * side + x2] - sat[y1 * side + x2] - sat[y2 * side + x1] + sat[y1 * side + x1] === full) return null; // the piece itself
  }
  return [bx / w, by / h];
}

/**
 * The background-remover controls: preview, "remove background" switch, the how-much slider, and
 * "remove more" / "add back" (tap the photo; pinch to zoom in) with undo. Used by the one-item form and by bulk upload.
 * `cut` ({ raster, tolerance, seeds, removeBg, result }) is edited in place. Nothing is re-cut until
 * a control is used, so an existing sticker stays exactly as it was.
 */
function mountCutout(host, cut, { onChange, extraTools = [] } = {}) {
  let mask = null, mode = null, timer = null, run = 0; // mode: 'erase' | 'add' while tapping the photo
  const el = h(`<div><div class="stage"><div class="busy"><div class="spinner"></div></div><span class="stage-hint">Tap what should go</span><button class="zoom-fit" hidden>${svg('zoom')}<span>Fit</span></button></div>
    <div class="cut-tools">
      <button class="chip" data-a="bg" role="switch" aria-checked="${!!cut.removeBg}"><span class="switch ${cut.removeBg ? 'on' : ''}" style="transform:scale(.7);margin:-6px -7px"></span>Remove background</button>
    </div>
    <div class="slider-row" data-a="tol-row"><span>Less</span><input type="range" min="${TOL_MIN}" max="${TOL_MAX}" value="${Math.min(TOL_MAX, Math.max(TOL_MIN, cut.tolerance))}" aria-label="How much background to remove" /><span>More</span></div>
    <div class="cut-more" data-a="more-row">
      <button class="btn soft" data-a="erase" aria-pressed="false">${svg('eraser')}<span>Remove</span></button>
      <button class="btn soft" data-a="add" aria-pressed="false">${svg('brush')}<span>Add back</span></button>
      <button class="btn soft" data-a="undo" aria-label="Undo">${svg('undo')}</button>
    </div></div>`);
  host.innerHTML = '';
  host.append(el);
  extraTools.forEach((t) => $('.cut-tools', el).append(t));
  const stage = $('.stage', el), bgBtn = $('[data-a=bg]', el), eraseBtn = $('[data-a=erase]', el), addBtn = $('[data-a=add]', el), range = $('input[type=range]', el);
  const fitBtn = $('.zoom-fit', el);

  function syncTools() {
    if (!cut.removeBg) mode = null;
    $('[data-a=tol-row]', el).style.display = cut.removeBg ? '' : 'none';
    $('[data-a=more-row]', el).style.display = cut.removeBg ? '' : 'none';
    $('[data-a=undo]', el).style.display = cut.seeds.length ? '' : 'none';
    [[eraseBtn, 'erase', 'Remove'], [addBtn, 'add', 'Add back']].forEach(([b, m, label]) => {
      b.classList.toggle('active', mode === m);
      b.setAttribute('aria-pressed', String(mode === m));
      $('span', b).textContent = mode === m ? 'Done' : label;
      // "Done" alone does not say which tool is on
      if (mode === m) b.setAttribute('aria-label', m === 'erase' ? 'Done removing' : 'Done adding back'); else b.removeAttribute('aria-label');
    });
    $('.stage-hint', el).textContent = mode === 'add' ? 'Tap what should come back' : 'Tap what should go';
  }
  // zoom while tapping: pinch (or scroll a mouse wheel) to look closer; one finger pans once zoomed in
  const zv = { z: 1, x: 0, y: 0 };
  const view = () => $('canvas', stage);
  function applyZoom(smooth = false) {
    const c = view();
    if (!c) return;
    const cw = c.offsetWidth, ch = c.offsetHeight;
    // the photo was resized (an iPad turned, Split View): the same spot stays in view
    if (zv.w && cw && ch && (cw !== zv.w || ch !== zv.h)) { zv.x *= cw / zv.w; zv.y *= ch / zv.h; }
    zv.w = cw; zv.h = ch;
    zv.z = Math.max(1, Math.min(6, zv.z));
    zv.x = Math.min(0, Math.max(cw * (1 - zv.z), zv.x));
    zv.y = Math.min(0, Math.max(ch * (1 - zv.z), zv.y));
    c.style.transition = smooth ? 'transform .3s cubic-bezier(.2,.8,.2,1)' : 'none';
    c.style.transform = zv.z > 1 ? `translate(${zv.x}px, ${zv.y}px) scale(${zv.z})` : '';
    fitBtn.hidden = zv.z <= 1.01;
    stage.classList.toggle('zoomed', zv.z > 1.01);
  }
  const resetZoom = (smooth = true) => { zv.z = 1; zv.x = 0; zv.y = 0; applyZoom(smooth); };
  // zoom to `z` keeping the photo point under (cx, cy) where it is
  function zoomAt(z, cx, cy, from = null) {
    const c = view();
    if (!c) return;
    const f = from || { z: zv.z, x: zv.x, y: zv.y, r: c.getBoundingClientRect() };
    const u = (cx - f.r.left) / f.z, v = (cy - f.r.top) / f.z; // the point, in unzoomed photo pixels
    const L = f.r.left - f.x, T = f.r.top - f.y; // where the photo sits unzoomed
    zv.z = Math.max(1, Math.min(6, z));
    zv.x = cx - L - zv.z * u; zv.y = cy - T - zv.z * v;
    applyZoom();
  }
  function show() {
    stage.classList.toggle('erasing', !!mode);
    stage.classList.toggle('adding', mode === 'add');
    $$('img, canvas', stage).forEach((n) => n.remove());
    if (mode && mask) { stage.prepend(renderMaskPreview(cut.raster, mask, { ghost: mode === 'add' ? 0.32 : 0 })); applyZoom(); }
    else { if (cut.result) stage.prepend(h(`<img src="${cutPreview(cut.result)}" alt="" />`)); zv.z = 1; zv.x = 0; zv.y = 0; fitBtn.hidden = true; stage.classList.remove('zoomed'); }
  }
  async function process() {
    if (!cut.raster) return;
    syncTools(); // erase marks may have been added or removed
    const mine = ++run;
    stage.classList.add('loading');
    await pause(30); // let the spinner paint before the heavy work
    if (mine !== run) return; // a newer change superseded this one
    mask = computeMask(cut.raster, cut.tolerance, cut.seeds);
    cut.result = renderSticker(cut.raster, mask, { removeBg: cut.removeBg });
    cut.guess = null;
    if (cut.removeBg) { try { cut.guess = guessCategory(mask, cut.raster.width, cut.raster.height); } catch { /* no guess */ } }
    stage.classList.remove('loading');
    show();
    onChange?.(cut);
  }

  press(bgBtn, { tap: () => { cut.removeBg = !cut.removeBg; $('.switch', bgBtn).classList.toggle('on', cut.removeBg); bgBtn.setAttribute('aria-checked', String(cut.removeBg)); syncTools(); process(); } });
  const toggle = async (m) => {
    const was = mode;
    mode = mode === m ? null : m;
    syncTools();
    // the form below may have scrolled the photo (and its hint) up out of sight
    if (mode) stage.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    if (mode && !mask) { await process(); return; } // first use on an untouched sticker
    if (was && mode) { // from one tool straight to the other: the same photo, at the same zoom
      const z = { ...zv }; show(); Object.assign(zv, z); applyZoom();
      return;
    }
    show();
  };
  const clearAll = () => { if (!cut.seeds.length) return; cut.seeds.length = 0; toast('Cleared'); process(); };
  press(eraseBtn, { tap: () => toggle('erase'), long: clearAll });
  press(addBtn, { tap: () => toggle('add'), long: clearAll });
  press(fitBtn, { tap: () => resetZoom() });
  press($('[data-a=undo]', el), { tap: () => {
    if (!cut.seeds.length) return;
    cut.seeds.pop();
    if (!cut.seeds.length && document.activeElement === $('[data-a=undo]', el)) eraseBtn.focus({ preventScroll: true }); // Undo is about to hide
    process();
  } });
  let lastTick = cut.tolerance;
  range.addEventListener('input', () => {
    cut.tolerance = +range.value;
    if (Math.abs(cut.tolerance - lastTick) >= 5) { haptic('light'); lastTick = cut.tolerance; }
    clearTimeout(timer); timer = setTimeout(() => { timer = null; process(); }, 140);
  });
  function tapAt(cx, cy) {
    if (!mode || !cut.removeBg || !mask) return;
    const target = view();
    if (!target) return;
    const r = target.getBoundingClientRect();
    const nx = (cx - r.left) / r.width, ny = (cy - r.top) / r.height;
    if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return;
    // a finger is wider than a stray line: reach about 14 screen pixels around the tap (fewer photo pixels when zoomed in)
    const reach = Math.max(2, Math.min(70, Math.round(14 * cut.raster.width / Math.max(1, r.width))));
    const hit = (mode === 'add' ? addTarget : eraseTarget)(mask, cut.raster.width, cut.raster.height, nx, ny, reach);
    if (!hit) { haptic('light'); return; } // nothing there to remove (or to add back)
    haptic('select');
    cut.seeds.push(hit);
    process();
  }
  // one finger: a tap marks the photo, a drag pans it (once zoomed in); two fingers: pinch to zoom and pan
  const pts = new Map();
  let gest = null; // { moved, many, from: {z, x, y, r}, d0, m0 } for the current touch
  const mid = () => { const [a, b] = [...pts.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(b.x - a.x, b.y - a.y) }; };
  const startFrom = () => {
    const c = view();
    gest.from = c ? { z: zv.z, x: zv.x, y: zv.y, r: c.getBoundingClientRect() } : null;
    if (pts.size >= 2) { const m = mid(); gest.m0 = m; gest.d0 = Math.max(1, m.d); } else { const [a] = [...pts.values()]; gest.m0 = { x: a.x, y: a.y }; }
  };
  stage.addEventListener('pointerdown', (e) => {
    if (!mode || e.target.closest('.zoom-fit') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    try { stage.setPointerCapture(e.pointerId); } catch { /* gone */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    if (!gest) gest = { moved: false, many: false };
    if (pts.size >= 2) gest.many = true;
    startFrom();
  });
  stage.addEventListener('pointermove', (e) => {
    const pt = pts.get(e.pointerId);
    if (!pt || !gest || !gest.from) return;
    pt.x = e.clientX; pt.y = e.clientY;
    if (pts.size >= 2) {
      const m = mid();
      zoomAt(gest.from.z * m.d / gest.d0, gest.m0.x, gest.m0.y, gest.from);
      zv.x += m.x - gest.m0.x; zv.y += m.y - gest.m0.y; applyZoom();
      return;
    }
    if (!gest.moved && Math.hypot(pt.x - pt.x0, pt.y - pt.y0) > 8) gest.moved = true;
    if (gest.moved && zv.z > 1) { zv.x = gest.from.x + (pt.x - gest.m0.x); zv.y = gest.from.y + (pt.y - gest.m0.y); applyZoom(); }
  });
  const lift = (e) => {
    const pt = pts.get(e.pointerId);
    if (!pt) return;
    pts.delete(e.pointerId);
    if (pts.size) { startFrom(); return; } // a finger stays: it carries on panning from here
    const g = gest; gest = null;
    if (e.type === 'pointerup' && g && !g.moved && !g.many) tapAt(e.clientX, e.clientY);
    if (g && g.many && zv.z < 1.08) resetZoom(); // pinched back out: settle at the whole photo
  };
  stage.addEventListener('pointerup', lift);
  stage.addEventListener('pointercancel', lift);
  stage.addEventListener('wheel', (e) => {
    if (!mode || !view()) return;
    e.preventDefault();
    zoomAt(zv.z * Math.exp(-e.deltaY * 0.004), e.clientX, e.clientY);
  }, { passive: false });
  // the screen turned or the window changed size while zoomed in: keep the photo in view
  const onResize = () => { if (!stage.isConnected) window.removeEventListener('resize', onResize); else if (mode) applyZoom(); };
  window.addEventListener('resize', onResize);
  syncTools();
  show();
  return {
    process, show,
    pending: () => timer !== null,
    cancel: () => { clearTimeout(timer); timer = null; },
    // run a re-cut that is still waiting on the slider, so what is saved matches what is set
    settle: async () => { if (timer !== null) { clearTimeout(timer); timer = null; await process(); } },
  };
}

/* ------------------------------------------------------------------ add / edit flow */

async function openAdd({ item = null, cat = null, source = null, kind = 'library' } = {}) {
  const st = {
    original: item?.original || null,
    raster: null,
    // strengths saved by the earlier remover were on a different scale, so those start from today's default
    tolerance: item?.cut?.v === CUT_V ? item.cut.tolerance : DEFAULT_TOLERANCE,
    seeds: item?.cut?.seeds ? [...item.cut.seeds] : [],
    removeBg: item?.cut?.removeBg ?? true,
    result: item ? { dataURL: item.sticker, darkURL: item.stickerDark || null, colors: item.colors } : null,
    cat: item?.cat || cat || (state.filterCat !== 'all' ? state.filterCat : 'top'),
    // a new piece's category follows its shape until one is chosen by hand (or was asked for)
    autoCat: !item && !cat && state.filterCat === 'all',
    kind, // where the photo came from, so "add another" opens the same place
    sub: item?.sub || (state.filterSub ?? null),
    // a name the app generated stays automatic, so it follows later category / type changes
    name: item && item.name !== autoName(item.colors, item.cat, item.sub) ? item.name : '',
    price: item?.price ?? '',
    brand: item?.brand || '',
    customSubs: [],
  };

  const c = h(`<div>
    <div class="sheet-head"><h2>${item ? 'Edit item' : 'New item'}</h2></div>
    <div data-step="photo"></div>
    <div data-step="details"></div>
  </div>`);
  const s = sheet(c);
  // swipe, scrim tap and Escape all ask first once there is a photo or a change to lose
  const sig = () => JSON.stringify([st.original === (item?.original || null), st.cat, st.sub, st.name, st.price, st.brand, st.tolerance, st.removeBg, st.seeds]);
  const clean = sig();
  s.dismiss = async () => {
    if (sig() !== clean && !(await confirmSheet(item ? 'Discard changes?' : 'Discard this item?', '', 'Discard'))) return;
    s.close();
  };
  let editor = null;

  const photo = $('[data-step=photo]', c);
  const details = $('[data-step=details]', c);

  function renderPick() {
    photo.innerHTML = '';
    const p = h(`<div class="pick">
      <div class="pick-btns">
        <button class="btn" data-a="cam">${svg('camera')}<span>Take photo</span></button>
        <button class="btn soft" data-a="lib">${svg('image')}<span>Choose photos</span></button>
      </div>
      <p class="pick-hint">Use a plain, light background. Choose several photos to add them together.</p>
    </div>`);
    press($('[data-a=cam]', p), { tap: () => pickFile('camera') });
    press($('[data-a=lib]', p), { tap: () => pickFile('library') });
    photo.append(p);
    details.innerHTML = '';
  }

  function pickFile(kind) {
    const input = kind === 'camera' ? $('#file-camera') : $('#file-library');
    input.value = '';
    st.kind = kind;
    // several photos at once → the batch flow (only while starting a brand-new piece)
    const multi = kind === 'library' && !item && !st.raster;
    if (kind === 'library') input.multiple = multi;
    input.onchange = async () => {
      const files = [...(input.files || [])];
      if (!files.length) return;
      if (multi && files.length > 1) {
        s.close();
        openBatch(files, cat || (state.filterCat !== 'all' ? state.filterCat : null));
        return;
      }
      await useFile(files[0]);
    };
    input.click();
  }

  async function useFile(f) {
    let shot;
    try { shot = await photoFromFile(f); } catch {
      haptic('warning'); toast('Photo could not be read');
      if (!st.raster && !item) renderPick();
      return;
    }
    st.original = shot.original;
    st.raster = shot.raster;
    st.seeds = [];
    st.result = null;
    await renderStage().process();
    renderDetails();
  }

  function renderStage() {
    const re = h(`<button class="chip icon" data-a="re" aria-label="New photo" title="New photo">${svg('image')}</button>`);
    press(re, { tap: () => pickFile('library'), long: (e) => contextMenu(re, 'New photo', [
      { icon: 'camera', label: 'Take photo', run: () => pickFile('camera') },
      { icon: 'image', label: 'Choose photo', run: () => pickFile('library') },
    ], e) });
    editor = mountCutout(photo, st, { onChange: () => { followShape(); syncNameHint(); }, extraTools: [re] });
    return editor;
  }

  // the category chip follows what the cut-out looks like, until the person picks one
  function followShape() {
    if (!st.autoCat || !st.guess || st.guess === st.cat) return;
    st.cat = st.guess; st.sub = null;
    $$('[data-cat]', details).forEach((x) => x.classList.toggle('active', x.dataset.cat === st.cat));
    renderSubs();
  }

  function renderDetails() {
    details.innerHTML = '';
    // a new piece needs only its category; the rest is tucked away (and stays open once opened)
    const open = !!item || !!state.moreOpen;
    const d = h(`<div>
      <div class="field"><label>Category</label><div class="seg">${CAT_ORDER.map((k) => `<button data-cat="${k}" class="${st.cat === k ? 'active' : ''}">${svg(k)}${CATS[k].label}</button>`).join('')}</div></div>
      ${item ? '' : `<button class="more-toggle" data-a="more" aria-expanded="${open}"><span>Type, brand, name, price</span>${svg('chev')}</button>`}
      <div class="more ${open ? 'open' : ''}" data-more>
        <div class="field"><label>Type</label><div class="wrap-chips" data-subs></div></div>
        <div data-brand></div>
        <div class="field"><label>Name</label><input class="input" data-name placeholder="Name" value="${esc(st.name)}" maxlength="40" /></div>
        ${item ? '' : `<div class="field"><label>Price (optional)</label><div class="price-wrap"><span>$</span><input class="input" data-price inputmode="decimal" placeholder="0" value="" /></div></div>`}
      </div>
      <button class="btn sage block" data-a="save">${item ? 'Save' : 'Add to closet'}</button>
      ${item ? '' : '<button class="btn ghost block" data-a="next">Add and do another</button>'}
    </div>`);
    details.append(d);
    $('[data-brand]', d).replaceWith(brandField(() => st.brand, (v) => { st.brand = v; }));
    $$('[data-cat]', d).forEach((b) => press(b, { tap: () => {
      st.cat = b.dataset.cat; st.sub = null; st.autoCat = false;
      $$('[data-cat]', d).forEach((x) => x.classList.toggle('active', x === b));
      renderSubs();
    }, hapticTap: 'select' }));
    const more = $('[data-a=more]', d);
    if (more) press(more, { tap: () => {
      state.moreOpen = !$('[data-more]', d).classList.contains('open');
      $('[data-more]', d).classList.toggle('open', state.moreOpen);
      more.setAttribute('aria-expanded', String(state.moreOpen));
    }, hapticTap: 'select' });
    const name = $('[data-name]', d); name.addEventListener('input', () => { st.name = name.value; });
    const price = $('[data-price]', d);
    if (price) {
      price.value = st.price === null ? '' : st.price;
      price.addEventListener('input', () => { price.value = cleanPrice(price.value); st.price = price.value; });
    }
    press($('[data-a=save]', d), { tap: save, hapticTap: null });
    const next = $('[data-a=next]', d);
    if (next) press(next, { tap: () => {
      if (!st.result) { haptic('warning'); toast('Add a photo first'); return; }
      // the camera (or the photo picker) has to open while this tap still counts; the piece is saved behind it
      quickPick(st.kind === 'camera' ? 'camera' : 'library');
      save();
    }, hapticTap: null });
    followShape();
    renderSubs();
    setTimeout(() => details.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }), 450);
  }

  function renderSubs() {
    const wrap = $('[data-subs]', details);
    if (!wrap) return;
    wrap.innerHTML = '';
    const custom = state.items.filter((i) => i.cat === st.cat && i.sub && !CATS[st.cat].subs.includes(i.sub)).map((i) => i.sub);
    const list = [...new Set([...CATS[st.cat].subs, ...custom, ...st.customSubs])];
    list.forEach((sname) => {
      const b = h(`<button class="chip small ${st.sub === sname ? 'active' : ''}">${esc(sname)}</button>`);
      press(b, { tap: () => { st.sub = st.sub === sname ? null : sname; st.autoCat = false; renderSubs(); }, hapticTap: 'select' });
      wrap.append(b);
    });
    const add = h('<button class="chip small add">Custom</button>');
    press(add, { tap: () => {
      const inp = h('<input class="input" style="height:34px;width:140px;font-size:14px" placeholder="Type" maxlength="20" />');
      add.replaceWith(inp); inp.focus();
      const done = () => { const v = inp.value.trim(); if (v) { st.customSubs.push(v); st.sub = v; } renderSubs(); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); });
      inp.addEventListener('blur', done);
    } });
    wrap.append(add);
    syncNameHint();
  }

  // the name box hints at the name the piece gets if it is left empty
  function syncNameHint() {
    const name = $('[data-name]', details);
    if (name) name.placeholder = autoName(st.result?.colors, st.cat, st.sub);
  }

  async function save() {
    await editor?.settle();
    if (!st.result) { haptic('warning'); toast('Add a photo first'); return; }
    const colors = mainColors(st.result);
    const rec = {
      ...(item ? itemById(item.id) || item : {}), // favourite, wear log and anything else the form does not show
      id: item?.id || uid(),
      created: item?.created || Date.now(),
      name: (st.name || '').trim() || autoName(colors, st.cat, st.sub),
      cat: st.cat, sub: st.sub,
      brand: (st.brand || '').trim() || undefined,
      price: item ? (item.price ?? null) : parsePrice(st.price), // editing never touches the price
      sticker: st.result.dataURL,
      stickerDark: st.result.darkURL || (item && st.result.dataURL === itemById(item.id)?.sticker ? itemById(item.id)?.stickerDark : null) || null,
      colors,
      original: st.original,
      cut: { v: CUT_V, tolerance: st.tolerance, seeds: st.seeds, removeBg: st.removeBg },
    };
    if (!rec.brand) delete rec.brand;
    await db.put('items', rec);
    const i = state.items.findIndex((x) => x.id === rec.id);
    if (i >= 0) state.items[i] = rec; else state.items.push(rec);
    forgetImgs(rec.id);
    haptic('success');
    toast(item ? 'Saved' : 'Added');
    s.close();
    if (state.view !== 'closet') setView('closet'); else render();
  }

  if (source) {
    photo.innerHTML = '<div class="stage loading"><div class="busy"><div class="spinner"></div></div></div>';
    await useFile(source);
  } else if (item?.original) {
    // the saved sticker is shown as it is; it is only cut again if one of the cut-out controls is used
    try { st.raster = rasterize(await loadImage(item.original), 900); } catch { /* keep the sticker */ }
    if (st.raster) renderStage(); else photo.innerHTML = `<div class="stage"><img src="${stickerOf(item)}" alt="" /></div>`;
    renderDetails();
  } else if (item) {
    // older piece without its photo: show the sticker only
    photo.innerHTML = `<div class="stage"><img src="${stickerOf(item)}" alt="" /></div>`;
    renderDetails();
  } else renderPick();
}

/* ------------------------------------------------------------------ batch add */

const BATCH_MAX = 40;

/** Several photos picked at once: cut them all out, ask only "what is it?" for each, add them together. */
function openBatch(files, presetCat = null) {
  const overflow = Math.max(0, files.length - BATCH_MAX);
  // status: wait → busy → done | fail (could not be decoded) | gone (removed by hand or already saved)
  const entries = files.slice(0, BATCH_MAX).map((file) => ({
    file, status: 'wait', cat: presetCat, auto: !presetCat, result: null, original: null, el: null, shown: null, redo: false,
    cut: { tolerance: DEFAULT_TOLERANCE, seeds: [], removeBg: true },
  }));
  let failed = 0, cancelled = false, saving = false, pumping = false, tuning = false;

  const c = h(`<div class="batch">
    <div class="editor-top">
      <button class="round" data-a="back" aria-label="Cancel">${svg('close')}</button>
      <h2 data-title></h2>
    </div>
    <div class="batch-progress"><div class="bar"><i data-bar></i></div><span data-status></span></div>
    <div class="batch-all" role="group" aria-label="Set every photo at once"><span class="field-label">Set all</span><div class="chips">${CAT_ORDER.map((k) => `<button class="chip small" data-all="${k}" aria-label="All ${CATS[k].label.toLowerCase()}" aria-pressed="false">${CATS[k].label}</button>`).join('')}</div></div>
    <div class="batch-list" data-list></div>
    <div class="batch-foot">
      <button class="btn block" data-a="save"></button>
      <p class="batch-hint">Tap a photo to fix its cut-out</p>
    </div>
  </div>`);
  const s = sheet(c, { full: true });
  s.el.style.paddingBottom = '0';
  const listEl = $('[data-list]', c);
  const live = () => entries.filter((e) => e.status !== 'fail' && e.status !== 'gone');

  function paint(e) {
    if (e.status === 'fail' || e.status === 'gone') { e.el?.remove(); e.el = null; return; }
    if (!e.el) {
      const n = entries.indexOf(e) + 1;
      e.el = h(`<div class="batch-row" role="group" aria-label="Photo ${n} of ${entries.length}">
        <button class="b-thumb" aria-label="Fix the cut-out of photo ${n}"><div class="spinner"></div><span class="b-tune">${svg('tune')}</span></button>
        <div class="b-main">
          <div class="b-cats">${CAT_ORDER.map((k) => `<button data-cat="${k}" aria-label="${CATS[k].label}" title="${CATS[k].label}">${svg(k)}</button>`).join('')}</div>
        </div>
        <button class="b-x" aria-label="Remove this photo">${svg('close')}</button>
      </div>`);
      $$('[data-cat]', e.el).forEach((b) => press(b, {
        tap: () => { if (saving) return; e.cat = b.dataset.cat; e.auto = false; paint(e); sync(); },
        hapticTap: 'select',
      }));
      press($('.b-thumb', e.el), { tap: () => tune(e), hapticTap: 'select' });
      press($('.b-x', e.el), { tap: () => drop(e) });
      listEl.append(e.el);
    }
    if (e.result && e.shown !== e.result.dataURL) {
      $('.b-thumb img', e.el)?.remove();
      $('.b-thumb', e.el).prepend(h(`<img src="${cutPreview(e.result)}" alt="" />`));
      e.shown = e.result.dataURL;
    }
    e.el.classList.toggle('busy', e.status === 'busy');
    e.el.classList.toggle('ready', e.status === 'done');
    $$('[data-cat]', e.el).forEach((b) => {
      b.classList.toggle('active', b.dataset.cat === e.cat);
      b.setAttribute('aria-pressed', String(b.dataset.cat === e.cat));
    });
  }

  function sync() {
    const l = live();
    const done = l.filter((e) => e.status === 'done').length, cutting = l.length - done;
    const missing = l.filter((e) => !e.cat).length;
    const pieces = `${l.length} item${l.length === 1 ? '' : 's'}`;
    $('[data-title]', c).textContent = 'New items';
    $('[data-bar]', c).style.width = `${l.length ? (done / l.length) * 100 : 100}%`;
    const notes = [];
    if (failed) notes.push(`${failed} unreadable`);
    if (overflow) notes.push(`first ${BATCH_MAX} only`);
    $('[data-status]', c).textContent = [cutting ? `${Math.min(done + 1, l.length)} of ${l.length}` : 'Ready', ...notes].join(', ');
    const btn = $('[data-a=save]', c);
    btn.className = `btn block ${!cutting && !missing && !saving ? 'sage' : 'soft'}`;
    btn.innerHTML = saving ? 'Adding' : missing ? `Choose ${missing} categor${missing === 1 ? 'y' : 'ies'}`
      : cutting ? 'Cutting out'
      : `Add ${pieces}`;
    $('.batch-all', c).style.display = l.length > 1 ? '' : 'none';
    $$('[data-all]', c).forEach((b) => {
      const on = l.length > 0 && l.every((e) => e.cat === b.dataset.all);
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  function setAll(cat) {
    if (saving) return;
    live().forEach((e) => { e.cat = cat; e.auto = false; paint(e); });
    sync();
    toast(`All ${CATS[cat].label.toLowerCase()}`);
  }

  function drop(e) {
    if (saving) return;
    e.status = 'gone'; e.file = null; e.result = null; e.original = null;
    paint(e); sync();
    if (!live().length) { cancelled = true; s.close(); toast('Nothing to add'); }
  }

  // The same cut-out editor as the one-piece form, for one photo of the batch.
  async function tune(e) {
    if (saving || tuning) return;
    if (e.status !== 'done') { toast('Still cutting out'); return; }
    tuning = true; // one editor at a time, also while the photo is being reopened
    let raster;
    try { raster = rasterize(await loadImage(e.original), 900); } catch { tuning = false; toast('Photo could not be opened'); return; }
    if (e.status !== 'done' || saving) { tuning = false; return; }
    const cut = { raster, tolerance: e.cut.tolerance, seeds: [...e.cut.seeds], removeBg: e.cut.removeBg, result: e.result };
    const cat0 = e.cat;
    let changed = false, ed = null;
    const t = h(`<div class="tuner"><h2>Fix cut-out</h2>
      <div data-ed></div>
      <div class="row-btns">${live().length > 1 ? '<button class="btn soft" data-a="all">Use for all</button>' : ''}<button class="btn sage" data-a="ok">Done</button></div>
    </div>`);
    const ts = sheet(t, { onClose: () => {
      tuning = false;
      if (e.status !== 'done') return;
      if (ed.pending()) {
        // the slider moved but its re-cut had not run yet: cut this photo again with the new settings
        ed.cancel();
        e.cut = { tolerance: cut.tolerance, seeds: cut.seeds, removeBg: cut.removeBg };
        e.status = 'wait'; paint(e); sync(); pump();
        return;
      }
      if (!changed) return;
      e.cut = { tolerance: cut.tolerance, seeds: cut.seeds, removeBg: cut.removeBg };
      e.result = cut.result;
      if (e.auto && e.cat === cat0 && cut.guess) e.cat = cut.guess;
      paint(e); sync();
    } });
    ed = mountCutout($('[data-ed]', t), cut, { onChange: () => { changed = true; } });
    press($('[data-a=ok]', t), { tap: async () => { await ed.settle(); ts.close(); } });
    const all = $('[data-a=all]', t);
    if (all) press(all, { tap: () => {
      // same strength (and background on/off) for every photo; each keeps its own erase marks
      const tol = cut.tolerance, rb = cut.removeBg;
      changed = false; // everything, this photo included, is cut again below
      ed.cancel();
      e.cut = { tolerance: tol, seeds: cut.seeds, removeBg: rb };
      ts.close();
      live().forEach((x) => {
        x.cut.tolerance = tol; x.cut.removeBg = rb;
        if (x.status === 'done') x.status = 'wait';
        else if (x.status === 'busy') x.redo = true;
      });
      entries.forEach(paint); sync();
      toast('Cutting all photos again');
      pump();
    } });
  }

  async function save() {
    if (saving) return;
    const l = live();
    if (!l.length) return;
    const first = l.find((e) => !e.cat);
    if (first) {
      haptic('warning');
      first.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      first.el.classList.remove('nudge'); void first.el.offsetWidth; first.el.classList.add('nudge');
      return;
    }
    if (l.some((e) => e.status !== 'done')) { haptic('warning'); toast('Still cutting out'); return; }
    saving = true; sync();
    const now = Date.now();
    // every record is built up front, so nothing the user taps while it saves can change the batch
    const recs = l.map((e, i) => ({
      e,
      rec: {
        id: uid(), created: now + i,
        name: autoName(e.result.colors, e.cat, null), cat: e.cat, sub: null, price: null,
        sticker: e.result.dataURL, stickerDark: e.result.darkURL || null, colors: mainColors(e.result),
        original: e.original, cut: { v: CUT_V, tolerance: e.cut.tolerance, seeds: e.cut.seeds, removeBg: e.cut.removeBg },
      },
    }));
    let added = 0;
    try {
      for (const { e, rec } of recs) {
        await db.put('items', rec);
        state.items.push(rec);
        e.status = 'gone'; added++;
      }
    } catch { /* most likely the device is out of storage; whatever was saved stays saved */ }
    saving = false;
    if (added) {
      // make sure the new pieces are visible behind the sheet
      if (state.filterCat !== 'all' && l.some((e) => e.cat !== state.filterCat)) state.filterCat = 'all';
      state.filterSub = null;
    }
    if (added < l.length) {
      haptic('warning');
      toast(added ? `Storage full. Added ${added} of ${l.length}` : 'Storage full. Nothing added');
      entries.forEach(paint); sync(); render();
      return;
    }
    cancelled = true;
    haptic('success');
    toast(`${added} item${added === 1 ? '' : 's'} added`);
    s.close();
    if (state.view !== 'closet') setView('closet'); else render();
  }

  async function tryClose() {
    if (saving) return;
    const n = live().length;
    if (n && !(await confirmSheet('Discard these photos?', '', 'Discard'))) return;
    cancelled = true;
    s.close();
  }
  s.dismiss = tryClose;

  press($('[data-a=back]', c), { tap: tryClose });
  press($('[data-a=save]', c), { tap: save, hapticTap: null });
  $$('[data-all]', c).forEach((b) => press(b, { tap: () => setAll(b.dataset.all), hapticTap: 'select' }));

  // Cuts waiting photos out one at a time, yielding between them so the sheet stays responsive.
  // Also used to cut photos again after "use for all photos".
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        if (cancelled) return;
        const e = entries.find((x) => x.status === 'wait');
        if (!e) break;
        e.status = 'busy'; paint(e); sync();
        await pause(40);
        if (e.status === 'gone') continue; // removed while waiting
        try {
          let raster;
          if (e.file) {
            const shot = await photoFromFile(e.file);
            e.original = shot.original; raster = shot.raster; e.file = null;
          } else raster = rasterize(await loadImage(e.original), 900);
          if (cancelled) return;
          if (e.status === 'gone') continue;
          const mask = computeMask(raster, e.cut.tolerance, e.cut.seeds);
          e.result = renderSticker(raster, mask, { removeBg: e.cut.removeBg });
          // the category starts as what the shape looks like; a tap on the row changes it
          if (e.auto && e.cut.removeBg) { try { e.cat = guessCategory(mask, raster.width, raster.height) || e.cat; } catch { /* left to the person */ } }
          // "use for all" may have changed the strength while this one was being cut
          if (e.redo) { e.redo = false; e.status = 'wait'; } else e.status = 'done';
        } catch {
          if (e.status === 'gone') continue;
          e.status = 'fail'; e.file = null; failed++;
        }
        paint(e); sync();
      }
    } finally { pumping = false; }
    if (!cancelled && !live().length) {
      cancelled = true;
      // close anything stacked on top first (the "Leave these behind?" question would be left dangling)
      while (stack.includes(s) && stack[stack.length - 1] !== s) stack[stack.length - 1].close();
      haptic('warning'); toast('No photos could be read');
      s.close();
    }
  }

  entries.forEach(paint);
  sync();
  if (overflow) toast(`First ${BATCH_MAX} photos only`);
  pump();
}

/* ------------------------------------------------------------------ mix: build a fit row by row */

// the rows Mix shows, top to bottom: up to five, and a kind can have more than one row (a shirt under a jacket)
const mix = { rows: [] };
const MIX_KEY = 'closet.mixRows';
const MIX_MAX = 5;
const MIX_DEFAULT = ['outer', 'top', 'bottom', 'shoes', 'acc'];
function mixCats() {
  try {
    const a = JSON.parse(localStorage.getItem(MIX_KEY) || 'null');
    const ok = Array.isArray(a) ? a.filter((k) => CATS[k]).slice(0, MIX_MAX) : [];
    if (ok.length) return ok;
  } catch { /* not stored: the default rows */ }
  return [...MIX_DEFAULT];
}
const saveMixCats = () => { try { localStorage.setItem(MIX_KEY, JSON.stringify(mix.rows.map((r) => r.cat))); } catch { /* kept for this visit */ } };
const resetMix = () => { mix.rows = mixCats().map((cat) => ({ cat, id: undefined })); };
resetMix();
const ONE = { top: 'Top', outer: 'Outerwear', bottom: 'Bottom', shoes: 'Shoes', acc: 'Accessory' };

function renderMix(focusRow = null) {
  const root = $('#view-mix');
  let focusEl = null;
  root.innerHTML = '';
  if (!state.items.length) {
    const e = h(`<div class="empty"><h3>Nothing to mix yet</h3><button class="btn">${svg('plus')} Add clothes</button></div>`);
    press($('.btn', e), { tap: () => openAdd() });
    root.append(e);
    return;
  }
  // what a row can show: the pieces of its kind, newest first, without those in the wash (unless that leaves nothing)
  const pool = (cat) => {
    const all = state.items.filter((i) => i.cat === cat).sort((a, b) => b.created - a.created);
    const clean = all.filter((i) => !inWash(i));
    return clean.length ? clean : all;
  };
  // a row of a kind with nothing in it yet waits, hidden, until something is added
  const rows = mix.rows.filter((r) => pool(r.cat).length);
  // a kind's second (or third) row is a layer: it starts on something the rows above are not showing
  rows.forEach((r, i) => { r.extra = rows.findIndex((x) => x.cat === r.cat) !== i; });
  const taken = (r) => new Set(rows.filter((x) => x !== r && x.cat === r.cat).map((x) => x.id).filter(Boolean));
  const wrap = h(`<div class="mix" style="--n:${rows.length}"></div>`);
  const starts = [];
  const save = h('<button class="btn sage" data-a="save">Save look</button>');
  const chosen = () => [...new Set(rows.map((r) => r.id).filter(Boolean))];

  rows.forEach((r, ri) => {
    const items = pool(r.cat);
    if (r.id && !items.some((i) => i.id === r.id)) r.id = undefined; // deleted, moved to another kind, or in the wash
    if (r.id === undefined) {
      // tops, bottoms and shoes start on a piece; outerwear and accessories start empty; a layer starts on a piece the other rows do not show
      const free = items.find((i) => !taken(r).has(i.id));
      r.id = r.extra ? (free ? free.id : null) : r.cat === 'acc' || r.cat === 'outer' ? null : (free || items[0]).id;
    }
    const slots = [null, ...items];
    const row = h(`<div class="mix-row"><div class="mix-track" role="listbox" tabindex="0" aria-label="${r.extra ? 'Another ' + ONE[r.cat].toLowerCase() : CATS[r.cat].label}"></div></div>`);
    const track = $('.mix-track', row);
    slots.forEach((it, si) => track.append(it
      ? h(`<button class="mix-item" role="option" tabindex="-1" id="mix-${ri}-${si}" aria-label="${esc(it.name)}"><img src="${stickerOf(it)}" data-st="${it.id}" alt="" draggable="false" /></button>`)
      : h(`<button class="mix-item none" role="option" tabindex="-1" id="mix-${ri}-${si}" aria-label="None"><span></span></button>`)));
    const els = [...track.children];
    const step = () => (els.length > 1 ? els[1].offsetLeft - els[0].offsetLeft : 1);
    let cur = Math.max(0, slots.findIndex((it) => (it ? it.id : null) === (r.id || null)));
    let want = -1; // the place a tap, a key or Shuffle is sliding this row to
    const mark = () => { els.forEach((el, i) => el.setAttribute('aria-selected', String(i === cur))); track.setAttribute('aria-activedescendant', els[cur].id); };
    // the piece in the middle is the one chosen; its neighbours shrink and fade as they leave
    const paint = () => {
      const pos = track.scrollLeft / step();
      els.forEach((el, i) => {
        const t = Math.max(0, 1 - Math.abs(i - pos));
        el.style.transform = `scale(${(0.62 + 0.38 * t).toFixed(3)})`;
        el.style.opacity = (0.28 + 0.72 * t).toFixed(3);
      });
      const now = Math.max(0, Math.min(els.length - 1, Math.round(pos)));
      if (want >= 0) { if (now !== want) return; want = -1; } // a row on its way to a piece keeps that piece chosen
      if (now === cur) return;
      cur = now; r.id = slots[now] ? slots[now].id : null;
      haptic('select'); mark();
      save.classList.toggle('off', !chosen().length);
    };
    let raf = 0;
    track.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); }, { passive: true });
    // a finger on the row, or the end of the slide, hands the choice back to where the row is
    const settle = () => { if (want >= 0) { want = -1; paint(); } };
    ['pointerdown', 'wheel', 'scrollend'].forEach((t) => track.addEventListener(t, settle, { passive: true }));
    const go = (i, smooth = true) => {
      i = Math.max(0, Math.min(els.length - 1, i));
      if (i !== cur) { want = i; cur = i; r.id = slots[i] ? slots[i].id : null; mark(); save.classList.toggle('off', !chosen().length); }
      track.scrollTo({ left: i * step(), behavior: smooth ? 'smooth' : 'auto' });
    };
    els.forEach((el, i) => press(el, { tap: () => go(i), hapticTap: null }));
    track.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault(); go(cur + (e.key === 'ArrowRight' ? 1 : -1));
    });
    r.go = (id) => go(Math.max(0, slots.findIndex((it) => (it ? it.id : null) === (id || null))));
    if (r === focusRow) focusEl = track;
    wrap.append(row);
    starts.push(() => { track.scrollLeft = cur * step(); paint(); mark(); });
  });

  if (!rows.length) wrap.append(h('<p class="mix-none">Nothing in these rows yet. Add items, or choose other rows.</p>'));
  const actions = h(`<div class="mix-actions">
    <button class="btn soft" data-a="rows" aria-label="Rows">${svg('layers')}<span>Rows</span></button>
    <button class="btn soft" data-a="shuffle" aria-label="Shuffle">${svg('swap')}<span>Shuffle</span></button>
  </div>`);
  actions.append(save);
  wrap.append(actions);
  root.append(wrap);
  starts.forEach((f) => f());
  save.classList.toggle('off', !chosen().length);
  if (focusRow) (focusEl || $('[data-a=rows]', actions)).focus({ preventScroll: true });

  press($('[data-a=rows]', actions), { tap: () => openMixRows() });
  // spin every row to a combination whose colours go together
  press($('[data-a=shuffle]', actions), { tap: () => {
    const pick = Object.fromEntries(suggestLook().map((id) => [itemById(id).cat, id]));
    const used = {}; // per kind: what is already showing after this shuffle (a kind's main row comes before its layers)
    rows.forEach((r) => {
      if (!r.extra) { r.go(pick[r.cat] || null); return; }
      const u = used[r.cat] || (used[r.cat] = new Set([pick[r.cat]]));
      const others = pool(r.cat).filter((i) => !u.has(i.id));
      const id = others.length && Math.random() < 0.6 ? others[Math.floor(Math.random() * others.length)].id : null;
      if (id) u.add(id);
      r.go(id);
    });
    haptic('success');
  }, hapticTap: null });
  let saving = false;
  press(save, { tap: async () => {
    const ids = chosen();
    if (!ids.length) { haptic('warning'); toast('Choose an item first'); return; }
    if (saving) return;
    saving = true;
    try { await saveLook(ids); } catch { haptic('warning'); toast('Could not save the look'); } finally { saving = false; }
  }, hapticTap: null });
}

/** The Rows sheet: what Mix shows, top to bottom. Drag the handle to reorder, minus to remove, up to five rows. */
function openMixRows() {
  const c = h(`<div class="rows-ed"><h2>Rows</h2><p class="sub">What Mix shows, top to bottom. Drag ${svg('grip', 'class="inline"')} to move a row. Up to ${MIX_MAX}; a kind can have more than one.</p>
    <ol class="rows-list"></ol>
    <button class="btn soft rows-add" data-a="add">${svg('plus')}<span>Add a row</span></button>
    <div class="row-btns"><button class="btn soft" data-a="reset">Reset</button><button class="btn sage" data-a="done">Done</button></div></div>`);
  const list = $('.rows-list', c), add = $('[data-a=add]', c);
  const s = sheet(c, { onClose: () => { saveMixCats(); render(); } });
  const count = (k) => state.items.filter((i) => i.cat === k).length;
  // every change shows at once on the Mix page underneath
  const changed = () => { saveMixCats(); if (state.view === 'mix') renderMix(); };
  let settling = 0; // a dropped row is landing; the list is about to be drawn again
  // focus goes to the moved row's handle, or (for a row just added or changed) to its kind button
  const draw = (focus = null, enter = null, toKind = focus !== null && focus === enter) => {
    list.innerHTML = '';
    const n = mix.rows.length;
    mix.rows.forEach((r, i) => {
      const k = count(r.cat);
      const li = h(`<li class="rows-item${r === enter ? ' in' : ''}">
        <button class="grip" aria-label="Move the ${CATS[r.cat].label.toLowerCase()} row: ${i + 1} of ${n}. Use the arrow keys">${svg('grip')}</button>
        <button class="rk" aria-label="Row ${i + 1}, ${CATS[r.cat].label}. Change what it shows">${svg(r.cat)}<span>${CATS[r.cat].label}<small>${k ? `${k} ${k === 1 ? 'item' : 'items'}` : 'No items yet'}</small></span>${svg('chev')}</button>
        <button class="rm" aria-label="Remove the ${CATS[r.cat].label.toLowerCase()} row"${n < 2 ? ' disabled' : ''}>${svg('minus')}</button></li>`);
      const grip = $('.grip', li), rk = $('.rk', li), rm = $('.rm', li);
      press(rk, { tap: () => contextMenu(rk, 'Show', CAT_ORDER.map((cat) => ({ icon: cat, label: CATS[cat].label, run: () => {
        if (r.cat === cat) return;
        r.cat = cat; r.id = undefined; changed(); draw(r, null, true);
      } })), null), hapticTap: null });
      press(rm, { tap: () => {
        // one row always stays, counting rows already sliding away; a second tap on this one does nothing
        if (li.classList.contains('out') || mix.rows.length - list.querySelectorAll('.rows-item.out').length < 2) return;
        li.classList.add('out');
        setTimeout(() => {
          const at = mix.rows.indexOf(r);
          if (at < 0 || mix.rows.length < 2) { li.classList.remove('out'); return; }
          mix.rows.splice(at, 1); changed(); draw(mix.rows[Math.min(at, mix.rows.length - 1)]);
        }, 200);
      } });
      grip.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const to = i + (e.key === 'ArrowUp' ? -1 : 1);
        if (to < 0 || to >= n) return;
        mix.rows.splice(to, 0, ...mix.rows.splice(i, 1)); haptic('select'); changed(); draw(r);
      });
      dragRow(grip, li, i);
      list.append(li);
      if (r === focus) setTimeout(() => (toKind ? rk : grip).focus({ preventScroll: true }), 0);
    });
    add.classList.toggle('off', n >= MIX_MAX);
    add.setAttribute('aria-disabled', String(n >= MIX_MAX));
  };
  // drag the handle: the row follows the finger and the others slide out of its way
  function dragRow(grip, li, from) {
    let d = null;
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || d || settling) return;
      e.preventDefault(); e.stopPropagation();
      try { grip.setPointerCapture(e.pointerId); } catch { /* gone already */ }
      const els = [...list.children], gap = els.length > 1 ? els[1].offsetTop - els[0].offsetTop : li.offsetHeight;
      d = { id: e.pointerId, y0: e.clientY, to: from, els, gap };
      li.classList.add('dragging'); list.classList.add('moving');
      haptic('select');
    });
    grip.addEventListener('pointermove', (e) => {
      if (!d || e.pointerId !== d.id) return;
      const n = d.els.length;
      const dy = Math.max(-from * d.gap - 10, Math.min((n - 1 - from) * d.gap + 10, e.clientY - d.y0));
      li.style.transform = `translateY(${dy}px) scale(1.03)`;
      const to = Math.max(0, Math.min(n - 1, from + Math.round(dy / d.gap)));
      if (to === d.to) return;
      d.to = to; haptic('select');
      d.els.forEach((el, k) => {
        if (el === li) return;
        const by = from < to && k > from && k <= to ? -d.gap : from > to && k < from && k >= to ? d.gap : 0;
        el.style.transform = by ? `translateY(${by}px)` : '';
      });
    });
    const end = (e) => {
      if (!d || e.pointerId !== d.id) return;
      const { to, gap } = d; d = null;
      li.classList.remove('dragging');
      li.style.transform = `translateY(${(to - from) * gap}px)`; // lands in its new place, then the list is drawn in order
      settling = setTimeout(() => {
        settling = 0;
        list.classList.remove('moving');
        const r = mix.rows[from];
        if (to !== from) { mix.rows.splice(to, 0, ...mix.rows.splice(from, 1)); changed(); haptic('light'); }
        draw(r);
      }, 190);
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }
  press(add, { tap: () => {
    if (mix.rows.length >= MIX_MAX) { haptic('warning'); toast(`Up to ${MIX_MAX} rows`); return; }
    contextMenu(add, 'Add a row', CAT_ORDER.map((cat) => ({ icon: cat, label: CATS[cat].label, run: () => {
      if (mix.rows.length >= MIX_MAX) { haptic('warning'); toast(`Up to ${MIX_MAX} rows`); return; } // a second menu opened meanwhile
      const r = { cat, id: undefined };
      mix.rows.push(r); changed(); draw(r, r);
    } })), null);
  }, hapticTap: null });
  press($('[data-a=reset]', c), { tap: () => { mix.rows = MIX_DEFAULT.map((cat) => ({ cat, id: undefined })); changed(); draw(); haptic('success'); }, hapticTap: null });
  press($('[data-a=done]', c), { tap: () => s.close() });
  draw();
}

/** A new look from these pieces, laid out by the app and added to the Looks page. */
async function saveLook(ids) {
  const board = isDark() ? BOARD_COLORS[BOARD_COLORS.length - 1] : BOARD_COLORS[0];
  const ratio = lookRatio();
  const o = { id: uid(), name: 'Untitled', pieces: await layoutPieces(ids, ratio, darkBoard(board)), board, auto: prefs.tint, created: Date.now(), updated: Date.now() };
  if (o.auto) o.board = autoBoard(o);
  o.thumb = await renderThumb(o, { W: 1, H: ratio });
  await db.put('outfits', o);
  state.outfits.push(o);
  haptic('success'); toast('Saved to Looks');
  setView('outfits');
}

/* ------------------------------------------------------------------ outfits view */

function outfitColors(o) {
  const out = [];
  for (const p of o.pieces) for (const c of mainColors(itemById(p.itemId))) {
    if (out.length < 6 && out.every((x) => closeness(x, c) < 0.85)) out.push(c);
  }
  return out;
}

// what a look can be found by: its name and everything its pieces can be found by
const lookWords = (o) => [o.name, ...o.pieces.map((p) => { const it = itemById(p.itemId); return it ? itemWords(it) : ''; })].join(' ').toLowerCase();

function renderOutfits() {
  const root = $('#view-outfits');
  root.innerHTML = '';
  if (!state.outfits.length) {
    // the only time the page offers "new look" itself; afterwards the + button does
    state.search = ''; resetView('outfits');
    const grid = h('<div class="looks"></div>');
    const nw = h(`<button class="look new"><div><div class="plus">${svg('plus')}</div><span>New look</span></div></button>`);
    press(nw, { tap: () => openEditor(), long: (e) => contextMenu(nw, 'New look', [
      { icon: 'sparkle', label: 'Surprise me', run: () => surpriseLook() },
      { icon: 'look', label: 'Blank board', run: () => openEditor() },
    ], e) });
    grid.append(nw);
    root.append(grid);
    return;
  }
  const families = () => FAMILIES.map(([f]) => f).filter((f) => state.outfits.some((o) => outfitColors(o).some((c) => family(c) === f)));
  root.append(toolbar('outfits', 'Search your looks', () => drawGrid(), families));
  const host = h('<div></div>');
  root.append(host);
  function drawGrid() {
    host.innerHTML = '';
    const q = state.search.trim();
    const looks = sortFilter(state.outfits.filter((o) => matches(lookWords(o), q)), 'outfits', outfitColors, (o) => o.created || o.updated);
    if (!looks.length) {
      const why = view.outfits.fav && !state.outfits.some((o) => o.fav) ? 'No favourites yet' : 'Nothing matches';
      host.append(h(`<div class="empty"><p>${why}</p></div>`));
      return;
    }
    const grid = h('<div class="looks"></div>');
    looks.forEach((o, idx) => {
      const cols = outfitColors(o);
      const n = wears(o);
      const card = h(`<div class="look" data-id="${o.id}" style="animation-delay:${Math.min(idx, 10) * 40}ms">
        <button class="look-open"${n ? ` aria-label="${esc(o.name)}, worn ${n} time${n === 1 ? '' : 's'}"` : ''}><span class="thumb-wrap" style="background:${o.board || 'var(--card)'}"><img class="thumb" src="${o.thumb || ''}" alt="" /></span>
        <span class="meta"><span class="name">${esc(o.name)}</span><span class="sub"><span class="dots">${cols.slice(0, 5).map((c) => `<i style="background:${c}"></i>`).join('')}</span>${n ? `<span class="wn">Worn ${n}×</span>` : ''}</span></span></button>
        ${heartBtn(o)}</div>`);
      const open = $('.look-open', card);
      press(open, { tap: () => openEditor(o), long: (e) => lookMenu(o, card, e) });
      bindHeart($('.heart', card), o, 'outfits', () => { if (view.outfits.fav) drawGrid(); });
      grid.append(card);
    });
    host.append(grid);
  }
  drawGrid();
}

function lookMenu(o, card, e) {
  contextMenu(card, o.name, [
    { icon: 'edit', label: 'Open', run: () => openEditor(o) },
    { icon: 'heart', label: o.fav ? 'Remove favourite' : 'Favourite', run: async () => { await toggleFav(o, 'outfits'); renderOutfits(); } },
    { icon: 'share', label: 'Share', run: () => shareLook(o) },
    { icon: 'copy', label: 'Duplicate', run: async () => {
      const copy = { ...structuredClone(o), id: uid(), name: o.name + ' ii', created: Date.now(), updated: Date.now(), worn: [], fav: false };
      await db.put('outfits', copy); state.outfits.push(copy); haptic('success'); renderOutfits();
    } },
    { icon: 'trash', label: 'Delete', danger: true, run: async () => {
      if (!(await confirmSheet('Delete this look?', o.name))) return;
      state.outfits = state.outfits.filter((x) => x.id !== o.id); await db.del('outfits', o.id); renderOutfits();
    } },
  ], e);
}

/**
 * One more wear of a look, counted for the look and for each of its pieces at the same moment, so it can be
 * taken back exactly. `keep` false leaves the look itself unsaved (a new look being made); `t` puts back a
 * wear that was taken away.
 */
async function wearLook(o, keep = true, t = Date.now(), ids = null) {
  o.worn = [...(o.worn || []), t].sort((a, b) => a - b).slice(-400);
  if (keep) await db.put('outfits', o);
  // `ids`: the items to credit (the pieces on the board, or exactly those a wear was taken from)
  for (const id of ids || new Set(o.pieces.map((p) => p.itemId))) {
    const it = itemById(id);
    if (!it) continue;
    it.worn = [...(it.worn || []), t].slice(-400);
    await db.put('items', it);
  }
  haptic('success');
  return t;
}
/**
 * Takes back a wear of a look (the given one, or the latest), and the same wear from every item that has it,
 * even one taken out of the look since. Returns { t, ids }: the wear, and the items it was taken from.
 */
async function unwearLook(o, t = lastWear(o), keep = true) {
  if (!t || !(o.worn || []).includes(t)) return null;
  o.worn = o.worn.filter((x) => x !== t);
  if (keep) await db.put('outfits', o);
  const ids = await dropItemWear(t);
  haptic('light');
  return { t, ids };
}
/** Removes the wear stamped `t` from every item that has it; returns their ids. */
async function dropItemWear(t) {
  const ids = [];
  for (const it of state.items) {
    if (!(it.worn || []).includes(t)) continue;
    it.worn = it.worn.filter((x) => x !== t);
    ids.push(it.id);
    await db.put('items', it);
  }
  return ids;
}

function surpriseLook() {
  const ids = suggestLook();
  if (!ids.length) { toast('Add items first'); return; }
  openEditor(null, ids);
}

/** Sends a look as a picture through the phone's share sheet, or saves the picture where sharing is not available or is refused. */
async function shareLook(o) {
  let blob, name;
  try {
    const cv = await drawLook(o, await lookSize(o), 1200);
    blob = await new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('no image'))), 'image/png'));
    name = `${(o.name || 'look').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim() || 'look'}.png`;
  } catch { toast('Could not make the picture'); return; }
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: o.name }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  if (!inApp()) toast('Image saved');
}

/* ------------------------------------------------------------------ outfit editor */

const imgCache = new Map();
/** A loaded picture of a piece. `edge` is false (white outline), true (soft dark outline) or a hex colour (tinted outline). */
function getImg(item, edge = false) {
  if (typeof edge === 'string') {
    const key = item.id + ':' + edge;
    if (!imgCache.has(key)) {
      const p = tintedSticker(item, edge).then((url) => loadImage(url || stickerOf(item, darkBoard(edge))));
      p.catch(() => imgCache.delete(key));
      imgCache.set(key, p);
    }
    return imgCache.get(key);
  }
  const src = stickerOf(item, edge), key = item.id + (src !== item.sticker ? ':dark' : '');
  if (imgCache.has(key)) return imgCache.get(key);
  const p = loadImage(src);
  p.catch(() => imgCache.delete(key));
  imgCache.set(key, p);
  return p;
}
/** Forget every picture of a piece (after it was edited or deleted). */
const forgetImgs = (id) => { for (const k of [...imgCache.keys()]) if (k === id || k.startsWith(id + ':')) imgCache.delete(k); };

function openEditor(outfit = null, startIds = []) {
  const o = outfit ? structuredClone(outfit) : {
    id: uid(), name: 'Untitled', pieces: [], board: isDark() ? BOARD_COLORS[BOARD_COLORS.length - 1] : BOARD_COLORS[0], auto: prefs.tint, created: Date.now(), updated: Date.now(),
  };
  let selected = null;
  let dirty = !outfit && startIds.length > 0;

  const c = h(`<div class="editor">
    <div class="editor-top">
      <button class="round" data-a="back" aria-label="Back">${svg('back')}</button>
      <input class="input" data-name value="${esc(o.name)}" maxlength="40" aria-label="Name of the look" />
      <div class="palette-tray"><div class="pill-strip" data-in aria-label="Colours in this look"></div></div>
      <button class="round dark" data-a="save" aria-label="Save">${svg('check')}</button>
    </div>
    <div class="board"><div class="hint">Tap Add to choose items</div></div>
    <div class="ed-tray" data-tray></div>
    <div class="editor-bar">
      <div class="bar-main">
        <button class="tool" data-a="add"><span class="round dark">${svg('plus')}</span><small>Add</small></button>
        <button class="tool" data-a="bg" aria-expanded="false"><span class="round"><i data-bgdot></i></span><small>Background</small></button>
        <button class="tool" data-a="shuffle"><span class="round">${svg('sparkle')}</span><small>Arrange</small></button>
        <div class="tool worn-tool">
          <span class="stepper" role="group" aria-label="Times worn">
            <button data-a="w-minus" aria-label="Worn one time less">${svg('minus')}</button><b data-wn aria-live="polite">0</b><button data-a="w-plus" aria-label="Worn one more time">${svg('plus')}</button>
          </span><small>Worn</small>
        </div>
      </div>
      <div class="bar-piece" role="toolbar" aria-label="Chosen item">
        <button class="tool" data-a="front"><span class="round">${svg('up')}</span><small>To front</small></button>
        <button class="tool" data-a="backward"><span class="round">${svg('down')}</span><small>To back</small></button>
        <button class="tool" data-a="p-swap"><span class="round">${svg('swap')}</span><small>Swap</small></button>
        <button class="tool" data-a="flip"><span class="round">${svg('flip')}</span><small>Flip</small></button>
        <button class="tool danger" data-a="remove"><span class="round">${svg('trash')}</span><small>Delete</small></button>
      </div>
    </div>
  </div>`);
  const s = sheet(c, { full: true });
  s.el.setAttribute('aria-label', 'Look');
  s.el.style.paddingBottom = 'calc(14px + env(safe-area-inset-bottom, 0px))';
  const board = $('.board', c);
  const nodes = new Map(); // piece -> element
  // pieces wear the soft edge on a dark board and the white one on a light board; with an automatic
  // background each wears an outline in its own colour (shown once it is made)
  const pic = (it) => stickerOf(it, darkBoard(o.board));
  function dress(p, im = $('img', nodes.get(p) || document.createElement('div'))) {
    const it = itemById(p.itemId);
    if (!it || !im) return;
    const plain = pic(it);
    if (!o.auto) { if (im.getAttribute('src') !== plain) im.src = plain; return; }
    const want = edgeFor(it, o.board);
    im.dataset.edge = want;
    tintedSticker(it, want).then((url) => {
      if (im.dataset.edge !== want || p.itemId !== it.id) return; // changed again meanwhile
      const src = url || plain;
      if (im.getAttribute('src') !== src) { im.onload = () => place(p); im.src = src; }
    });
  }
  const paintBoard = () => {
    board.style.background = o.board; $('[data-bgdot]', c).style.background = o.board;
    $('[data-bgdot]', c).classList.toggle('auto', !!o.auto);
    nodes.forEach((el, p) => dress(p, $('img', el)));
  };
  // an automatic background follows the pieces
  const follow = () => { if (o.auto && o.pieces.length) { o.board = autoBoard(o); paintBoard(); } };
  if (o.auto) o.board = autoBoard(o);
  paintBoard();
  const nameInp = $('[data-name]', c);
  nameInp.addEventListener('input', () => { o.name = nameInp.value; dirty = true; });

  // ----- board rendering
  function bsize() { const r = board.getBoundingClientRect(); return { W: r.width, H: r.height }; }
  function place(p) {
    const el = nodes.get(p); if (!el) return;
    const { W, H } = bsize();
    const w = p.w * W;
    el.style.width = w + 'px';
    // from the picture's own proportions, so it is right even while the width is still animating
    const im = el.firstElementChild;
    const hgt = im.naturalWidth ? w * im.naturalHeight / im.naturalWidth : (el.offsetHeight || w);
    el.style.transform = `translate(${p.x * W - w / 2}px, ${p.y * H - hgt / 2}px) rotate(${p.rot}deg) scaleX(${p.flip ? -1 : 1})`;
    el.style.zIndex = o.pieces.indexOf(p) + 1;
  }
  function addNode(p, pop = false) {
    const it = itemById(p.itemId); if (!it) return;
    const el = h(`<div class="bitem ${pop ? 'pop' : ''}"><img src="${pic(it)}" alt="" /><span class="handle">${svg('rotate')}</span></div>`);
    nodes.set(p, el);
    board.append(el);
    const img = $('img', el);
    if (img.complete) place(p); else img.onload = () => place(p);
    place(p);
    bindPiece(p, el);
    if (o.auto) dress(p, img);
  }
  function refreshAll() {
    nodes.forEach((el) => el.remove()); nodes.clear();
    o.pieces = o.pieces.filter((p) => itemById(p.itemId));
    o.pieces.forEach((p) => addNode(p));
    sync();
  }
  function select(p) {
    selected = p;
    nodes.forEach((el, q) => el.classList.toggle('sel', q === p));
    // with a piece chosen, the bar offers what can be done to it
    c.classList.toggle('has-sel', !!p);
    if (p) { closeTray(); $('[data-a=p-swap]', c).hidden = !swapChoices(p).length; }
    syncPalette();
  }
  function sync() {
    $('.hint', board).style.opacity = o.pieces.length ? 0 : 1;
    syncPalette();
  }

  function addPiece(itemId, pop = true) {
    const it = itemById(itemId); if (!it) return;
    // it lands where a piece of its kind belongs; Arrange sets the whole look out again
    const { W, H } = bsize();
    const lay = layoutLook([...o.pieces.map((q) => ({ cat: itemById(q.itemId)?.cat })), { cat: it.cat }], H / Math.max(1, W));
    const p = { itemId, ...lay.at[lay.at.length - 1], flip: false };
    o.pieces.push(p); dirty = true;
    addNode(p, pop);
    sync(); follow();
    return p;
  }
  function removePiece(p) {
    o.pieces.splice(o.pieces.indexOf(p), 1);
    nodes.get(p)?.remove(); nodes.delete(p);
    if (selected === p) select(null);
    dirty = true; sync(); follow();
  }
  const toFront = (p) => { o.pieces.push(o.pieces.splice(o.pieces.indexOf(p), 1)[0]); o.pieces.forEach(place); dirty = true; };
  const toBack = (p) => { o.pieces.unshift(o.pieces.splice(o.pieces.indexOf(p), 1)[0]); o.pieces.forEach(place); dirty = true; };
  const flip = (p) => { p.flip = !p.flip; place(p); dirty = true; };

  // ----- gestures
  function bindPiece(p, el) {
    const handle = $('.handle', el);

    handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); handle.setPointerCapture(e.pointerId);
      el.style.transition = ''; // still springing from Arrange: follow at once
      if (g) { clearTimeout(g.longTimer); g.moved = true; } // turning is not a long press
      turning = true;
      const { W, H } = bsize(); const br = board.getBoundingClientRect();
      const cx = br.left + p.x * W, cy = br.top + p.y * H;
      const d0 = Math.hypot(e.clientX - cx, e.clientY - cy), a0 = Math.atan2(e.clientY - cy, e.clientX - cx);
      const w0 = p.w, r0 = p.rot;
      const mv = (ev) => {
        const d = Math.hypot(ev.clientX - cx, ev.clientY - cy), a = Math.atan2(ev.clientY - cy, ev.clientX - cx);
        p.w = Math.max(0.08, Math.min(1.2, w0 * d / d0));
        p.rot = snapRot(r0 + (a - a0) * 180 / Math.PI);
        place(p); dirty = true;
      };
      const up = () => {
        turning = false;
        handle.removeEventListener('pointermove', mv); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up);
        haptic('light');
      };
      handle.addEventListener('pointermove', mv); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
    });

    el.addEventListener('pointerdown', (e) => { e.stopPropagation(); fingerDown(e, p, el); });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); if (g) { clearTimeout(g.longTimer); g = null; } pieceMenu(p, el, e); });
  }

  // ----- one gesture at a time: the first finger picks the item; every other finger, wherever it lands
  //       (on another item or on the board), joins in to pinch and turn that same item
  let g = null; // { p, el, pts: Map(pointerId -> {x, y}), start, moved, longTimer }
  let turning = false; // a finger is on a rotate handle
  function baseline() {
    const pts = [...g.pts.values()], p = g.p;
    if (pts.length === 1) g.start = { x: p.x, y: p.y, px: pts[0].x, py: pts[0].y };
    else {
      const [a, b] = pts;
      g.start = { w: p.w, rot: p.rot, d: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), ang: Math.atan2(b.y - a.y, b.x - a.x), x: p.x, y: p.y, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
  }
  function fingerDown(e, p, el) {
    try { board.setPointerCapture(e.pointerId); } catch { /* the pointer already left */ }
    if (!g) {
      el.style.transition = ''; // an item still springing from Arrange follows the finger at once
      g = { p, el, pts: new Map(), start: null, moved: false, longTimer: 0 };
      if (selected !== p) { select(p); haptic('select'); }
      g.longTimer = setTimeout(() => { if (g && !g.moved && !turning && g.pts.size === 1) { const gp = g; g = null; haptic('long'); pieceMenu(gp.p, gp.el, e); } }, 520);
    } else {
      clearTimeout(g.longTimer); // a second finger: a pinch, not a long press
      g.moved = true;
    }
    g.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    baseline();
  }
  board.addEventListener('pointermove', (e) => {
    if (!g || !g.pts.has(e.pointerId)) return;
    g.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const { W, H } = bsize(), p = g.p, st = g.start, pts = [...g.pts.values()];
    if (pts.length === 1) {
      const dx = pts[0].x - st.px, dy = pts[0].y - st.py;
      if (!g.moved && Math.hypot(dx, dy) > 6) { g.moved = true; clearTimeout(g.longTimer); }
      if (g.moved) {
        p.x = Math.max(0, Math.min(1, st.x + dx / W)); // its centre stays on the board, where it can be grabbed again
        p.y = Math.max(0, Math.min(1, st.y + dy / H));
        place(p); dirty = true;
      }
    } else {
      const [a, b] = pts;
      const d = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
      p.w = Math.max(0.08, Math.min(1.2, st.w * d / st.d));
      p.rot = snapRot(st.rot + (ang - st.ang) * 180 / Math.PI);
      p.x = Math.max(0, Math.min(1, st.x + ((a.x + b.x) / 2 - st.mx) / W));
      p.y = Math.max(0, Math.min(1, st.y + ((a.y + b.y) / 2 - st.my) / H));
      place(p); dirty = true;
    }
  });
  const fingerUp = (e) => {
    if (!g || !g.pts.has(e.pointerId)) return;
    g.pts.delete(e.pointerId);
    if (g.pts.size) { baseline(); return; } // the remaining finger carries on from where things are
    clearTimeout(g.longTimer);
    if (g.moved) haptic('light');
    g = null;
  };
  board.addEventListener('pointerup', fingerUp);
  board.addEventListener('pointercancel', fingerUp);
  let lastSnap = null;
  function snapRot(r) {
    const near = Math.round(r / 45) * 45;
    if (Math.abs(r - near) < 4) { if (lastSnap !== near) { haptic('select'); lastSnap = near; } return near; }
    lastSnap = null; return r;
  }
  board.addEventListener('pointerdown', (e) => {
    if (e.target !== board && !e.target.classList.contains('hint')) return;
    if (g) fingerDown(e, g.p, g.el); // a finger on the empty board while an item is held: it helps pinch that item
    else select(null);
  });
  board.addEventListener('pointerdown', () => closeTray(), true);

  // ----- the tray that opens above the toolbar (background colours, or pieces to swap in)
  const tray = $('[data-tray]', c);
  tray.inert = true; // a hidden tray is not focusable or announced
  let trayKind = null;
  function closeTray() {
    if (!trayKind) return;
    trayKind = null; tray.classList.remove('open');
    if (tray.contains(document.activeElement)) $('[data-a=bg]', c).focus({ preventScroll: true });
    tray.inert = true;
    $('[data-a=bg]', c).setAttribute('aria-expanded', 'false');
  }
  function openTray(kind, fill) {
    const fromKeys = document.activeElement === $('[data-a=bg]', c) && document.activeElement.matches(':focus-visible');
    trayKind = kind; tray.innerHTML = ''; fill(); tray.inert = false; tray.classList.add('open');
    $('[data-a=bg]', c).setAttribute('aria-expanded', String(kind === 'bg'));
    if (fromKeys) $('[aria-pressed=true]', tray)?.focus({ preventScroll: true });
  }
  function bgTray() {
    if (trayKind === 'bg') { closeTray(); return; }
    openTray('bg', () => {
      tray.setAttribute('aria-label', 'Background colour');
      // Auto: the board takes its colour from the pieces, and each piece's outline from its own colours
      const cols = outfitColors(o);
      const auto = h(`<button class="sw auto" aria-label="Automatic" aria-pressed="${!!o.auto}" style="background:${cols.length > 1 ? `conic-gradient(${cols.join(', ')}, ${cols[0]})` : cols[0] || 'var(--soft)'}">${svg('sparkle')}</button>`);
      press(auto, { tap: () => {
        o.auto = !o.auto;
        if (o.auto) o.board = autoBoard(o);
        paintBoard(); dirty = true;
        $$('.sw', tray).forEach((x) => x.setAttribute('aria-pressed', String(x === auto ? !!o.auto : !o.auto && x.dataset.col === o.board)));
      }, hapticTap: 'select' });
      tray.append(auto);
      BOARD.forEach(([label, col]) => {
        const b = h(`<button class="sw" data-col="${col}" style="background:${col}" aria-label="${label}" aria-pressed="${!o.auto && o.board === col}"></button>`);
        press(b, { tap: () => { o.auto = false; setBoard(col); $$('.sw', tray).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }, hapticTap: 'select' });
        tray.append(b);
      });
    });
  }
  // other pieces of the same kind, best colour match with the rest of the look first
  function swapChoices(p) {
    const cur = itemById(p.itemId);
    if (!cur) return [];
    const rest = o.pieces.filter((q) => q !== p).map((q) => itemById(q.itemId)).filter(Boolean);
    const fit = (it) => (rest.length ? rest.reduce((sum, x) => sum + pairScore(it.colors?.[0], x.colors?.[0]), 0) / rest.length : 0);
    return state.items.filter((it) => it.cat === cur.cat && it.id !== cur.id && !inWash(it)).sort((a, b) => fit(b) - fit(a));
  }
  function swapTray(p) {
    if (selected !== p) select(p);
    openTray('swap', () => {
      tray.setAttribute('aria-label', 'Swap for another item');
      [itemById(p.itemId), ...swapChoices(p)].filter(Boolean).forEach((it) => {
        const b = h(`<button class="swp" aria-label="${esc(it.name)}" aria-pressed="${it.id === p.itemId}"><img src="${stickerOf(it)}" alt="" /></button>`);
        press(b, { tap: () => {
          const node = nodes.get(p);
          if (!node || !o.pieces.includes(p)) { closeTray(); return; } // the piece left the look meanwhile
          // the new piece takes over the old one's place, size, tilt and layer
          p.itemId = it.id;
          const im = $('img', node);
          im.onload = () => place(p);
          im.src = pic(it);
          if (o.auto) { o.board = autoBoard(o); paintBoard(); }
          $$('.swp', tray).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
          dirty = true; syncPalette();
        }, hapticTap: 'light' });
        tray.append(b);
      });
    });
  }

  function pieceMenu(p, el, e) {
    const it = itemById(p.itemId);
    contextMenu(null, it?.name, [
      ...(swapChoices(p).length ? [{ icon: 'swap', label: 'Swap', run: () => swapTray(p) }] : []),
      { icon: 'up', label: 'Bring to front', run: () => toFront(p) },
      { icon: 'down', label: 'Send to back', run: () => toBack(p) },
      { icon: 'flip', label: 'Flip', run: () => flip(p) },
      { icon: 'copy', label: 'Duplicate', run: () => { const q = { ...p, x: p.x + 0.05, y: p.y + 0.04 }; o.pieces.push(q); addNode(q, true); select(q); dirty = true; sync(); } },
      { icon: 'trash', label: 'Remove from look', danger: true, run: () => removePiece(p) },
    ], e);
  }

  // ----- the colours in this look (taken from its pieces)
  function syncPalette() {
    const inEl = $('[data-in]', c);
    const cols = outfitColors(o);
    inEl.innerHTML = '';
    (cols.length ? cols : ['#ece8e1']).forEach((col) => inEl.append(swatchBtn(col, !cols.length)));
  }
  function swatchBtn(col, placeholder = false) {
    const b = h(`<button style="background:${col}" aria-label="${colorName(col)}"></button>`);
    if (placeholder) return b;
    press(b, { tap: () => toast(colorName(col)), hapticTap: 'select' });
    return b;
  }

  // ----- toolbar
  press($('[data-a=add]', c), { tap: () => openPicker(), long: (e) => contextMenu($('[data-a=add]', c), 'Add', CAT_ORDER.map((k) => ({ icon: k, label: CATS[k].label, run: () => openPicker(k) })), e) });
  press($('[data-a=bg]', c), { tap: bgTray, hapticTap: 'select' });
  press($('[data-a=front]', c), { tap: () => selected && toFront(selected), hapticTap: 'select' });
  press($('[data-a=backward]', c), { tap: () => selected && toBack(selected), hapticTap: 'select' });
  press($('[data-a=p-swap]', c), { tap: () => selected && swapTray(selected), hapticTap: 'select' });
  press($('[data-a=flip]', c), { tap: () => selected && flip(selected), hapticTap: 'select' });
  press($('[data-a=remove]', c), { tap: () => selected && removePiece(selected), hapticTap: 'warning' });
  function setBoard(col) { o.board = col; paintBoard(); dirty = true; }
  /** Sets the whole look out again: tops up, bottoms under, shoes at the foot, accessories at the edges, lightly scattered. */
  async function arrange(animate = true) {
    const { W, H } = bsize();
    const old = [...o.pieces];
    const next = await layoutPieces(old.map((p) => p.itemId), H / Math.max(1, W), darkBoard(o.board));
    if (old.length !== o.pieces.length || old.some((p, i) => o.pieces[i] !== p)) return; // the look changed while pictures loaded
    // keep the same piece objects (the board's elements hang off them), in the new back-to-front order
    const pool = [...old];
    o.pieces = next.map((n) => {
      const p = pool.splice(pool.findIndex((q) => q.itemId === n.itemId), 1)[0];
      return Object.assign(p, { x: n.x, y: n.y, w: n.w, rot: n.rot });
    });
    o.pieces.forEach((p, k) => {
      const el = nodes.get(p);
      if (!el) return;
      if (!animate) { place(p); return; }
      const delay = Math.min(k * 45, 300);
      el.style.transition = `transform .75s cubic-bezier(.3,1.45,.5,1) ${delay}ms, width .75s cubic-bezier(.3,1.45,.5,1) ${delay}ms`;
      el.classList.remove('hop', 'pop'); void el.offsetWidth; el.classList.add('hop'); // 'pop' would replay the drop-in afterwards
      setTimeout(() => { el.style.transition = ''; el.classList.remove('hop'); }, 820 + delay);
      place(p);
      if (k < 6) setTimeout(() => haptic('light'), delay + 380);
    });
    dirty = true;
  }
  press($('[data-a=shuffle]', c), { tap: () => { if (!o.pieces.length) return; closeTray(); haptic('success'); arrange(); }, hapticTap: null });

  async function save() {
    o.name = nameInp.value.trim() || 'Untitled';
    o.updated = Date.now();
    o.thumb = await renderThumb(o, bsize());
    const i = state.outfits.findIndex((x) => x.id === o.id);
    if (i >= 0) state.outfits[i] = o; else state.outfits.push(o);
    await db.put('outfits', o);
    dirty = false;
    haptic('success'); toast('Saved');
  }
  press($('[data-a=save]', c), { tap: async () => { await save(); s.close(); setView('outfits'); renderOutfits(); }, hapticTap: null });
  press($('[data-a=back]', c), { tap: async () => {
    if (dirty && o.pieces.length) {
      const keep = await confirmSheet('Discard changes?', '', 'Discard');
      if (!keep) return;
    }
    s.close();
  } });

  // ----- piece picker
  function openPicker(onlyCat = null) {
    closeTray();
    let cat = onlyCat || 'all';
    const pc = h(`<div><h2>Add items</h2>
      <div class="chips" data-c></div><div class="picker-grid" data-g></div></div>`);
    sheet(pc);
    const draw = () => {
      const chipsEl = $('[data-c]', pc); chipsEl.innerHTML = '';
      ['all', ...CAT_ORDER].forEach((k) => {
        const b = h(`<button class="chip ${cat === k ? 'active' : ''}">${k === 'all' ? 'All' : CATS[k].label}</button>`);
        press(b, { tap: () => { cat = k; draw(); }, hapticTap: 'select' });
        chipsEl.append(b);
      });
      const g = $('[data-g]', pc); g.innerHTML = '';
      let list = state.items.filter((i) => cat === 'all' || i.cat === cat);
      if (!list.length) g.append(h(`<p style="grid-column:1/-1;color:var(--ink-3);text-align:center;padding:30px 0">${state.items.length ? 'No items' : 'Your closet is empty'}</p>`));
      list.forEach((it, idx) => {
        const inLook = o.pieces.some((p) => p.itemId === it.id);
        const b = h(`<button class="pick-item ${inLook ? 'in' : ''} ${inWash(it) ? 'wash' : ''}" aria-label="${esc(it.name)}" style="animation:pieceIn .5s ${Math.min(idx, 14) * 25}ms both cubic-bezier(.22,1,.36,1)"><img src="${stickerOf(it)}" alt="" /><span class="on">${svg('check')}</span></button>`);
        press(b, {
          tap: () => {
            const existing = o.pieces.filter((p) => p.itemId === it.id);
            if (existing.length) { existing.forEach(removePiece); b.classList.remove('in'); }
            else { addPiece(it.id); b.classList.add('in'); }
          },
          long: (e) => contextMenu(b, it.name, [
            { icon: 'plus', label: 'Add another', run: () => { addPiece(it.id); b.classList.add('in'); } },
          ], e),
          hapticTap: 'select',
        });
        g.append(b);
      });
    };
    draw();
  }

  requestAnimationFrame(() => {
    const { W, H } = bsize();
    rememberBoard(W, H);
    refreshAll();
    startIds.forEach((id) => addPiece(id));
    if (startIds.length) { select(null); arrange(false); }
    if (!o.pieces.length && state.items.length) setTimeout(() => openPicker(state.filterCat !== 'all' ? state.filterCat : null), 500);
  });
  const onResize = () => o.pieces.forEach(place);
  window.addEventListener('resize', onResize);
  // ----- times worn: minus and plus, each with Undo
  const stored = () => state.outfits.find((x) => x.id === o.id);
  const wn = $('[data-wn]', c), minus = $('[data-a=w-minus]', c);
  let wornChanged = false, edClosed = false;
  const paintWorn = () => { wn.textContent = String(wears(o)); minus.disabled = !wears(o); };
  paintWorn();
  // Undo can still be tapped after the editor has closed: the Looks page then shows the count it brings back
  const sayWorn = (undo) => toast(`Worn ${wears(o)} time${wears(o) === 1 ? '' : 's'}`, { label: 'Undo', run: async () => {
    await undo(); paintWorn();
    if (edClosed && state.view === 'outfits') renderOutfits();
  } });
  // the look in storage takes the change when there is one; the open copy follows it so saving keeps it.
  // A wear goes to the items on the board now (not those the look held when it was last saved).
  async function wornStep(add, t, ids = null) {
    const s0 = stored(), target = s0 || o;
    const at = add ? await wearLook(target, !!s0, t, ids || new Set(o.pieces.map((p) => p.itemId))) : await unwearLook(target, t, !!s0);
    if (s0) o.worn = [...(s0.worn || [])];
    wornChanged = true;
    paintWorn();
    return at;
  }
  press($('[data-a=w-plus]', c), { tap: async () => {
    const t = await wornStep(true);
    sayWorn(() => wornStep(false, t));
  }, hapticTap: null });
  press(minus, { tap: async () => {
    if (!wears(o)) return;
    const r = await wornStep(false, lastWear(stored() || o));
    if (r) sayWorn(() => wornStep(true, r.t, r.ids)); // back to exactly the items it was taken from
  }, hapticTap: null });

  const close0 = s.close; s.close = () => {
    edClosed = true;
    window.removeEventListener('resize', onResize);
    // a new look that was never saved: the wears it gave its items go with it
    if (!stored()) for (const t of o.worn || []) dropItemWear(t);
    close0();
    if (wornChanged && state.view === 'outfits') renderOutfits();
  };
}

/** Height / width of the look board on this phone (measured whenever the editor opens; estimated before that). */
let boardRatio = 0;
try { boardRatio = Number(localStorage.getItem('closet.board')) || 0; } catch { /* estimated */ }
const lookRatio = () => boardRatio || Math.min(2.2, Math.max(1.2, (window.innerHeight - 170) / Math.max(200, Math.min(window.innerWidth, 720) - 40)));
function rememberBoard(W, H) {
  if (W < 80 || H < 80) return;
  boardRatio = H / W;
  try { localStorage.setItem('closet.board', boardRatio.toFixed(3)); } catch { /* measured again next time */ }
}
/** The proportions a saved look was drawn with (taken from its picture). */
async function lookSize(o) {
  let ratio = lookRatio();
  if (o.thumb) { try { const t = await loadImage(o.thumb); ratio = t.naturalHeight / t.naturalWidth || ratio; } catch { /* keep the estimate */ } }
  return { W: 1, H: ratio };
}
async function renderThumb(o, size) {
  return (await drawLook(o, size, 600)).toDataURL('image/jpeg', 0.82);
}
/** Paints a look onto a canvas `width` px wide, with the board's own proportions. */
async function drawLook(o, { W, H }, width) {
  const scale = width / Math.max(1e-6, W);
  const cw = width, ch = Math.round(H * scale);
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = o.board; ctx.fillRect(0, 0, cw, ch);
  for (const p of o.pieces) {
    const it = itemById(p.itemId); if (!it) continue;
    const img = await getImg(it, edgeOf(o, it));
    const w = p.w * cw, hgt = w * img.naturalHeight / img.naturalWidth;
    ctx.save();
    ctx.translate(p.x * cw, p.y * ch);
    ctx.rotate(p.rot * Math.PI / 180);
    if (p.flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -w / 2, -hgt / 2, w, hgt);
    ctx.restore();
  }
  return cv;
}

/* ------------------------------------------------------------------ tally + settings */

/** The More page: the closet in numbers, then the settings. */
function renderMore() {
  const root = $('#view-more');
  root.innerHTML = '';
  if (state.items.length) renderStats(root);
  else {
    const e = h(`<div class="empty more-empty"><h3>Nothing to count yet</h3><button class="btn">${svg('plus')} Add clothes</button></div>`);
    press($('.btn', e), { tap: () => openAdd() });
    root.append(e);
  }
  root.append(settingsPanel());
}

function renderStats(root) {
  const t = totals(), now = Date.now();
  const maxN = Math.max(1, ...CAT_ORDER.map((k) => t.by[k].n));
  const unpriced = t.n - t.priced;
  const status = unpriced ? `${unpriced} to price` : 'All priced';
  const worn = state.items.filter((i) => wears(i)).sort((x, y) => wears(y) - wears(x) || lastWear(y) - lastWear(x));
  const lately = state.items.filter((i) => (i.worn || []).some((w) => now - w < 30 * DAY_MS)).length;
  const topLook = state.outfits.filter((o) => wears(o)).sort((x, y) => wears(y) - wears(x))[0];
  // "not worn lately" only means something once wears are being logged
  const logging = state.items.some((i) => (i.worn || []).some((w) => now - w < 45 * DAY_MS));
  const resting = state.items.filter((i) => now - lastWear(i) > 30 * DAY_MS).length;
  const palette = state.items.map((i) => mainColors(i)[0]).filter(Boolean).sort((a, b) => rainbowKey(a) - rainbowKey(b));
  const c = h(`<div class="stats">
    <div class="big-total"><div class="v">${t.n}</div><small>item${t.n === 1 ? '' : 's'}</small></div>
    <div class="breakdown">${CAT_ORDER.map((k, i) => `<div class="line"><span class="nm">${CATS[k].label}</span><span class="bar"><i style="width:${(t.by[k].n / maxN) * 100}%;animation-delay:${i * 70}ms"></i></span><span class="amt">${t.by[k].n}</span></div>`).join('')}</div>
    <div class="kv three">
      <div><small>Looks</small><b>${state.outfits.length}</b></div>
      <div><small>Favourites</small><b>${state.items.filter((i) => i.fav).length}</b></div>
      <div><small>Worn this month</small><b>${lately}</b></div>
    </div>
    ${worn.length ? `<h3 class="st-h">Most worn</h3><div class="st-pieces">${worn.slice(0, 3).map((it) => `<button data-piece="${it.id}" aria-label="${esc(it.name)}, worn ${wears(it)} times"><span class="st-tile"><img src="${stickerOf(it)}" alt="" /></span><span class="st-n">${wears(it)}×</span></button>`).join('')}</div>` : ''}
    ${topLook ? `<h3 class="st-h">Most worn look</h3><button class="st-look" data-look="${topLook.id}"><span class="thumb-wrap" style="background:${topLook.board}"><img src="${topLook.thumb || ''}" alt="" /></span><span><b>${esc(topLook.name)}</b><small>${wears(topLook)}×</small></span></button>` : ''}
    ${logging && resting ? `<button class="st-row" data-a="resting"><span>Not worn lately</span><b>${resting}</b>${svg('back', 'class="vp-c"')}</button>` : ''}
    ${palette.length > 1 ? `<h3 class="st-h">Colours</h3><div class="st-palette" role="img" aria-label="The colours of your closet">${palette.map((col) => `<i style="background:${col}"></i>`).join('')}</div>` : ''}
    <button class="value-pill" data-a="prices" aria-label="Closet value ${money(t.v)}, ${status}. Open the price list">
      <span class="vp-l">Closet value</span><span class="vp-v">${money(t.v)}</span>
      <span class="vp-s">${status}</span>${svg('back', 'class="vp-c"')}
    </button>
  </div>`);
  root.append(c);
  $$('[data-piece]', c).forEach((b) => press(b, { tap: () => { const it = itemById(b.dataset.piece); if (it) openDetail(it); } }));
  const tl = $('[data-look]', c);
  if (tl) press(tl, { tap: () => { const o = state.outfits.find((x) => x.id === tl.dataset.look); if (o) openEditor(o); } });
  const rest = $('[data-a=resting]', c);
  if (rest) press(rest, { tap: () => {
    // the closet, showing only what has not been worn for a month
    setView('closet');
    resetView('closet'); view.closet.worn = 'lately'; view.closet.sort = 'least';
    state.filterCat = 'all'; state.filterSub = null;
    renderCloset();
  } });
  // after pricing: refresh the numbers and hand focus back to the pill
  const prices = () => openPrices(() => { if (state.view === 'more') { renderMore(); $('#view-more [data-a=prices]')?.focus({ preventScroll: true }); } });
  press($('[data-a=prices]', c), { tap: prices, long: prices, hapticTap: 'select' });
}

/** The one place prices are listed and edited. Unpriced pieces come first. */
let pricesOpen = false;
function openPrices(onClose) {
  if (pricesOpen) return; // one list at a time: a second copy would hold stale boxes
  pricesOpen = true;
  // order is fixed when the list opens so rows don't jump while typing
  const byNew = (x, y) => y.created - x.created;
  const todo = state.items.filter((i) => !isPriced(i)).sort(byNew);
  const done = state.items.filter(isPriced).sort(byNew);
  const c = h(`<div class="prices"><h2>Prices</h2>
    <div class="price-total"><span>Total</span><b data-total></b><small data-count></small></div>
    <div data-list></div></div>`);
  const list = $('[data-list]', c);
  const syncTotal = () => {
    const t = totals();
    $('[data-total]', c).textContent = money(t.v);
    $('[data-count]', c).textContent = `${t.priced} of ${t.n} priced`;
  };
  const pending = new Map(); // item id -> save timer
  const dirty = new Set(); // ids whose box was actually changed; nothing else is ever written
  const rows = []; // { it, inp, row } in display order
  const commit = async (it, inp) => {
    clearTimeout(pending.get(it.id)); pending.delete(it.id);
    if (!dirty.delete(it.id)) return;
    const next = parsePrice(inp.value);
    if (next === (isPriced(it) ? Number(it.price) : null)) return;
    it.price = next;
    await db.put('items', it);
    syncTotal();
  };
  // Scroll the sheet so the focused row sits clear of the sticky total and the on-screen keyboard.
  let sh = null;
  const vv = window.visualViewport;
  const reveal = (row, inp) => {
    if (!sh || document.activeElement !== inp) return;
    const r = row.getBoundingClientRect();
    const top = vv ? vv.offsetTop : 0, height = vv ? vv.height : window.innerHeight;
    const head = $('.price-total', c).getBoundingClientRect().bottom;
    if (r.bottom > top + height - 16 || r.top < head + 8) {
      // aim a little above the middle of what is visible, but never underneath the pinned total
      const target = Math.max(head + 8 + r.height / 2, top + height * 0.42);
      sh.el.scrollBy({ top: r.top + r.height / 2 - target, behavior: 'smooth' });
    }
  };
  const onViewport = () => { const r = rows.find((x) => x.inp === document.activeElement); if (r) reveal(r.row, r.inp); };
  vv?.addEventListener('resize', onViewport);
  const section = (title, items) => {
    if (!items.length) return;
    list.append(h(`<div class="price-head">${title}</div>`));
    items.forEach((it) => {
      const row = h(`<div class="price-row">
        <img src="${stickerOf(it)}" alt="" />
        <div class="pr-text"><div class="pr-name">${esc(it.name)}</div><div class="pr-sub">${esc(it.sub || CATS[it.cat]?.label || '')}</div></div>
        <label class="pr-input"><span>$</span><input inputmode="decimal" enterkeyhint="next" autocomplete="off" maxlength="9" placeholder="0" aria-label="Price of ${esc(it.name)}" value="${isPriced(it) ? priceText(it.price) : ''}" /></label>
      </div>`);
      const inp = $('input', row);
      rows.push({ it, inp, row });
      let wasPriced = isPriced(it); // as it stood when the box last gained focus
      inp.addEventListener('input', () => {
        inp.value = cleanPrice(inp.value);
        dirty.add(it.id);
        clearTimeout(pending.get(it.id));
        pending.set(it.id, setTimeout(() => commit(it, inp), 500));
      });
      inp.addEventListener('focus', () => {
        row.classList.add('focus');
        wasPriced = isPriced(it);
        // Select the old value so typing replaces it, but only if this box still has focus (select()
        // can steal focus, and two boxes would then fight over it) and nothing has been typed yet
        // (or a fast first digit would be selected and overwritten by the second).
        const v0 = inp.value;
        setTimeout(() => { if (document.activeElement === inp && inp.value === v0) inp.select(); }, 0);
        setTimeout(() => reveal(row, inp), 350);
      });
      inp.addEventListener('blur', async () => {
        row.classList.remove('focus');
        await commit(it, inp);
        // tidy the display ("12." → "12")
        inp.value = isPriced(it) ? priceText(it.price) : '';
        if (isPriced(it) !== wasPriced) { haptic(isPriced(it) ? 'success' : 'light'); wasPriced = isPriced(it); }
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const nxt = rows[rows.findIndex((r) => r.inp === inp) + 1];
        if (nxt) nxt.inp.focus(); else inp.blur();
      });
      // tap the piece to type its price; long-press for quick actions
      press($('.pr-text', row), {
        tap: () => inp.focus(),
        long: (e) => contextMenu(null, it.name, [
          { icon: 'undo', label: 'Clear price', run: async () => { inp.value = ''; dirty.add(it.id); await commit(it, inp); wasPriced = false; } },
        ], e),
        hapticTap: 'select',
      });
      list.append(row);
    });
  };
  if (!state.items.length) list.append(h('<p class="pr-empty">No items yet</p>'));
  section('To price', todo);
  section('Priced', done);
  syncTotal();
  sh = sheet(c, { onClose: () => {
    pricesOpen = false;
    vv?.removeEventListener('resize', onViewport);
    // save whatever was typed last, even if its box still has focus or its debounce hasn't fired
    rows.forEach(({ it, inp }) => { commit(it, inp); });
    if (list.contains(document.activeElement)) document.activeElement.blur();
    onClose?.();
  } });
}

/** Settings, as a section of the More page. */
function settingsPanel() {
  const c = h(`<section class="settings" aria-labelledby="set-h"><h3 class="st-h" id="set-h">Settings</h3>
    <div class="set-card">
      <div class="set-row"><span id="set-theme">Appearance</span><div class="seg three" role="group" aria-labelledby="set-theme">
        ${[['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<button data-theme-opt="${k}">${l}</button>`).join('')}</div></div>
      <div class="set-row opt"><span id="set-tint">Colour backgrounds<small>Each item's card, and each new look, takes a soft tint of its colours</small></span><button class="switch" role="switch" data-a="tint" aria-labelledby="set-tint"></button></div>
    </div>
    <div class="set-card">
      <button class="set-link" data-a="mixrows">${svg('layers')}<span>Mix rows<small>${mix.rows.map((r) => esc(CATS[r.cat].label)).join(' · ')}</small></span>${svg('chev', 'class="go"')}</button>
    </div>
    <div class="set-card">
      <button class="set-link" data-a="exp">${svg('download')}<span>Backup</span></button>
      <button class="set-link" data-a="imp">${svg('upload')}<span>Restore a backup</span></button>
      <button class="set-link danger" data-a="wipe">${svg('trash')}<span>Clear everything</span></button>
    </div>
  </section>`);
  const sync = () => {
    $$('[data-theme-opt]', c).forEach((b) => { const on = b.dataset.themeOpt === prefs.theme; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    const t = $('[data-a=tint]', c); t.classList.toggle('on', prefs.tint); t.setAttribute('aria-checked', String(prefs.tint));
  };
  // items are drawn with a different sticker edge on dark, so the pages are drawn again
  // applyPrefs draws the More page again: focus (and VoiceOver) stays on the control just used, in the new panel
  const refocus = (q) => $(`#view-more ${q}`)?.focus({ preventScroll: true });
  $$('[data-theme-opt]', c).forEach((b) => press(b, { tap: () => { prefs.theme = b.dataset.themeOpt; applyPrefs(); sync(); refocus(`[data-theme-opt="${prefs.theme}"]`); }, hapticTap: 'select' }));
  press($('[data-a=tint]', c), { tap: () => { prefs.tint = !prefs.tint; applyPrefs(); sync(); refocus('[data-a=tint]'); }, hapticTap: 'select' });
  sync();
  press($('[data-a=mixrows]', c), { tap: () => openMixRows() });
  press($('[data-a=exp]', c), { tap: exportData });
  press($('[data-a=imp]', c), { tap: () => { const f = $('#file-import'); f.value = ''; f.onchange = () => f.files[0] && importData(f.files[0]); f.click(); } });
  press($('[data-a=wipe]', c), { tap: async () => {
    if (!(await confirmSheet('Clear everything?', 'All items and looks will be deleted.', 'Clear'))) return;
    await db.clear('items'); await db.clear('outfits');
    try { localStorage.removeItem(BRANDS_KEY); } catch { /* nothing kept */ }
    state.items = []; state.outfits = []; resetMix(); imgCache.clear(); resetClosetFilters(); render(); toast('Cleared');
  } });
  return c;
}

async function exportData() {
  const blob = new Blob([JSON.stringify({ version: 2, exported: new Date().toISOString(), items: state.items, outfits: state.outfits })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `my-closet-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  // in the iOS app the file goes to the share sheet, which speaks for itself
  haptic('success'); if (!inApp()) toast('Backup saved');
}
async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    for (const it of data.items || []) { if ((data.version || 1) < 2) toOuter(it); await db.put('items', it); }
    for (const o of data.outfits || []) await db.put('outfits', o);
    await load(); render();
    haptic('success'); toast(`Restored ${data.items?.length || 0} items`);
    edgeOlderPieces();
  } catch { haptic('warning'); toast('File could not be read'); }
}

/* ------------------------------------------------------------------ boot */

/** Gives older pieces their soft-edged picture (made from the white-edged one), a piece at a time, without holding anything up. */
let edging = false;
let edgeAgain = false;
async function edgeOlderPieces() {
  if (edging) { edgeAgain = true; return; }
  edging = true;
  const done = new Set();
  try {
    for (const it of [...state.items]) {
      if (it.stickerDark || !it.sticker) continue;
      try {
        const url = await retintSticker(it.sticker, EDGE_DARK);
        const cur = itemById(it.id);
        if (!url || !cur || cur.sticker !== it.sticker || cur.stickerDark) continue; // edited or deleted meanwhile
        cur.stickerDark = url;
        await db.put('items', cur);
        done.add(cur.id);
        if (isDark()) $$(`img[data-st="${CSS.escape(cur.id)}"]`).forEach((img) => { img.src = url; });
      } catch { /* this one keeps its white edge */ }
      await pause(40);
    }
    // looks on a dark board were drawn with the white edge: draw those again
    for (const o of done.size ? [...state.outfits] : []) {
      if (!darkBoard(o.board) || !o.pieces.some((p) => done.has(p.itemId))) continue;
      try {
        const thumb = await renderThumb(o, await lookSize(o));
        if (state.outfits.find((x) => x.id === o.id) !== o) continue; // edited, deleted or restored meanwhile
        o.thumb = thumb;
        await db.put('outfits', o);
        $$(`#view-outfits .look[data-id="${CSS.escape(o.id)}"] img.thumb`).forEach((img) => { img.src = thumb; });
      } catch { /* keeps its old picture */ }
    }
  } finally {
    edging = false;
    if (edgeAgain) { edgeAgain = false; edgeOlderPieces(); }
  }
}

function toOuter(it) {
  if (it?.cat !== 'top' || !OUTER_SUBS.has(it.sub)) return false;
  it.cat = 'outer';
  return true;
}

async function load() {
  const [items, outfits] = await Promise.all([db.all('items'), db.all('outfits')]);
  state.items = items || [];
  state.outfits = outfits || [];
  // wash marks older than a week have lifted
  for (const it of state.items) if (it.wash && !inWash(it)) { delete it.wash; db.put('items', it).catch(() => {}); }
  // Outerwear arrived after some jackets and coats were filed under Tops: move those once
  let moved = false;
  try { moved = localStorage.getItem('closet.outer') === '1'; } catch { /* moved again next time, harmlessly */ }
  if (!moved) {
    for (const it of state.items) if (toOuter(it)) db.put('items', it).catch(() => {});
    try { localStorage.setItem('closet.outer', '1'); } catch { /* see above */ }
  }
}

function bindChrome() {
  $$('.tab[data-view]').forEach((t) => press(t, {
    tap: () => setView(t.dataset.view),
    long: t.dataset.view === 'mix' ? null : t.dataset.view === 'more' ? () => openPrices() : t.dataset.view === 'closet' ? (e) => contextMenu(t, 'Closet', CAT_ORDER.map((k) => ({ icon: k, label: CATS[k].label, run: () => { state.filterCat = k; state.filterSub = null; if (state.view !== 'closet') setView('closet'); else renderCloset(); } })), e)
      : (e) => contextMenu(t, 'Looks', [
        { icon: 'plus', label: 'New look', run: () => openEditor() },
        { icon: 'sparkle', label: 'Surprise me', run: surpriseLook },
      ], e),
    hapticTap: 'select',
  }));
  const fab = $('#fab');
  press(fab, {
    // the + offers the two things there are to make
    tap: (e) => contextMenu(fab, null, [
      { icon: 'top', label: 'Add clothes', run: () => openAdd() },
      { icon: 'look', label: 'Create a look', run: () => openEditor() },
    ], e),
    // held down: the shortcuts
    long: (e) => contextMenu(fab, null, [
      { icon: 'camera', label: 'Take photo', run: () => quickPick('camera') },
      { icon: 'image', label: 'Choose photos', run: () => quickPick('library') },
      { icon: 'look', label: 'Create a look', run: () => openEditor() },
      { icon: 'sparkle', label: 'Surprise me', run: surpriseLook },
    ], e),
    hapticTap: null, // the menu gives its own
  });
  press($('#select-btn'), { tap: () => (sel.on ? endSelect() : startSelect()), hapticTap: 'select' });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sel.on && !stack.length && !menuOpen) { endSelect(); return; }
    if (e.key !== 'Escape' || !stack.length) return;
    const top = stack[stack.length - 1];
    (top.dismiss || top.close)(); // a sheet can ask before it closes (the batch sheet does)
  });
}

/**
 * Shortcuts from outside the page: the iOS app's home-screen quick actions call window.closetAction(name), and an
 * installed web app's shortcuts open the page with #action=name. Ignored while something is open on screen.
 */
function closetAction(name) {
  if (stack.length || menuOpen) return false;
  const run = { add: () => openAdd(), look: () => openEditor(), surprise: () => surpriseLook(), mix: () => setView('mix'), more: () => setView('more'), stats: () => setView('more'), closet: () => setView('closet'), looks: () => setView('outfits') }[name];
  if (!run) return false;
  run();
  return true;
}
window.closetAction = closetAction;
function actionFromHash() {
  const m = /(?:^#|&)action=([a-z]+)/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search); // once only
  closetAction(m[1]);
}

/** Items sway a little while the closet scrolls, and settle when it stops. */
function swayOnScroll() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  let lastY = window.scrollY, lastT = performance.now(), cur = 0, target = 0, raf = 0;
  // only the tiles on screen sway (and are restyled each frame), not every tile in a large closet
  const root = $('#view-closet'), inView = new Set();
  const io = new IntersectionObserver((es) => es.forEach(({ target, isIntersecting }) => {
    if (isIntersecting) inView.add(target);
    else { inView.delete(target); target.style.removeProperty('--sway'); }
  }));
  const watch = () => { io.disconnect(); inView.clear(); root.querySelectorAll('.piece').forEach((t) => io.observe(t)); };
  watch();
  new MutationObserver(watch).observe(root, { childList: true }); // the grid is drawn again as a whole
  const put = (v) => inView.forEach((t) => t.style.setProperty('--sway', v));
  const tick = () => {
    cur += (target - cur) * 0.18;
    target *= 0.86; // the push fades: it springs back when the scrolling stops
    put(cur.toFixed(3) + 'deg');
    raf = Math.abs(cur) > 0.02 || Math.abs(target) > 0.02 ? requestAnimationFrame(tick) : 0;
    if (!raf) put('0deg');
  };
  window.addEventListener('scroll', () => {
    if (state.view !== 'closet') return;
    const now = performance.now(), dy = window.scrollY - lastY, dt = Math.max(8, now - lastT);
    lastY = window.scrollY; lastT = now;
    target = Math.max(-4, Math.min(4, target + (dy / dt) * 1.6));
    if (!raf) raf = requestAnimationFrame(tick);
  }, { passive: true });
}

function quickPick(kind) {
  const input = kind === 'camera' ? $('#file-camera') : $('#file-library');
  input.value = '';
  if (kind === 'library') input.multiple = true;
  input.onchange = () => {
    const files = [...(input.files || [])];
    if (files.length > 1) openBatch(files, state.filterCat !== 'all' ? state.filterCat : null);
    else if (files[0]) openAdd({ source: files[0], kind });
  };
  input.click();
}

(async function boot() {
  applyPrefs(false);
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => { applyPrefs(false); render(); });
  bindChrome();
  await load();
  render();
  if (nativeChrome()) document.documentElement.classList.add('native-bar');
  swayOnScroll();
  postChrome();
  setTimeout(edgeOlderPieces, 900);
  actionFromHash();
  window.addEventListener('hashchange', actionFromHash);
  moveTabInd();
  window.addEventListener('resize', moveTabInd);
  document.fonts?.ready?.then(moveTabInd);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();

// exposed for debugging / tests
window.__closet = { state, mix, openAdd, openEditor, suggestLook, pairScore, layoutLook, eraseTarget, autoBoard, edgeFor };

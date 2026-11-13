import { db, uid } from './db.js';
import { haptic, setHaptics, hapticsEnabled } from './haptics.js';
import { loadImage, rasterize, computeMask, renderSticker, renderMaskPreview } from './cutout.js';
import { harmonies, INSPIRATION, colorName, closeness, textOn, hexToHsl } from './color.js';

/* ------------------------------------------------------------------ data */

const CATS = {
  top: { label: 'Tops', subs: ['T-shirts', 'Shirts', 'Blouses', 'Knits', 'Hoodies', 'Tanks', 'Jackets', 'Coats', 'Dresses'] },
  bottom: { label: 'Bottoms', subs: ['Jeans', 'Trousers', 'Shorts', 'Skirts', 'Leggings', 'Sweatpants'] },
  shoes: { label: 'Shoes', subs: ['Sneakers', 'Boots', 'Loafers', 'Heels', 'Flats', 'Sandals'] },
  acc: { label: 'Accessories', subs: ['Bags', 'Hats', 'Jewelry', 'Belts', 'Scarves', 'Sunglasses', 'Watches'] },
};
const CAT_ORDER = ['top', 'bottom', 'shoes', 'acc'];
const BOARD_COLORS = ['#f7f3ec', '#eef0e8', '#f3ebe6', '#eaeef0', '#efebf2', '#2e2b28'];

const ICON = {
  top: '<path d="M8 4 3.5 6.5l1.8 3.6L7.5 9v11h9V9l2.2 1.1 1.8-3.6L16 4c-.6 1.4-2.2 2.3-4 2.3S8.6 5.4 8 4z"/>',
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
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.8 0-1-.9-1.4-.9-2.4 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/>',
  look: '<rect x="3.5" y="3.5" width="7" height="9" rx="2"/><rect x="13.5" y="3.5" width="7" height="5" rx="2"/><rect x="13.5" y="11.5" width="7" height="9" rx="2"/><rect x="3.5" y="15.5" width="7" height="5" rx="2"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  eraser: '<path d="m4 15 9-9 7 7-6 6H8zM9 10l7 7M8 20h12"/>',
  undo: '<path d="M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  swatch: '<circle cx="12" cy="12" r="8"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  sparkle: '<path d="M12 3c.6 4.4 2.6 6.4 7 7-4.4.6-6.4 2.6-7 7-.6-4.4-2.6-6.4-7-7 4.4-.6 6.4-2.6 7-7z"/>',
};
const svg = (name, extra = '') => `<svg viewBox="0 0 24 24" ${extra}>${ICON[name] || ''}</svg>`;

const state = {
  items: [],
  outfits: [],
  settings: { currency: '$', haptics: true },
  view: 'closet',
  filterCat: 'all',
  filterSub: null,
  paletteBase: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => {
  const v = Number(n) || 0;
  const s = v % 1 === 0 ? v.toLocaleString() : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return state.settings.currency + s;
};
const itemById = (id) => state.items.find((i) => i.id === id);
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

function sheet(content, { full = false, onClose } = {}) {
  const scrim = h('<div class="scrim"></div>');
  const el = h(`<div class="sheet ${full ? 'full' : ''}">${full ? '' : '<div class="grabber"></div>'}</div>`);
  el.append(content);
  layer.append(scrim, el);
  requestAnimationFrame(() => requestAnimationFrame(() => { scrim.classList.add('show'); el.classList.add('show'); }));
  let closed = false;
  const api = {
    el,
    close() {
      if (closed) return; closed = true;
      stack.splice(stack.indexOf(api), 1);
      scrim.classList.remove('show'); el.classList.remove('show');
      el.style.transform = '';
      setTimeout(() => { scrim.remove(); el.remove(); }, 520);
      onClose?.();
      syncTabbar();
    },
  };
  if (!full) scrim.addEventListener('click', () => api.close());
  // drag-to-dismiss from the grabber zone
  if (!full) {
    let y0 = null, dy = 0;
    el.addEventListener('pointerdown', (e) => {
      const r = el.getBoundingClientRect();
      if (e.clientY - r.top > 44 || el.scrollTop > 0) return;
      y0 = e.clientY; dy = 0; el.style.transition = 'none';
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (y0 === null) return;
      dy = Math.max(0, e.clientY - y0);
      el.style.transform = `translateY(${dy}px)`;
    });
    const end = () => {
      if (y0 === null) return;
      el.style.transition = ''; y0 = null;
      if (dy > 110) { haptic('light'); api.close(); } else el.style.transform = '';
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
  stack.push(api);
  syncTabbar();
  return api;
}

function syncTabbar() {
  $('#tabbar').classList.toggle('hidden', stack.some((s) => s.el.classList.contains('full')));
}

function contextMenu(anchor, title, actions, point) {
  haptic('medium');
  const scrim = h('<div class="scrim"></div>');
  const menu = h(`<div class="ctx">${title ? `<div class="ctx-title">${esc(title)}</div>` : ''}</div>`);
  let preview = null;
  const r = anchor?.getBoundingClientRect?.();
  if (anchor && r && r.width < window.innerWidth * 0.8 && r.height < window.innerHeight * 0.6) {
    preview = anchor.cloneNode(true);
    preview.classList.add('ctx-preview');
    preview.classList.remove('pressing', 'long-fired', 'sel');
    Object.assign(preview.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: 0, animation: 'none', transform: anchor.style.transform || '' });
  }
  for (const a of actions) {
    const b = h(`<button class="${a.danger ? 'danger' : ''}">${svg(a.icon)}<span>${esc(a.label)}</span></button>`);
    b.addEventListener('click', () => { haptic(a.danger ? 'warning' : 'select'); close(); setTimeout(() => a.run(), 120); });
    menu.append(b);
  }
  layer.append(scrim);
  if (preview) layer.append(preview);
  layer.append(menu);
  // position
  const mw = 230, mh = actions.length * 46 + (title ? 34 : 12);
  let x, y;
  if (r && preview) {
    x = Math.min(Math.max(12, r.left + r.width / 2 - mw / 2), window.innerWidth - mw - 12);
    y = r.bottom + 10;
    if (y + mh > window.innerHeight - 20) y = Math.max(12, r.top - mh - 10);
    if (y < 12) y = 12;
  } else {
    const px = point?.clientX ?? window.innerWidth / 2, py = point?.clientY ?? window.innerHeight / 2;
    x = Math.min(Math.max(12, px - mw / 2), window.innerWidth - mw - 12);
    y = Math.min(Math.max(12, py - mh - 16), window.innerHeight - mh - 12);
  }
  Object.assign(menu.style, { left: x + 'px', top: y + 'px', transformOrigin: `${r ? '50%' : '50%'} ${r && y < r.top ? '100%' : '0%'}` });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    scrim.classList.add('show'); menu.classList.add('show');
    if (preview) preview.style.transform = (anchor.style.transform || '') + ' scale(1.04)';
  }));
  function close() {
    scrim.classList.remove('show'); menu.classList.remove('show');
    if (preview) preview.style.transform = anchor.style.transform || '';
    setTimeout(() => { scrim.remove(); menu.remove(); preview?.remove(); }, 380);
  }
  scrim.addEventListener('click', close);
  scrim.addEventListener('contextmenu', (e) => { e.preventDefault(); close(); });
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
}

function confirmSheet(title, text, okLabel = 'Delete') {
  return new Promise((resolve) => {
    const c = h(`<div><h2>${esc(title)}</h2><p class="sub">${esc(text)}</p>
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
  $$('.tab[data-view]').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
  $$('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + v));
  const title = $('#view-title');
  title.classList.add('swap');
  setTimeout(() => { title.textContent = $('#view-' + v).dataset.title; title.classList.remove('swap'); }, 200);
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function greeting() {
  const hr = new Date().getHours();
  const g = hr < 5 ? 'still up' : hr < 12 ? 'good morning' : hr < 17 ? 'good afternoon' : hr < 22 ? 'good evening' : 'good night';
  $('#greeting').textContent = g;
}

function render() {
  if (state.view === 'closet') renderCloset();
  if (state.view === 'outfits') renderOutfits();
  if (state.view === 'palette') renderPalette();
}

/* ------------------------------------------------------------------ closet view */

// Names a piece from its main colour and what it is: "Sage knit", "Denim jeans", "Beige accessory".
const SINGULAR = { 'T-shirts': 't-shirt', Shirts: 'shirt', Blouses: 'blouse', Knits: 'knit', Hoodies: 'hoodie', Tanks: 'tank', Jackets: 'jacket', Coats: 'coat', Dresses: 'dress', Skirts: 'skirt', Bags: 'bag', Hats: 'hat', Belts: 'belt', Scarves: 'scarf', Watches: 'watch' };
const CAT_NOUN = { top: 'top', bottom: 'bottoms', shoes: 'shoes', acc: 'accessory' };
function autoName(colors, cat, sub) {
  const noun = sub ? (SINGULAR[sub] || sub.toLowerCase()) : (CAT_NOUN[cat] || 'piece');
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
  const t = totals();
  const maxN = Math.max(1, ...CAT_ORDER.map((c) => t.by[c].n));
  const nLooks = state.outfits.length;
  const tally = h(`<button class="tally" aria-label="Open the tally">
      <div><div class="label">in your closet</div><div class="value">${t.n} piece${t.n === 1 ? '' : 's'}</div>
      <div class="count">${nLooks ? `${nLooks} look${nLooks === 1 ? '' : 's'} styled` : 'no looks yet'}</div></div>
      <div class="tally-bars">${CAT_ORDER.map((c) => `<i style="height:${8 + 36 * (t.by[c].n / maxN)}px"></i>`).join('')}</div>
    </button>`);
  press(tally, { tap: openTally, long: openTally });
  root.append(tally);

  // category chips
  const chips = h('<div class="chips"></div>');
  const mk = (key, label) => {
    const count = key === 'all' ? state.items.length : state.items.filter((i) => i.cat === key).length;
    const c = h(`<button class="chip ${state.filterCat === key ? 'active' : ''}">${label}${count ? ` <span style="opacity:.5">${count}</span>` : ''}</button>`);
    press(c, {
      tap: () => { state.filterCat = key; state.filterSub = null; renderCloset(); },
      long: key === 'all' ? null : (e) => contextMenu(c, CATS[key].label, [
        { icon: 'plus', label: `Add ${CATS[key].label.toLowerCase()}`, run: () => openAdd({ cat: key }) },
        { icon: 'look', label: 'Start a look with these', run: () => { state.filterCat = key; openEditor(); } },
      ], e),
      hapticTap: 'select',
    });
    return c;
  };
  chips.append(mk('all', 'All'));
  CAT_ORDER.forEach((k) => chips.append(mk(k, CATS[k].label)));
  root.append(chips);

  const subs = h(`<div class="subchips ${state.filterCat !== 'all' ? 'open' : ''}"><div class="chips"></div></div>`);
  if (state.filterCat !== 'all') {
    const used = new Set(state.items.filter((i) => i.cat === state.filterCat).map((i) => i.sub).filter(Boolean));
    const list = [...new Set([...CATS[state.filterCat].subs.filter((s) => used.has(s)), ...used])];
    const row = $('.chips', subs);
    if (!list.length) row.append(h('<span style="font-size:13px;color:var(--ink-3);padding:6px 4px">no subcategories yet</span>'));
    list.forEach((s) => {
      const c = h(`<button class="chip small ${state.filterSub === s ? 'active' : ''}">${esc(s)}</button>`);
      press(c, { tap: () => { state.filterSub = state.filterSub === s ? null : s; renderCloset(); }, hapticTap: 'select' });
      row.append(c);
    });
  }
  root.append(subs);

  const items = state.items
    .filter((i) => state.filterCat === 'all' || i.cat === state.filterCat)
    .filter((i) => !state.filterSub || i.sub === state.filterSub)
    .sort((a, b) => b.created - a.created);

  if (!state.items.length) {
    const e = h(`<div class="empty"><div class="orb"></div><h3>a quiet, empty closet</h3>
      <p>Photograph a piece on a light, plain background — it’ll become a little sticker here.</p>
      <button class="btn">${svg('plus')} add your first piece</button></div>`);
    press($('.btn', e), { tap: () => openAdd() });
    root.append(e);
    return;
  }
  if (!items.length) {
    root.append(h('<div class="empty"><h3>nothing here yet</h3><p>Long-press a category to add straight into it.</p></div>'));
    return;
  }
  const grid = h('<div class="grid"></div>');
  items.forEach((it, idx) => {
    const card = h(`<button class="piece" style="animation-delay:${Math.min(idx, 12) * 35}ms">
      <img class="sticker" src="${it.sticker}" alt="${esc(it.name)}" loading="lazy" />
      <div class="meta"><span class="name">${esc(it.name)}</span></div>
      <div class="dots">${(it.colors || []).map((c) => `<i style="background:${c}"></i>`).join('')}</div></button>`);
    press(card, { tap: () => openDetail(it), long: (e) => itemMenu(it, card, e) });
    grid.append(card);
  });
  root.append(grid);
}

function itemMenu(it, anchor, e) {
  contextMenu(anchor, it.name, [
    { icon: 'edit', label: 'Edit details', run: () => openAdd({ item: it }) },
    { icon: 'look', label: 'Style a look with this', run: () => openEditor(null, [it.id]) },
    { icon: 'palette', label: 'Colours that match', run: () => { state.paletteBase = it.colors?.[0]; setView('palette'); } },
    { icon: 'copy', label: 'Duplicate', run: () => duplicateItem(it) },
    { icon: 'trash', label: 'Delete', danger: true, run: () => deleteItem(it) },
  ], e);
}

async function duplicateItem(it) {
  const copy = { ...it, id: uid(), created: Date.now(), name: it.name + ' (copy)' };
  await db.put('items', copy);
  state.items.push(copy);
  haptic('success'); toast('duplicated');
  render();
}

async function deleteItem(it) {
  if (!(await confirmSheet('Let it go?', `“${it.name}” will be removed from your closet.`))) return;
  await db.del('items', it.id);
  state.items = state.items.filter((i) => i.id !== it.id);
  toast('removed'); render();
}

/* ------------------------------------------------------------------ item detail */

function openDetail(it) {
  const outfitsWith = state.outfits.filter((o) => o.pieces.some((p) => p.itemId === it.id));
  const c = h(`<div>
    <div class="detail-img"><img src="${it.sticker}" alt="" /></div>
    <h2>${esc(it.name)}</h2>
    <p class="sub">${esc(CATS[it.cat]?.label || '')}${it.sub ? ' · ' + esc(it.sub) : ''}</p>
    <div class="kv">
      <div><small>in looks</small><b>${outfitsWith.length}</b></div>
      <div><small>added</small><b>${new Date(it.created).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</b></div>
    </div>
    <div class="field"><span class="field-label">colours</span><div class="swatches">${(it.colors || []).map((c) => `<button class="sw" data-c="${c}" style="background:${c}" aria-label="${colorName(c)}"></button>`).join('')}</div></div>
    <div class="row-btns" style="margin-bottom:10px"><button class="btn soft" data-a="edit">${svg('edit')} Edit</button><button class="btn" data-a="look">${svg('look')} Style it</button></div>
    <button class="btn ghost block" data-a="del">${svg('trash')} Delete</button>
  </div>`);
  const s = sheet(c);
  $$('.sw', c).forEach((b) => press(b, {
    tap: () => toast(`${colorName(b.dataset.c)} · ${b.dataset.c}`),
    long: () => { s.close(); state.paletteBase = b.dataset.c; setView('palette'); },
  }));
  press($('[data-a=edit]', c), { tap: () => { s.close(); openAdd({ item: it }); } });
  press($('[data-a=look]', c), { tap: () => { s.close(); openEditor(null, [it.id]); } });
  press($('[data-a=del]', c), { tap: () => { s.close(); deleteItem(it); } });
}

/* ------------------------------------------------------------------ add / edit flow */

async function openAdd({ item = null, cat = null, source = null } = {}) {
  const st = {
    original: item?.original || null,
    raster: null,
    tolerance: item?.cut?.tolerance ?? 32,
    seeds: item?.cut?.seeds ? [...item.cut.seeds] : [],
    removeBg: item?.cut?.removeBg ?? true,
    erasing: false,
    result: item ? { dataURL: item.sticker, colors: item.colors } : null,
    cat: item?.cat || cat || (state.filterCat !== 'all' ? state.filterCat : 'top'),
    sub: item?.sub || (state.filterSub ?? null),
    name: item?.name || '',
    price: item?.price ?? '',
    customSubs: [],
  };

  const c = h(`<div>
    <div class="sheet-head"><h2>${item ? 'edit piece' : 'new piece'}</h2></div>
    <div data-step="photo"></div>
    <div data-step="details"></div>
  </div>`);
  const s = sheet(c);

  const photo = $('[data-step=photo]', c);
  const details = $('[data-step=details]', c);

  function renderPick() {
    photo.innerHTML = '';
    const p = h(`<div class="pick">
      <div class="pick-btns">
        <button class="btn" data-a="cam">${svg('camera')}<span>take photo</span></button>
        <button class="btn soft" data-a="lib">${svg('image')}<span>choose photos</span></button>
      </div>
      <div class="tip"><span class="sun">${svg('sun')}</span><span><b>For the cleanest cut-out</b>, lay the piece flat on a light, plain background (a bedsheet, floor or wall), in soft even light, with a little space around it.</span></div>
      <div class="tip many"><span class="sun">${svg('look')}</span><span><b>Adding lots?</b> Choose several photos at once and they’ll all be cut out and added together.</span></div>
    </div>`);
    press($('[data-a=cam]', p), { tap: () => pickFile('camera') });
    press($('[data-a=lib]', p), { tap: () => pickFile('library') });
    photo.append(p);
    details.innerHTML = '';
  }

  function pickFile(kind) {
    const input = kind === 'camera' ? $('#file-camera') : $('#file-library');
    input.value = '';
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
      haptic('warning'); toast('that photo could not be read');
      if (!st.raster && !item) renderPick();
      return;
    }
    st.original = shot.original;
    st.raster = shot.raster;
    st.seeds = [];
    renderStage();
    await process();
    renderDetails();
  }

  let stageEl, busyTimer;
  function renderStage() {
    photo.innerHTML = '';
    stageEl = h(`<div><div class="stage"><div class="busy"><div class="spinner"></div></div></div>
      <div class="stage-tools">
        <button class="chip" data-a="bg"><span class="switch ${st.removeBg ? 'on' : ''}" style="transform:scale(.7);margin:-6px -4px"></span>remove background</button>
        <button class="chip" data-a="erase">${svg('eraser')} tap to erase</button>
        <button class="chip" data-a="undo">${svg('undo')} undo</button>
        <button class="chip" data-a="re">${svg('image')} new photo</button>
      </div>
      <div class="slider-row" data-a="tol-row"><span>gentle</span><input type="range" min="6" max="80" value="${st.tolerance}" /><span>strong</span></div></div>`);
    photo.append(stageEl);
    const stage = $('.stage', stageEl);
    const bgBtn = $('[data-a=bg]', stageEl);
    press(bgBtn, { tap: async () => { st.removeBg = !st.removeBg; $('.switch', bgBtn).classList.toggle('on', st.removeBg); syncTools(); await process(); } });
    const eraseBtn = $('[data-a=erase]', stageEl);
    press(eraseBtn, {
      tap: () => { st.erasing = !st.erasing; eraseBtn.classList.toggle('active', st.erasing); if (st.erasing) toast('tap any leftover background'); showStage(); },
      long: async () => { st.seeds = []; toast('erase marks cleared'); await process(); },
    });
    press($('[data-a=undo]', stageEl), { tap: async () => { if (st.seeds.length) { st.seeds.pop(); await process(); } else toast('nothing to undo'); } });
    press($('[data-a=re]', stageEl), { tap: () => pickFile('library'), long: (e) => contextMenu($('[data-a=re]', stageEl), 'new photo', [
      { icon: 'camera', label: 'Take photo', run: () => pickFile('camera') },
      { icon: 'image', label: 'Choose photo', run: () => pickFile('library') },
    ], e) });
    const range = $('input[type=range]', stageEl);
    let lastTick = 0;
    range.addEventListener('input', () => {
      st.tolerance = +range.value;
      if (Math.abs(st.tolerance - lastTick) >= 4) { haptic('light'); lastTick = st.tolerance; }
      clearTimeout(busyTimer); busyTimer = setTimeout(process, 140);
    });
    stage.addEventListener('click', async (e) => {
      if (!st.erasing || !st.removeBg) return;
      const target = $('canvas', stage);
      if (!target) return;
      const r = target.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width, ny = (e.clientY - r.top) / r.height;
      if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return;
      haptic('select');
      st.seeds.push([nx, ny]);
      await process();
    });
    syncTools();
  }
  function syncTools() {
    if (!stageEl) return;
    $('[data-a=erase]', stageEl).style.display = st.removeBg ? '' : 'none';
    $('[data-a=undo]', stageEl).style.display = st.removeBg ? '' : 'none';
    $('[data-a=tol-row]', stageEl).style.display = st.removeBg ? '' : 'none';
    if (!st.removeBg) { st.erasing = false; $('[data-a=erase]', stageEl).classList.remove('active'); }
  }

  let mask = null;
  async function process() {
    if (!st.raster) return;
    const stage = $('.stage', stageEl);
    stage.classList.add('loading');
    await new Promise((r) => setTimeout(r, 30));
    mask = computeMask(st.raster, st.tolerance, st.seeds);
    st.result = renderSticker(st.raster, mask, { removeBg: st.removeBg });
    stage.classList.remove('loading');
    showStage();
    syncSwatches();
  }
  function showStage() {
    const stage = $('.stage', stageEl);
    stage.classList.toggle('erasing', st.erasing);
    $$('img, canvas', stage).forEach((n) => n.remove());
    if (st.erasing && mask) {
      const cv = renderMaskPreview(st.raster, mask);
      stage.prepend(cv);
    } else if (st.result) {
      stage.prepend(h(`<img src="${st.result.dataURL}" alt="" />`));
    }
  }

  function renderDetails() {
    details.innerHTML = '';
    const d = h(`<div>
      <div class="field"><label>category</label><div class="seg">${CAT_ORDER.map((k) => `<button data-cat="${k}" class="${st.cat === k ? 'active' : ''}">${svg(k)}${CATS[k].label}</button>`).join('')}</div></div>
      <div class="field"><label>type</label><div class="wrap-chips" data-subs></div></div>
      <div class="field"><label>name</label><input class="input" data-name placeholder="e.g. Linen shirt" value="${esc(st.name)}" maxlength="40" /></div>
      ${item ? '' : `<div class="field"><label>price <span style="text-transform:none;letter-spacing:0">(optional — or add it later in the tally)</span></label><div class="price-wrap"><span>${esc(state.settings.currency)}</span><input class="input" data-price inputmode="decimal" placeholder="0" value="" /></div></div>`}
      <div class="field"><label>colours found</label><div class="swatches" data-sw></div></div>
      <button class="btn sage block" data-a="save">${svg('check')} ${item ? 'save changes' : 'add to closet'}</button>
    </div>`);
    details.append(d);
    $$('[data-cat]', d).forEach((b) => press(b, { tap: () => {
      st.cat = b.dataset.cat; st.sub = null;
      $$('[data-cat]', d).forEach((x) => x.classList.toggle('active', x === b));
      renderSubs();
    }, hapticTap: 'select' }));
    const name = $('[data-name]', d); name.addEventListener('input', () => { st.name = name.value; });
    const price = $('[data-price]', d);
    if (price) {
      price.value = st.price === null ? '' : st.price;
      price.addEventListener('input', () => { price.value = cleanPrice(price.value); st.price = price.value; });
    }
    press($('[data-a=save]', d), { tap: save, hapticTap: null });
    renderSubs();
    syncSwatches();
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
      press(b, { tap: () => { st.sub = st.sub === sname ? null : sname; renderSubs(); }, hapticTap: 'select' });
      wrap.append(b);
    });
    const add = h('<button class="chip small add">+ custom</button>');
    press(add, { tap: () => {
      const inp = h('<input class="input" style="height:34px;width:140px;border-radius:999px;font-size:14px" placeholder="type & enter" maxlength="20" />');
      add.replaceWith(inp); inp.focus();
      const done = () => { const v = inp.value.trim(); if (v) { st.customSubs.push(v); st.sub = v; } renderSubs(); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); });
      inp.addEventListener('blur', done);
    } });
    wrap.append(add);
  }

  function syncSwatches() {
    const sw = $('[data-sw]', details);
    if (!sw || !st.result) return;
    sw.innerHTML = (st.result.colors || []).map((c) => `<span class="sw" style="background:${c}" title="${colorName(c)}"></span>`).join('') +
      `<span style="align-self:center;font-size:13px;color:var(--ink-2);margin-left:4px">${(st.result.colors || []).map(colorName).join(', ')}</span>`;
  }

  async function save() {
    if (!st.result) { haptic('warning'); toast('add a photo first'); return; }
    const colors = st.result.colors || [];
    const rec = {
      id: item?.id || uid(),
      created: item?.created || Date.now(),
      name: (st.name || '').trim() || autoName(colors, st.cat, st.sub),
      cat: st.cat, sub: st.sub,
      price: parsePrice(st.price),
      sticker: st.result.dataURL,
      colors,
      original: st.original,
      cut: { tolerance: st.tolerance, seeds: st.seeds, removeBg: st.removeBg },
    };
    await db.put('items', rec);
    const i = state.items.findIndex((x) => x.id === rec.id);
    if (i >= 0) state.items[i] = rec; else state.items.push(rec);
    imgCache.delete(rec.id);
    haptic('success');
    toast(item ? 'saved' : 'added to your closet');
    s.close();
    if (state.view !== 'closet') setView('closet'); else render();
  }

  if (source) { renderStage(); await useFile(source); }
  else if (item?.original) {
    const img = await loadImage(item.original);
    st.raster = rasterize(img, 900);
    renderStage();
    await process();
    renderDetails();
  } else if (item) {
    // legacy item without original: show sticker only
    photo.innerHTML = `<div class="stage"><img src="${item.sticker}" alt="" /></div>`;
    renderDetails();
  } else renderPick();
}

/* ------------------------------------------------------------------ batch add */

const BATCH_MAX = 30;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Several photos picked at once: cut them all out, ask only "what is it?" for each, add them together. */
function openBatch(files, presetCat = null) {
  const images = files.filter((f) => !f.type || f.type.startsWith('image/'));
  const overflow = Math.max(0, images.length - BATCH_MAX);
  // status: wait → busy → done | fail (unreadable) | gone (removed by hand or already saved)
  const entries = images.slice(0, BATCH_MAX).map((file) => ({ file, status: 'wait', cat: presetCat, result: null, original: null, el: null }));
  let failed = files.length - images.length, cancelled = false, saving = false;

  const c = h(`<div class="batch">
    <div class="editor-top">
      <button class="round" data-a="back" aria-label="Cancel">${svg('close')}</button>
      <h2 data-title></h2>
    </div>
    <div class="batch-progress"><div class="bar"><i data-bar></i></div><span data-status></span></div>
    <div class="batch-all"><span class="field-label">they’re all</span><div class="chips">${CAT_ORDER.map((k) => `<button class="chip small" data-all="${k}">${CATS[k].label}</button>`).join('')}</div></div>
    <div class="batch-list" data-list></div>
    <div class="batch-foot">
      <button class="btn block" data-a="save"></button>
      <p class="batch-hint">names are filled in for you · edit any piece later</p>
    </div>
  </div>`);
  const s = sheet(c, { full: true });
  s.el.style.paddingBottom = '0';
  const listEl = $('[data-list]', c);
  const live = () => entries.filter((e) => e.status !== 'fail' && e.status !== 'gone');

  function paint(e) {
    if (e.status === 'fail' || e.status === 'gone') { e.el?.remove(); e.el = null; return; }
    if (!e.el) {
      e.el = h(`<div class="batch-row">
        <div class="b-thumb"><div class="spinner"></div></div>
        <div class="b-main">
          <div class="b-cats">${CAT_ORDER.map((k) => `<button data-cat="${k}" aria-label="${CATS[k].label}" title="${CATS[k].label}">${svg(k)}</button>`).join('')}</div>
          <div class="b-name"></div>
        </div>
        <button class="b-x" aria-label="Remove this photo">${svg('close')}</button>
      </div>`);
      $$('[data-cat]', e.el).forEach((b) => press(b, {
        tap: () => { e.cat = b.dataset.cat; paint(e); sync(); },
        long: () => setAll(b.dataset.cat), // long-press = this category for every photo
        hapticTap: 'select',
      }));
      press($('.b-x', e.el), { tap: () => drop(e) });
      listEl.append(e.el);
    }
    if (e.status === 'done' && !$('img', e.el)) $('.b-thumb', e.el).innerHTML = `<img src="${e.result.dataURL}" alt="" />`;
    e.el.classList.toggle('busy', e.status === 'busy');
    e.el.classList.toggle('todo', !e.cat);
    $$('[data-cat]', e.el).forEach((b) => {
      b.classList.toggle('active', b.dataset.cat === e.cat);
      b.setAttribute('aria-pressed', String(b.dataset.cat === e.cat));
    });
    $('.b-name', e.el).textContent = !e.cat ? 'what is it?'
      : e.status === 'done' ? autoName(e.result.colors, e.cat, null)
      : CATS[e.cat].label.toLowerCase();
  }

  function sync() {
    const l = live();
    const done = l.filter((e) => e.status === 'done').length, cutting = l.length - done;
    const missing = l.filter((e) => !e.cat).length;
    const pieces = `${l.length} piece${l.length === 1 ? '' : 's'}`;
    $('[data-title]', c).textContent = `add ${pieces}`;
    $('[data-bar]', c).style.width = `${l.length ? (done / l.length) * 100 : 100}%`;
    const notes = [];
    if (failed) notes.push(`${failed} couldn’t be read`);
    if (overflow) notes.push(`first ${BATCH_MAX} only`);
    $('[data-status]', c).textContent = [cutting ? `cutting out ${Math.min(done + 1, l.length)} of ${l.length}` : 'all cut out', ...notes].join(' · ');
    const btn = $('[data-a=save]', c);
    btn.className = `btn block ${!cutting && !missing ? 'sage' : 'soft'}`;
    btn.innerHTML = missing ? `pick a category for ${missing === l.length ? (l.length === 1 ? 'it' : 'each one') : `${missing} more`}`
      : cutting ? 'cutting out…'
      : `${svg('check')} add ${pieces} to closet`;
    $('.batch-all', c).style.display = l.length > 1 ? '' : 'none';
    $$('[data-all]', c).forEach((b) => b.classList.toggle('active', l.length > 0 && l.every((e) => e.cat === b.dataset.all)));
  }

  function setAll(cat) {
    live().forEach((e) => { e.cat = cat; paint(e); });
    sync();
    toast(`all set to ${CATS[cat].label.toLowerCase()}`);
  }

  function drop(e) {
    e.status = 'gone'; e.file = null; e.result = null; e.original = null;
    paint(e); sync();
    if (!live().length) { cancelled = true; s.close(); toast('nothing left to add'); }
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
    if (l.some((e) => e.status !== 'done')) { haptic('warning'); toast('still cutting out — one moment'); return; }
    saving = true;
    const now = Date.now();
    let added = 0;
    try {
      for (const e of l) {
        const rec = {
          id: uid(), created: now + added,
          name: autoName(e.result.colors, e.cat, null), cat: e.cat, sub: null, price: null,
          sticker: e.result.dataURL, colors: e.result.colors || [],
          original: e.original, cut: { tolerance: 32, seeds: [], removeBg: true },
        };
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
      toast(added ? `storage is full — added ${added} of ${l.length}` : 'storage is full — nothing was added');
      entries.forEach(paint); sync(); render();
      return;
    }
    cancelled = true;
    haptic('success');
    toast(`${added} piece${added === 1 ? '' : 's'} added to your closet`);
    s.close();
    if (state.view !== 'closet') setView('closet'); else render();
  }

  async function tryClose() {
    if (saving) return;
    const n = live().length;
    if (n && !(await confirmSheet('Leave these behind?', `None of the ${n} photo${n === 1 ? '' : 's'} will be added.`, 'Discard'))) return;
    cancelled = true;
    s.close();
  }
  s.dismiss = tryClose;

  press($('[data-a=back]', c), { tap: tryClose });
  press($('[data-a=save]', c), { tap: save, hapticTap: null });
  $$('[data-all]', c).forEach((b) => press(b, { tap: () => setAll(b.dataset.all), hapticTap: 'select' }));

  entries.forEach(paint);
  sync();
  if (overflow) toast(`adding the first ${BATCH_MAX} — do the rest in another go`);

  // cut the photos out one at a time, yielding between them so the sheet stays responsive
  (async () => {
    for (const e of entries) {
      if (cancelled) return;
      if (e.status !== 'wait') continue;
      e.status = 'busy'; paint(e); sync();
      await pause(40);
      try {
        const shot = await photoFromFile(e.file);
        if (cancelled) return;
        if (e.status === 'gone') continue;
        const mask = computeMask(shot.raster, 32, []);
        e.result = renderSticker(shot.raster, mask, { removeBg: true });
        e.original = shot.original;
        e.status = 'done';
      } catch {
        if (e.status === 'gone') continue;
        e.status = 'fail'; failed++;
      }
      e.file = null;
      paint(e); sync();
    }
    if (!cancelled && !live().length) {
      cancelled = true;
      haptic('warning'); toast('none of those photos could be read');
      s.close();
    }
  })();
}

/* ------------------------------------------------------------------ outfits view */

function outfitColors(o) {
  const out = [];
  for (const p of o.pieces) {
    const c = itemById(p.itemId)?.colors?.[0];
    if (c && out.every((x) => closeness(x, c) < 0.85)) out.push(c);
  }
  return out;
}

function renderOutfits() {
  const root = $('#view-outfits');
  root.innerHTML = '';
  const grid = h('<div class="looks"></div>');
  const nw = h(`<button class="look new"><div><div class="plus">${svg('plus')}</div><span>new look</span></div></button>`);
  press(nw, { tap: () => openEditor(), long: (e) => contextMenu(nw, 'new look', [
    { icon: 'sparkle', label: 'Surprise me', run: () => surpriseLook() },
    { icon: 'look', label: 'Blank board', run: () => openEditor() },
  ], e) });
  grid.append(nw);
  [...state.outfits].sort((a, b) => b.updated - a.updated).forEach((o, idx) => {
    const cols = outfitColors(o);
    const card = h(`<button class="look" style="animation-delay:${(idx + 1) * 40}ms">
      <img class="thumb" src="${o.thumb || ''}" alt="" />
      <div class="strip">${cols.map((c) => `<i style="background:${c}"></i>`).join('')}</div>
      <div class="meta"><div class="name">${esc(o.name)}</div>
      <div class="small"><span>${o.pieces.length} piece${o.pieces.length === 1 ? '' : 's'}</span></div></div></button>`);
    press(card, { tap: () => openEditor(o), long: (e) => contextMenu(card, o.name, [
      { icon: 'edit', label: 'Open', run: () => openEditor(o) },
      { icon: 'copy', label: 'Duplicate', run: async () => {
        const copy = { ...structuredClone(o), id: uid(), name: o.name + ' ii', updated: Date.now() };
        await db.put('outfits', copy); state.outfits.push(copy); haptic('success'); renderOutfits();
      } },
      { icon: 'trash', label: 'Delete', danger: true, run: async () => {
        if (!(await confirmSheet('Delete this look?', `“${o.name}” will be gone, your pieces stay.`))) return;
        await db.del('outfits', o.id); state.outfits = state.outfits.filter((x) => x.id !== o.id); renderOutfits();
      } },
    ], e) });
    grid.append(card);
  });
  root.append(grid);
  if (!state.outfits.length) {
    root.append(h(`<div class="empty" style="padding-top:30px"><h3>compose your first look</h3><p>${state.items.length ? 'Pick pieces from your closet and arrange them like a mood board.' : 'Add a few pieces to your closet first, then come back here to collage.'}</p></div>`));
  }
}

function surpriseLook() {
  const pick = (cat) => { const l = state.items.filter((i) => i.cat === cat); return l[Math.floor(Math.random() * l.length)]; };
  const ids = ['top', 'bottom', 'shoes', 'acc'].map(pick).filter(Boolean).map((i) => i.id);
  if (!ids.length) { toast('add some pieces first'); return; }
  openEditor(null, ids);
}

/* ------------------------------------------------------------------ outfit editor */

const imgCache = new Map();
function getImg(item) {
  if (imgCache.has(item.id)) return imgCache.get(item.id);
  const p = loadImage(item.sticker);
  imgCache.set(item.id, p);
  return p;
}

const DEFAULT_LAYOUT = {
  top: { x: 0.38, y: 0.26, w: 0.5 },
  bottom: { x: 0.42, y: 0.62, w: 0.42 },
  shoes: { x: 0.72, y: 0.86, w: 0.3 },
  acc: { x: 0.76, y: 0.42, w: 0.28 },
};

function openEditor(outfit = null, startIds = []) {
  const o = outfit ? structuredClone(outfit) : {
    id: uid(), name: 'untitled look', pieces: [], board: BOARD_COLORS[0], updated: Date.now(),
  };
  let selected = null;
  let dirty = !outfit && startIds.length > 0;

  const c = h(`<div class="editor">
    <div class="editor-top">
      <button class="round" data-a="back" aria-label="Back">${svg('back')}</button>
      <input class="input" data-name value="${esc(o.name)}" maxlength="40" />
      <button class="round dark" data-a="save" aria-label="Save">${svg('check')}</button>
    </div>
    <div class="board"><div class="hint">tap + to add pieces<br/>drag · pinch · twist</div></div>
    <div class="editor-bar">
      <button class="round dark" data-a="add" aria-label="Add pieces">${svg('plus')}</button>
      <button class="round" data-a="bg" aria-label="Board colour"><span data-bgdot style="width:22px;height:22px;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--ink-3)"></span></button>
      <button class="round" data-a="shuffle" aria-label="Tidy layout">${svg('sparkle')}</button>
      <div class="total"><small>in this look</small><b data-total>0 pieces</b></div>
    </div>
    <div class="palette-tray">
      <div class="row"><span class="lbl">in look</span><div class="pill-strip" data-in></div></div>
      <div class="row"><span class="lbl">try with</span><div class="pill-strip" data-try></div></div>
      <div class="note" data-note>tap a colour for its name · long-press to find pieces</div>
    </div>
  </div>`);
  const s = sheet(c, { full: true });
  s.el.style.paddingBottom = 'calc(14px + env(safe-area-inset-bottom, 0px))';
  const board = $('.board', c);
  const paintBoard = () => { board.style.background = o.board; $('[data-bgdot]', c).style.background = o.board; };
  paintBoard();
  const nameInp = $('[data-name]', c);
  nameInp.addEventListener('input', () => { o.name = nameInp.value; dirty = true; });

  // ----- board rendering
  const nodes = new Map(); // piece -> element
  function bsize() { const r = board.getBoundingClientRect(); return { W: r.width, H: r.height }; }
  function place(p) {
    const el = nodes.get(p); if (!el) return;
    const { W, H } = bsize();
    const w = p.w * W;
    el.style.width = w + 'px';
    const hgt = el.offsetHeight || w;
    el.style.transform = `translate(${p.x * W - w / 2}px, ${p.y * H - hgt / 2}px) rotate(${p.rot}deg) scaleX(${p.flip ? -1 : 1})`;
    el.style.zIndex = o.pieces.indexOf(p) + 1;
  }
  function addNode(p, pop = false) {
    const it = itemById(p.itemId); if (!it) return;
    const el = h(`<div class="bitem ${pop ? 'pop' : ''}"><img src="${it.sticker}" alt="" /><span class="handle">${svg('rotate')}</span></div>`);
    nodes.set(p, el);
    board.append(el);
    const img = $('img', el);
    if (img.complete) place(p); else img.onload = () => place(p);
    place(p);
    bindPiece(p, el);
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
    syncPalette();
  }
  function sync() {
    $('.hint', board).style.opacity = o.pieces.length ? 0 : 1;
    $('[data-total]', c).textContent = `${o.pieces.length} piece${o.pieces.length === 1 ? '' : 's'}`;
    syncPalette();
  }

  function addPiece(itemId, pop = true) {
    const it = itemById(itemId); if (!it) return;
    const base = DEFAULT_LAYOUT[it.cat] || { x: 0.5, y: 0.5, w: 0.36 };
    const sameCat = o.pieces.filter((p) => itemById(p.itemId)?.cat === it.cat).length;
    const p = { itemId, x: Math.min(0.85, base.x + sameCat * 0.07), y: Math.min(0.9, base.y + sameCat * 0.05), w: base.w, rot: (Math.random() - 0.5) * 8, flip: false };
    o.pieces.push(p); dirty = true;
    addNode(p, pop);
    select(p); sync();
  }
  function removePiece(p) {
    o.pieces.splice(o.pieces.indexOf(p), 1);
    nodes.get(p)?.remove(); nodes.delete(p);
    if (selected === p) select(null);
    dirty = true; sync();
  }

  // ----- gestures
  function bindPiece(p, el) {
    let pointers = new Map();
    let start = null; let longTimer = null; let moved = false;
    const handle = $('.handle', el);

    handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); handle.setPointerCapture(e.pointerId);
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
      const up = () => { handle.removeEventListener('pointermove', mv); handle.removeEventListener('pointerup', up); haptic('light'); };
      handle.addEventListener('pointermove', mv); handle.addEventListener('pointerup', up);
    });

    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (selected !== p) { select(p); haptic('select'); }
      // bring to front softly on touch
      if (pointers.size === 1) {
        moved = false;
        start = { x: p.x, y: p.y, px: e.clientX, py: e.clientY };
        clearTimeout(longTimer);
        longTimer = setTimeout(() => { if (!moved) { pointers.clear(); haptic('long'); pieceMenu(p, el, e); } }, 520);
      } else if (pointers.size === 2) {
        clearTimeout(longTimer);
        const [a, b] = [...pointers.values()];
        start = { w: p.w, rot: p.rot, d: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x), x: p.x, y: p.y, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const { W, H } = bsize();
      if (pointers.size === 1 && start && 'px' in start) {
        const dx = e.clientX - start.px, dy = e.clientY - start.py;
        if (!moved && Math.hypot(dx, dy) > 6) { moved = true; clearTimeout(longTimer); }
        if (moved) {
          p.x = Math.max(-0.1, Math.min(1.1, start.x + dx / W));
          p.y = Math.max(-0.1, Math.min(1.1, start.y + dy / H));
          place(p); dirty = true;
        }
      } else if (pointers.size === 2 && start && 'd' in start) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
        p.w = Math.max(0.08, Math.min(1.2, start.w * d / start.d));
        p.rot = snapRot(start.rot + (ang - start.ang) * 180 / Math.PI);
        p.x = start.x + ((a.x + b.x) / 2 - start.mx) / W;
        p.y = start.y + ((a.y + b.y) / 2 - start.my) / H;
        place(p); dirty = true;
      }
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      clearTimeout(longTimer);
      if (pointers.size === 1) {
        const [only] = [...pointers.values()];
        start = { x: p.x, y: p.y, px: only.x, py: only.y }; moved = true;
      } else if (pointers.size === 0) {
        if (moved) haptic('light');
        start = null;
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); clearTimeout(longTimer); pointers.clear(); pieceMenu(p, el, e); });
  }
  let lastSnap = null;
  function snapRot(r) {
    const near = Math.round(r / 45) * 45;
    if (Math.abs(r - near) < 4) { if (lastSnap !== near) { haptic('select'); lastSnap = near; } return near; }
    lastSnap = null; return r;
  }
  board.addEventListener('pointerdown', (e) => { if (e.target === board || e.target.classList.contains('hint')) select(null); });

  function pieceMenu(p, el, e) {
    const it = itemById(p.itemId);
    contextMenu(null, it?.name, [
      { icon: 'up', label: 'Bring to front', run: () => { o.pieces.push(o.pieces.splice(o.pieces.indexOf(p), 1)[0]); o.pieces.forEach(place); dirty = true; } },
      { icon: 'down', label: 'Send to back', run: () => { o.pieces.unshift(o.pieces.splice(o.pieces.indexOf(p), 1)[0]); o.pieces.forEach(place); dirty = true; } },
      { icon: 'flip', label: 'Flip', run: () => { p.flip = !p.flip; place(p); dirty = true; } },
      { icon: 'copy', label: 'Duplicate', run: () => { const q = { ...p, x: p.x + 0.05, y: p.y + 0.04 }; o.pieces.push(q); addNode(q, true); select(q); dirty = true; sync(); } },
      { icon: 'palette', label: 'Match colours', run: () => select(p) },
      { icon: 'trash', label: 'Remove from look', danger: true, run: () => removePiece(p) },
    ], e);
  }

  // ----- palette tray
  function syncPalette() {
    const inEl = $('[data-in]', c), tryEl = $('[data-try]', c);
    const cols = outfitColors(o);
    inEl.innerHTML = '';
    (cols.length ? cols : ['#e9e4d8']).forEach((col) => inEl.append(swatchBtn(col, !cols.length)));
    const base = (selected && itemById(selected.itemId)?.colors?.[0]) || cols[0];
    tryEl.innerHTML = '';
    let suggestion;
    if (base) {
      const hs = harmonies(base);
      // a gentle mix: analogous neighbour, complementary accent, tonal light, a grounding neutral
      suggestion = [hs.find((g) => g.name === 'Analogous').colors[0], hs.find((g) => g.name === 'Complementary').colors[1],
        hs.find((g) => g.name === 'Tonal').colors[3], hs.find((g) => g.name === 'Analogous').colors[2], '#6f6558'];
    } else suggestion = INSPIRATION[0].colors;
    suggestion.forEach((col) => tryEl.append(swatchBtn(col)));
  }
  function swatchBtn(col, placeholder = false) {
    const b = h(`<button style="background:${col}" aria-label="${colorName(col)}"></button>`);
    if (placeholder) return b;
    press(b, {
      tap: () => {
        const n = state.items.filter((i) => (i.colors || []).some((x) => closeness(x, col) > 0.72)).length;
        $('[data-note]', c).textContent = `${colorName(col)} · ${col}${n ? ` — ${n} piece${n === 1 ? '' : 's'} in your closet match` : ''}`;
      },
      long: () => openPicker(col),
      hapticTap: 'select',
    });
    return b;
  }

  // ----- toolbar
  press($('[data-a=add]', c), { tap: () => openPicker(), long: (e) => contextMenu($('[data-a=add]', c), 'add', CAT_ORDER.map((k) => ({ icon: k, label: CATS[k].label, run: () => openPicker(null, k) })), e) });
  const bgBtn = $('[data-a=bg]', c);
  press(bgBtn, {
    tap: () => { o.board = BOARD_COLORS[(BOARD_COLORS.indexOf(o.board) + 1) % BOARD_COLORS.length]; paintBoard(); dirty = true; },
    long: (e) => contextMenu(bgBtn, 'board colour', [
      { icon: 'swatch', label: 'Linen', run: () => setBoard('#f7f3ec') },
      { icon: 'swatch', label: 'Sage mist', run: () => setBoard('#eef0e8') },
      { icon: 'swatch', label: 'Blush clay', run: () => setBoard('#f3ebe6') },
      { icon: 'swatch', label: 'Fog blue', run: () => setBoard('#eaeef0') },
      { icon: 'swatch', label: 'Lilac', run: () => setBoard('#efebf2') },
      { icon: 'swatch', label: 'Night', run: () => setBoard('#2e2b28') },
    ], e),
  });
  function setBoard(col) { o.board = col; paintBoard(); dirty = true; }
  press($('[data-a=shuffle]', c), { tap: () => {
    // tidy: rearrange pieces into the default flat-lay arrangement
    const seen = {};
    o.pieces.forEach((p) => {
      const cat = itemById(p.itemId)?.cat; const base = DEFAULT_LAYOUT[cat] || { x: 0.5, y: 0.5, w: 0.36 };
      const n = seen[cat] = (seen[cat] || 0) + 1;
      Object.assign(p, { x: Math.min(0.85, base.x + (n - 1) * 0.08), y: Math.min(0.9, base.y + (n - 1) * 0.05), w: base.w, rot: (Math.random() - 0.5) * 6 });
      const el = nodes.get(p); el.style.transition = 'transform .7s cubic-bezier(.34,1.56,.64,1)';
      place(p); setTimeout(() => (el.style.transition = ''), 720);
    });
    haptic('success'); dirty = true;
  }, hapticTap: null });

  async function save() {
    o.name = nameInp.value.trim() || 'untitled look';
    o.updated = Date.now();
    o.thumb = await renderThumb(o, bsize());
    await db.put('outfits', o);
    const i = state.outfits.findIndex((x) => x.id === o.id);
    if (i >= 0) state.outfits[i] = o; else state.outfits.push(o);
    dirty = false;
    haptic('success'); toast('look saved');
  }
  press($('[data-a=save]', c), { tap: async () => { await save(); s.close(); setView('outfits'); renderOutfits(); }, hapticTap: null });
  press($('[data-a=back]', c), { tap: async () => {
    if (dirty && o.pieces.length) {
      const keep = await confirmSheet('Leave without saving?', 'Your arrangement will be lost.', 'Discard');
      if (!keep) return;
    }
    s.close();
  } });

  // ----- piece picker
  function openPicker(matchColor = null, onlyCat = null) {
    let cat = onlyCat || 'all';
    const pc = h(`<div><h2>${matchColor ? 'pieces that match' : 'add pieces'}</h2>
      ${matchColor ? `<p class="sub"><span class="sw" style="display:inline-block;width:14px;height:14px;vertical-align:-2px;background:${matchColor}"></span> ${colorName(matchColor)} and close tones</p>` : '<p class="sub">tap to add or remove · long-press for details</p>'}
      <div class="chips" data-c></div><div class="picker-grid" data-g></div></div>`);
    const ps = sheet(pc);
    const draw = () => {
      const chipsEl = $('[data-c]', pc); chipsEl.innerHTML = '';
      ['all', ...CAT_ORDER].forEach((k) => {
        const b = h(`<button class="chip ${cat === k ? 'active' : ''}">${k === 'all' ? 'All' : CATS[k].label}</button>`);
        press(b, { tap: () => { cat = k; draw(); }, hapticTap: 'select' });
        chipsEl.append(b);
      });
      const g = $('[data-g]', pc); g.innerHTML = '';
      let list = state.items.filter((i) => cat === 'all' || i.cat === cat);
      if (matchColor) list = list.map((i) => [i, Math.max(0, ...(i.colors || []).map((x) => closeness(x, matchColor)))]).filter(([, s]) => s > 0.55).sort((a, b) => b[1] - a[1]).map(([i]) => i);
      if (!list.length) g.append(h(`<p style="grid-column:1/-1;color:var(--ink-3);text-align:center;padding:30px 0">${state.items.length ? 'nothing here' : 'your closet is empty — add pieces first'}</p>`));
      list.forEach((it, idx) => {
        const inLook = o.pieces.some((p) => p.itemId === it.id);
        const b = h(`<button class="pick-item ${inLook ? 'in' : ''}" style="animation:pieceIn .5s ${idx * 25}ms both cubic-bezier(.22,1,.36,1)"><img src="${it.sticker}" alt="" /><span class="on">${svg('check')}</span></button>`);
        press(b, {
          tap: () => {
            const existing = o.pieces.filter((p) => p.itemId === it.id);
            if (existing.length) { existing.forEach(removePiece); b.classList.remove('in'); }
            else { addPiece(it.id); b.classList.add('in'); }
          },
          long: (e) => contextMenu(b, it.name, [
            { icon: 'plus', label: 'Add another', run: () => { addPiece(it.id); b.classList.add('in'); } },
            { icon: 'palette', label: 'Find matching pieces', run: () => { ps.close(); setTimeout(() => openPicker(it.colors?.[0]), 300); } },
          ], e),
          hapticTap: 'select',
        });
        g.append(b);
      });
    };
    draw();
  }

  requestAnimationFrame(() => {
    refreshAll();
    startIds.forEach((id) => addPiece(id));
    if (startIds.length) select(null);
    if (!o.pieces.length && state.items.length) setTimeout(() => openPicker(null, state.filterCat !== 'all' ? state.filterCat : null), 500);
  });
  const onResize = () => o.pieces.forEach(place);
  window.addEventListener('resize', onResize);
  const close0 = s.close; s.close = () => { window.removeEventListener('resize', onResize); close0(); };
}

async function renderThumb(o, { W, H }) {
  const scale = 600 / Math.max(1, W);
  const cw = 600, ch = Math.round(H * scale);
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = o.board; ctx.fillRect(0, 0, cw, ch);
  for (const p of o.pieces) {
    const it = itemById(p.itemId); if (!it) continue;
    const img = await getImg(it);
    const w = p.w * cw, hgt = w * img.naturalHeight / img.naturalWidth;
    ctx.save();
    ctx.translate(p.x * cw, p.y * ch);
    ctx.rotate(p.rot * Math.PI / 180);
    if (p.flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -w / 2, -hgt / 2, w, hgt);
    ctx.restore();
  }
  return cv.toDataURL('image/jpeg', 0.82);
}

/* ------------------------------------------------------------------ palette view */

function closetColors() {
  const all = [];
  state.items.forEach((i) => (i.colors || []).forEach((c) => { if (all.every((x) => closeness(x, c) < 0.9)) all.push(c); }));
  return all.sort((a, b) => {
    const [ha, sa, la] = hexToHsl(a), [hb, sb, lb] = hexToHsl(b);
    const na = sa < 14, nb = sb < 14;
    if (na !== nb) return na ? 1 : -1;
    return na ? lb - la : ha - hb;
  });
}

function renderPalette() {
  const root = $('#view-palette');
  root.innerHTML = '';
  const cols = closetColors();
  if (!state.paletteBase) state.paletteBase = cols[0] || '#a3b18a';
  const base = state.paletteBase;

  const head = h(`<div class="card"><div class="base-row">
      <label class="base-swatch" style="background:${base}"><input type="color" value="${base}" aria-label="Pick a base colour" /></label>
      <div><div class="base-name">${colorName(base)}</div><div class="base-hex">${base.toUpperCase()} · tap the swatch to choose any colour</div></div>
    </div></div>`);
  const picker = $('input', head);
  picker.addEventListener('change', () => { state.paletteBase = picker.value; haptic('select'); renderPalette(); });
  root.append(head);

  if (cols.length) {
    const cc = h(`<div class="card"><h3>your closet’s colours</h3><p class="hint">tap one to build harmonies around it</p><div class="closet-colors"></div></div>`);
    cols.forEach((col) => {
      const b = h(`<button class="sw ${col === base ? 'active' : ''}" style="background:${col}" aria-label="${colorName(col)}"></button>`);
      press(b, { tap: () => { state.paletteBase = col; renderPalette(); }, long: (e) => colorMenu(col, b, e), hapticTap: 'select' });
      $('.closet-colors', cc).append(b);
    });
    root.append(cc);
  }

  harmonies(base).forEach((g, gi) => {
    const card = h(`<div class="card" style="animation-delay:${gi * 50}ms"><h3>${g.name.toLowerCase()}</h3><p class="hint">${g.hint}</p><div class="harmony"></div><div class="matches"></div></div>`);
    g.colors.forEach((col) => {
      const b = h(`<button style="background:${col};color:${textOn(col)}"><span>${colorName(col)}</span></button>`);
      press(b, { tap: () => copyHex(col), long: (e) => colorMenu(col, b, e), hapticTap: 'select' });
      $('.harmony', card).append(b);
    });
    // pieces in the closet that fit this harmony
    const matches = state.items.filter((i) => i.colors?.[0] && g.colors.some((gc) => closeness(i.colors[0], gc) > 0.8)).slice(0, 12);
    matches.forEach((it) => { const im = h(`<img src="${it.sticker}" alt="${esc(it.name)}" />`); press(im, { tap: () => openDetail(it) }); $('.matches', card).append(im); });
    if (!matches.length) $('.matches', card).remove();
    root.append(card);
  });

  const insp = h('<div class="card"><h3>calm inspiration</h3><p class="hint">quiet palettes to dress around — tap to explore</p></div>');
  INSPIRATION.forEach((p) => {
    const row = h(`<div style="margin-bottom:12px"><div style="font-size:13px;color:var(--ink-2);margin:0 0 6px 2px">${p.name}</div><div class="harmony" style="height:44px"></div></div>`);
    p.colors.forEach((col) => {
      const b = h(`<button style="background:${col}"></button>`);
      press(b, { tap: () => { state.paletteBase = col; renderPalette(); window.scrollTo({ top: 0, behavior: 'smooth' }); }, long: (e) => colorMenu(col, b, e), hapticTap: 'select' });
      $('.harmony', row).append(b);
    });
    insp.append(row);
  });
  root.append(insp);
}

function colorMenu(col, anchor, e) {
  contextMenu(null, `${colorName(col)} ${col}`, [
    { icon: 'palette', label: 'Use as base colour', run: () => { state.paletteBase = col; if (state.view !== 'palette') setView('palette'); else renderPalette(); window.scrollTo({ top: 0, behavior: 'smooth' }); } },
    { icon: 'copy', label: 'Copy hex', run: () => copyHex(col) },
    { icon: 'look', label: 'Start a look in this colour', run: () => {
      const ids = CAT_ORDER.map((cat) => state.items.filter((i) => i.cat === cat).map((i) => [i, Math.max(0, ...(i.colors || []).map((x) => closeness(x, col)))]).sort((a, b) => b[1] - a[1])[0]).filter((x) => x && x[1] > 0.5).map(([i]) => i.id);
      if (!ids.length) { toast('no close matches yet'); return; }
      openEditor(null, ids);
    } },
  ], e);
}
function copyHex(col) {
  navigator.clipboard?.writeText(col).catch(() => {});
  toast(`${colorName(col)} · ${col.toUpperCase()} copied`);
}

/* ------------------------------------------------------------------ tally + settings */

function openTally() {
  const c = h('<div class="breakdown"></div>');
  const draw = () => {
    const t = totals();
    const maxN = Math.max(1, ...CAT_ORDER.map((k) => t.by[k].n));
    const unpriced = t.n - t.priced;
    // how often each piece appears in a look
    const uses = new Map();
    state.outfits.forEach((o) => new Set(o.pieces.map((p) => p.itemId)).forEach((id) => uses.set(id, (uses.get(id) || 0) + 1)));
    const mostStyled = state.items.filter((i) => uses.get(i.id)).sort((x, y) => uses.get(y.id) - uses.get(x.id))[0];
    const unstyled = state.items.filter((i) => !uses.get(i.id)).length;
    // signature colour = the most common main colour
    const colourCount = new Map();
    state.items.forEach((i) => { const col = i.colors?.[0]; if (col) { const nm = colorName(col); const e = colourCount.get(nm) || { n: 0, col }; e.n++; colourCount.set(nm, e); } });
    const signature = [...colourCount.entries()].sort((x, y) => y[1].n - x[1].n)[0];
    c.innerHTML = `<h2>the tally</h2>
      <div class="big-total"><div class="v">${t.n}</div><small>piece${t.n === 1 ? '' : 's'} in your closet</small></div>
      <button class="value-pill" data-a="prices" aria-label="Closet value ${money(t.v)}. Open the price list">
        <span class="vp-l">closet value</span><span class="vp-v">${money(t.v)}</span>
        <span class="vp-s">${!t.n ? 'no pieces yet' : unpriced ? `${unpriced} to price` : 'all priced'}</span>${svg('back', 'class="vp-c"')}
      </button>
      ${CAT_ORDER.map((k, i) => `<div class="line"><span class="nm">${CATS[k].label}</span><span class="bar"><i style="width:${(t.by[k].n / maxN) * 100}%;animation-delay:${i * 80}ms;background:${['var(--sage)', 'var(--clay)', '#8fa8b0', '#b9a3c4'][i]}"></i></span><span class="amt">${t.by[k].n}</span></div>`).join('')}
      <div class="kv" style="margin-top:16px">
        <div><small>looks</small><b>${state.outfits.length}</b></div>
        <div><small>not yet styled</small><b>${unstyled} piece${unstyled === 1 ? '' : 's'}</b></div>
      </div>
      <div class="kv">
        <div><small>most styled</small><b>${mostStyled ? esc(mostStyled.name) : '—'}</b></div>
        <div><small>signature colour</small><b>${signature ? `<i class="dot" style="background:${signature[1].col}"></i>${signature[0]}` : '—'}</b></div>
      </div>`;
    press($('[data-a=prices]', c), { tap: () => openPrices(draw), long: () => openPrices(draw), hapticTap: 'select' });
  };
  draw();
  sheet(c);
}

/** The one place prices are listed and edited. Unpriced pieces come first. */
function openPrices(onClose) {
  const cur = state.settings.currency;
  // order is fixed when the list opens so rows don't jump while typing
  const byNew = (x, y) => y.created - x.created;
  const todo = state.items.filter((i) => !isPriced(i)).sort(byNew);
  const done = state.items.filter(isPriced).sort(byNew);
  const c = h(`<div class="prices"><h2>prices</h2>
    <p class="sub">only you see these — type a price for any piece</p>
    <div class="price-total"><span>total</span><b data-total></b><small data-count></small></div>
    <div data-list></div></div>`);
  const list = $('[data-list]', c);
  const syncTotal = () => {
    const t = totals();
    $('[data-total]', c).textContent = money(t.v);
    $('[data-count]', c).textContent = `${t.priced} of ${t.n} priced`;
  };
  const pending = new Map(); // item id -> save timer
  const rows = []; // { it, inp, row } in display order
  const commit = async (it, inp) => {
    clearTimeout(pending.get(it.id)); pending.delete(it.id);
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
      sh.el.scrollBy({ top: r.top + r.height / 2 - (top + height * 0.42), behavior: 'smooth' });
    }
  };
  const onViewport = () => { const r = rows.find((x) => x.inp === document.activeElement); if (r) reveal(r.row, r.inp); };
  vv?.addEventListener('resize', onViewport);
  const section = (title, items) => {
    if (!items.length) return;
    list.append(h(`<div class="price-head">${title} <span>${items.length}</span></div>`));
    items.forEach((it) => {
      const row = h(`<div class="price-row">
        <img src="${it.sticker}" alt="" />
        <div class="pr-text"><div class="pr-name">${esc(it.name)}</div><div class="pr-sub">${esc(CATS[it.cat]?.label || '')}${it.sub ? ' · ' + esc(it.sub) : ''}</div></div>
        <label class="pr-input"><span>${esc(cur)}</span><input inputmode="decimal" enterkeyhint="next" autocomplete="off" placeholder="—" aria-label="Price of ${esc(it.name)}" value="${isPriced(it) ? priceText(it.price) : ''}" /></label>
      </div>`);
      const inp = $('input', row);
      rows.push({ it, inp, row });
      inp.addEventListener('input', () => {
        inp.value = cleanPrice(inp.value);
        clearTimeout(pending.get(it.id));
        pending.set(it.id, setTimeout(() => commit(it, inp), 500));
      });
      inp.addEventListener('focus', () => {
        row.classList.add('focus');
        // select() focuses the input in some browsers, so only ever select the one that still has focus
        // (otherwise two quick focus changes would steal focus back and forth forever)
        setTimeout(() => { if (document.activeElement === inp) inp.select(); }, 0);
        setTimeout(() => reveal(row, inp), 350);
      });
      inp.addEventListener('blur', async () => {
        row.classList.remove('focus');
        const before = isPriced(it);
        await commit(it, inp);
        // tidy the display ("12." → "12")
        inp.value = isPriced(it) ? priceText(it.price) : '';
        if (isPriced(it) !== before) haptic(isPriced(it) ? 'success' : 'light');
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const nxt = rows[rows.findIndex((r) => r.inp === inp) + 1];
        if (nxt) nxt.inp.focus(); else inp.blur();
      });
      // long-press the piece (not the input) for quick actions
      press($('.pr-text', row), {
        tap: () => inp.focus(),
        long: (e) => contextMenu(null, it.name, [
          { icon: 'edit', label: 'Set price', run: () => inp.focus() },
          { icon: 'undo', label: 'Clear price', run: async () => { inp.value = ''; await commit(it, inp); } },
        ], e),
        hapticTap: 'select',
      });
      list.append(row);
    });
  };
  if (!state.items.length) list.append(h('<p class="pr-empty">add a piece to your closet and it will show up here</p>'));
  section('to price', todo);
  section('priced', done);
  syncTotal();
  sh = sheet(c, { onClose: () => {
    vv?.removeEventListener('resize', onViewport);
    // save whatever was typed last, even if its box still has focus or its debounce hasn't fired
    rows.forEach(({ it, inp }) => { commit(it, inp); });
    if (list.contains(document.activeElement)) document.activeElement.blur();
    onClose?.();
  } });
}

function openSettings() {
  const c = h(`<div><h2>settings</h2><p class="sub">everything lives privately on this device</p>
    <div class="toggle"><span>haptic feedback</span><button class="switch ${hapticsEnabled() ? 'on' : ''}" data-a="hap" aria-label="Haptics"></button></div>
    <div class="field" style="margin-top:16px"><label>currency symbol</label><div class="wrap-chips" data-cur></div></div>
    <div class="row-btns" style="margin-bottom:10px"><button class="btn soft" data-a="exp">${svg('download')} backup</button><button class="btn soft" data-a="imp">${svg('upload')} restore</button></div>
    <button class="btn ghost block" data-a="wipe">${svg('trash')} clear everything</button></div>`);
  const s = sheet(c);
  const hb = $('[data-a=hap]', c);
  press(hb, { tap: () => { const on = !hb.classList.contains('on'); hb.classList.toggle('on', on); setHaptics(on); state.settings.haptics = on; saveSettings(); haptic('select'); }, hapticTap: null });
  ['$', '€', '£', '¥', '₩', '₹', 'A$', 'C$'].forEach((sym) => {
    const b = h(`<button class="chip small ${state.settings.currency === sym ? 'active' : ''}">${sym}</button>`);
    press(b, { tap: () => { state.settings.currency = sym; saveSettings(); $$('.chip', $('[data-cur]', c)).forEach((x) => x.classList.toggle('active', x === b)); render(); }, hapticTap: 'select' });
    $('[data-cur]', c).append(b);
  });
  press($('[data-a=exp]', c), { tap: exportData });
  press($('[data-a=imp]', c), { tap: () => { const f = $('#file-import'); f.value = ''; f.onchange = () => f.files[0] && importData(f.files[0]).then(() => s.close()); f.click(); } });
  press($('[data-a=wipe]', c), { tap: async () => {
    s.close();
    if (!(await confirmSheet('Clear everything?', 'All pieces and looks will be deleted from this device. Make a backup first if unsure.', 'Clear all'))) return;
    await db.clear('items'); await db.clear('outfits');
    state.items = []; state.outfits = []; render(); toast('a fresh start');
  } });
}

function saveSettings() { db.put('meta', { key: 'settings', value: state.settings }); }

async function exportData() {
  const blob = new Blob([JSON.stringify({ version: 1, exported: new Date().toISOString(), items: state.items, outfits: state.outfits, settings: state.settings })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `my-closet-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  haptic('success'); toast('backup saved');
}
async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    for (const it of data.items || []) await db.put('items', it);
    for (const o of data.outfits || []) await db.put('outfits', o);
    await load(); render();
    haptic('success'); toast(`restored ${data.items?.length || 0} pieces`);
  } catch { haptic('warning'); toast('that file could not be read'); }
}

/* ------------------------------------------------------------------ boot */

async function load() {
  const [items, outfits, settings] = await Promise.all([db.all('items'), db.all('outfits'), db.get('meta', 'settings')]);
  state.items = items || [];
  state.outfits = outfits || [];
  if (settings?.value) Object.assign(state.settings, settings.value);
  setHaptics(state.settings.haptics);
}

function bindChrome() {
  $$('.tab[data-view]').forEach((t) => press(t, {
    tap: () => setView(t.dataset.view),
    long: t.dataset.view === 'closet' ? (e) => contextMenu(t, 'closet', CAT_ORDER.map((k) => ({ icon: k, label: CATS[k].label, run: () => { state.filterCat = k; state.filterSub = null; if (state.view !== 'closet') setView('closet'); else renderCloset(); } })), e)
      : t.dataset.view === 'outfits' ? (e) => contextMenu(t, 'looks', [
        { icon: 'plus', label: 'New look', run: () => openEditor() },
        { icon: 'sparkle', label: 'Surprise me', run: surpriseLook },
      ], e)
      : (e) => contextMenu(t, 'palette', INSPIRATION.slice(0, 5).map((p) => ({ icon: 'swatch', label: p.name, run: () => { state.paletteBase = p.colors[2]; if (state.view !== 'palette') setView('palette'); else renderPalette(); } })), e),
    hapticTap: 'select',
  }));
  press($('#tally-tab'), { tap: openTally, long: () => openPrices(), hapticTap: 'select' });
  const fab = $('#fab');
  press(fab, {
    tap: () => (state.view === 'outfits' ? openEditor() : openAdd()),
    long: (e) => contextMenu(fab, 'create', [
      { icon: 'camera', label: 'Take a photo', run: () => quickPick('camera') },
      { icon: 'image', label: 'Choose photos', run: () => quickPick('library') },
      { icon: 'look', label: 'New look', run: () => openEditor() },
      { icon: 'sparkle', label: 'Surprise me', run: surpriseLook },
    ], e),
    hapticTap: 'medium',
  });
  press($('#settings-btn'), { tap: openSettings, long: openTally });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !stack.length) return;
    const top = stack[stack.length - 1];
    (top.dismiss || top.close)(); // a sheet can ask before it closes (the batch sheet does)
  });
}

function quickPick(kind) {
  const input = kind === 'camera' ? $('#file-camera') : $('#file-library');
  input.value = '';
  if (kind === 'library') input.multiple = true;
  input.onchange = () => {
    const files = [...(input.files || [])];
    if (files.length > 1) openBatch(files, state.filterCat !== 'all' ? state.filterCat : null);
    else if (files[0]) openAdd({ source: files[0] });
  };
  input.click();
}

(async function boot() {
  greeting();
  bindChrome();
  await load();
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();

// exposed for debugging / tests
window.__closet = { state, openAdd, openEditor };

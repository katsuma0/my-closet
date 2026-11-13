import { db, uid } from './db.js';
import { haptic, setHaptics, hapticsEnabled } from './haptics.js';
import { loadImage, rasterize, computeMask, renderSticker, renderMaskPreview, DEFAULT_TOLERANCE } from './cutout.js';
import { colorName, closeness } from './color.js';

/* ------------------------------------------------------------------ data */

const CATS = {
  top: { label: 'Tops', subs: ['T-shirts', 'Shirts', 'Blouses', 'Knits', 'Hoodies', 'Tanks', 'Jackets', 'Coats', 'Dresses'] },
  bottom: { label: 'Bottoms', subs: ['Jeans', 'Trousers', 'Shorts', 'Skirts', 'Leggings', 'Sweatpants'] },
  shoes: { label: 'Shoes', subs: ['Sneakers', 'Boots', 'Loafers', 'Heels', 'Flats', 'Sandals'] },
  acc: { label: 'Accessories', subs: ['Bags', 'Hats', 'Jewelry', 'Belts', 'Scarves', 'Sunglasses', 'Watches'] },
};
const CAT_ORDER = ['top', 'bottom', 'shoes', 'acc'];
const BOARD = [['Mist', '#f6f6f5'], ['White', '#ffffff'], ['Ivory', '#f1ede6'], ['Sand', '#e6dfd3'], ['Stone', '#d3ccc0'], ['Night', '#1d1d1b']];
const BOARD_COLORS = BOARD.map((b) => b[1]);

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
  look: '<rect x="3.5" y="3.5" width="7" height="9" rx="2"/><rect x="13.5" y="3.5" width="7" height="5" rx="2"/><rect x="13.5" y="11.5" width="7" height="9" rx="2"/><rect x="3.5" y="15.5" width="7" height="5" rx="2"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  eraser: '<path d="m4 15 9-9 7 7-6 6H8zM9 10l7 7M8 20h12"/>',
  undo: '<path d="M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  tune: '<path d="M4 7h9M19 7h1M4 17h1M11 17h9"/><circle cx="16" cy="7" r="2.6"/><circle cx="8" cy="17" r="2.6"/>',
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
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// the colours shown for a piece: its main two
const mainColors = (x) => (x?.colors || []).slice(0, 2);
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
  if (!full) {
    scrim.addEventListener('click', () => (api.dismiss || api.close)());
    // let go: far enough or fast enough puts the sheet away, otherwise it springs back
    const settle = (dy, v = 0) => {
      el.style.transition = '';
      scrim.style.opacity = '';
      el.style.transform = ''; // spring back first: a sheet that asks before closing may stay open
      if (dy > Math.min(150, el.offsetHeight * 0.3) || (dy > 24 && v > 0.5)) { haptic('light'); (api.dismiss || api.close)(); }
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
      if (closed || e.touches.length !== 1 || e.target.closest('input[type=range], .slider-row, .stage.erasing')) return;
      const t = e.touches[0];
      t0 = { x: t.clientX, y: t.clientY, on: false, d: 0, v: 0, lastY: t.clientY, lastT: performance.now(), t: performance.now() };
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
      const now = performance.now(), dt = now - t0.lastT;
      if (dt > 4) { t0.v = (t.clientY - t0.lastY) / dt; t0.lastY = t.clientY; t0.lastT = now; }
      follow(t0.d);
    }, { passive: false });
    const touchEnd = () => {
      if (!t0) return;
      const { on, d, v, t } = t0; t0 = null;
      // speed of the last stretch, or of the whole gesture when it was a short flick
      if (on) settle(d, Math.max(v, d / Math.max(1, performance.now() - t)));
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
  markTab(v);
  $$('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + v));
  const title = $('#view-title');
  title.classList.add('swap');
  setTimeout(() => { title.textContent = $('#view-' + v).dataset.title; title.classList.remove('swap'); }, 200);
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Which tab the glass drop sits under ('tally' while the tally sheet is up).
function markTab(key) {
  $$('#tabs .tab').forEach((t) => t.classList.toggle('active', (t.dataset.view || 'tally') === key));
  moveTabInd();
}
function moveTabInd() {
  const act = $('#tabs .tab.active'), ind = $('#tab-ind');
  if (!act || !ind) return;
  ind.style.width = act.offsetWidth + 'px';
  ind.style.transform = `translateX(${act.offsetLeft}px)`;
}

function render() {
  if (state.view === 'closet') renderCloset();
  if (state.view === 'outfits') renderOutfits();
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

  if (!state.items.length) {
    const e = h(`<div class="empty"><h3>Your closet is empty</h3><button class="btn">${svg('plus')} Add a piece</button></div>`);
    press($('.btn', e), { tap: () => openAdd() });
    root.append(e);
    return;
  }

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

  const items = state.items
    .filter((i) => state.filterCat === 'all' || i.cat === state.filterCat)
    .filter((i) => !state.filterSub || i.sub === state.filterSub)
    .sort((a, b) => b.created - a.created);
  if (!items.length) {
    root.append(h('<div class="empty"><p>No pieces here yet</p></div>'));
    return;
  }
  const grid = h('<div class="grid"></div>');
  items.forEach((it, idx) => {
    const card = h(`<button class="piece" style="animation-delay:${Math.min(idx, 12) * 35}ms">
      <span class="tile"><img class="sticker" src="${it.sticker}" alt="" loading="lazy" /></span>
      <span class="name">${esc(it.name)}</span>
      <span class="kind">${esc(it.sub || CATS[it.cat]?.label || '')}</span>
      <span class="dots">${mainColors(it).map((c) => `<i style="background:${c}"></i>`).join('')}</span></button>`);
    press(card, { tap: () => openDetail(it), long: (e) => itemMenu(it, card, e) });
    grid.append(card);
  });
  root.append(grid);
}

function itemMenu(it, anchor, e) {
  contextMenu(anchor, it.name, [
    { icon: 'edit', label: 'Edit', run: () => openAdd({ item: it }) },
    { icon: 'look', label: 'Style a look', run: () => openEditor(null, [it.id]) },
    { icon: 'copy', label: 'Duplicate', run: () => duplicateItem(it) },
    { icon: 'trash', label: 'Delete', danger: true, run: () => deleteItem(it) },
  ], e);
}

async function duplicateItem(it) {
  const copy = { ...it, id: uid(), created: Date.now(), name: it.name + ' (copy)' };
  await db.put('items', copy);
  state.items.push(copy);
  haptic('success'); toast('Duplicated');
  render();
}

async function deleteItem(it) {
  if (!(await confirmSheet('Delete this piece?', it.name))) return;
  await db.del('items', it.id);
  state.items = state.items.filter((i) => i.id !== it.id);
  toast('Deleted'); render();
}

/* ------------------------------------------------------------------ item detail */

function openDetail(it) {
  const cols = mainColors(it);
  const c = h(`<div>
    <div class="detail-img"><img src="${it.sticker}" alt="" /></div>
    <h2>${esc(it.name)}</h2>
    <p class="sub kind">${esc(it.sub || CATS[it.cat]?.label || '')}</p>
    ${cols.length ? `<div class="field"><div class="swatches">${cols.map((x) => `<span class="sw" style="background:${x}"></span>`).join('')}<span class="sw-names">${cols.map(colorName).join(', ')}</span></div></div>` : ''}
    <div class="row-btns" style="margin-bottom:10px"><button class="btn soft" data-a="edit">Edit</button><button class="btn" data-a="look">Style</button></div>
    <button class="btn ghost block" data-a="del">Delete</button>
  </div>`);
  const s = sheet(c);
  press($('[data-a=edit]', c), { tap: () => { s.close(); openAdd({ item: it }); } });
  press($('[data-a=look]', c), { tap: () => { s.close(); openEditor(null, [it.id]); } });
  press($('[data-a=del]', c), { tap: () => { s.close(); deleteItem(it); } });
}

/* ------------------------------------------------------------------ cut-out editor (shared) */

const TOL_MIN = 6, TOL_MAX = 110;
const CUT_V = 2; // version of the remover a saved strength belongs to

/**
 * The background-remover controls: preview, "remove background" switch, tap-to-erase, undo and the
 * strength slider. Used by the one-piece form and by bulk upload.
 * `cut` ({ raster, tolerance, seeds, removeBg, result }) is edited in place. Nothing is re-cut until
 * a control is used, so an existing sticker stays exactly as it was.
 */
function mountCutout(host, cut, { onChange, extraTools = [] } = {}) {
  let mask = null, erasing = false, timer = null, run = 0;
  const el = h(`<div><div class="stage"><div class="busy"><div class="spinner"></div></div></div>
    <div class="stage-tools">
      <button class="chip" data-a="bg"><span class="switch ${cut.removeBg ? 'on' : ''}" style="transform:scale(.7);margin:-6px -4px"></span>remove background</button>
      <button class="chip" data-a="erase">${svg('eraser')} tap to erase</button>
      <button class="chip" data-a="undo">${svg('undo')} undo</button>
    </div>
    <div class="slider-row" data-a="tol-row"><span>gentle</span><input type="range" min="${TOL_MIN}" max="${TOL_MAX}" value="${Math.min(TOL_MAX, Math.max(TOL_MIN, cut.tolerance))}" aria-label="Background removal strength" /><span>strong</span></div></div>`);
  host.innerHTML = '';
  host.append(el);
  extraTools.forEach((t) => $('.stage-tools', el).append(t));
  const stage = $('.stage', el), bgBtn = $('[data-a=bg]', el), eraseBtn = $('[data-a=erase]', el), range = $('input[type=range]', el);

  function syncTools() {
    eraseBtn.style.display = cut.removeBg ? '' : 'none';
    $('[data-a=undo]', el).style.display = cut.removeBg ? '' : 'none';
    $('[data-a=tol-row]', el).style.display = cut.removeBg ? '' : 'none';
    if (!cut.removeBg) { erasing = false; eraseBtn.classList.remove('active'); }
  }
  function show() {
    stage.classList.toggle('erasing', erasing);
    $$('img, canvas', stage).forEach((n) => n.remove());
    if (erasing && mask) stage.prepend(renderMaskPreview(cut.raster, mask));
    else if (cut.result) stage.prepend(h(`<img src="${cut.result.dataURL}" alt="" />`));
  }
  async function process() {
    if (!cut.raster) return;
    const mine = ++run;
    stage.classList.add('loading');
    await pause(30); // let the spinner paint before the heavy work
    if (mine !== run) return; // a newer change superseded this one
    mask = computeMask(cut.raster, cut.tolerance, cut.seeds);
    cut.result = renderSticker(cut.raster, mask, { removeBg: cut.removeBg });
    stage.classList.remove('loading');
    show();
    onChange?.(cut);
  }

  press(bgBtn, { tap: () => { cut.removeBg = !cut.removeBg; $('.switch', bgBtn).classList.toggle('on', cut.removeBg); syncTools(); process(); } });
  press(eraseBtn, {
    tap: async () => {
      erasing = !erasing;
      eraseBtn.classList.toggle('active', erasing);
      if (erasing) {
        toast('Tap leftover background');
        if (!mask) { await process(); return; } // first use on an untouched sticker
      }
      show();
    },
    long: () => { cut.seeds.length = 0; toast('Cleared'); process(); },
  });
  press($('[data-a=undo]', el), { tap: () => { if (cut.seeds.length) { cut.seeds.pop(); process(); } else toast('Nothing to undo'); } });
  let lastTick = cut.tolerance;
  range.addEventListener('input', () => {
    cut.tolerance = +range.value;
    if (Math.abs(cut.tolerance - lastTick) >= 5) { haptic('light'); lastTick = cut.tolerance; }
    clearTimeout(timer); timer = setTimeout(() => { timer = null; process(); }, 140);
  });
  stage.addEventListener('click', (e) => {
    if (!erasing || !cut.removeBg) return;
    const target = $('canvas', stage);
    if (!target) return;
    const r = target.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width, ny = (e.clientY - r.top) / r.height;
    if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return;
    haptic('select');
    cut.seeds.push([nx, ny]);
    process();
  });
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

async function openAdd({ item = null, cat = null, source = null } = {}) {
  const st = {
    original: item?.original || null,
    raster: null,
    // strengths saved by the earlier remover were on a different scale, so those start from today's default
    tolerance: item?.cut?.v === CUT_V ? item.cut.tolerance : DEFAULT_TOLERANCE,
    seeds: item?.cut?.seeds ? [...item.cut.seeds] : [],
    removeBg: item?.cut?.removeBg ?? true,
    result: item ? { dataURL: item.sticker, colors: item.colors } : null,
    cat: item?.cat || cat || (state.filterCat !== 'all' ? state.filterCat : 'top'),
    sub: item?.sub || (state.filterSub ?? null),
    // a name the app generated stays automatic, so it follows later category / type changes
    name: item && item.name !== autoName(item.colors, item.cat, item.sub) ? item.name : '',
    price: item?.price ?? '',
    customSubs: [],
  };

  const c = h(`<div>
    <div class="sheet-head"><h2>${item ? 'Edit piece' : 'New piece'}</h2></div>
    <div data-step="photo"></div>
    <div data-step="details"></div>
  </div>`);
  const s = sheet(c);
  // swipe, scrim tap and Escape all ask first once there is a photo or a change to lose
  const sig = () => JSON.stringify([st.original === (item?.original || null), st.cat, st.sub, st.name, st.price, st.tolerance, st.removeBg, st.seeds]);
  const clean = sig();
  s.dismiss = async () => {
    if (sig() !== clean && !(await confirmSheet(item ? 'Discard changes?' : 'Discard this piece?', '', 'Discard'))) return;
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
      <p class="pick-hint">Use a light, plain background</p>
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
    const re = h(`<button class="chip" data-a="re">${svg('image')} new photo</button>`);
    press(re, { tap: () => pickFile('library'), long: (e) => contextMenu(re, 'New photo', [
      { icon: 'camera', label: 'Take photo', run: () => pickFile('camera') },
      { icon: 'image', label: 'Choose photo', run: () => pickFile('library') },
    ], e) });
    editor = mountCutout(photo, st, { onChange: syncSwatches, extraTools: [re] });
    return editor;
  }

  function renderDetails() {
    details.innerHTML = '';
    const d = h(`<div>
      <div class="field"><label>Category</label><div class="seg">${CAT_ORDER.map((k) => `<button data-cat="${k}" class="${st.cat === k ? 'active' : ''}">${svg(k)}${CATS[k].label}</button>`).join('')}</div></div>
      <div class="field"><label>Type</label><div class="wrap-chips" data-subs></div></div>
      <div class="field"><label>Name</label><input class="input" data-name placeholder="Name" value="${esc(st.name)}" maxlength="40" /></div>
      ${item ? '' : `<div class="field"><label>Price (optional)</label><div class="price-wrap"><span>${esc(state.settings.currency)}</span><input class="input" data-price inputmode="decimal" placeholder="0" value="" /></div></div>`}
      <div class="field"><label>Colours</label><div class="swatches" data-sw></div></div>
      <button class="btn sage block" data-a="save">${item ? 'Save' : 'Add to closet'}</button>
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

  function syncSwatches() {
    syncNameHint();
    const sw = $('[data-sw]', details);
    if (!sw || !st.result) return;
    const cols = mainColors(st.result);
    sw.innerHTML = cols.map((c) => `<span class="sw" style="background:${c}"></span>`).join('') + `<span class="sw-names">${cols.map(colorName).join(', ')}</span>`;
  }

  async function save() {
    await editor?.settle();
    if (!st.result) { haptic('warning'); toast('Add a photo first'); return; }
    const colors = mainColors(st.result);
    const rec = {
      id: item?.id || uid(),
      created: item?.created || Date.now(),
      name: (st.name || '').trim() || autoName(colors, st.cat, st.sub),
      cat: st.cat, sub: st.sub,
      price: item ? (item.price ?? null) : parsePrice(st.price), // editing never touches the price
      sticker: st.result.dataURL,
      colors,
      original: st.original,
      cut: { v: CUT_V, tolerance: st.tolerance, seeds: st.seeds, removeBg: st.removeBg },
    };
    await db.put('items', rec);
    const i = state.items.findIndex((x) => x.id === rec.id);
    if (i >= 0) state.items[i] = rec; else state.items.push(rec);
    imgCache.delete(rec.id);
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
    if (st.raster) renderStage(); else photo.innerHTML = `<div class="stage"><img src="${item.sticker}" alt="" /></div>`;
    renderDetails();
  } else if (item) {
    // older piece without its photo: show the sticker only
    photo.innerHTML = `<div class="stage"><img src="${item.sticker}" alt="" /></div>`;
    renderDetails();
  } else renderPick();
}

/* ------------------------------------------------------------------ batch add */

const BATCH_MAX = 30;

/** Several photos picked at once: cut them all out, ask only "what is it?" for each, add them together. */
function openBatch(files, presetCat = null) {
  const overflow = Math.max(0, files.length - BATCH_MAX);
  // status: wait → busy → done | fail (could not be decoded) | gone (removed by hand or already saved)
  const entries = files.slice(0, BATCH_MAX).map((file) => ({
    file, status: 'wait', cat: presetCat, result: null, original: null, el: null, shown: null, redo: false,
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
          <div class="b-name"></div>
        </div>
        <button class="b-x" aria-label="Remove this photo">${svg('close')}</button>
      </div>`);
      $$('[data-cat]', e.el).forEach((b) => press(b, {
        tap: () => { if (saving) return; e.cat = b.dataset.cat; paint(e); sync(); },
        hapticTap: 'select',
      }));
      press($('.b-thumb', e.el), { tap: () => tune(e), hapticTap: 'select' });
      press($('.b-x', e.el), { tap: () => drop(e) });
      listEl.append(e.el);
    }
    if (e.result && e.shown !== e.result.dataURL) {
      $('.b-thumb img', e.el)?.remove();
      $('.b-thumb', e.el).prepend(h(`<img src="${e.result.dataURL}" alt="" />`));
      e.shown = e.result.dataURL;
    }
    e.el.classList.toggle('busy', e.status === 'busy');
    e.el.classList.toggle('ready', e.status === 'done');
    e.el.classList.toggle('todo', !e.cat);
    $$('[data-cat]', e.el).forEach((b) => {
      b.classList.toggle('active', b.dataset.cat === e.cat);
      b.setAttribute('aria-pressed', String(b.dataset.cat === e.cat));
    });
    $('.b-name', e.el).textContent = !e.cat ? 'Choose a category'
      : e.result ? autoName(e.result.colors, e.cat, null)
      : CATS[e.cat].label;
  }

  function sync() {
    const l = live();
    const done = l.filter((e) => e.status === 'done').length, cutting = l.length - done;
    const missing = l.filter((e) => !e.cat).length;
    const pieces = `${l.length} piece${l.length === 1 ? '' : 's'}`;
    $('[data-title]', c).textContent = 'New pieces';
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
    live().forEach((e) => { e.cat = cat; paint(e); });
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
      paint(e); sync();
    } });
    ed = mountCutout($('[data-ed]', t), cut, { onChange: () => { changed = true; } });
    mountCutout($('[data-ed]', t), cut, { onChange: () => { changed = true; } });
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
        sticker: e.result.dataURL, colors: mainColors(e.result),
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
    toast(`${added} piece${added === 1 ? '' : 's'} added`);
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

/* ------------------------------------------------------------------ outfits view */

function outfitColors(o) {
  const out = [];
  for (const p of o.pieces) for (const c of mainColors(itemById(p.itemId))) {
    if (out.length < 8 && out.every((x) => closeness(x, c) < 0.85)) out.push(c);
  }
  return out;
}

function renderOutfits() {
  const root = $('#view-outfits');
  root.innerHTML = '';
  const grid = h('<div class="looks"></div>');
  const nw = h(`<button class="look new"><div><div class="plus">${svg('plus')}</div><span>New look</span></div></button>`);
  press(nw, { tap: () => openEditor(), long: (e) => contextMenu(nw, 'New look', [
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
        if (!(await confirmSheet('Delete this look?', o.name))) return;
        await db.del('outfits', o.id); state.outfits = state.outfits.filter((x) => x.id !== o.id); renderOutfits();
      } },
    ], e) });
    grid.append(card);
  });
  root.append(grid);
}

function surpriseLook() {
  const pick = (cat) => { const l = state.items.filter((i) => i.cat === cat); return l[Math.floor(Math.random() * l.length)]; };
  const ids = ['top', 'bottom', 'shoes', 'acc'].map(pick).filter(Boolean).map((i) => i.id);
  if (!ids.length) { toast('Add pieces first'); return; }
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
    id: uid(), name: 'Untitled', pieces: [], board: BOARD_COLORS[0], updated: Date.now(),
  };
  let selected = null;
  let dirty = !outfit && startIds.length > 0;

  const c = h(`<div class="editor">
    <div class="editor-top">
      <button class="round" data-a="back" aria-label="Back">${svg('back')}</button>
      <input class="input" data-name value="${esc(o.name)}" maxlength="40" />
      <button class="round dark" data-a="save" aria-label="Save">${svg('check')}</button>
    </div>
    <div class="board"><div class="hint">Tap + to add pieces</div></div>
    <div class="editor-bar">
      <button class="round dark" data-a="add" aria-label="Add pieces">${svg('plus')}</button>
      <button class="round" data-a="bg" aria-label="Board colour"><span data-bgdot style="width:22px;height:22px;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--ink-3)"></span></button>
      <button class="round" data-a="shuffle" aria-label="Tidy layout">${svg('sparkle')}</button>
      <div class="total"><b data-total>0 pieces</b></div>
    </div>
    <div class="palette-tray">
      <div class="row"><span class="lbl">Colours</span><div class="pill-strip" data-in></div></div>
      <div class="note" data-note></div>
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
      { icon: 'trash', label: 'Remove from look', danger: true, run: () => removePiece(p) },
    ], e);
  }

  // ----- the colours in this look (taken from its pieces)
  function syncPalette() {
    const inEl = $('[data-in]', c);
    const cols = outfitColors(o);
    inEl.innerHTML = '';
    (cols.length ? cols : ['#e9e4d8']).forEach((col) => inEl.append(swatchBtn(col, !cols.length)));
    $('[data-note]', c).textContent = '';
  }
  function swatchBtn(col, placeholder = false) {
    const b = h(`<button style="background:${col}" aria-label="${colorName(col)}"></button>`);
    if (placeholder) return b;
    press(b, { tap: () => { $('[data-note]', c).textContent = colorName(col); }, hapticTap: 'select' });
    return b;
  }

  // ----- toolbar
  press($('[data-a=add]', c), { tap: () => openPicker(), long: (e) => contextMenu($('[data-a=add]', c), 'Add', CAT_ORDER.map((k) => ({ icon: k, label: CATS[k].label, run: () => openPicker(k) })), e) });
  const bgBtn = $('[data-a=bg]', c);
  press(bgBtn, {
    tap: () => { o.board = BOARD_COLORS[(BOARD_COLORS.indexOf(o.board) + 1) % BOARD_COLORS.length]; paintBoard(); dirty = true; },
    long: (e) => contextMenu(bgBtn, 'Board', [
      ...BOARD.map(([label, col]) => ({ icon: 'swatch', label, run: () => setBoard(col) })),
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
    o.name = nameInp.value.trim() || 'Untitled';
    o.updated = Date.now();
    o.thumb = await renderThumb(o, bsize());
    await db.put('outfits', o);
    const i = state.outfits.findIndex((x) => x.id === o.id);
    if (i >= 0) state.outfits[i] = o; else state.outfits.push(o);
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
    let cat = onlyCat || 'all';
    const pc = h(`<div><h2>Add pieces</h2>
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
      if (!list.length) g.append(h(`<p style="grid-column:1/-1;color:var(--ink-3);text-align:center;padding:30px 0">${state.items.length ? 'No pieces' : 'Your closet is empty'}</p>`));
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
    if (!o.pieces.length && state.items.length) setTimeout(() => openPicker(state.filterCat !== 'all' ? state.filterCat : null), 500);
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

/* ------------------------------------------------------------------ tally + settings */

function openTally() {
  const c = h('<div class="breakdown"></div>');
  const draw = () => {
    const t = totals();
    const maxN = Math.max(1, ...CAT_ORDER.map((k) => t.by[k].n));
    const unpriced = t.n - t.priced;
    const status = !t.n ? 'No pieces' : unpriced ? `${unpriced} to price` : 'All priced';
    // how often each piece appears in a look
    const uses = new Map();
    state.outfits.forEach((o) => new Set(o.pieces.map((p) => p.itemId)).forEach((id) => uses.set(id, (uses.get(id) || 0) + 1)));
    const mostStyled = state.items.filter((i) => uses.get(i.id)).sort((x, y) => uses.get(y.id) - uses.get(x.id))[0];
    const unstyled = state.items.filter((i) => !uses.get(i.id)).length;
    const newest = [...state.items].sort((x, y) => y.created - x.created)[0];
    c.innerHTML = `<h2>Tally</h2>
      <div class="big-total"><div class="v">${t.n}</div><small>piece${t.n === 1 ? '' : 's'}</small></div>
      <button class="value-pill" data-a="prices" aria-label="Closet value ${money(t.v)}, ${status}. Open the price list">
        <span class="vp-l">Value</span><span class="vp-v">${money(t.v)}</span>
        <span class="vp-s">${status}</span>${svg('back', 'class="vp-c"')}
      </button>
      ${CAT_ORDER.map((k, i) => `<div class="line"><span class="nm">${CATS[k].label}</span><span class="bar"><i style="width:${(t.by[k].n / maxN) * 100}%;animation-delay:${i * 80}ms"></i></span><span class="amt">${t.by[k].n}</span></div>`).join('')}
      <div class="kv" style="margin-top:16px">
        <div><small>Looks</small><b>${state.outfits.length}</b></div>
        <div><small>Unstyled</small><b>${unstyled}</b></div>
      </div>
      <div class="kv">
        <div><small>Most styled</small><b>${mostStyled ? esc(mostStyled.name) : 'None'}</b></div>
        <div><small>Newest</small><b>${newest ? esc(newest.name) : 'None'}</b></div>
      </div>`;
    // after pricing: refresh the numbers and hand focus back to the pill
    const prices = () => openPrices(() => { draw(); $('[data-a=prices]', c)?.focus({ preventScroll: true }); });
    press($('[data-a=prices]', c), { tap: prices, long: prices, hapticTap: 'select' });
  };
  draw();
  markTab('tally');
  sheet(c, { onClose: () => markTab(state.view) });
}

/** The one place prices are listed and edited. Unpriced pieces come first. */
let pricesOpen = false;
function openPrices(onClose) {
  if (pricesOpen) return; // one list at a time: a second copy would hold stale boxes
  pricesOpen = true;
  const cur = state.settings.currency;
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
        <img src="${it.sticker}" alt="" />
        <div class="pr-text"><div class="pr-name">${esc(it.name)}</div><div class="pr-sub">${esc(it.sub || CATS[it.cat]?.label || '')}</div></div>
        <label class="pr-input"><span>${esc(cur)}</span><input inputmode="decimal" enterkeyhint="next" autocomplete="off" maxlength="9" placeholder="0" aria-label="Price of ${esc(it.name)}" value="${isPriced(it) ? priceText(it.price) : ''}" /></label>
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
  if (!state.items.length) list.append(h('<p class="pr-empty">No pieces yet</p>'));
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

function openSettings() {
  const c = h(`<div><h2>Settings</h2>
    <div class="toggle"><span>Haptics</span><button class="switch ${hapticsEnabled() ? 'on' : ''}" data-a="hap" aria-label="Haptics"></button></div>
    <div class="field"><label>Currency</label><div class="wrap-chips" data-cur></div></div>
    <div class="row-btns" style="margin-bottom:10px"><button class="btn soft" data-a="exp">Backup</button><button class="btn soft" data-a="imp">Restore</button></div>
    <button class="btn ghost block" data-a="wipe">Clear everything</button></div>`);
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
    if (!(await confirmSheet('Clear everything?', 'All pieces and looks will be deleted.', 'Clear'))) return;
    await db.clear('items'); await db.clear('outfits');
    state.items = []; state.outfits = []; render(); toast('Cleared');
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
  haptic('success'); toast('Backup saved');
}
async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    for (const it of data.items || []) await db.put('items', it);
    for (const o of data.outfits || []) await db.put('outfits', o);
    await load(); render();
    haptic('success'); toast(`Restored ${data.items?.length || 0} pieces`);
  } catch { haptic('warning'); toast('File could not be read'); }
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
    long: t.dataset.view === 'closet' ? (e) => contextMenu(t, 'Pieces', CAT_ORDER.map((k) => ({ icon: k, label: CATS[k].label, run: () => { state.filterCat = k; state.filterSub = null; if (state.view !== 'closet') setView('closet'); else renderCloset(); } })), e)
      : (e) => contextMenu(t, 'Looks', [
        { icon: 'plus', label: 'New look', run: () => openEditor() },
        { icon: 'sparkle', label: 'Surprise me', run: surpriseLook },
      ], e),
    hapticTap: 'select',
  }));
  press($('#tally-tab'), { tap: openTally, long: () => openPrices(), hapticTap: 'select' });
  const fab = $('#fab');
  press(fab, {
    tap: () => (state.view === 'outfits' ? openEditor() : openAdd()),
    long: (e) => contextMenu(fab, 'Add', [
      { icon: 'camera', label: 'Take photo', run: () => quickPick('camera') },
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
  bindChrome();
  await load();
  render();
  moveTabInd();
  window.addEventListener('resize', moveTabInd);
  document.fonts?.ready?.then(moveTabInd);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();

// exposed for debugging / tests
window.__closet = { state, openAdd, openEditor };

// Re-tint the white border of an already rendered sticker (renderSticker in cutout.js) so that it
// matches the dark-border variant (`darkURL`), for stickers saved before that variant existed.
//
// How a sticker is built (renderSticker): item layer (photo pixels, alpha from a 5-tap blur of the
// mask: 255 inside, 147..220 on the item's own edge pixels, 37..147 on the 1-px ring just outside
// the mask) over a border layer (the mask grown by r, opaque out to D <= r - 0.5, soft beyond), over
// a soft drop shadow of the border. Only the border colour differs between the two variants, so:
//   - any pixel that is not fully opaque holds no item paint: border rim + shadow, solved exactly;
//   - an opaque pixel with item alpha a becomes  C - (1 - a) * (255 - edge)  per channel.
// The work is finding the item mask again (so that a is known), in particular telling white border
// from white item, using the geometry of the border (r) and the faint 1-px blend ring that the photo
// background leaves around the mask.
//
// Outline of retintEdge:
//   1. not a sticker (opaque pixels on the image frame): returned unchanged;
//   2. classes, depth D into the opaque area, border radius r (size formula, checked against the
//      picture: it wins only on hard evidence);
//   3. "remove background" off (whole photo + border): exact, done;
//   4. photo edges (item cut by the frame, no ring there), white item seen from the rim, border
//      flood, holes and white pieces left over, mask by erosion of the non-white area (with fixes for
//      photo edges, blown-out backgrounds and 1-2 px gaps), recomposition over the edge colour;
//   5. resampled stickers (geometry not exact): the item edge is unmixed from the colour inside.
//
// Pure JS on RGBA data (runs in Node); retintSticker is a small browser wrapper.

const EDGE_DEFAULT = [78, 72, 65];   // EDGE_DARK in cutout.js
const SH = [60, 50, 40];              // drop-shadow colour used by renderSticker
const SH_DEN = (255 - SH[0]) + (255 - SH[1]) + (255 - SH[2]);
const INF = 1e9;

// bits of the per-pixel class byte
const FULL = 1, WHITE = 2, SEEDED = 4;   // SEEDED: white item found from an unsupported rim

/** Two chamfer passes over the pixels of `list` (ascending raster order), in place on d. */
function chamferList(d, list, len, w) {
  const b = Math.SQRT2;
  for (let j = 0; j < len; j++) {
    const p = list[j];
    let v = d[p]; if (v === 0) continue;
    let t;
    if ((t = d[p - 1] + 1) < v) v = t;
    if ((t = d[p - w] + 1) < v) v = t;
    if ((t = d[p - w - 1] + b) < v) v = t;
    if ((t = d[p - w + 1] + b) < v) v = t;
    d[p] = v;
  }
  for (let j = len - 1; j >= 0; j--) {
    const p = list[j];
    let v = d[p]; if (v === 0) continue;
    let t;
    if ((t = d[p + 1] + 1) < v) v = t;
    if ((t = d[p + w] + 1) < v) v = t;
    if ((t = d[p + w + 1] + b) < v) v = t;
    if ((t = d[p + w - 1] + b) < v) v = t;
    d[p] = v;
  }
  return d;
}

/**
 * Chamfer distance computed only over the pixels of `list` (ascending raster order); everything else
 * is a source (src set) or unreachable. Exact for paths that stay inside the list.
 */
function distToList(src, list, len, w, d) {
  d.fill(INF);
  // only sources on or next to the list are ever read
  for (let j = 0; j < len; j++) {
    const p = list[j];
    if (src[p]) d[p] = 0;
    if (src[p - 1]) d[p - 1] = 0;
    if (src[p + 1]) d[p + 1] = 0;
    if (src[p - w]) d[p - w] = 0;
    if (src[p + w]) d[p + w] = 0;
    if (src[p - w - 1]) d[p - w - 1] = 0;
    if (src[p - w + 1]) d[p - w + 1] = 0;
    if (src[p + w - 1]) d[p + w - 1] = 0;
    if (src[p + w + 1]) d[p + w + 1] = 0;
  }
  return chamferList(d, list, len, w);
}

/** 3x3 dilation (separable). */
function dilate3(s, w, h) {
  const n = w * h, t = new Uint8Array(n), o = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0, p = y * w; x < w; x++, p++) t[p] = s[p] | (x > 0 ? s[p - 1] : 0) | (x < w - 1 ? s[p + 1] : 0);
  for (let y = 0; y < h; y++) for (let x = 0, p = y * w; x < w; x++, p++) o[p] = t[p] | (y > 0 ? t[p - w] : 0) | (y < h - 1 ? t[p + w] : 0);
  return o;
}

/** Border radius renderSticker used, from the sticker size: max(W,H) = L + 2r + 28, r = max(5, round(0.022 L)). */
function radiusFromSize(W, H) {
  const M = Math.max(W, H) - 28;
  let best = 5, bestErr = Infinity;
  for (let r = 5; r <= 400; r++) {
    const L = M - 2 * r; if (L < 1) break;
    const err = Math.abs(Math.max(5, 0.022 * L) - r);  // <= 0.5 when consistent
    if (err < bestErr - 1e-9) { bestErr = err; best = r; }
  }
  return best;
}

/** Any fully opaque pixel on the outermost rows / columns? (A sticker has a transparent margin.) */
function opaqueOnFrame(data, w, h) {
  for (let x = 0; x < w; x++) if (data[x * 4 + 3] === 255 || data[((h - 1) * w + x) * 4 + 3] === 255) return true;
  for (let y = 0; y < h; y++) if (data[y * w * 4 + 3] === 255 || data[(y * w + w - 1) * 4 + 3] === 255) return true;
  return false;
}

/**
 * Border radius of this sticker. The size formula (rSize) is exact for stickers made with the default
 * border width; the picture is checked against it, and wins only on hard evidence:
 *  - the plain border (D <= r - 1.5) is pure white in every native sticker, so non-white pixels there
 *    prove r is smaller (rPic = 1 + the first D level with non-white pixels; it can only overshoot,
 *    never undershoot, and it overshoots only where the 1-px blend ring around the item is invisible);
 *  - renderSticker puts the item's bounding box exactly r + 14 px from every canvas edge, and the
 *    opaque area always starts 15 px in: if that holds ("native"), the first non-white pixel from
 *    each side gives an independent upper bound rExt.
 * A picture value above rSize is used only when it is >= rSize + 2, both bounds agree and the level
 * just inside it is mostly non-white (a real blend ring, not the first speckles of a white garment).
 */
function estimateRadius(cls, D, w, h, rSize) {
  const Q = 16, rMax = Math.max(3 * rSize, rSize + 12), nb = Q * (rMax + 1) + 2;
  const cnt = new Int32Array(nb), nwc = new Int32Array(nb);
  const cap = (nb - 1) / Q;
  let deep = 0, deepNW = 0;
  for (let p = 0; p < cls.length; p++) {
    const c = cls[p];
    if (!c) continue;
    const d = D[p];
    if (d >= cap) { deep++; if (c === FULL) deepNW++; continue; }
    const b = Math.round(d * Q);
    cnt[b]++;
    if (c === FULL) nwc[b]++;
  }
  cnt[nb - 1] += deep; nwc[nb - 1] += deepNW;
  // extents of the opaque and of the non-white pixels
  const ext = (test) => {
    let x0 = w, x1 = -1, y0 = h, y1 = -1;
    for (let y = 0; y < h && y0 === h; y++) for (let x = 0, p = y * w; x < w; x++, p++) if (test(cls[p])) { y0 = y; break; }
    if (y0 === h) return null;
    for (let y = h - 1; y >= 0 && y1 < 0; y--) for (let x = 0, p = y * w; x < w; x++, p++) if (test(cls[p])) { y1 = y; break; }
    for (let x = 0; x < w && x1 < 0; x++) for (let y = y0, p = y * w + x; y <= y1; y++, p += w) if (test(cls[p])) { x0 = x; x1 = 0; break; }
    x1 = -1;
    for (let x = w - 1; x >= 0 && x1 < 0; x--) for (let y = y0, p = y * w + x; y <= y1; y++, p += w) if (test(cls[p])) { x1 = x; break; }
    return [x0, x1, y0, y1];
  };
  const eo = ext((c) => c !== 0), en = ext((c) => c === FULL);
  const [oxL, oxR, oyT, oyB] = eo || [w, -1, h, -1];
  const [xL, xR, yT, yB] = en || [w, -1, h, -1];
  for (let b = 1; b < nb; b++) { cnt[b] += cnt[b - 1]; nwc[b] += nwc[b - 1]; }
  const at = (arr, d) => { const b = Math.round(d * Q); return b < 0 ? 0 : arr[b >= nb ? nb - 1 : b]; };
  // level k = D in (k - 0.5, k + 0.5]; the ring of a sticker with radius r is level r - 1 and every
  // level below it is pure white. The first level with a real share of non-white pixels (5%; a few
  // stray pixels from resampling do not count, nor does the outermost level) is the ring.
  let rPic = rMax + 1, ringFrac = 0;
  for (let k = 2; k <= rMax; k++) {
    const a = at(nwc, k + 0.5) - at(nwc, k - 0.5), c = at(cnt, k + 0.5) - at(cnt, k - 0.5);
    if (c > 0 && a >= 3 && a > 0.05 * c) { rPic = k + 1; ringFrac = a / c; break; }
  }
  const native = oxL === 15 && oyT === 15 && oxR === w - 16 && oyB === h - 16;
  const rExt = native && xR >= 0 ? Math.min(xL, yT, w - 1 - xR, h - 1 - yB) - 13 : NaN;
  let r = rSize, why = 'size';
  if (rPic < rSize) { r = rPic; why = 'picture<size'; }
  else if (rPic >= rSize + 2 && ringFrac >= 0.6 && (!native || Math.abs(rExt - rPic) <= 1)) { r = rPic; why = 'picture>size'; }
  return { r, rPic, rExt, native, why };
}

/**
 * An item that runs off the photo has no blend ring along the cut: renderSticker only paints the
 * ring where the photo has pixels. In a native sticker the item's bounding box sits r + 14 px from
 * each canvas edge and its ring one pixel further out; a side with item colour on the box line but
 * nothing non-white on the ring line is a photo edge. Returns the photo frame (pixels outside it hold
 * no item paint) or null.
 */
function detectFrame(cls, w, h, r) {
  const pad = r + 14;
  if (2 * pad + 2 >= w || 2 * pad + 2 >= h) return null;
  const nwCol = (x) => { for (let y = 0, p = x; y < h; y++, p += w) if (cls[p] === FULL) return true; return false; };
  const nwRow = (y) => { for (let x = 0, p = y * w; x < w; x++, p++) if (cls[p] === FULL) return true; return false; };
  const fr = { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
  let any = false;
  if (!nwCol(pad - 1) && nwCol(pad)) { fr.x0 = pad; any = true; }
  if (!nwCol(w - pad) && nwCol(w - 1 - pad)) { fr.x1 = w - 1 - pad; any = true; }
  if (!nwRow(pad - 1) && nwRow(pad)) { fr.y0 = pad; any = true; }
  if (!nwRow(h - pad) && nwRow(h - 1 - pad)) { fr.y1 = h - 1 - pad; any = true; }
  return any ? fr : null;
}

/** Item-layer alpha byte renderSticker gives a pixel: in mask or not, k = # of 4-neighbours in the mask. */
function itemAlpha(m, k) {
  const s = ((m ? 4 : 0) + k) / 8 * 1.15;
  return s <= 0 ? 0 : Math.round(255 * (s > 1 ? 1 : s));
}

/** Dark-variant colour of a pixel that holds no item paint (border, its soft rim, shadow). */
function paintBorder(src, dst, i, E) {
  const A = src[i + 3];
  if (!A) return;
  const a = A / 255;
  // composite = border (share T) over shadow of fixed colour SH: solve for T from the white version
  let T = a * ((src[i] - SH[0]) + (src[i + 1] - SH[1]) + (src[i + 2] - SH[2])) / SH_DEN;
  if (T <= 0.004) return;            // pure shadow: unchanged
  if (T > a) T = a;
  const s = a - T;
  dst[i] = (T * E[0] + s * SH[0]) / a;
  dst[i + 1] = (T * E[1] + s * SH[1]) / a;
  dst[i + 2] = (T * E[2] + s * SH[2]) / a;
}

/**
 * data: RGBA (straight alpha, as from getImageData) of a white-border sticker.
 * Returns a NEW Uint8ClampedArray with the border in `rgb` (default: EDGE_DARK of cutout.js).
 * `info` (optional object) receives diagnostics.
 */
export function retintEdge(data, width, height, rgb = EDGE_DEFAULT, info = null) {
  const w = width | 0, h = height | 0, n = w * h;
  const out = new Uint8ClampedArray(data);
  const E = [rgb[0], rgb[1], rgb[2]];
  if (w < 3 || h < 3) return out;
  const tm = info && info.timing ? { t: performance.now(), log: (info.timing = []) } : null;
  const mark = (k) => { if (tm) { const t = performance.now(); tm.log.push(k + ' ' + (t - tm.t).toFixed(1)); tm.t = t; } };

  // A sticker always has a transparent margin (renderSticker pads the border by 14 px, which holds
  // at most the soft shadow). An image with opaque pixels on its outer frame is something else, e.g.
  // a plain photo: leave it untouched rather than paint a dark frame round it.
  if (opaqueOnFrame(data, w, h)) { if (info) info.notSticker = true; return out; }

  // ---- pixel classes ------------------------------------------------------------------------
  const cls = new Uint8Array(n), notFull = new Uint8Array(n), LUM = new Uint8Array(n);
  const opq = new Int32Array(n);
  let nFull = 0;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (data[i + 3] === 255) {
      opq[nFull++] = p;
      cls[p] = (data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255) ? FULL | WHITE : FULL;
      LUM[p] = (77 * data[i] + 150 * data[i + 1] + 29 * data[i + 2] + 128) >> 8;
    } else {
      notFull[p] = 1;
      paintBorder(data, out, i, E);   // not opaque: soft rim of the border + shadow, never item
    }
  }
  if (!nFull) return out;

  // distance (into the opaque area) from the outside, same metric as the border was grown with
  // (opaque pixels never touch the image frame here, so the list-based transform needs no bounds)
  const D = new Float32Array(n);
  for (let j = 0; j < nFull; j++) D[opq[j]] = INF;
  chamferList(D, opq, nFull, w);
  if (info && info.debug) info.D = D;
  mark('classes+D');

  // ---- border radius ------------------------------------------------------------------------
  const rSize = radiusFromSize(w, h);
  const R = estimateRadius(cls, D, w, h, rSize);
  const r = R.r;
  if (info) { info.rSize = rSize; info.r = r; info.rPic = R.rPic; info.rExt = R.rExt; info.rWhy = R.why; info.native = R.native; }
  mark('radius');

  // ---- "remove background" off: the item is the whole rectangle ---------------------------------
  const rect = detectRect(cls, w, h);
  if (rect) {
    if (info) info.rect = rect;
    const M = new Uint8Array(n);
    for (let y = rect.y0; y <= rect.y1; y++) M.fill(1, y * w + rect.x0, y * w + rect.x1 + 1);
    compose(data, out, cls, null, M, w, h, E, null);
    return out;
  }
  const frame = R.native ? detectFrame(cls, w, h, r) : null;
  if (info && frame) info.frame = frame;

  // Geometry (exact when r is right): item pixels have D > r - 0.5; the 1-px blend ring just
  // outside the item has D > r - 1.5; anything nearer the outside is plain border.
  const bandMax = r - 1.5, clMin = r - 0.5;
  // state: 0 undecided white, 1 border (no item paint), 2 white item, 3 non-white (item or blend)
  const state = new Uint8Array(n);
  const NW = new Uint8Array(n), S = new Uint8Array(n);
  // the outer band (D <= r + 2): every border decision near the outline happens in here
  const bandLim = clMin + 2.5;
  const band = new Int32Array(n);
  let nBand = 0;
  for (let p = 0; p < n; p++) {
    const c = cls[p];
    if (!c) continue;
    const d = D[p];
    if (d <= bandLim) band[nBand++] = p;
    if (d <= bandMax) state[p] = 1;
    else if (!(c & WHITE)) { NW[p] = 1; state[p] = 3; if (d > clMin) S[p] = 1; }
  }
  // closing of the non-white set (evaluated lazily, only white pixels ask): plugs 1-2 px holes in
  // the faint blend ring around white items
  const dil = dilate3(NW, w, h);
  const clos = (p) => {
    if (!dil[p]) return false;
    const x = p % w;
    if (x < 1 || x >= w - 1 || p < w || p >= n - w) return false;
    return dil[p - w - 1] && dil[p - w] && dil[p - w + 1] && dil[p - 1] && dil[p + 1] && dil[p + w - 1] && dil[p + w] && dil[p + w + 1];
  };
  const queue = new Int32Array(n);
  const tmpF = new Float32Array(n);
  mark('state+close');

  // ---- white items: rim pixels no non-white item pixel can account for --------------------------
  // Every opaque pixel lies within r - 0.5 of the item. If no non-white pixel that can be item
  // (D > r - 0.5) is that close to a rim pixel, the item there is white: seed "white item" at the
  // pixels that must be holding that rim up, and spread through white.
  {
    // seeds can only sit just inside the band (D <= r + 1.5); skip all of this when no white is there
    let nCand = 0;
    for (let j = 0; j < nBand; j++) { const p = band[j]; if (state[p] === 0 && cls[p] & WHITE && D[p] > clMin && D[p] <= clMin + 2 && !clos(p)) { nCand++; break; } }
    let nUnsup = 0;
    const unsup = nCand ? new Uint8Array(n) : null;
    if (nCand) {
      // D is 1-Lipschitz, so a path of length <= clMin + 0.25 from a rim pixel never leaves this band
      const DS = distToList(S, band, nBand, w, tmpF);
      // (a resampled sticker has its ring smeared by a pixel or two: allow for that)
      const supLim = clMin + (R.native ? 0.25 : 1.75);
      for (let j = 0; j < nBand; j++) {
        const p = band[j];
        if (D[p] !== 1) continue;   // rim: opaque with a non-opaque 4-neighbour
        if (DS[p] > supLim) { unsup[p] = 1; nUnsup++; }
      }
    }
    if (nUnsup) {
      const DU = distToList(unsup, band, nBand, w, tmpF);
      const span = 2 * r + 1;
      let qt = 0;
      for (let j = 0; j < nBand; j++) {
        const p = band[j];
        if (state[p] === 0 && cls[p] & WHITE && D[p] > clMin && DU[p] <= clMin + 0.75 && !clos(p) && !inGap(S, p, w, h, span)) { state[p] = 2; queue[qt++] = p; }
      }
      // spread: white, beyond the plain-border band, not a plug in the blend ring
      let qh = 0;
      while (qh < qt) {
        const p = queue[qh++], x = p % w;
        if (x > 0) { const q = p - 1; if (state[q] === 0 && cls[q] & WHITE && D[q] > clMin && !clos(q)) { state[q] = 2; queue[qt++] = q; } }
        if (x < w - 1) { const q = p + 1; if (state[q] === 0 && cls[q] & WHITE && D[q] > clMin && !clos(q)) { state[q] = 2; queue[qt++] = q; } }
        if (p >= w) { const q = p - w; if (state[q] === 0 && cls[q] & WHITE && D[q] > clMin && !clos(q)) { state[q] = 2; queue[qt++] = q; } }
        if (p + w < n) { const q = p + w; if (state[q] === 0 && cls[q] & WHITE && D[q] > clMin && !clos(q)) { state[q] = 2; queue[qt++] = q; } }
      }
      for (let i = 0; i < qt; i++) cls[queue[i]] |= SEEDED;
      if (info) info.whiteItemPx = qt;
    }
  }
  if (info && info.debug) { info.S = S; info.NW = NW; }
  mark('whiteItems');

  // distance of every white pixel (not already white item) to the nearest non-white one: the nearest
  // non-white pixel is reached through white, so only white pixels need computing
  const DNW = new Float32Array(n);
  {
    // thin white plugs between non-white pixels (closing) are left out: the flood never enters them
    // and a hole's size check below ignores them
    const list = queue;
    let len = 0;
    for (let p = w + 1; p < n - w - 1; p++) if (cls[p] & WHITE && state[p] !== 2 && !clos(p)) list[len++] = p;
    distToList(NW, list, len, w, DNW);
  }
  mark('DNW');

  // ---- border: flood from the outer band through white -------------------------------------------
  const outF = (p) => { const x = p % w, y = (p / w) | 0; return x < frame.x0 || x > frame.x1 || y < frame.y0 || y > frame.y1; };
  {
    let qt = 0, qh = 0;
    for (let j = 0; j < nBand; j++) { const p = band[j]; if (state[p] === 1) queue[qt++] = p; }
    const admit = r + 0.5;
    while (qh < qt) {
      const p = queue[qh++], x = p % w;
      for (let k = 0; k < 4; k++) {
        const q = k === 0 ? (x > 0 ? p - 1 : -1) : k === 1 ? (x < w - 1 ? p + 1 : -1) : k === 2 ? p - w : p + w;
        if (q < 0 || q >= n || state[q] !== 0 || !(cls[q] & WHITE) || clos(q)) continue;
        if (D[q] > clMin && DNW[q] > admit) continue;   // border is never farther than r from the item
        // no ring guards a photo edge: never cross it from outside (white item may sit right on it)
        if (frame && outF(p) && !outF(q)) continue;
        state[q] = 1; queue[qt++] = q;
      }
    }
    for (let j = 0; j < nBand; j++) { const p = band[j]; if (state[p] === 0 && cls[p] & WHITE && D[p] <= clMin) state[p] = 1; }
  }
  mark('borderFlood');

  // ---- reference: photo colour implied by the blend ring around the outer contour ------------------
  const lum = (p) => LUM[p];
  // k = item neighbours of a ring pixel = neighbours that are not border and not next to border
  const nb = (u) => cls[u] && state[u] !== 1;
  const inner = (u) => nb(u) && nb(u - 1) && nb(u + 1) && nb(u - w) && nb(u + w);
  const ref = [], refR = [], refG = [], refB = [];
  // (the ring round the outline lies in the outer band)
  for (let j = 0; j < nBand; j++) {
    const p = band[j];
    if (!NW[p]) continue;
    if (!(state[p - 1] === 1 || state[p + 1] === 1 || state[p - w] === 1 || state[p + w] === 1)) continue;
    const k = inner(p - 1) + inner(p + 1) + inner(p - w) + inner(p + w);
    if (!k) continue;
    const a = itemAlpha(0, k) / 255, i = p * 4;
    ref.push(255 - (255 - lum(p)) / a);
    refR.push(255 - (255 - data[i]) / a); refG.push(255 - (255 - data[i + 1]) / a); refB.push(255 - (255 - data[i + 2]) / a);
  }
  let refLo = 1, refHi = 0;
  const bgRef = [0, 0, 0];
  if (ref.length >= 16) {
    const q = (arr, f) => arr[Math.floor(arr.length * f)], num = (a, b) => a - b;
    ref.sort(num); refR.sort(num); refG.sort(num); refB.sort(num);
    refLo = q(ref, 0.05) - 6;
    refHi = Math.min(255, q(ref, 0.95) + 6);
    bgRef[0] = q(refR, 0.5); bgRef[1] = q(refG, 0.5); bgRef[2] = q(refB, 0.5);
  }
  if (info) { info.refN = ref.length; info.refLo = refLo; info.refHi = refHi; info.bgRef = bgRef.map(Math.round); }
  mark('ref');
  // does luminance L fit "blend ring with k item neighbours over white" for a photo colour in range?
  const fitLo = {}, fitHi = [];
  for (let k = 0; k <= 4; k++) fitHi[k] = 255 - ALPHA[k] / 255 * (255 - refHi) + 1.5;
  const fits = (L, k, slack) => {
    if (k < 1 || refHi < refLo) return false;
    const key = k * 1000 + slack;
    let lo = fitLo[key];
    if (lo === undefined) lo = fitLo[key] = 255 - ALPHA[k] / 255 * (255 - refLo + slack) - 1.5;
    return L >= lo && L <= fitHi[k];
  };

  // ---- left-over white pieces: holes in the item (border) or white parts of the item -------------
  classifyLeftover({ data, cls, state, NW, LUM, D, DNW, queue, w, h, r, fits, refLo, refHi, bgRef, info, native: R.native });
  mark('leftover');

  // ---- item mask estimate -> exact item alpha of every pixel ------------------------------------
  // non-white = item or the 1-px blend ring; the ring is what erosion takes off (white item stays)
  const notB = new Uint8Array(n);
  for (let p = 0; p < n; p++) notB[p] = state[p] >= 2 ? 1 : 0;
  const M = new Uint8Array(n);   // erosion of notB; white item stays whole
  for (let y = 1; y < h - 1; y++) for (let x = 1, p = y * w + 1; x < w - 1; x++, p++) {
    if (!notB[p]) continue;
    M[p] = state[p] === 2 ? 1 : notB[p - 1] & notB[p + 1] & notB[p - w] & notB[p + w];
  }
  if (frame) keepFrameEdge(M, notB, data, w, h, frame);
  // Where the photo background next to the item was blown out the ring is white, and the erosion
  // took the item's own edge instead. A ring pixel with k item neighbours is at least 255 - alpha_k
  // in every channel whatever the photo held there; anything darker is item. (Native stickers only:
  // after resampling the ring is smeared into the item and this bound no longer holds.)
  let restored = 0;
  if (R.native) {
    const back = queue;
    let nb = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1, p = y * w + 1; x < w - 1; x++, p++) {
      if (!notB[p] || M[p] || state[p] !== 3) continue;
      const k = M[p - 1] + M[p + 1] + M[p - w] + M[p + w];
      if (!k) continue;
      const lo = 255 - ALPHA[k] - 3, i = p * 4;
      if (data[i] < lo || data[i + 1] < lo || data[i + 2] < lo) back[nb++] = p;
    }
    for (let j = 0; j < nb; j++) M[back[j]] = 1;
    restored = nb;
  }
  if (info) info.restored = restored;
  const peeled = peelNarrowGaps(M, state, LUM, fits, w, h, queue);
  if (info) info.peeled = peeled;
  mark('erode+peel');
  if (info && info.debug) { info.state = state; info.M = M; info.gapLike = new Uint8Array(n).map((_, p) => (state[p] === 0 || cls[p] & WHITE) && D[p] > clMin && inGap(S, p, w, h, 2 * r + 1) ? 1 : 0); }
  compose(data, out, cls, state, M, w, h, E, frame);
  if (!R.native) softEdge(data, out, state, w, h, E, queue);
  mark('compose');
  return out;
}

/**
 * White pixels still undecided after the border flood: each 4-connected piece is either a hole in the
 * item (border, state 1) or white item (state 2). (Split out of retintEdge to keep it small for the JIT.)
 */
function classifyLeftover(env) {
  const { data, cls, state, NW, LUM, D, DNW, queue, w, h, r, fits, refLo, refHi, bgRef, info, native } = env;
  const n = w * h;
  // (near-)white garment around a white piece, other than solid white item found from the rim
  const speck = (u) => cls[u] !== 0 && !(cls[u] & SEEDED) && LUM[u] >= 251;
  const lum = (p) => LUM[p];
  let anyLeft = false;
  for (let p = 0; p < n; p++) if (state[p] === 0 && cls[p] & WHITE) { anyLeft = true; break; }
  if (anyLeft) {
    const comp = new Int32Array(n);
    let ringQ = null, ringD = null;   // only the (rare) full hole test needs these
    let nHoles = 0, nKept = 0, cid = 0;
    // A real hole (border inside the item): ring 1 is the blend of the photo background over the
    // border with item right behind it, it stands out from the item, and the item levels off.
    // a ring pixel with k item neighbours: per channel, the photo colour it implies is close to the
    // background seen round the outline (a light print edge or noise implies something else; the
    // tolerance is tight because a thin white print line on a dark garment looks just like a gap)
    const implies = (q, k) => {
      const f = 255 / ALPHA[k], i = q * 4;
      for (let ch = 0; ch < 3; ch++) if (Math.abs(255 - (255 - data[i + ch]) * f - bgRef[ch]) > 20) return false;
      return true;
    };
    const ringish = (q) => state[q] === 3 && ((fits(LUM[q], 1, 30) && implies(q, 1)) || (fits(LUM[q], 2, 30) && implies(q, 2)));
    const gapMid = (c) => {
      for (let k = 0; k < 2; k++) {
        const s = k ? w : 1, q1 = c - s, q2 = c + s, u1 = c - 2 * s, u2 = c + 2 * s;
        if (u1 < 0 || u2 >= n || state[u1] !== 3 || state[u2] !== 3) continue;
        // the item on both sides is clearly darker than the ring (light items cannot be told apart)
        const lo = Math.min(LUM[q1], LUM[q2]) - 40;
        if (LUM[u1] < lo && LUM[u2] < lo && ringish(q1) && ringish(q2)) return true;
      }
      return false;
    };
    const RINGS = 9;
    const sum = new Float64Array(RINGS + 1), cnt = new Float64Array(RINGS + 1), sR = new Float64Array(RINGS + 1), sG = new Float64Array(RINGS + 1), sB = new Float64Array(RINGS + 1);
    const holeTest = (qt, solid) => {
      if (!ringQ) { ringQ = new Int32Array(n); ringD = new Uint8Array(n); }
      const cur = cid;
      const ok = (u) => cls[u] && state[u] !== 1 && comp[u] !== cur;
      const isM = (u) => ok(u) && ok(u - 1) && ok(u + 1) && ok(u - w) && ok(u + w);
      // cheap necessary condition first: 3/4 of the first ring must look like blend ring
      {
        let g = 0, t = 0;
        for (let i = 0; i < qt; i++) {
          const p = queue[i], x = p % w;
          for (let k = 0; k < 4; k++) {
            const q = k === 0 ? (x > 0 ? p - 1 : -1) : k === 1 ? (x < w - 1 ? p + 1 : -1) : k === 2 ? p - w : p + w;
            if (q < 0 || q >= n || comp[q] === cur || comp[q] === -cur || !cls[q] || state[q] === 1) continue;
            comp[q] = -cur; ringQ[t++] = q;
          }
        }
        // Behind the ring of a real hole lies the item (or photo background the cutout kept); behind a
        // cluster of clipped pixels in a speckled white garment lies near-white garment all round.
        // (A hole with a solid white core, 5x5 or more, is let through: speckles never form one.)
        let t2 = 0, w2 = 0;
        for (let i = 0; i < t; i++) {
          const q = ringQ[i], x = q % w;
          for (let k = 0; k < 4; k++) {
            const u = k === 0 ? (x > 0 ? q - 1 : -1) : k === 1 ? (x < w - 1 ? q + 1 : -1) : k === 2 ? q - w : q + w;
            if (u < 0 || u >= n || comp[u] === cur || comp[u] === -cur || comp[u] === -cur - 1e6 || !cls[u] || state[u] === 1) continue;
            comp[u] = -cur - 1e6; ringQ[t + t2++] = u;
            if (speck(u)) w2++;
          }
        }
        for (let i = t; i < t + t2; i++) comp[ringQ[i]] = 0;
        if (!solid && w2 > 0.4 * t2) { for (let i = 0; i < t; i++) comp[ringQ[i]] = 0; return false; }
        for (let i = 0; i < t; i++) {
          const q = ringQ[i];
          comp[q] = 0;
          if (NW[q] && fits(lum(q), isM(q - 1) + isM(q + 1) + isM(q - w) + isM(q + w), 60)) g++;
        }
        if (!t || g < 0.75 * t) return false;
      }
      let rt = 0, head = 0, good = 0, tot = 0;
      sum.fill(0); cnt.fill(0); sR.fill(0); sG.fill(0); sB.fill(0);
      for (let i = 0; i < qt; i++) ringQ[rt++] = queue[i];
      while (head < rt) {
        const p = ringQ[head++], d = comp[p] === cur ? 0 : ringD[p];
        if (d >= RINGS) continue;
        const x = p % w;
        for (let k = 0; k < 4; k++) {
          const q = k === 0 ? (x > 0 ? p - 1 : -1) : k === 1 ? (x < w - 1 ? p + 1 : -1) : k === 2 ? p - w : p + w;
          if (q < 0 || q >= n || comp[q] === cur || comp[q] === -cur || !cls[q] || state[q] === 1) continue;
          comp[q] = -cur; ringD[q] = d + 1; ringQ[rt++] = q;
          sum[d + 1] += lum(q); cnt[d + 1]++; sR[d + 1] += data[q * 4]; sG[d + 1] += data[q * 4 + 1]; sB[d + 1] += data[q * 4 + 2];
          if (d === 0) {
            tot++;
            if (NW[q] && fits(lum(q), isM(q - 1) + isM(q + 1) + isM(q - w) + isM(q + w), 60)) good++;
          }
        }
      }
      for (let i = qt; i < rt; i++) { const q = ringQ[i]; if (comp[q] === -cur) comp[q] = 0; }
      const L = new Float64Array(RINGS + 1), col = [];
      for (let d = 1; d <= RINGS; d++) {
        if (cnt[d]) { L[d] = sum[d] / cnt[d]; col[d] = [sR[d] / cnt[d], sG[d] / cnt[d], sB[d] / cnt[d]]; }
        else { L[d] = L[d - 1]; col[d] = col[d - 1]; }
      }
      // rings 2.. may be photo background the cutout kept around the hole (a halo): same colour as
      // the background seen in the outer blend ring, and no lighter than it
      let j0 = 2;
      while (j0 < RINGS - 4 && Math.hypot(col[j0][0] - bgRef[0], col[j0][1] - bgRef[1], col[j0][2] - bgRef[2]) <= 24 && L[j0] <= refHi && L[j0] >= refLo) j0++;
      // ring 1 must stand out from the item (more so for tiny pieces) and the item behind must have
      // levelled off two rings further on (a soft highlight keeps sloping)
      const a = j0 + 2, b = j0 + 3, e = j0 + 4;
      const c = Math.max(Math.abs(L[1] - L[b]), Math.abs(L[1] - L[2])), flat = Math.max(Math.abs(L[a] - L[b]), Math.abs(L[b] - L[e]));
      const res = tot > 0 && good >= 0.75 * tot && c >= Math.max(3, 24 / Math.sqrt(qt)) && flat <= 0.12 * c + 1.5;
      if (info && info.debug) (info.comps || (info.comps = [])).push({ at: [queue[0] % w, (queue[0] / w) | 0], solid, area: qt, tot, good, j0, L: Array.from(L.slice(1), (v) => +v.toFixed(1)), res });
      return res;
    };
    for (let s = 0; s < n; s++) {
      if (state[s] !== 0 || !(cls[s] & WHITE) || comp[s]) continue;
      // a lone white pixel among non-white ones: a clipped speck, or the middle of a 3-px gap
      if (state[s - 1] === 3 && state[s + 1] === 3 && state[s - w] === 3 && state[s + w] === 3) {
        if (refHi >= refLo && gapMid(s)) { state[s] = 1; nHoles++; } else { state[s] = 2; nKept++; }
        continue;
      }
      cid++;
      let qh = 0, qt = 0;
      queue[qt++] = s; comp[s] = cid;
      let maxD = 0, minDo = INF, touchB = false, touchI = false;
      // (opaque pixels never touch the image frame, so neighbours need no bounds checks)
      while (qh < qt) {
        const p = queue[qh++];
        const dn = DNW[p];
        if (dn > maxD && dn < INF) maxD = dn;
        if (D[p] < minDo) minDo = D[p];
        for (let k = 0; k < 4; k++) {
          const q = k === 0 ? p - 1 : k === 1 ? p + 1 : k === 2 ? p - w : p + w;
          const st = state[q];
          if (st === 1) touchB = true; else if (st === 2) touchI = true;
          else if (st === 0 && cls[q] & WHITE && !comp[q]) { comp[q] = cid; queue[qt++] = q; }
        }
      }
      let hole = false;
      if (!touchI && refHi >= refLo) {
        // What lies beyond each non-white neighbour? Behind the 1-px ring of a real hole there is
        // item; behind a speck of clipped white in a white garment there is near-white garment all
        // round. (Solid white item found from the rim does not count: a hole can sit in it.)
        let ring1 = 0, beyond = 0, beyondW = 0;
        if (maxD < 3) for (let i = 0; i < qt; i++) {
          const p = queue[i];
          for (let k = 0; k < 4; k++) {
            const q = k === 0 ? p - 1 : k === 1 ? p + 1 : k === 2 ? p - w : p + w;
            if (state[q] !== 3) continue;
            ring1++;
            const u = 2 * q - p;
            if (u >= 0 && u < n && state[u] !== 1 && comp[u] !== cid && speck(u)) { beyond++; if (cls[u] & WHITE) beyondW++; }
          }
        }
        // a small piece is a speck already when other clipped white lies just behind its ring
        const specky = beyond > 0.4 * ring1 || (qt < 16 && beyondW > 0.1 * ring1);
        // a hole is no wider than 2r (every border pixel is within r of the item), and an enclosed one
        // lies behind the outer ring, the item and its own ring: D >= r + 2
        if (maxD <= r + 0.5 && qt >= (touchB ? 2 : 4) && (touchB || minDo >= r + 1.4) && (maxD >= 3 || !specky)) hole = holeTest(qt, maxD >= 3);
        // the white middle line of a 3-px gap between two parts of a non-white item, cut into pieces
        // where the gap bends: item | ring | white | ring | item across most of its pixels
        if (!hole && maxD < 2) {
          let good = 0, bad = 0;
          for (let i = 0; i < qt && bad <= 0.4 * qt; i++) if (gapMid(queue[i])) good++; else bad++;
          hole = good >= 0.6 * qt;
        }
      }
      const st = hole ? 1 : 2;
      for (let i = 0; i < qt; i++) state[queue[i]] = st;
      if (hole) nHoles++; else nKept++;
    }
    if (info) { info.holes = nHoles; info.keptWhite = nKept; }
  }
}

/**
 * Item pixels on a photo edge have no ring outside them, so the erosion wrongly took them: put back
 * every eroded pixel on the frame line whose other neighbours are item, unless it looks like a ring
 * pixel (light, and clearly lighter than the item next to it), which happens where the item leaves
 * the photo edge.
 */
function keepFrameEdge(M, notB, data, w, h, fr) {
  const lum = (p) => 0.299 * data[p * 4] + 0.587 * data[p * 4 + 1] + 0.114 * data[p * 4 + 2];
  const minC = (p) => Math.min(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]);
  const inF = (x, y) => x < fr.x0 || x > fr.x1 || y < fr.y0 || y > fr.y1;   // outside the photo
  const fix = (x, y, inward) => {
    const p = y * w + x;
    if (!notB[p] || M[p]) return;
    const ok = (xx, yy) => inF(xx, yy) || notB[yy * w + xx];
    if (!(ok(x - 1, y) && ok(x + 1, y) && ok(x, y - 1) && ok(x, y + 1))) return;
    // a ring pixel where the item leaves the edge: light, lighter than the item next to it, and at
    // the end of the run along the edge
    const along = inward === 1 || inward === -1 ? w : 1;
    const end = !notB[p - along] || !notB[p + along];
    if (end && minC(p) >= 182 && lum(p) > lum(p + inward) + 6) return;
    M[p] = 1;
  };
  if (fr.x0 > 0) for (let y = fr.y0; y <= fr.y1; y++) fix(fr.x0, y, 1);
  if (fr.x1 < w - 1) for (let y = fr.y0; y <= fr.y1; y++) fix(fr.x1, y, -1);
  if (fr.y0 > 0) for (let x = fr.x0; x <= fr.x1; x++) fix(x, fr.y0, w);
  if (fr.y1 < h - 1) for (let x = fr.x0; x <= fr.x1; x++) fix(x, fr.y1, -w);
}

/**
 * Gaps of 1-2 px between two parts of the item (shoes side by side, the tip of the wedge between
 * trouser legs) contain no plain border pixel, only blend pixels, so the erosion takes them for item.
 * Peel them from the open end: a pixel goes when it is lighter than item on both sides of a 1-2 px
 * line and its colour is what the blend ring would be there. Runs shorter than 4 px are left alone
 * (a light speck in a thin chain looks the same).
 */
function peelNarrowGaps(M, state, LUM, fits, w, h, stack) {
  const n = w * h, cand = new Uint8Array(n);
  const lum = (p) => LUM[p];
  const MARGIN = 8;
  // line test along one axis: s = 1 (walls left/right) or w (walls above/below)
  const lineK = (p, s) => {
    const a = p - s, b = p + s, L = lum(p);
    const wallA = M[a] && !cand[a] && state[a] === 3 && lum(a) < L - MARGIN;
    const wallB = M[b] && !cand[b] && state[b] === 3 && lum(b) < L - MARGIN;
    if (wallA && wallB) return 2;                               // 1-px gap: item on both sides
    // 2-px gap: the partner pixel is light too, and item lies beyond it
    if (wallA && M[b] && state[b] === 3 && lum(b) > lum(a) + MARGIN && M[b + s] && state[b + s] === 3 && lum(b + s) < lum(b) - MARGIN && lum(b + s) < L - MARGIN) return 1;
    if (wallB && M[a] && state[a] === 3 && lum(a) > lum(b) + MARGIN && M[a - s] && state[a - s] === 3 && lum(a - s) < lum(a) - MARGIN && lum(a - s) < L - MARGIN) return 1;
    return 0;
  };
  const isWall = (q, L) => M[q] && !cand[q] && state[q] === 3 && lum(q) < L - MARGIN;
  const test = (p) => {
    if (!M[p] || state[p] !== 3 || cand[p]) return false;
    const x = p % w, y = (p / w) | 0;
    if (x < 2 || x >= w - 2 || y < 2 || y >= h - 2) return false;
    if (!(lineK(p, 1) || lineK(p, w))) return false;
    // item alpha of a gap pixel = number of item neighbours (3 at the closed tip of a gap)
    const L = lum(p), k = isWall(p - 1, L) + isWall(p + 1, L) + isWall(p - w, L) + isWall(p + w, L);
    return fits(L, k, 30);
  };
  // 8-neighbourhood: a 1-px gap that runs at a slant steps diagonally
  const N8 = [-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1];
  let sp = 0;
  const all = [];
  for (let y = 2; y < h - 2; y++) for (let x = 2, p = y * w + 2; x < w - 2; x++, p++) {
    if (!M[p] || state[p] !== 3) continue;
    // must touch the non-item side or white (a gap may open into a tiny white pocket)
    if (M[p - 1] && M[p + 1] && M[p - w] && M[p + w] && state[p - 1] !== 2 && state[p + 1] !== 2 && state[p - w] !== 2 && state[p + w] !== 2) continue;
    const Lm = LUM[p] - MARGIN;   // quick reject: a gap pixel is lighter than a wall next to it
    if (!(LUM[p - 1] < Lm || LUM[p + 1] < Lm || LUM[p - w] < Lm || LUM[p + w] < Lm)) continue;
    if (test(p)) { cand[p] = 1; stack[sp++] = p; all.push(p); }
  }
  if (!sp) return 0;
  while (sp) {
    const p = stack[--sp];
    for (let j = 0; j < 8; j++) { const q = p + N8[j]; if (test(q)) { cand[q] = 1; stack[sp++] = q; all.push(q); } }
  }
  let peeled = 0;
  for (const s0 of all) {
    if (cand[s0] !== 1) continue;
    let qh = 0, qt = 0;
    stack[qt++] = s0; cand[s0] = 2;
    let open = false;
    while (qh < qt) {
      const p = stack[qh++];
      if (!open && ((!M[p - 1] && !cand[p - 1]) || (!M[p + 1] && !cand[p + 1]) || (!M[p - w] && !cand[p - w]) || (!M[p + w] && !cand[p + w]))) open = true;
      for (let j = 0; j < 8; j++) { const q = p + N8[j]; if (cand[q] === 1) { cand[q] = 2; stack[qt++] = q; } }
    }
    // A gap opens onto the border somewhere; a light line closed at both ends inside the item (a
    // thin white print stripe looks exactly like a 2-px gap) is left alone.
    if (qt >= 4 && open) { for (let i = 0; i < qt; i++) M[stack[i]] = 0; peeled += qt; }
  }
  return peeled;
}

/**
 * Does pixel p lie between two pixels of S on opposite sides (horizontally, vertically or along
 * either diagonal) no more than `span` apart? Then it is inside a gap between two parts of the item.
 */
function inGap(S, p, w, h, span) {
  const x0 = p % w, y0 = (p / w) | 0;
  for (let k = 0; k < 4; k++) {
    const dx = k === 1 ? 0 : 1, dy = k === 0 ? 0 : k === 3 ? -1 : 1, len = dx && dy ? Math.SQRT2 : 1;
    const maxSteps = Math.floor(span / len);
    let a = 0, x = x0, y = y0;
    for (; a < maxSteps; ) { x += dx; y += dy; a++; if (x < 0 || x >= w || y < 0 || y >= h) { a = maxSteps; break; } if (S[y * w + x]) break; }
    if (a >= maxSteps) continue;
    let b = 0; x = x0; y = y0;
    const rest = maxSteps - a;
    for (; b < rest; ) { x -= dx; y -= dy; b++; if (x < 0 || x >= w || y < 0 || y >= h) { b = rest; break; } if (S[y * w + x]) break; }
    if (b < rest) return true;
  }
  return false;
}

/** Given the item mask estimate M, recolour every opaque pixel. */
const ALPHA = [0, 1, 2, 3, 4].map((k) => itemAlpha(0, k)).concat([0, 1, 2, 3, 4].map((k) => itemAlpha(1, k)));
function compose(data, out, cls, state, M, w, h, E, fr) {
  const dR = 255 - E[0], dG = 255 - E[1], dB = 255 - E[2];
  for (let y = 0; y < h; y++) for (let x = 0, p = y * w; x < w; x++, p++) {
    if (!cls[p]) continue;
    const i = p * 4;
    if (state && state[p] === 1) { paintBorder(data, out, i, E); continue; }
    if (fr && (x < fr.x0 || x > fr.x1 || y < fr.y0 || y > fr.y1)) { paintBorder(data, out, i, E); continue; }
    const k = (x > 0 ? M[p - 1] : 0) + (x < w - 1 ? M[p + 1] : 0) + (y > 0 ? M[p - w] : 0) + (y < h - 1 ? M[p + w] : 0);
    const a = ALPHA[M[p] * 5 + k];
    if (a === 255) continue;
    if (a === 0) { paintBorder(data, out, i, E); continue; }
    const f = (255 - a) / 255;   // white version = a*P + (1-a)*255, wanted a*P + (1-a)*edge
    out[i] = data[i] - f * dR;
    out[i + 1] = data[i + 1] - f * dG;
    out[i + 2] = data[i + 2] - f * dB;
  }
}

/**
 * A resampled sticker (scaled after it was made) has its item edge smeared over a pixel or two, so the
 * exact alpha model does not hold there. Each non-white pixel within 3 px of the border is unmixed as
 * v = a * C + (1 - a) * 255, with C the item colour a few pixels further in, and put back over the
 * edge colour. Near-white items cannot be unmixed this way and are left as they are.
 */
function softEdge(data, out, state, w, h, E, queue) {
  const n = w * h, layer = new Uint8Array(n);
  let qt = 0;
  for (let p = w + 1; p < n - w - 1; p++) {
    if (state[p] === 3 && (state[p - 1] === 1 || state[p + 1] === 1 || state[p - w] === 1 || state[p + w] === 1)) { layer[p] = 1; queue[qt++] = p; }
  }
  for (let qh = 0; qh < qt; qh++) {
    const p = queue[qh], L = layer[p];
    if (L >= 6) continue;
    for (let k = 0; k < 4; k++) {
      const q = k === 0 ? p - 1 : k === 1 ? p + 1 : k === 2 ? p - w : p + w;
      if (state[q] === 3 && !layer[q]) { layer[q] = L + 1; queue[qt++] = q; }
    }
  }
  for (let j = 0; j < qt; j++) {
    const p = queue[j];
    if (layer[p] > 3) break;   // the queue is in layer order
    let c = p;
    for (let st = 0; st < 5; st++) {   // walk inwards
      let best = -1, bl = layer[c];
      for (let k = 0; k < 4; k++) {
        const q = k === 0 ? c - 1 : k === 1 ? c + 1 : k === 2 ? c - w : c + w;
        if (state[q] !== 3) continue;
        const lq = layer[q] || 9;
        if (lq > bl) { bl = lq; best = q; }
      }
      if (best < 0) break;
      c = best;
    }
    if (layer[c] && layer[c] < 4) continue;   // no item deep enough next to it
    const i = p * 4, ci = c * 4;
    const dr = 255 - data[ci], dg = 255 - data[ci + 1], db = 255 - data[ci + 2];
    const den = dr * dr + dg * dg + db * db;
    if (den < 400) continue;
    let a = ((255 - data[i]) * dr + (255 - data[i + 1]) * dg + (255 - data[i + 2]) * db) / den;
    if (a >= 1) continue;
    if (a < 0) a = 0;
    const f = 1 - a;
    out[i] = data[i] - f * (255 - E[0]);
    out[i + 1] = data[i + 1] - f * (255 - E[1]);
    out[i + 2] = data[i + 2] - f * (255 - E[2]);
  }
}

/**
 * "Remove background" switched off: the item is the whole photo, a rectangle, and the opaque area is
 * exactly that rectangle grown by r. The top opaque row lies r - 1 above the rectangle and starts
 * one pixel left of its corner. There is no photo outside the rectangle, so its blend ring is pure
 * white; a rectangular item cut out of a larger photo (a card, a tote with a die-cut handle) has a
 * visible ring and may have holes, so it goes through the general path instead.
 */
function detectRect(cls, w, h) {
  let y0f = -1;
  for (let y = 0; y < h && y0f < 0; y++) for (let x = 0; x < w; x++) if (cls[y * w + x]) { y0f = y; break; }
  if (y0f < 0) return null;
  let xa = -1;
  for (let x = 0; x < w; x++) if (cls[y0f * w + x]) { xa = x; break; }
  const x0 = xa + 1, r = x0 - y0f + 1;
  if (r < 2) return null;
  const y0 = x0, x1 = w - 1 - x0, y1 = h - 1 - y0;
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  const k = Math.SQRT2 - 1, lim = r - 0.5;
  let nwOut = 0;
  for (let y = 0; y < h; y++) {
    const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
    for (let x = 0, p = y * w; x < w; x++, p++) {
      const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
      const d = dx > dy ? dx + k * dy : dy + k * dx;
      if (cls[p] ? d > lim + 0.15 : d <= lim) return null;
      if (d > 0 && cls[p] === FULL && ++nwOut > 2) return null;   // non-white outside the photo
    }
  }
  return { x0, y0, x1, y1, r };
}

/** Browser wrapper: PNG data URL of a white-border sticker -> PNG data URL with the border in `rgb`. */
export async function retintSticker(dataURL, rgb = EDGE_DEFAULT) {
  const img = new Image();
  img.src = dataURL;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, c.width, c.height);
  id.data.set(retintEdge(id.data, c.width, c.height, rgb));
  ctx.putImageData(id, 0, 0);
  return c.toDataURL('image/png');
}

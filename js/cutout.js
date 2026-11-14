// Background removal + sticker rendering, fully on-device.
// Works best with photos taken on a light, plain background.

const MAX_SIDE = 900;

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/** Draw image into a working canvas, downscaled. Returns ImageData. */
export function rasterize(img, maxSide = MAX_SIDE) {
  const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * s));
  const h = Math.max(1, Math.round(img.naturalHeight * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  // transparent PNGs (ready-made cut-outs) are treated as sitting on white
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** Strength applied automatically (bulk upload, first preview). Slider range is 6..110. */
export const DEFAULT_TOLERANCE = 60;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Slider value -> thresholds. u = 0 at the gentle end, 1 at the default, ~1.9 at the strong end. */
function cutParams(tolerance) {
  const t = clamp(+tolerance || 0, 0, 200);
  const u = Math.max(0, (t - 6) / (DEFAULT_TOLERANCE - 6));
  const lo = 0.02 + 0.08 * u, hi = 0.02 + 0.05 * u;
  return {
    u,
    cTol: 2.5 + 3.5 * u,              // chroma distance (levels) still counted as background
    rS: 1 - (0.02 + 0.025 * u),       // "plain background" brightness window, relative to the lighting model
    rHi: 1 + hi,
    rLo: 1 - lo,                      // down to here a darker patch still passes if nothing sharp separates it
    gEdge: 0.016 * Math.max(0.5, u),  // a brightness step this sharp (per px) is an outline, not lighting
    rMin: Math.max(0.3, 1 - lo - 0.4 * u), // deepest shadow that may be followed
    rMax: 1 + hi + 0.1 * Math.min(1.5, u), // brightest soft highlight that may be followed
    eps: 0.0025 / Math.max(0.25, u),  // a shadow must keep getting darker by this much per px
    gMax: 0.03 + 0.05 * u,            // steeper than this is an edge, not a shadow
    edgeContrast: 14,                 // outline is only re-placed where garment and surroundings differ this much (levels)
    edgeChroma: 9,                    // ...or where the garment has this much colour cast of its own (levels)
    seedTol: 29 * Math.max(0.2, t / DEFAULT_TOLERANCE), // colour distance for a tapped erase point
  };
}

function dist(d, i, r, g, b) {
  const dr = d[i] - r, dg = d[i + 1] - g, db = d[i + 2] - b;
  // weighted so subtle chroma differences (beige on cream) still register
  return Math.sqrt((2 * dr * dr + 4 * dg * dg + 3 * db * db) / 3);
}

/** Box-downsample RGBA to three float planes (factor 1 or 2). */
function toPlanes(data, w, h, f, W, H) {
  const N = W * H;
  const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N);
  if (f === 1) {
    for (let p = 0, i = 0; p < N; p++, i += 4) { R[p] = data[i]; G[p] = data[i + 1]; B[p] = data[i + 2]; }
    return [R, G, B];
  }
  for (let y = 0; y < H; y++) {
    const ya = 2 * y, yb = Math.min(h - 1, ya + 1);
    for (let x = 0; x < W; x++) {
      const xa = 2 * x, xb = Math.min(w - 1, xa + 1);
      const a = (ya * w + xa) * 4, b = (ya * w + xb) * 4, c = (yb * w + xa) * 4, d = (yb * w + xb) * 4;
      const p = y * W + x;
      R[p] = (data[a] + data[b] + data[c] + data[d]) * 0.25;
      G[p] = (data[a + 1] + data[b + 1] + data[c + 1] + data[d + 1]) * 0.25;
      B[p] = (data[a + 2] + data[b + 2] + data[c + 2] + data[d + 2]) * 0.25;
    }
  }
  return [R, G, B];
}

/** In-place separable 1-2-1 blur. */
function blur121(a, W, H, tmp) {
  for (let y = 0; y < H; y++) {
    const o = y * W;
    tmp[o] = (3 * a[o] + a[o + 1]) * 0.25;
    for (let x = 1; x < W - 1; x++) tmp[o + x] = (a[o + x - 1] + 2 * a[o + x] + a[o + x + 1]) * 0.25;
    tmp[o + W - 1] = (3 * a[o + W - 1] + a[o + W - 2]) * 0.25;
  }
  for (let x = 0; x < W; x++) a[x] = (3 * tmp[x] + tmp[x + W]) * 0.25;
  for (let p = W; p < W * (H - 1); p++) a[p] = (tmp[p - W] + 2 * tmp[p] + tmp[p + W]) * 0.25;
  for (let p = W * (H - 1); p < W * H; p++) a[p] = (3 * tmp[p] + tmp[p - W]) * 0.25;
}

/** Grey-level 3x3 max (sign=1) or min (sign=-1), separable, src -> dst using tmp. */
function minmax3(src, dst, W, H, tmp, isMax) {
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let x = 0; x < W; x++) {
      const c = src[o + x], l = x > 0 ? src[o + x - 1] : c, r = x < W - 1 ? src[o + x + 1] : c;
      tmp[o + x] = isMax ? (l > c ? (l > r ? l : r) : (c > r ? c : r)) : (l < c ? (l < r ? l : r) : (c < r ? c : r));
    }
  }
  for (let y = 0; y < H; y++) {
    const o = y * W, up = y > 0 ? o - W : o, dn = y < H - 1 ? o + W : o;
    for (let x = 0; x < W; x++) {
      const c = tmp[o + x], l = tmp[up + x], r = tmp[dn + x];
      dst[o + x] = isMax ? (l > c ? (l > r ? l : r) : (c > r ? c : r)) : (l < c ? (l < r ? l : r) : (c < r ? c : r));
    }
  }
}

/** In-place separable box blur of radius r (running sums, edges renormalised). */
function boxBlur(a, W, H, r, tmp) {
  for (let y = 0; y < H; y++) {
    const o = y * W; let s = 0, c = 0;
    for (let x = 0; x <= r && x < W; x++) { s += a[o + x]; c++; }
    for (let x = 0; x < W; x++) {
      tmp[o + x] = s / c;
      const add = x + r + 1, sub = x - r;
      if (add < W) { s += a[o + add]; c++; }
      if (sub >= 0) { s -= a[o + sub]; c--; }
    }
  }
  for (let x = 0; x < W; x++) {
    let s = 0, c = 0;
    for (let y = 0; y <= r && y < H; y++) { s += tmp[y * W + x]; c++; }
    for (let y = 0; y < H; y++) {
      a[y * W + x] = s / c;
      const add = y + r + 1, sub = y - r;
      if (add < H) { s += tmp[add * W + x]; c++; }
      if (sub >= 0) { s -= tmp[sub * W + x]; c--; }
    }
  }
}

// ---- smooth lighting model: low-order 2-D polynomial fitted to background cells ----

function polyTerms(deg) {
  const t = [];
  for (let d = 0; d <= deg; d++) for (let j = 0; j <= d; j++) t.push(d - j, j);
  return t;
}
function polyBasis(terms, x, y, out) {
  for (let k = 0, m = terms.length >> 1; k < m; k++) {
    let v = 1;
    for (let i = terms[2 * k]; i > 0; i--) v *= x;
    for (let j = terms[2 * k + 1]; j > 0; j--) v *= y;
    out[k] = v;
  }
}
/** Least squares for several right-hand sides at once. xs, ys in -1..1. Returns one coef array per value array. */
function polyFit(terms, xs, ys, vals, use, count) {
  const m = terms.length >> 1, nv = vals.length;
  const A = new Float64Array(m * m), rhs = vals.map(() => new Float64Array(m)), b = new Float64Array(m);
  for (let i = 0; i < count; i++) {
    const wt = use[i];          // 0/1 mask or a real weight
    if (!wt) continue;
    polyBasis(terms, xs[i], ys[i], b);
    for (let r = 0; r < m; r++) {
      const br = b[r] * wt;
      for (let c = r; c < m; c++) A[r * m + c] += br * b[c];
      for (let v = 0; v < nv; v++) rhs[v][r] += br * vals[v][i];
    }
  }
  for (let r = 0; r < m; r++) for (let c = 0; c < r; c++) A[r * m + c] = A[c * m + r];
  // light ridge on the non-constant terms keeps the surface tame where there is no data
  const tr = A[0] || 1;
  for (let r = 1; r < m; r++) A[r * m + r] += tr * 1e-4 * (terms[2 * r] + terms[2 * r + 1]);
  // Gaussian elimination with partial pivoting
  for (let c = 0; c < m; c++) {
    let piv = c, best = Math.abs(A[c * m + c]);
    for (let r = c + 1; r < m; r++) { const v = Math.abs(A[r * m + c]); if (v > best) { best = v; piv = r; } }
    if (best < 1e-12) continue;
    if (piv !== c) {
      for (let k = 0; k < m; k++) { const t = A[c * m + k]; A[c * m + k] = A[piv * m + k]; A[piv * m + k] = t; }
      for (let v = 0; v < nv; v++) { const t = rhs[v][c]; rhs[v][c] = rhs[v][piv]; rhs[v][piv] = t; }
    }
    const d = A[c * m + c];
    for (let r = c + 1; r < m; r++) {
      const fac = A[r * m + c] / d;
      if (fac === 0) continue;
      for (let k = c; k < m; k++) A[r * m + k] -= fac * A[c * m + k];
      for (let v = 0; v < nv; v++) rhs[v][r] -= fac * rhs[v][c];
    }
  }
  for (let v = 0; v < nv; v++) {
    const x = rhs[v];
    for (let r = m - 1; r >= 0; r--) {
      let s = x[r];
      for (let k = r + 1; k < m; k++) s -= A[r * m + k] * x[k];
      const d = A[r * m + r];
      x[r] = Math.abs(d) < 1e-12 ? 0 : s / d;
    }
  }
  return rhs;
}
function polyEvalAll(terms, coef, xs, ys, count, out) {
  const m = terms.length >> 1, b = new Float64Array(m);
  for (let i = 0; i < count; i++) {
    polyBasis(terms, xs[i], ys[i], b);
    let s = 0;
    for (let k = 0; k < m; k++) s += coef[k] * b[k];
    out[i] = s;
  }
}
function medianOf(arr, use, count) {
  const v = [];
  for (let i = 0; i < count; i++) if (use[i]) v.push(arr[i]);
  if (!v.length) return 0;
  v.sort((a, b) => a - b);
  return v[v.length >> 1];
}

/**
 * Lighting model on a coarse grid: brightness of the bare background at every cell (mY) and its
 * colour cast (mU = R/Y, mV = B/Y). Starts from the image frame, then grows over everything that
 * is connected to the frame and looks like the same surface, and refits.
 */
function fitLighting(Yc, Y, R, B, W, H) {
  const cs = Math.max(2, Math.round(Math.max(W, H) / 64));
  const gw = Math.ceil(W / cs), gh = Math.ceil(H / cs), gn = gw * gh;
  const cY = new Float32Array(gn), cU = new Float32Array(gn), cV = new Float32Array(gn);
  const xs = new Float32Array(gn), ys = new Float32Array(gn);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const x0 = gx * cs, y0 = gy * cs, x1 = Math.min(W, x0 + cs), y1 = Math.min(H, y0 + cs);
    let sy = 0, sc = 0, sr = 0, sb = 0, c = 0;
    for (let y = y0; y < y1; y++) for (let x = x0, p = y * W + x0; x < x1; x++, p++) { sc += Yc[p]; sy += Y[p]; sr += R[p]; sb += B[p]; c++; }
    const g = gy * gw + gx, inv = 1 / Math.max(1, sy);
    cY[g] = sc / c; cU[g] = sr * inv; cV[g] = sb * inv;
    xs[g] = gw > 1 ? (2 * gx) / (gw - 1) - 1 : 0; ys[g] = gh > 1 ? (2 * gy) / (gh - 1) - 1 : 0;
  }
  const use = new Uint8Array(gn), ring = new Uint8Array(gn);
  const rw = Math.max(1, Math.min(2, (Math.min(gw, gh) / 8) | 0));
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    if (gx < rw || gy < rw || gx >= gw - rw || gy >= gh - rw) ring[gy * gw + gx] = 1;
  }
  const mY = new Float32Array(gn), mU = new Float32Array(gn), mV = new Float32Array(gn);
  const res = new Float32Array(gn);
  const t2 = polyTerms(2), t1 = polyTerms(1);
  let termsY = t2;

  // 1) Frame only: the quadratic surface that the largest share of frame cells agrees with (RANSAC),
  //    so a garment that pokes into the frame cannot drag the fit, however dark or light it is.
  const med = medianOf(cY, ring, gn);
  const ri = [];
  for (let g = 0; g < gn; g++) if (ring[g]) ri.push(g);
  const nr = ri.length, pick = new Uint8Array(gn);
  let coefY = new Float64Array(6); coefY[0] = med;
  if (nr >= 24) {
    let seed = 20240607, best = -1;
    const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x80000000; };
    const sel = new Int32Array(6), bb = new Float64Array(6);
    for (let trial = 0; trial < 90; trial++) {
      for (let k = 0; k < 6; k++) { sel[k] = ri[(rnd() * nr) | 0]; pick[sel[k]] = 1; }
      const cf = polyFit(t2, xs, ys, [cY], pick, gn)[0];
      for (let k = 0; k < 6; k++) pick[sel[k]] = 0;
      let agree = 0;
      for (let i = 0; i < nr; i++) {
        const g = ri[i];
        polyBasis(t2, xs[g], ys[g], bb);
        const v = cf[0] * bb[0] + cf[1] * bb[1] + cf[2] * bb[2] + cf[3] * bb[3] + cf[4] * bb[4] + cf[5] * bb[5];
        if (Math.abs(cY[g] - v) <= 0.03 * v) agree++;
      }
      if (agree > best) { best = agree; coefY = cf; }
    }
  }
  for (let it = 0; it < 3; it++) {
    polyEvalAll(t2, coefY, xs, ys, gn, mY);
    for (let g = 0; g < gn; g++) res[g] = Math.abs(cY[g] / Math.max(1, mY[g]) - 1);
    let k = 0;
    if (it === 0) { for (let g = 0; g < gn; g++) { use[g] = ring[g] && res[g] <= 0.03 ? 1 : 0; k += use[g]; } }
    else {
      const thr = clamp(4.5 * medianOf(res, use, gn), 0.03, 0.06);
      for (let g = 0; g < gn; g++) { use[g] = ring[g] && res[g] <= thr ? 1 : 0; k += use[g]; }
    }
    if (k < 8) { for (let g = 0; g < gn; g++) use[g] = ring[g] && Math.abs(cY[g] - med) < 0.3 * med ? 1 : 0; coefY = polyFit(t2, xs, ys, [cY], use, gn)[0]; break; }
    coefY = polyFit(t2, xs, ys, [cY], use, gn)[0];
  }
  polyEvalAll(t2, coefY, xs, ys, gn, mY);
  // colour cast from the same frame cells (robust: median first, then a plane through the inliers)
  const uMed = medianOf(cU, use, gn), vMed = medianOf(cV, use, gn);
  const useC = new Uint8Array(gn);
  const castOk = (g) => (Math.abs(cU[g] - uMed) + Math.abs(cV[g] - vMed)) * mY[g] < 9;
  for (let g = 0; g < gn; g++) useC[g] = use[g] && castOk(g) ? 1 : 0;
  let [coefU, coefV] = polyFit(t1, xs, ys, [cU, cV], useC, gn);
  polyEvalAll(t1, coefU, xs, ys, gn, mU); polyEvalAll(t1, coefV, xs, ys, gn, mV);

  // 2) Grow from those frame cells over everything that still looks like the same surface and is
  //    not separated by a jump in brightness (a garment that touches the frame stays out), then refit:
  //    a richer polynomial, anchored to the previous model where there is no data so it cannot swing
  //    off under a big garment, times a very smooth correction for what a polynomial cannot bend to
  //    (a hot spot in the middle of the photo).
  const queue = new Int32Array(gn), seen = new Uint8Array(gn), inl0 = Uint8Array.from(useC);
  const pY = Float32Array.from(mY), wts = new Float32Array(gn), tgt = new Float32Array(gn);
  const cr = new Float32Array(gn), cw = new Float32Array(gn), ctmp = new Float32Array(gn);
  const cR = Math.max(2, Math.round(Math.max(gw, gh) / 8));
  let grown = 0;
  for (let round = 0; round < 6; round++) {
    const band = round === 0 ? 0.09 : round === 1 ? 0.08 : 0.07;
    const cast = (g) => (Math.abs(cU[g] - mU[g]) + Math.abs(cV[g] - mV[g])) * cY[g] < 7;
    // (tighter on the dark side: a garment only a little darker than the background must stay out)
    const like = (g) => { const d = cY[g] / mY[g] - 1; return d < band && d > -0.045 && cast(g); };
    seen.fill(0); let qh = 0, qt = 0;
    for (let g = 0; g < gn; g++) if (inl0[g] && like(g)) { seen[g] = 1; queue[qt++] = g; }
    while (qh < qt) {
      const g = queue[qh++], gx = g % gw, v = cY[g], limUp = 0.06 * v, limDn = -0.03 * v;
      for (let k = 0; k < 4; k++) {
        const q = k === 0 ? g - 1 : k === 1 ? g + 1 : k === 2 ? g - gw : g + gw;
        if (k === 0 ? gx === 0 : k === 1 ? gx === gw - 1 : (q < 0 || q >= gn)) continue;
        const dv = cY[q] - v;
        if (seen[q] || dv >= limUp || dv <= limDn) continue;
        // Accept what matches the model and, along the frame itself, anything that changes as gently
        // as lighting does. Brighter areas are NOT followed step by step: the soft edge of a white
        // garment on a grey sheet climbs just as smoothly as a lighting hot spot, and following it
        // swallowed the whole garment. Real hot spots are picked up by the refit in the next round.
        if (like(q) || (cast(q) && ring[q] && ring[g] && Math.abs(cY[q] - v) < 0.035 * v)) { seen[q] = 1; queue[qt++] = q; }
      }
    }
    if (qt < 24 || (round >= 2 && qt <= grown * 1.02)) break;
    grown = qt;
    termsY = qt >= 120 ? polyTerms(4) : qt >= 60 ? polyTerms(3) : t2;
    for (let g = 0; g < gn; g++) { if (seen[g]) { wts[g] = 1; tgt[g] = cY[g]; } else { wts[g] = 0.05; tgt[g] = mY[g]; } }
    coefY = polyFit(termsY, xs, ys, [tgt], wts, gn)[0];
    polyEvalAll(termsY, coefY, xs, ys, gn, pY);
    for (let g = 0; g < gn; g++) { if (!(pY[g] > 8)) pY[g] = 8; if (seen[g]) { cr[g] = cY[g] / pY[g] - 1; cw[g] = 1; } else { cr[g] = 0; cw[g] = 0; } }
    for (let k = 0; k < 3; k++) { boxBlur(cr, gw, gh, cR, ctmp); boxBlur(cw, gw, gh, cR, ctmp); }
    for (let g = 0; g < gn; g++) mY[g] = pY[g] * (1 + cr[g] / (cw[g] + 0.02));
    [coefU, coefV] = polyFit(t1, xs, ys, [cU, cV], seen, gn);
    polyEvalAll(t1, coefU, xs, ys, gn, mU); polyEvalAll(t1, coefV, xs, ys, gn, mV);
  }
  for (let g = 0; g < gn; g++) if (!(mY[g] > 8)) mY[g] = 8;
  return { cs, gw, gh, mY, mU, mV };
}

/**
 * The actual segmentation, at working resolution (half size for big photos).
 * Returns { W, H, f, fg (Uint8Array 1 = garment), planes... } for the full-resolution finish.
 */
function segment(img, P) {
  const { data, width: w, height: h } = img;
  const f = Math.max(w, h) >= 560 ? 2 : 1;
  const W = Math.ceil(w / f), H = Math.ceil(h / f), N = W * H;
  const [R, G, B] = toPlanes(data, w, h, f, W, H);
  const tmp = new Float32Array(N);
  // closing (on the un-blurred brightness) wipes out thin dark lines - floorboard gaps, creases -
  // so they read as plain background
  const Y = new Float32Array(N), Yc = new Float32Array(N);
  for (let p = 0; p < N; p++) Y[p] = 0.299 * R[p] + 0.587 * G[p] + 0.114 * B[p];
  const raw = Float32Array.from(Y), line = new Uint8Array(N);
  minmax3(Y, Yc, W, H, tmp, true); minmax3(Yc, Y, W, H, tmp, false);
  minmax3(Y, Yc, W, H, tmp, false); minmax3(Yc, Y, W, H, tmp, true);   // ...and opening the thin bright ones
  Yc.set(Y);
  // remember where a thin line was wiped (plus two pixels either side): the brightness step that is
  // left there - floorboards differ in shade - is not an outline
  for (let p = 0; p < N; p++) if (Math.abs(Yc[p] - raw[p]) > 0.04 * raw[p]) line[p] = 1;
  for (let pass = 2; pass < 4; pass++) for (let p = 0; p < N; p++) {
    if (line[p] !== pass - 1) continue;
    const x = p % W;
    if (x > 0 && !line[p - 1]) line[p - 1] = pass;
    if (x < W - 1 && !line[p + 1]) line[p + 1] = pass;
    if (p >= W && !line[p - W]) line[p - W] = pass;
    if (p + W < N && !line[p + W]) line[p + W] = pass;
  }
  blur121(Yc, W, H, tmp);
  blur121(R, W, H, tmp); blur121(G, W, H, tmp); blur121(B, W, H, tmp);
  for (let p = 0; p < N; p++) Y[p] = 0.299 * R[p] + 0.587 * G[p] + 0.114 * B[p];

  const L = fitLighting(Yc, Y, R, B, W, H);

  // per-pixel: rho = brightness relative to the bare background here, dc = colour-cast distance in levels
  const rho = new Float32Array(N), cls = new Uint8Array(N);
  const { cs, gw, gh, mY, mU, mV } = L;
  const { cTol, rS, rLo, rHi, rMin, rMax } = P;
  for (let y = 0; y < H; y++) {
    const gyf = clamp((y + 0.5) / cs - 0.5, 0, gh - 1), gy0 = Math.min(gh - 2 < 0 ? 0 : gh - 2, gyf | 0), wy = gh > 1 ? gyf - gy0 : 0;
    const rowA = gy0 * gw, rowB = gh > 1 ? rowA + gw : rowA;
    for (let x = 0, p = y * W; x < W; x++, p++) {
      const gxf = clamp((x + 0.5) / cs - 0.5, 0, gw - 1), gx0 = Math.min(gw - 2 < 0 ? 0 : gw - 2, gxf | 0), wx = gw > 1 ? gxf - gx0 : 0;
      const a = rowA + gx0, b = gw > 1 ? a + 1 : a, c = rowB + gx0, d = gw > 1 ? c + 1 : c;
      const w00 = (1 - wx) * (1 - wy), w10 = wx * (1 - wy), w01 = (1 - wx) * wy, w11 = wx * wy;
      const my = mY[a] * w00 + mY[b] * w10 + mY[c] * w01 + mY[d] * w11;
      const mu = mU[a] * w00 + mU[b] * w10 + mU[c] * w01 + mU[d] * w11;
      const mv = mV[a] * w00 + mV[b] * w10 + mV[c] * w01 + mV[d] * w11;
      const r = Yc[p] / my;
      rho[p] = r;
      const yy = Y[p];
      const dr = R[p] - mu * yy, db = B[p] - mv * yy, dg = -(0.299 * dr + 0.114 * db) / 0.587;
      const dc2 = dr * dr + dg * dg + db * db;
      if (dc2 < cTol * cTol) cls[p] = r >= rS ? (r <= rHi ? 2 : r <= rMax ? 3 : 0) : (r >= rMin ? 1 : 0);
    }
  }

  // flood 1: plain background from the frame, plus enclosed pockets of plain background
  const bg = new Uint8Array(N), queue = new Int32Array(2 * N + 8);
  let qh = 0, qt = 0;
  const seedIf = (p) => { if (cls[p] === 2 && !bg[p]) { bg[p] = 1; queue[qt++] = p; } };
  for (let x = 0; x < W; x++) { seedIf(x); seedIf((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seedIf(y * W); seedIf(y * W + W - 1); }
  const grow2 = () => {
    while (qh < qt) {
      const p = queue[qh++], x = p % W;
      if (x > 0 && cls[p - 1] === 2 && !bg[p - 1]) { bg[p - 1] = 1; queue[qt++] = p - 1; }
      if (x < W - 1 && cls[p + 1] === 2 && !bg[p + 1]) { bg[p + 1] = 1; queue[qt++] = p + 1; }
      if (p >= W && cls[p - W] === 2 && !bg[p - W]) { bg[p - W] = 1; queue[qt++] = p - W; }
      if (p + W < N && cls[p + W] === 2 && !bg[p + W]) { bg[p + W] = 1; queue[qt++] = p + W; }
    }
  };
  grow2();
  const pocketMin = Math.max(12, Math.round(N * 0.0012));
  for (let s = 0; s < N; s++) {
    if (cls[s] !== 2 || bg[s]) continue;
    const start = qt; bg[s] = 1; queue[qt++] = s; qh = start;
    grow2();
    if (qt - start < pocketMin) { for (let k = start; k < qt; k++) bg[queue[k]] = 2; qt = start; }
  }
  for (let p = 0; p < N; p++) if (bg[p] === 2) bg[p] = 0;

  // smoothed rho for the "keeps getting darker" test; only background-plausible pixels take part.
  // How much smoothing depends on how grainy the bare background is.
  const { eps, gMax } = P;
  let noise = 0;
  {
    const hist = new Int32Array(64); let cnt = 0;
    for (let k = 0; k < qt; k += 3) {
      const p = queue[k];
      if (p > 0 && p + 1 < N && bg[p + 1] === 1 && bg[p - 1] === 1) { const dlt = Math.abs(rho[p + 1] + rho[p - 1] - 2 * rho[p]); hist[Math.min(63, (dlt * 8000) | 0)]++; cnt++; }
    }
    let acc = 0, b = 0;
    while (b < 63 && acc + hist[b] < cnt / 2) acc += hist[b++];
    noise = cnt ? (b + 0.5) / 8000 : 0;   // median second difference of rho on bare background
  }
  const rs = new Float32Array(N);
  const br = noise < 0.0007 ? 0 : Math.min(4, Math.max(1, Math.round(noise / 0.0006)));
  if (br === 0) rs.set(rho);
  else {
    const wsum = new Float32Array(N);
    for (let p = 0; p < N; p++) { if (cls[p]) { rs[p] = rho[p]; wsum[p] = 1; } }
    for (let k = 0; k < 3; k++) { boxBlur(rs, W, H, br, tmp); boxBlur(wsum, W, H, br, tmp); }
    for (let p = 0; p < N; p++) rs[p] = wsum[p] > 1e-3 ? rs[p] / wsum[p] : rho[p];
  }

  // Flood 2: everything else that is background-coloured but darker (or lighter) than plain.
  //  - A slightly darker patch (down to rLo) is taken as long as it is not on a sharp brightness step:
  //    lighting drift, wrinkles, the outskirts of a soft shadow. bg = 1, "plain mode".
  //  - On a sharp step, behind one, and anywhere deeper, the flood may only keep going DOWNHILL: a shadow
  //    gets steadily darker towards the garment, whereas a garment in a background-like colour is a
  //    flat plateau behind an outline - so the flood stops at its foot. bg = 2, "downhill mode".
  //  - It never climbs a sharp step and never drops off a cliff (gMax): those are outlines.
  const soft = 2 / 0.04, look = Math.max(3, Math.round(Math.max(W, H) / 110)), gentle = 6 * eps;
  const gB = (2 * P.gEdge) / Math.sqrt(1 + br * (br + 1)), gB2 = gB * gB, zoneLo = rLo - 0.02;
  const offs = [-1, 1, -W, W];
  qh = 0;
  while (qh < qt) {
    const p = queue[qh++], x = p % W, rp = rs[p], mode = bg[p], cliff = rho[p] - gMax;
    for (let k = 0; k < 4; k++) {
      const o = offs[k], q = p + o;
      if (k === 0) { if (x === 0) continue; } else if (k === 1) { if (x === W - 1) continue; } else if (q < 0 || q >= N) continue;
      const c = cls[q], was = bg[q];
      if (c === 0 || was === 1 || (was === 2 && mode === 2)) continue;
      if (c === 2) { bg[q] = 1; queue[qt++] = q; continue; }
      const rq = rs[q];
      if (c === 3) {
        // mirror image for soft highlights: must keep getting brighter, never in a sharp step
        let e = (rq - rHi) * soft - 1; e = e > 1 ? eps : e < -1 ? -eps : e * eps;
        if (!was && rq >= rp + e && rho[q] <= rho[p] + gMax) { bg[q] = 1; queue[qt++] = q; }
        continue;
      }
      if (rho[q] < cliff) continue;
      const drop = rp - rq;
      if (mode === 1 && rq >= zoneLo) {
        // is q on a sharp brightness step (any direction)? then it is not "gentle"
        const xq = k === 0 ? x - 1 : k === 1 ? x + 1 : x;
        const gx = xq > 0 && xq < W - 1 ? rs[q + 1] - rs[q - 1] : 0, gy = q >= W && q + W < N ? rs[q + W] - rs[q - W] : 0;
        if (line[q] || gx * gx + gy * gy < gB2) { bg[q] = 1; queue[qt++] = q; continue; }
      }
      if (was) continue;
      let ok = drop >= eps;
      if (!ok && drop >= -0.5 * eps) {
        // locally flat: fine if we are on a gentle slope that keeps dropping just beyond
        // (a flat spot in a soft shadow, not the top of a plateau and not the foot of an edge)
        const back = p - o;
        const backOk = k < 2 ? (k === 0 ? x < W - 1 : x > 0) : (back >= 0 && back < N);
        if (backOk && cls[back] !== 0 && rs[back] - rp <= gentle && rs[back] >= rp - 0.5 * eps) {
          let xx = x + (k === 0 ? -1 : k === 1 ? 1 : 0), t = q;
          for (let j = 2; j <= look; j++) {
            t += o;
            if (k < 2) { xx += k === 0 ? -1 : 1; if (xx < 0 || xx >= W) break; } else if (t < 0 || t >= N) break;
            const rt = rs[t];
            if (cls[t] !== 1 || rt > rp + 0.5 * eps || rt < rp - gentle * j) break;
            if (rt <= rp - eps * j) { ok = true; break; }
          }
        }
      }
      if (ok) { bg[q] = 2; queue[qt++] = q; }
    }
  }

  // A garment only a little darker than the background has no outline where its own soft shadow
  // happens to be exactly as dark, and the plain-mode flood walks in through that gap. So look at
  // every flat patch it took: if a good part of the patch's rim is a sharp step up to brighter ground, the
  // patch is an object lying on the background (give it back); lighting drift and wrinkles have
  // soft rims all round.
  {
    const flat = new Uint8Array(N), gF = 2 * 3 * eps, gF2 = gF * gF;
    const grad2 = (p) => {
      const x = p % W;
      const gx = x > 0 && x < W - 1 ? rs[p + 1] - rs[p - 1] : 0, gy = p >= W && p + W < N ? rs[p + W] - rs[p - W] : 0;
      return gx * gx + gy * gy;
    };
    for (let p = 0; p < N; p++) if (bg[p] === 1 && cls[p] === 1 && grad2(p) < gF2) flat[p] = 1;
    const stack = queue, minPatch = pocketMin;
    for (let s = 0; s < N; s++) {
      if (flat[s] !== 1) continue;
      let sp = 0, cnt = 0, rim = 0, sharp = 0, sum = 0;
      stack[cnt++] = s; flat[s] = 2;
      while (sp < cnt) {
        const p = stack[sp++], x = p % W;
        sum += rho[p];
        for (let k = 0; k < 4; k++) {
          const q = p + offs[k];
          if (k === 0 ? x === 0 : k === 1 ? x === W - 1 : (q < 0 || q >= N)) continue;
          if (flat[q] === 1) { flat[q] = 2; stack[cnt++] = q; }
          else if (!flat[q]) {
            // Look a few pixels outward. A steep step there (the foot of an edge is not steep yet)
            // makes this a sharp rim - unless the step is a wiped thin line (a floorboard gap: boards
            // differ in shade too) or leads into something with a colour of its own (then this patch
            // is just background next to a garment, and that stretch of rim says nothing).
            rim++;
            let steep = 0, top = rs[p];
            for (let j = 0, t = q, xx = x + (k === 0 ? -1 : k === 1 ? 1 : 0); j < 6; j++) {
              if (!cls[t]) { rim--; steep = 0; break; }
              if (line[t]) { steep = 0; break; }
              if (j < 3 && grad2(t) >= gB2) steep = 1;
              if (rs[t] > top) top = rs[t];
              t += offs[k];
              if (k < 2) { xx += k === 0 ? -1 : 1; if (xx < 0 || xx >= W) break; } else if (t < 0 || t >= N) break;
            }
            // only steps UP to brighter surroundings count: next to a sharp shadow the step goes down
            if (steep && top - rs[p] >= gB) sharp++;
          }
        }
      }
      if (cnt >= minPatch && sharp >= 0.25 * rim && sum / cnt < rS - 0.01) for (let i = 0; i < cnt; i++) bg[stack[i]] = 0;
    }
  }

  // with a smoothed test the flood nibbles the rim of flat shadow-coloured garments: give it back
  if (br > 0) {
    const ref = new Float32Array(N), depth = new Uint8Array(N), maxDepth = 2 * br + 1, wFlat = 0.012 + 4 * noise;
    let h2 = 0, t2 = 0;
    const q2 = new Int32Array(N);
    for (let p = 0; p < N; p++) {
      if (bg[p] || cls[p] !== 1) continue;
      const x = p % W;
      if ((x > 0 && bg[p - 1] && cls[p - 1] === 1) || (x < W - 1 && bg[p + 1] && cls[p + 1] === 1) ||
          (p >= W && bg[p - W] && cls[p - W] === 1) || (p + W < N && bg[p + W] && cls[p + W] === 1)) { ref[p] = rs[p]; q2[t2++] = p; }
    }
    while (h2 < t2) {
      const p = q2[h2++], x = p % W, d = depth[p], rf = ref[p];
      if (d >= maxDepth) continue;
      for (let k = 0; k < 4; k++) {
        const q = p + offs[k];
        if (k === 0) { if (x === 0) continue; } else if (k === 1) { if (x === W - 1) continue; } else if (q < 0 || q >= N) continue;
        if (!bg[q] || cls[q] !== 1 || Math.abs(rho[q] - rf) > wFlat) continue;
        bg[q] = 0; ref[q] = rf; depth[q] = d + 1; q2[t2++] = q;
      }
    }
  }

  const fg = new Uint8Array(N);
  for (let p = 0; p < N; p++) fg[p] = bg[p] ? 0 : 1;
  return { W, H, f, fg, cls, rho, rs, R, G, B, L, noise, br, stage: bg };
}

// ---- binary morphology on the working-resolution mask ----
function erode4(m, W, H, edge) {
  const o = new Uint8Array(m.length);
  for (let y = 0; y < H; y++) for (let x = 0, p = y * W; x < W; x++, p++) {
    if (!m[p]) continue;
    const l = x > 0 ? m[p - 1] : edge, r = x < W - 1 ? m[p + 1] : edge, u = y > 0 ? m[p - W] : edge, d = y < H - 1 ? m[p + W] : edge;
    o[p] = l & r & u & d;
  }
  return o;
}
function dilate4(m, W, H) {
  const o = new Uint8Array(m.length);
  for (let y = 0; y < H; y++) for (let x = 0, p = y * W; x < W; x++, p++) {
    o[p] = m[p] | (x > 0 ? m[p - 1] : 0) | (x < W - 1 ? m[p + 1] : 0) | (y > 0 ? m[p - W] : 0) | (y < H - 1 ? m[p + W] : 0);
  }
  return o;
}

/** Drop connected regions of `val` smaller than minSize (set them to 1 - val). Returns sizes of the largest region. */
function dropSmall(m, W, H, val, minSizeAbs, minRel) {
  const N = W * H, label = new Int32Array(N), stack = new Int32Array(N), sizes = [0];
  let cur = 0, biggest = 0;
  for (let s = 0; s < N; s++) {
    if (m[s] !== val || label[s]) continue;
    cur++; let sp = 0, size = 0;
    stack[sp++] = s; label[s] = cur;
    while (sp) {
      const q = stack[--sp]; size++;
      const x = q % W;
      if (x > 0 && m[q - 1] === val && !label[q - 1]) { label[q - 1] = cur; stack[sp++] = q - 1; }
      if (x < W - 1 && m[q + 1] === val && !label[q + 1]) { label[q + 1] = cur; stack[sp++] = q + 1; }
      if (q >= W && m[q - W] === val && !label[q - W]) { label[q - W] = cur; stack[sp++] = q - W; }
      if (q + W < N && m[q + W] === val && !label[q + W]) { label[q + W] = cur; stack[sp++] = q + W; }
    }
    sizes.push(size); if (size > biggest) biggest = size;
  }
  const min = Math.max(minSizeAbs, biggest * minRel);
  for (let p = 0; p < N; p++) if (label[p] && sizes[label[p]] < min) m[p] = 1 - val;
  return biggest;
}

/** Tidy the working-resolution mask: thin background-coloured threads, pinholes, stray specks. */
function tidy(S, P) {
  const { W, H, cls } = S, N = W * H;
  let fg = S.fg;
  if (P.u > 0.15) {
    // Leftovers in a background-like colour that border removed background: the far end of a crevice,
    // the shadow under a strap. Tiny ones go; bigger ones go when their brightness slopes like a
    // shadow does (a flat patch could be a grey cuff or buckle and stays).
    const rs = S.rs;
    let area = 0;
    for (let p = 0; p < N; p++) area += fg[p];
    const k = Math.min(1.5, P.u), tiny = N * 0.0005 * k, big = Math.min(area * 0.06, N * 0.008) * k;
    const seen = new Uint8Array(N), stack = new Int32Array(N);
    for (let s = 0; s < N; s++) {
      if (!fg[s] || !cls[s] || seen[s]) continue;
      let sp = 0, cnt = 0, touch = 0, inner = 0, rim = 0;
      stack[cnt++] = s; seen[s] = 1;
      while (sp < cnt) {
        const p = stack[sp++], x = p % W;
        let own = 0;
        for (let d = 0; d < 4; d++) {
          const q = d === 0 ? p - 1 : d === 1 ? p + 1 : d === 2 ? p - W : p + W;
          if (d === 0 ? x === 0 : d === 1 ? x === W - 1 : (q < 0 || q >= N)) continue;
          if (!fg[q]) { touch++; continue; }
          if (cls[q]) { own++; if (!seen[q]) { seen[q] = 1; stack[cnt++] = q; } }
        }
        if (own === 4) inner++; else rim += 4 - own;
      }
      // enclosed or nearly so (a seam between two colours of the garment), large, or thread-thin: keep
      if (touch < 2 || touch < rim * 0.06 || cnt > big || inner < 2 || inner < cnt * 0.15) continue;
      let drop = cnt <= tiny;
      if (!drop) {
        const v = new Float32Array(cnt);
        for (let i = 0; i < cnt; i++) v[i] = rs[stack[i]];
        v.sort();
        drop = v[(cnt * 0.8) | 0] - v[(cnt * 0.2) | 0] >= 0.035;
      }
      if (drop) for (let i = 0; i < cnt; i++) fg[stack[i]] = 0;
    }
  }
  if (P.u > 0.15) {
    // thin leftovers in a background-like colour (ridge lines of shadows, board gaps) go; anything
    // with a colour of its own stays however thin it is
    const open = dilate4(erode4(fg, W, H, 1), W, H);
    for (let p = 0; p < N; p++) if (fg[p] && !open[p] && cls[p]) fg[p] = 0;
  }
  dropSmall(fg, W, H, 0, Math.max(4, Math.round(N * 0.0003)), 0);       // pinholes
  dropSmall(fg, W, H, 1, Math.max(4, Math.round(N * 0.00008)), 0.04);   // specks, keeps pairs (shoes)
  return fg;
}

// ---- prune: long thin background structures the segmentation kept (crease and fold lines, floorboard
// seams, tile grout, the edge of a rug or a cast shadow, cables) ----

/** Chamfer distance (px) from every pixel with m[p] = 1 to the nearest pixel with m[p] = 0, computed inside the
 *  box x0..x1, y0..y1 only. outside = 1: beyond the frame counts as more of the same; 0: as a zero pixel.
 *  boxOut: the same for pixels outside the box but inside the frame. */
function chamferIn(m, W, H, outside, x0, y0, x1, y1, boxOut) {
  const N = W * H, d = new Float32Array(N), INF = 1e6, E = outside ? INF : 0, EB = boxOut ? INF : 0, D = Math.SQRT2;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? E : x < x0 || x > x1 || y < y0 || y > y1 ? EB : d[y * W + x]);
  for (let y = y0; y <= y1; y++) for (let x = x0, p = y * W + x0; x <= x1; x++, p++) d[p] = m[p] ? INF : 0;
  for (let y = y0; y <= y1; y++) {
    const inY = y > y0;
    for (let x = x0, p = y * W + x0; x <= x1; x++, p++) {
      let v = d[p]; if (!v) continue;
      const l = x > x0 ? d[p - 1] : at(x - 1, y), u = inY ? d[p - W] : at(x, y - 1);
      const ul = x > x0 && inY ? d[p - W - 1] : at(x - 1, y - 1), ur = x < x1 && inY ? d[p - W + 1] : at(x + 1, y - 1);
      if (l + 1 < v) v = l + 1; if (u + 1 < v) v = u + 1; if (ul + D < v) v = ul + D; if (ur + D < v) v = ur + D;
      d[p] = v;
    }
  }
  for (let y = y1; y >= y0; y--) {
    const inY = y < y1;
    for (let x = x1, p = y * W + x1; x >= x0; x--, p--) {
      let v = d[p]; if (!v) continue;
      const r = x < x1 ? d[p + 1] : at(x + 1, y), b = inY ? d[p + W] : at(x, y + 1);
      const br = x < x1 && inY ? d[p + W + 1] : at(x + 1, y + 1), bl = x > x0 && inY ? d[p + W - 1] : at(x - 1, y + 1);
      if (r + 1 < v) v = r + 1; if (b + 1 < v) v = b + 1; if (br + D < v) v = br + D; if (bl + D < v) v = bl + D;
      d[p] = v;
    }
  }
  return d;
}

/** The bare background at working pixel p from the lighting model (same interpolation as segment): out = [Y, R/Y, B/Y]. */
function bgAt(S, p, out) {
  const { W, L: { cs, gw, gh, mY, mU, mV } } = S, x = p % W, y = (p / W) | 0;
  const gyf = clamp((y + 0.5) / cs - 0.5, 0, gh - 1), gy0 = Math.min(gh - 2 < 0 ? 0 : gh - 2, gyf | 0), wy = gh > 1 ? gyf - gy0 : 0;
  const rowA = gy0 * gw, rowB = gh > 1 ? rowA + gw : rowA;
  const gxf = clamp((x + 0.5) / cs - 0.5, 0, gw - 1), gx0 = Math.min(gw - 2 < 0 ? 0 : gw - 2, gxf | 0), wx = gw > 1 ? gxf - gx0 : 0;
  const a = rowA + gx0, b = gw > 1 ? a + 1 : a, c = rowB + gx0, d = gw > 1 ? c + 1 : c;
  const w00 = (1 - wx) * (1 - wy), w10 = wx * (1 - wy), w01 = (1 - wx) * wy, w11 = wx * wy;
  out[0] = mY[a] * w00 + mY[b] * w10 + mY[c] * w01 + mY[d] * w11;
  out[1] = mU[a] * w00 + mU[b] * w10 + mU[c] * w01 + mU[d] * w11;
  out[2] = mV[a] * w00 + mV[b] * w10 + mV[c] * w01 + mV[d] * w11;
  return out;
}
const bgTmp = new Float64Array(3);

/**
 * Colour verdict for a group of mask pixels: does it look like the garment it hangs on ('own'),
 * like the background in a darker or lighter shade ('bg': creases, seams, shadow edges), or like
 * neither ('other': a cable)? Colours are read at full resolution (the line's own centre, not the blurred
 * mix with its surroundings) and compared with samples of the garment's solid core.
 */
function colourVerdict(img, S, P, pix, cnt, samples, ns, dIn) {
  // only the middle of the piece votes (its rim is a blend with the background)
  let dMax = 1;
  for (let i = 0; i < cnt; i++) if (dIn[pix[i]] > dMax) dMax = dIn[pix[i]];
  const dMin = Math.max(1, 0.6 * dMax);
  let nv = 0;
  for (let i = 0; i < cnt; i++) if (dIn[pix[i]] >= dMin) nv++;
  const step = Math.max(1, Math.floor(nv / 96));
  const n3 = [0, 0, 0];
  let tot = 0, seen = 0;
  for (let i = 0; i < cnt; i++) {
    const p = pix[i];
    if (dIn[p] < dMin || (seen++ % step)) continue;
    n3[pixelVote(img, S, P, p, samples, ns)]++; tot++;
  }
  const [own, bgv, oth] = n3, share = tot ? own / tot : 0;
  if (!tot) return { v: 'amb', own: 0 };
  if (own >= 0.55 * tot) return { v: 'own', own: share };
  if (bgv >= 0.5 * tot) return { v: 'bg', own: share };
  if (oth >= 0.5 * tot) return { v: 'other', own: share };
  return { v: 'amb', own: share };
}

/** One pixel's vote: 0 = the garment's colour, 1 = the background's colour (darker or lighter), 2 = neither. */
function pixelVote(img, S, P, p, samples, ns) {
  const { data, width: w, height: h } = img;
  const { W, f, cls } = S;
  const [yb, bu, bv] = bgAt(S, p, bgTmp);
  const castTol = 1.5 * P.cTol + 4;
  const x = p % W, y = (p / W) | 0;
  const rb = bu * yb, bb = bv * yb, gb = (yb - 0.299 * rb - 0.114 * bb) / 0.587;
  // the full-resolution pixel of this block that is least like the background
  let cr = 0, cg = 0, cb = 0, best = -1;
  for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
    const X = x * f + dx, Y = y * f + dy; if (X >= w || Y >= h) continue;
    const o = (Y * w + X) * 4, r = data[o], g = data[o + 1], b = data[o + 2];
    const dd = (r - rb) * (r - rb) + (g - gb) * (g - gb) + (b - bb) * (b - bb);
    if (dd > best) { best = dd; cr = r; cg = g; cb = b; }
  }
  const dB = Math.sqrt(best), er = cr - rb, eg = cg - gb, eb = cb - bb;
  let dC2 = 1e9, mixOk = false;
  for (let k = 0; k < ns; k++) {
    const sr = samples[3 * k], sg = samples[3 * k + 1], sb = samples[3 * k + 2];
    const a = sr - cr, b2 = sg - cg, c = sb - cb;
    const v = a * a + b2 * b2 + c * c; if (v < dC2) dC2 = v;
    if (!mixOk) {
      // or a blend of this garment colour and the background, mostly garment (soft or sub-pixel edge)
      const vr = sr - rb, vg = sg - gb, vb = sb - bb, vv = vr * vr + vg * vg + vb * vb;
      if (vv > 400) {
        const al = (er * vr + eg * vg + eb * vb) / vv;
        if (al >= 0.75) { const qr = er - al * vr, qg = eg - al * vg, qb = eb - al * vb; if (qr * qr + qg * qg + qb * qb < 256) mixOk = true; }
      }
    }
  }
  const dC = Math.sqrt(dC2);
  if (mixOk || (dC < 30 && dC < 0.6 * dB)) return 0;
  const yy = 0.299 * cr + 0.587 * cg + 0.114 * cb, dr = cr - bu * yy, db = cb - bv * yy, dg = -(0.299 * dr + 0.114 * db) / 0.587;
  const ratio = yy / yb;
  if (cls[p] || dB < 18 || (dr * dr + dg * dg + db * db < castTol * castTol && ratio > 0.3 && ratio < 1.3)) return 1;
  return 2;
}

/** Collect colour samples of the garment's solid core (away from its rim) in a window. */
function sampleCore(S, core, dIn, cx, cy, rad, samples, ns, cap) {
  const { W, H, R, G, B } = S;
  const x0 = Math.max(0, cx - rad), x1 = Math.min(W - 1, cx + rad), y0 = Math.max(0, cy - rad), y1 = Math.min(H - 1, cy + rad);
  for (let y = y0; y <= y1 && ns < cap; y += 2) for (let x = x0, p = y * W + x0; x <= x1 && ns < cap; x += 2, p += 2) {
    if (!core[p] || dIn[p] < 2.5) continue;
    samples[3 * ns] = R[p]; samples[3 * ns + 1] = G[p]; samples[3 * ns + 2] = B[p]; ns++;
  }
  return ns;
}

/**
 * Shape and colour of a piece of the mask: len = its length along its main axis (px), elong = length / width
 * (a straight line scores high, a curved strap low), and how its colour sits between the background (al = 0) and
 * the garment samples (al = 1): al along that axis, res off it, gbC = how far apart garment and background are.
 */
function pieceFeatures(img, S, pix, cnt, samples, ns, dIn) {
  const { W, f } = S, { data, width: w, height: h } = img;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, dmax = 0;
  for (let i = 0; i < cnt; i++) { const p = pix[i], x = p % W, y = (p / W) | 0; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; if (dIn[p] > dmax) dmax = dIn[p]; }
  const mx = sx / cnt, my = sy / cnt, cxx = sxx / cnt - mx * mx, cyy = syy / cnt - my * my, cxy = sxy / cnt - mx * my;
  const tr = cxx + cyy, det = cxx * cyy - cxy * cxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(0.25, tr / 2 - disc);
  // colour: per working pixel in the middle of the piece, the full-resolution pixel least like the background
  let pr = 0, pg = 0, pb = 0, br = 0, bgc = 0, bb = 0, n = 0;
  const step = Math.max(1, Math.floor(cnt / 400));
  for (let i = 0; i < cnt; i += step) {
    const p = pix[i]; if (dIn[p] < 0.6 * dmax) continue;
    const [yb, bu, bv] = bgAt(S, p, bgTmp), x = p % W, y = (p / W) | 0, rb = bu * yb, b2 = bv * yb, gb = (yb - 0.299 * rb - 0.114 * b2) / 0.587;
    let best = -1, cr = 0, cg = 0, cb = 0;
    for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
      const X = x * f + dx, Y = y * f + dy; if (X >= w || Y >= h) continue;
      const o = (Y * w + X) * 4, r = data[o], g = data[o + 1], b = data[o + 2], dd = (r - rb) * (r - rb) + (g - gb) * (g - gb) + (b - b2) * (b - b2);
      if (dd > best) { best = dd; cr = r; cg = g; cb = b; }
    }
    pr += cr; pg += cg; pb += cb; br += rb; bgc += gb; bb += b2; n++;
  }
  n = Math.max(1, n); pr /= n; pg /= n; pb /= n; br /= n; bgc /= n; bb /= n;
  let gr = 0, gg = 0, gbl = 0;
  for (let k = 0; k < ns; k++) { gr += samples[3 * k]; gg += samples[3 * k + 1]; gbl += samples[3 * k + 2]; }
  const m = 1 / Math.max(1, ns); gr *= m; gg *= m; gbl *= m;
  const vr = gr - br, vg = gg - bgc, vb = gbl - bb, vv = vr * vr + vg * vg + vb * vb, er = pr - br, eg = pg - bgc, eb = pb - bb;
  const al = vv > 1 ? (er * vr + eg * vg + eb * vb) / vv : 0, qr = er - al * vr, qg = eg - al * vg, qb = eb - al * vb;
  return { len: 2 * Math.sqrt(l1), elong: Math.sqrt(l1 / l2), gbC: Math.sqrt(vv), al, res: Math.sqrt(qr * qr + qg * qg + qb * qb) };
}

/** A piece's colour matches the garment only roughly: off the background-garment axis, or not at the garment's
 *  end of it (a crease is part way between). An exact match (a belt strap, a chain, a shoulder strap) is kept. */
function roughMatch(F) {
  return F.res >= 20 || Math.abs(F.al - 1) > 0.25;
}

/**
 * Remove what the segmentation kept although it is background: thin lines (creases, seams, grout, cables, the
 * edge of a step or a shadow) attached to the garment or lying apart from it, and broad flat patches of
 * darker floor or shadow that run into the frame. Works on the working-resolution mask; returns a new mask.
 * Every rule leans towards keeping: a leftover line costs a tap, a missing strap spoils the sticker.
 */
function prune(img, S, fg, P) {
  const { W, H, cls } = S, N = W * H;
  const r = Math.max(2, Math.round(Math.max(W, H) * 0.009));
  // work inside the mask's bounding box (plus a margin)
  let bx0 = W, by0 = H, bx1 = -1, by1 = -1, area = 0;
  for (let y = 0; y < H; y++) for (let x = 0, p = y * W; x < W; x++, p++) if (fg[p]) {
    area++; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
  }
  if (!area) return fg;
  bx0 = Math.max(0, bx0 - 2); by0 = Math.max(0, by0 - 2); bx1 = Math.min(W - 1, bx1 + 2); by1 = Math.min(H - 1, by1 + 2);
  // solid core = opening of the mask with a disc of radius r; the rest is thin
  const dIn = chamferIn(fg, W, H, 1, bx0, by0, bx1, by1, 0);
  const notEro = new Uint8Array(N).fill(1);
  for (let y = by0; y <= by1; y++) for (let x = bx0, p = y * W + bx0; x <= bx1; x++, p++) if (dIn[p] > r) notEro[p] = 0;
  const dEro = chamferIn(notEro, W, H, 1, bx0, by0, bx1, by1, 1);
  const core = new Uint8Array(N);
  let coreArea = 0;
  let cx0 = W, cy0 = H, cx1 = -1, cy1 = -1;
  for (let y = by0; y <= by1; y++) for (let x = bx0, p = y * W + bx0; x <= bx1; x++, p++) if (fg[p] && dEro[p] <= r + 0.5) {
    core[p] = 1; coreArea++; if (x < cx0) cx0 = x; if (x > cx1) cx1 = x; if (y < cy0) cy0 = y; if (y > cy1) cy1 = y;
  }
  // share of a piece lying outside the solid parts' bounding box: a stripe or seam of the garment that came loose
  // stays within it, a line on the background reaches out of it
  cx0 -= r; cy0 -= r; cx1 += r; cy1 += r;
  const outside = (pix, cnt) => {
    let o = 0;
    for (let i = 0; i < cnt; i++) { const p = pix[i], x = p % W, y = (p / W) | 0; if (x < cx0 || x > cx1 || y < cy0 || y > cy1) o++; }
    return o / Math.max(1, cnt);
  };
  const label = new Int32Array(N), stack = new Int32Array(N), q2 = new Int32Array(N);
  const isContact = new Uint8Array(N), samples = new Float32Array(3 * 200);
  const Lshort = 3 * r, out = fg.slice();
  const nb8 = [-1, 1, -W, W, -W - 1, -W + 1, W - 1, W + 1];
  const inside = (p, k) => { const x = p % W; if ((k === 0 || k === 4 || k === 6) && x === 0) return false; if ((k === 1 || k === 5 || k === 7) && x === W - 1) return false; const q = p + nb8[k]; return q >= 0 && q < N; };

  // A) thin pieces hanging off the solid core (skipped when the object is itself mostly thin: a necklace, a belt)
  if (coreArea >= 0.3 * area) {
    const dist = new Int32Array(N), src = new Int32Array(N);
    let cur = 0;
    for (let s = 0; s < N; s++) {
      if (!fg[s] || core[s] || label[s]) continue;
      cur++; let cnt = 0, border = 0;
      stack[cnt++] = s; label[s] = cur;
      for (let i = 0; i < cnt; i++) {
        const p = stack[i], x = p % W, edge = x === 0 || x === W - 1 || p < W || p >= N - W;
        if (edge) border = 1;
        for (let k = 0; k < 8; k++) {
          if (edge && !inside(p, k)) continue;
          const q = p + nb8[k];
          if (core[q]) isContact[p] = 1;
          else if (fg[q] && !label[q]) { label[q] = cur; stack[cnt++] = q; }
        }
      }
      // contact clusters, then a multi-source walk along the piece: how far does it stick out from the
      // core, and does it join the core in two separate places (a strap, a handle)?
      let nc = 0, qh = 0, qt = 0, far = 0, span = 0, cx = 0, cy = 0;
      const pix = stack.subarray(0, cnt);
      for (let i = 0; i < cnt; i++) { const p = pix[i]; dist[p] = -1; src[p] = 0; }
      for (let i = 0; i < cnt; i++) {
        const p0 = pix[i];
        if (!isContact[p0] || src[p0]) continue;
        nc++;
        let a = qt; src[p0] = nc; dist[p0] = 0; q2[qt++] = p0;
        while (a < qt) {
          const p = q2[a++];
          const ex = p % W, edge = ex === 0 || ex === W - 1 || p < W || p >= N - W;
          for (let k = 0; k < 8; k++) { if (edge && !inside(p, k)) continue; const q = p + nb8[k]; if (label[q] === cur && isContact[q] && !src[q]) { src[q] = nc; dist[q] = 0; q2[qt++] = q; } }
        }
      }
      if (nc) {
        for (let i = 0; i < qt; i++) { cx += q2[i] % W; cy += (q2[i] / W) | 0; }
        cx = Math.round(cx / qt); cy = Math.round(cy / qt);
        qh = 0;
        while (qh < qt) {
          const p = q2[qh++], d = dist[p], sp = src[p], ex = p % W, edge = ex === 0 || ex === W - 1 || p < W || p >= N - W;
          if (d > far) far = d;
          for (let k = 0; k < 8; k++) {
            if (edge && !inside(p, k)) continue;
            const q = p + nb8[k];
            if (label[q] !== cur) continue;
            if (dist[q] < 0) { dist[q] = d + 1; src[q] = sp; q2[qt++] = q; }
            else if (src[q] !== sp) { const s2 = d + dist[q] + 1; if (s2 > span) span = s2; }
          }
        }
      }
      for (let i = 0; i < cnt; i++) isContact[pix[i]] = 0;
      if (!nc || far <= Lshort) continue;          // short nubs stay; detached pieces are judged in B
      let ns = sampleCore(S, core, dIn, cx, cy, 3 * r + 2, samples, 0, 200);
      const cv = ns ? colourVerdict(img, S, P, pix, cnt, samples, ns, dIn) : { v: 'amb', own: 0 }, verdict = cv.v;
      const loop = span > 4 * r;
      // the garment's own colour keeps a piece, even where it runs out of the photo (a strap cut by the frame);
      // the background's colour drops it; for anything else a loop (strap, handle) stays and a long free end goes
      let drop;
      if (verdict === 'own') {
        // the garment's colour - unless the piece is long and dead straight with a free end (a crease or a cable
        // lying across the photo is straight; a strap curves or is short), or it runs out of the photo and either
        // the garment's colour is too close to the background's to tell, or the piece's colour is off the garment's,
        // or it is long and straight and its colour matches only roughly
        const F = pieceFeatures(img, S, pix, cnt, samples, ns, dIn);
        const rough = roughMatch(F);
        const straight = !loop && F.elong >= 20 && F.len >= 45 && rough;
        drop = (straight || (border && !loop && (F.gbC < 30 || F.res >= 25 || (F.elong >= 12 && F.len >= 30 && rough)))) && outside(pix, cnt) >= 0.3;
      } else if (verdict === 'bg') {
        // (when the garment itself is nearly the background's colour, "background-coloured" says nothing: judge it
        // like an undecided piece below)
        drop = pieceFeatures(img, S, pix, cnt, samples, ns, dIn).gbC >= 30 || (!loop && (border || far > 2 * Lshort));
      } else if (verdict === 'other') drop = !loop;
      else drop = !loop && (border || far > 2 * Lshort);
      if (drop && ns && loop && cv.own >= 0.2) {
        // it joins the garment in two places and a good part of it has the garment's colour: a strap or handle
        // that a line on the background crosses. Take away only what does not have the garment's colour.
        for (let i = 0; i < cnt; i++) if (pixelVote(img, S, P, pix[i], samples, ns) !== 0) out[pix[i]] = 0;
      } else if (drop) for (let i = 0; i < cnt; i++) out[pix[i]] = 0;
    }
  }

  // B) Whole components. The largest one is the garment (with its partner, for a pair of shoes); the others are
  // compared with its colour. A thin one in the background's colour, or one that runs into the frame without the
  // garment's colour, is a line on the background (floorboard seams, a grout grid, a cable). A solid one goes only
  // when it is entirely in the background's colour and the garment clearly is not (a detached patch of shadow).
  {
    const lab = label; lab.fill(0);
    const comps = [];
    let qt = 0;     // each component's pixels lie together in q2[start .. start + cnt)
    for (let y = by0; y <= by1; y++) for (let s0 = y * W + bx0, e = y * W + bx1; s0 <= e; s0++) {
      if (!out[s0] || lab[s0]) continue;
      const id = comps.length + 1, start = qt;
      let nCore = 0, border = 0, nOwn = 0;
      q2[qt++] = s0; lab[s0] = id;
      for (let i = start; i < qt; i++) {
        const p = q2[i], x = p % W, edge = x === 0 || x === W - 1 || p < W || p >= N - W;
        if (core[p]) nCore++;
        if (!cls[p]) nOwn++;
        if (edge) border = 1;
        for (let k = 0; k < 8; k++) { if (edge && !inside(p, k)) continue; const q = p + nb8[k]; if (out[q] && !lab[q]) { lab[q] = id; q2[qt++] = q; } }
      }
      comps.push({ start, cnt: qt - start, nCore, border, nOwn });
    }
    if (comps.length > 1) {
      // the garment: the largest component, counting pixels in a background-like colour at a quarter (so a
      // necklace beats a bigger leftover patch of floor)
      let main = 0;
      const weight = (c) => c.nOwn + 0.25 * (c.cnt - c.nOwn);
      for (let i = 1; i < comps.length; i++) if (weight(comps[i]) > weight(comps[main])) main = i;
      const M = comps[main], mainThin = M.nCore < 0.3 * M.cnt, mainOwn = M.nOwn >= 0.6 * M.cnt;
      // garment colour samples from the main component (its core, or its middle when it has none)
      let ns = 0;
      const pool = mainThin ? M.cnt : M.nCore, stride = Math.max(1, Math.floor(pool / 200));
      for (let i = M.start, k = 0, e = M.start + M.cnt; i < e && ns < 200; i++) {
        const p = q2[i];
        if (mainThin ? dIn[p] < 1.5 : !core[p] || dIn[p] < 2.5) continue;
        if ((k++ % stride) === 0) { samples[3 * ns] = S.R[p]; samples[3 * ns + 1] = S.G[p]; samples[3 * ns + 2] = S.B[p]; ns++; }
      }
      for (let i = 0; i < comps.length; i++) {
        const c = comps[i];
        if (i === main) continue;
        const thin = c.nCore < 0.3 * c.cnt;
        if (!thin && !(mainOwn && c.nOwn <= 0.1 * c.cnt)) continue;
        const cnt = c.cnt, stack = q2.subarray(c.start, c.start + cnt);
        const verdict = ns ? colourVerdict(img, S, P, stack, cnt, samples, ns, dIn).v : 'amb';
        // (a garment that is itself close to the background's colour makes the colour verdict meaningless)
        let drop = verdict === 'bg' && pieceFeatures(img, S, stack, cnt, samples, ns, dIn).gbC >= 30;
        if (!drop && thin) {
          // a thin piece on its own: next to a solid garment, one that runs into the frame is a line on the
          // background unless its colour matches the garment exactly, and so is a long straight one; next to a thin
          // garment (a necklace or belt that came apart) only one without the garment's colour that runs into the
          // frame goes
          if (c.border) drop = verdict !== 'own' || (!mainThin && outside(stack, cnt) >= 0.3 && (!ns || roughMatch(pieceFeatures(img, S, stack, cnt, samples, ns, dIn))));
          else if (!mainThin && ns) {
            const F = pieceFeatures(img, S, stack, cnt, samples, ns, dIn);
            drop = F.elong >= 25 && F.len >= 60 && roughMatch(F) && outside(stack, cnt) >= 0.3;
          }
        } else if (!drop && ns) {
          // a solid piece on its own, entirely in a background-like colour, next to a garment with a colour of
          // its own: a detached patch of shadow or darker floor if its colour is mostly the background's
          const F = pieceFeatures(img, S, stack, cnt, samples, ns, dIn);
          drop = F.gbC >= 40 && F.al < 0.4;
        }
        if (drop) for (let k = 0; k < cnt; k++) out[stack[k]] = 0;
      }
    }
  }

  // C) Broad leftovers in the background's own colour that run into the frame of the photo: a hard-edged cast
  // shadow, the darker floor beyond a rug edge. Each is a flat patch whose outline borders removed background
  // almost everywhere. They go only when what is left is a solid garment with a colour of its own that the
  // patch does not wrap around (a garment in a background-like colour with a print would look the same).
  {
    const { rho, rs } = S, lab = label; lab.fill(0);
    const regions = [];
    let qh = 0, qt = 0;
    for (let s0 = 0; s0 < N; s0++) {
      const x0 = s0 % W;
      if (!(x0 === 0 || x0 === W - 1 || s0 < W || s0 >= N - W)) continue;
      if (!out[s0] || lab[s0] || !cls[s0] || rho[s0] < 0.6 || rho[s0] > 1.25) continue;
      const id = regions.length + 1, start = qt;
      lab[s0] = id; stack[qt++] = s0; qh = start;
      let toBg = 0;
      while (qh < qt) {
        const p = stack[qh++], x = p % W, v = rs[p];
        for (let k = 0; k < 4; k++) {
          if (k === 0 ? x === 0 : k === 1 ? x === W - 1 : k === 2 ? p < W : p >= N - W) continue;
          const q = p + nb8[k];
          if (!out[q]) { toBg++; continue; }
          if (lab[q] === id) continue;
          if (!lab[q] && cls[q] && rho[q] >= 0.6 && rho[q] <= 1.25 && Math.abs(rs[q] - v) < 0.02) { lab[q] = id; stack[qt++] = q; }
        }
      }
      regions.push({ start, end: qt, toBg, toFg: 0 });
    }
    if (regions.length) {
      for (const g of regions) for (let i = g.start; i < g.end; i++) {
        const p = stack[i], x = p % W;
        for (let k = 0; k < 4; k++) {
          if (k === 0 ? x === 0 : k === 1 ? x === W - 1 : k === 2 ? p < W : p >= N - W) continue;
          const q = p + nb8[k];
          if (out[q] && !lab[q]) g.toFg++;
        }
      }
      const flat = (g) => {
        const n = g.end - g.start, v = new Float32Array(Math.min(n, 512)), st = n / v.length;
        for (let i = 0; i < v.length; i++) v[i] = rho[stack[g.start + Math.floor(i * st)]];
        v.sort();
        return v[Math.floor(v.length * 0.9)] - v[Math.floor(v.length * 0.1)] <= 0.1;
      };
      // separate stretches of the frame each region touches (a band crossing the photo meets it at both ends)
      const runsOnFrame = new Int32Array(regions.length + 1);
      {
        const per = [];
        for (let x = 0; x < W; x++) per.push(x);
        for (let y = 1; y < H; y++) per.push(y * W + W - 1);
        for (let x = W - 2; x >= 0; x--) per.push((H - 1) * W + x);
        for (let y = H - 2; y > 0; y--) per.push(y * W);
        for (let i = 0; i < per.length; i++) {
          const a = lab[per[i]], b = lab[per[(i + per.length - 1) % per.length]];
          if (a && a !== b) runsOnFrame[a]++;
        }
      }
      const isBand = regions.map((g, i) => {
        const ratio = g.toBg / Math.max(1, g.toBg + g.toFg);
        return g.end - g.start >= N * 0.002 && (ratio >= 0.6 || (ratio >= 0.45 && runsOnFrame[i + 1] >= 2)) && flat(g);
      });
      if (isBand.some((b) => b)) {
        // what is left: its big pieces (the garment, or both shoes) must be solid, mostly in a colour of their own,
        // and bordered mostly by removed background rather than by the bands (a print on a background-coloured
        // garment is left as small pieces, each wrapped in "band")
        const inBand = (p) => lab[p] && isBand[lab[p] - 1];
        const seen = new Uint8Array(N);
        const pieces = [];
        let restN = 0;
        for (let s0 = 0; s0 < N; s0++) {
          if (!out[s0] || seen[s0] || inBand(s0)) continue;
          let cnt = 0, nc = 0, no = 0, tb = 0, tg = 0;
          q2[cnt++] = s0; seen[s0] = 1;
          for (let i = 0; i < cnt; i++) {
            const p = q2[i], x = p % W;
            if (core[p]) nc++;
            if (!cls[p]) no++;
            for (let k = 0; k < 4; k++) {
              if (k === 0 ? x === 0 : k === 1 ? x === W - 1 : k === 2 ? p < W : p >= N - W) continue;
              const q = p + nb8[k];
              if (!out[q]) tg++;
              else if (inBand(q)) tb++;
              else if (!seen[q]) { seen[q] = 1; q2[cnt++] = q; }
            }
          }
          restN += cnt;
          pieces.push([cnt, nc, no, tb, tg]);
        }
        let big = 0;
        for (const pc of pieces) if (pc[0] > big) big = pc[0];
        let bestN = 0, bestCore = 0, bestOwn = 0, bestToBand = 0, bestToBg = 0, nBig = 0, wrapped = 0;
        for (const [cnt, nc, no, tb, tg] of pieces) if (cnt >= 0.25 * big) {
          bestN += cnt; bestCore += nc; bestOwn += no; bestToBand += tb; bestToBg += tg; nBig++;
          if (tb > 0.75 * (tb + tg)) wrapped = 1;
        }
        const ok = bestN >= N * 0.01 && bestN >= 0.7 * restN && nBig <= 2 && !wrapped && bestCore >= 0.3 * bestN &&
          bestOwn >= 0.5 * bestN && bestToBand <= 0.7 * (bestToBand + bestToBg);
        if (ok) for (let i = 0; i < regions.length; i++) if (isBand[i]) for (let k = regions[i].start; k < regions[i].end; k++) out[stack[k]] = 0;
      }
    }
  }
  return out;
}

/**
 * Bring the working-resolution mask to full resolution. Along the outline every pixel is re-decided
 * by asking whether its colour is nearer the garment just inside or the background just outside,
 * which removes the light halo and puts the edge on the true contour.
 */
function finish(img, S, fg, P) {
  const { data, width: w, height: h } = img;
  const { W, H, f, R, G, B } = S, N = W * H, n = w * h;
  const mask = new Uint8Array(n);
  if (f === 1) mask.set(fg);
  else for (let y = 0; y < h; y++) { const o = (y >> 1) * W; for (let x = 0, p = y * w; x < w; x++, p++) mask[p] = fg[o + (x >> 1)]; }
  if (P.u <= 0.15) return mask;

  const e1 = erode4(fg, W, H, 1), e2 = erode4(e1, W, H, 1), e3 = erode4(e2, W, H, 1);
  const d1 = dilate4(fg, W, H), d2 = dilate4(d1, W, H), d3 = dilate4(d2, W, H), d4 = dilate4(d3, W, H);
  // nearest clean garment colour (from e2) and nearest clean background colour (from outside d3)
  const srcF = new Int32Array(N).fill(-1), srcF2 = new Int32Array(N).fill(-1), srcB = new Int32Array(N).fill(-1);
  const queue = new Int32Array(N), depth = new Uint8Array(N);
  const spread = (src, isCore, maxDepth) => {
    let qh = 0, qt = 0;
    for (let p = 0; p < N; p++) {
      if (!isCore[p]) continue;
      const x = p % W;
      if ((x > 0 && !isCore[p - 1]) || (x < W - 1 && !isCore[p + 1]) || (p >= W && !isCore[p - W]) || (p + W < N && !isCore[p + W])) { src[p] = p; depth[p] = 0; queue[qt++] = p; }
    }
    while (qh < qt) {
      const p = queue[qh++], x = p % W, d = depth[p];
      if (d >= maxDepth) continue;
      const s = src[p];
      if (x > 0 && !isCore[p - 1] && src[p - 1] < 0) { src[p - 1] = s; depth[p - 1] = d + 1; queue[qt++] = p - 1; }
      if (x < W - 1 && !isCore[p + 1] && src[p + 1] < 0) { src[p + 1] = s; depth[p + 1] = d + 1; queue[qt++] = p + 1; }
      if (p >= W && !isCore[p - W] && src[p - W] < 0) { src[p - W] = s; depth[p - W] = d + 1; queue[qt++] = p - W; }
      if (p + W < N && !isCore[p + W] && src[p + W] < 0) { src[p + W] = s; depth[p + W] = d + 1; queue[qt++] = p + W; }
    }
  };
  spread(srcF, e3, 7);
  spread(srcF2, e2, 6);      // fallback for parts too thin to have a deeper core
  const bgCore = new Uint8Array(N);
  for (let p = 0; p < N; p++) bgCore[p] = d4[p] ? 0 : 1;
  spread(srcB, bgCore, 8);

  const minC2 = P.edgeContrast * P.edgeContrast, minX2 = P.edgeChroma * P.edgeChroma;
  for (let cy = 0; cy < H; cy++) for (let cx = 0, c = cy * W; cx < W; cx++, c++) {
    if (fg[c] ? e2[c] : !d3[c]) continue;          // not in the band
    const sf = srcF[c] >= 0 ? srcF[c] : srcF2[c], sb = srcB[c];
    if (sf < 0 || sb < 0) continue;
    const fr = R[sf], fgc = G[sf], fb = B[sf], br = R[sb], bgc = G[sb], bb = B[sb];
    // Two ways to measure "how much garment is in this pixel":
    //  - by colour cast (what is left after scaling the background colour to the pixel's brightness):
    //    blind to shadows, so used whenever the garment has a cast of its own;
    //  - by plain colour distance, for garments that only differ from the background in brightness.
    const yb = 0.299 * br + 0.587 * bgc + 0.114 * bb + 1e-3, nr = br / yb, ng = bgc / yb, nb = bb / yb;
    const yf = 0.299 * fr + 0.587 * fgc + 0.114 * fb;
    const xr = fr - yf * nr, xg = fgc - yf * ng, xb = fb - yf * nb, x2 = xr * xr + xg * xg + xb * xb;
    const vr = fr - br, vg = fgc - bgc, vb = fb - bb, c2 = vr * vr + vg * vg + vb * vb;
    const byCast = x2 >= minX2;
    if (!byCast && c2 < minC2) continue;
    const inv = 1 / (byCast ? x2 : c2), lab = fg[c], addAt = byCast ? 0.58 : 0.78;
    for (let dy = 0; dy < f; dy++) {
      const y = cy * f + dy; if (y >= h) break;
      for (let dx = 0; dx < f; dx++) {
        const x = cx * f + dx; if (x >= w) break;
        // 3x3 mean of the full-resolution pixel (tames grain)
        const xa = x > 0 ? x - 1 : x, xe = x < w - 1 ? x + 1 : x, ya = y > 0 ? y - 1 : y, ye = y < h - 1 ? y + 1 : y;
        let sr = 0, sg = 0, sbl = 0;
        for (let yy = ya; yy <= ye; yy++) for (let xx = xa, i = (yy * w + xa) * 4; xx <= xe; xx++, i += 4) { sr += data[i]; sg += data[i + 1]; sbl += data[i + 2]; }
        const cnt = 1 / ((xe - xa + 1) * (ye - ya + 1));
        sr *= cnt; sg *= cnt; sbl *= cnt;
        let a;
        if (byCast) { const yp = 0.299 * sr + 0.587 * sg + 0.114 * sbl; a = ((sr - yp * nr) * xr + (sg - yp * ng) * xg + (sbl - yp * nb) * xb) * inv; }
        else a = ((sr - br) * vr + (sg - bgc) * vg + (sbl - bb) * vb) * inv;
        const p = y * w + x;
        if (lab) { if (a < 0.42) mask[p] = 0; } else if (a > addAt) mask[p] = 1;
      }
    }
  }
  return mask;
}

/* ------------------------------------------------------------------ scene check (backdrop) */

// ================================================================================================
// BACKDROP FIRST
//
// The lighting-model remover above assumes the piece lies on ONE plain surface that reaches the
// frame all round. Real photos are often taken in a room: the piece lies on a sheet / bed / table
// (the "backdrop") and around that are a wall, a floor, a rug, furniture. This stage finds the
// backdrop, and paints everything that is clearly beyond it (the surroundings) with the backdrop's
// own colour, so the remover then sees one plain backdrop and does its usual fine cut. Whatever
// is painted is also removed from the final mask.
//
// Works on coarse cells (about 4 x 4 px of the 900-px raster):
//   1. bdCells      - mean colour and grain per cell
//   2. bdGrow       - a surface grown from a smooth seed over everything of the same colour (folds,
//                     creases and soft shadows included; a wall of another colour is not)
//   3. bdPick       - surfaces grown from many seeds are the candidates; the backdrop is the one
//                     that does not lie ON another and that, with what it encloses, best covers the
//                     middle of the photo
//   4. bdOutside    - what is not backdrop and connects to the frame, beyond the backdrop's edge
//                     (its convex hull) or hemmed in there by the frame and the surroundings, and
//                     that looks different from the backdrop, is surroundings - except pieces that
//                     lie on the backdrop and only reach over its edge (bdLiesOn)
//   5. bdPaint      - surroundings get the backdrop's colour (smooth fill from the nearby backdrop),
//                     and the backdrop's colour cast is made even across the photo (bdCastField)
// After the remover has cut (computeMask -> backdropFinish):
//   6. backdropFinish - nothing painted is kept; leftover bits of backdrop along the outline go;
//                     grainy knit the remover dropped where the pieces lie comes back; enclosed holes
//                     that do not look like the backdrop (a neck label) are filled; 1-2 px fringe of
//                     backdrop colour along the outline goes; parts not connected to where the pieces
//                     lie go.
//
// When the backdrop already fills the frame (a plain-background photo), or there is no clear
// backdrop, or what lies around it looks like more of the same, nothing is painted, backdropFirst
// returns null and computeMask runs exactly as before.
// ================================================================================================

/** 1. Coarse cells (cs x cs px): mean colour, brightness and grain (relative std of brightness). */
function bdCells(img) {
  const { data, width: w, height: h } = img;
  const cs = Math.max(2, Math.round(Math.max(w, h) / 225));
  const gw = Math.ceil(w / cs), gh = Math.ceil(h / cs), gn = gw * gh;
  const R = new Float32Array(gn), G = new Float32Array(gn), B = new Float32Array(gn), Y = new Float32Array(gn);
  const YY = new Float64Array(gn), cnt = new Float32Array(gn), tex = new Float32Array(gn);
  for (let y = 0; y < h; y++) {
    const row = ((y / cs) | 0) * gw;
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
      const g = row + ((x / cs) | 0), r = data[i], gg = data[i + 1], b = data[i + 2];
      const yy = 0.299 * r + 0.587 * gg + 0.114 * b;
      R[g] += r; G[g] += gg; B[g] += b; Y[g] += yy; YY[g] += yy * yy; cnt[g]++;
    }
  }
  for (let g = 0; g < gn; g++) {
    const c = 1 / cnt[g];
    R[g] *= c; G[g] *= c; B[g] *= c; Y[g] *= c;
    tex[g] = Math.sqrt(Math.max(0, YY[g] * c - Y[g] * Y[g])) / Math.max(Y[g], 40);
  }
  return { cs, gw, gh, gn, R, G, B, Y, tex, w, h };
}

/**
 * 2. Grow a candidate surface from its smooth seed cells over every cell of the same colour.
 * Brightness may change only gradually from cell to cell (folds, soft shadows, lighting) and stay
 * within a wide band around the seed's. The colour cast may drift, but only SLOWLY: every cell carries
 * a reference cast that follows the cells it was reached through at a limited rate per cell. White
 * balance drifting across a sheet (yellowish on the lamp side, bluish on the window side) is
 * followed; a white skirting board turning into a yellow wall within a few cells is not, however
 * soft the moulding between them. Texture is ignored: creases and wrinkles belong to the sheet.
 */
function bdGrow(C, seeds) {
  const { gw, gn, R, B, Y } = C;
  const ys = seeds.map((g) => Y[g]).sort((p, q) => p - q);
  const y0 = ys[ys.length >> 1], yLo = 0.6 * y0, yHi = 1.3 * y0 + 10;
  const DRIFT = 0.002, TOL = 0.06;           // cast units (R/Y, B/Y): per cell / in all
  const rU = new Float32Array(gn), rV = new Float32Array(gn);
  const m = new Uint8Array(gn), q = new Int32Array(gn);
  let qt = 0;
  for (const g of seeds) {
    if (m[g] || Y[g] < yLo || Y[g] > yHi) continue;
    const yy = Math.max(1, Y[g]);
    rU[g] = R[g] / yy; rV[g] = B[g] / yy; m[g] = 1; q[qt++] = g;
  }
  for (let qh = 0; qh < qt; qh++) {
    const g = q[qh], x = g % gw, yg = Y[g], ug = R[g] - yg, vg = B[g] - yg;
    for (let k = 0; k < 4; k++) {
      const t = k === 0 ? g - 1 : k === 1 ? g + 1 : k === 2 ? g - gw : g + gw;
      if (k === 0 ? x === 0 : k === 1 ? x === gw - 1 : (t < 0 || t >= gn)) continue;
      if (m[t]) continue;
      const yt = Y[t], top = Math.max(yg, yt);
      if (yt < yLo || yt > yHi || Math.abs(yt - yg) > 0.07 * top) continue;
      if (Math.abs(R[t] - yt - ug) + Math.abs(B[t] - yt - vg) > Math.max(4, 0.035 * top)) continue;
      const iy = 1 / Math.max(1, yt), du = R[t] * iy - rU[g], dv = B[t] * iy - rV[g];
      if (Math.abs(du) + Math.abs(dv) > TOL * Math.max(1, 60 / Math.max(1, yt))) continue;
      rU[t] = rU[g] + (du > DRIFT ? DRIFT : du < -DRIFT ? -DRIFT : du);
      rV[t] = rV[g] + (dv > DRIFT ? DRIFT : dv < -DRIFT ? -DRIFT : dv);
      m[t] = 1; q[qt++] = t;
    }
  }
  return { m, y0, n: qt, cells: q.subarray(0, qt) };
}

/** Cells of ~m reachable from the frame through ~m (4-connected). */
function bdFromFrame(m, gw, gh) {
  const gn = gw * gh, out = new Uint8Array(gn), q = new Int32Array(gn);
  let qt = 0;
  const push = (g) => { if (!m[g] && !out[g]) { out[g] = 1; q[qt++] = g; } };
  for (let x = 0; x < gw; x++) { push(x); push((gh - 1) * gw + x); }
  for (let y = 0; y < gh; y++) { push(y * gw); push(y * gw + gw - 1); }
  for (let qh = 0; qh < qt; qh++) {
    const g = q[qh], x = g % gw;
    if (x > 0) push(g - 1); if (x < gw - 1) push(g + 1); if (g >= gw) push(g - gw); if (g + gw < gn) push(g + gw);
  }
  return out;
}

/** 8-neighbour binary dilation / erosion on the cell grid, r times. */
function bdDilate(m, gw, gh, r) {
  let a = m;
  for (let k = 0; k < r; k++) {
    const o = new Uint8Array(a.length);
    for (let y = 0; y < gh; y++) for (let x = 0, g = y * gw; x < gw; x++, g++) {
      if (a[g]) { o[g] = 1; continue; }
      const l = x > 0, rr = x < gw - 1, u = y > 0, d = y < gh - 1;
      o[g] = (l && a[g - 1]) || (rr && a[g + 1]) || (u && a[g - gw]) || (d && a[g + gw]) ||
        (l && u && a[g - gw - 1]) || (rr && u && a[g - gw + 1]) || (l && d && a[g + gw - 1]) || (rr && d && a[g + gw + 1]) ? 1 : 0;
    }
    a = o;
  }
  return a;
}


function bdErode(m, gw, gh, r) {
  const inv = new Uint8Array(m.length);
  for (let g = 0; g < m.length; g++) inv[g] = m[g] ? 0 : 1;
  const d = bdDilate(inv, gw, gh, r);   // cells off the grid count as set (no erosion from the frame)
  for (let g = 0; g < m.length; g++) d[g] = d[g] ? 0 : 1;
  return d;
}

/**
 * 3. Pick the backdrop. Candidates are the big surfaces grown (bdGrow) from seeds in smooth places,
 * each closed a little (bridges creases two cells wide). A candidate whose outline runs mostly along
 * other candidates lies ON them (a plain garment on the sheet, the wall above the skirting board) and
 * cannot be the backdrop. Of the rest, the one whose area plus everything it encloses best covers the
 * middle of the photo wins - if its convex hull covers most of the middle at all.
 */
function bdPick(C) {
  const { gw, gh, gn } = C;
  const tex = C.tex;
  const wc = new Float32Array(gn);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const dx = (x + 0.5) / gw - 0.5, dy = (y + 0.5) / gh - 0.5;
    wc[y * gw + x] = Math.exp(-(dx * dx + dy * dy) / (2 * 0.22 * 0.22));
  }
  // seeds: centres of smooth 3x3 patches on a coarse lattice, smoothest first. Each seed not yet
  // covered by an earlier surface grows a surface of its own; the big ones are the candidates.
  const seeds = [];
  for (let y = 1; y < gh - 1; y += 3) for (let x = 1; x < gw - 1; x += 3) {
    const g = y * gw + x;
    let mx = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const t = tex[g + dy * gw + dx]; if (t > mx) mx = t; }
    if (mx < 0.03) seeds.push([mx, g]);
  }
  seeds.sort((a, b) => a[0] - b[0]);
  const covered = new Uint8Array(gn), grown = [];
  let tries = 0;
  for (const [, s0] of seeds) {
    if (covered[s0]) continue;
    if (++tries > 60 || grown.length >= 6) break;
    const G = bdGrow(C, [s0]);
    for (const g of G.cells) covered[g] = 1;
    if (G.n < gn * 0.03) continue;
    // the same surface reached again from another seed (growth is not symmetric): merge
    const same = grown.find((o) => { let k = 0; for (const g of G.cells) k += o.m[g]; return k > 0.5 * Math.min(o.n, G.n); });
    if (same) { for (const g of G.cells) if (!same.m[g]) { same.m[g] = 1; same.n++; } continue; }
    grown.push({ m: G.m, n: G.n, y0: G.y0 });
  }
  const list = [];
  for (const G of grown) {
    const mc = bdErode(bdDilate(G.m, gw, gh, 2), gw, gh, 2);   // closing: bridges creases
    for (let g = 0; g < gn; g++) mc[g] |= G.m[g];
    const out = bdFromFrame(mc, gw, gh);
    let sc = 0;
    for (let g = 0; g < gn; g++) if (!out[g]) sc += wc[g];
    list.push({ grow: G.m, n: G.n, m: mc, out, sc, y0: G.y0, near: bdDilate(G.m, gw, gh, 3) });
  }
  // "lies on": a lies on the others when most of a's outline (the frame counts as outline that runs
  // along nothing) runs within 3 cells of other candidates, and no other candidate runs along a for
  // a larger share of its own outline. A garment's outline runs along the sheet almost entirely; the
  // sheet's runs along the frame, the wall, the rug and the garment; a plain background's outline is
  // mostly the frame.
  for (const a of list) {
    let rim = 0, any = 0;
    a.along = new Array(list.length).fill(0);
    for (let y = 0; y < gh; y++) for (let x = 0, g = y * gw; x < gw; x++, g++) {
      if (!a.grow[g]) continue;
      if (x === 0 || y === 0 || x === gw - 1 || y === gh - 1) { rim++; continue; }
      if (!a.grow[g - 1] || !a.grow[g + 1] || !a.grow[g - gw] || !a.grow[g + gw]) {
        rim++;
        let hit = 0;
        for (let k = 0; k < list.length; k++) if (list[k] !== a && list[k].near[g]) { a.along[k]++; hit = 1; }
        any += hit;
      }
    }
    for (let k = 0; k < list.length; k++) a.along[k] = rim ? a.along[k] / rim : 0;
    a.alongAny = rim ? any / rim : 0;
  }
  list.forEach((a, i) => {
    let rev = 0;
    list.forEach((b, k) => { if (k !== i && b.along[i] > rev) rev = b.along[i]; });
    a.on = a.alongAny > rev ? a.alongAny : 0;
  });
  let best = null, total = 0;
  for (let g = 0; g < gn; g++) total += wc[g];
  for (const a of list) if (a.on < 0.5 && (!best || a.sc > best.sc)) best = a;
  // a backdrop must span (its convex hull) most of the middle of the photo; else there is no clear
  // backdrop (a busy floor, wood grain...) and the stage stays out of the way
  if (!best) return null;
  best.hull = bdHull(best.m, gw, gh);
  let cov = 0;
  for (let g = 0; g < gn; g++) if (best.hull[g]) cov += wc[g];
  if (cov < 0.6 * total) return null;
  return best;
}

/** Convex hull of the set cells, rasterised (1 = inside or on the hull). */
function bdHull(m, gw, gh) {
  const pts = [];
  for (let y = 0; y < gh; y++) {
    let x0 = -1, x1 = -1;
    for (let x = 0, g = y * gw; x < gw; x++, g++) if (m[g]) { if (x0 < 0) x0 = x; x1 = x; }
    if (x0 >= 0) { pts.push([x0, y]); if (x1 !== x0) pts.push([x1, y]); }
  }
  const hull = new Uint8Array(gw * gh);
  if (pts.length < 3) { for (const [x, y] of pts) hull[y * gw + x] = 1; return hull; }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let k = pts.length - 1; k >= 0; k--) { const p = pts[k]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const poly = lo.slice(0, -1).concat(up.slice(0, -1));
  for (let y = 0; y < gh; y++) {
    let xl = Infinity, xr = -Infinity;
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length];
      if ((a[1] - y) * (b[1] - y) > 0) continue;
      if (a[1] === b[1]) { xl = Math.min(xl, a[0], b[0]); xr = Math.max(xr, a[0], b[0]); continue; }
      const x = a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
      if (x < xl) xl = x; if (x > xr) xr = x;
    }
    if (xl > xr) continue;
    for (let x = Math.max(0, Math.ceil(xl - 0.5)); x <= Math.min(gw - 1, Math.floor(xr + 0.5)); x++) hull[y * gw + x] = 1;
  }
  return hull;
}

/**
 * Pieces lying on the backdrop that reach beyond its edge (a sleeve over the rug, a hem over the
 * frame): the parts of the photo that are not backdrop and connect to the frame are split into
 * colour-coherent regions (neighbouring cells join where brightness and cast change gradually; a knit
 * stays one region, a striped rug falls apart in stripes). A region of some size that lies mostly
 * inside the backdrop's convex hull and runs along the backdrop (within 2 cells) for a good part of
 * its outline is a piece on the backdrop: it, and the thin ring of mixed cells around it, is kept
 * out of the surroundings. The wall above a sheet, the floor beside it and the rug below lie mostly
 * outside the hull.
 */
function bdLiesOn(C, bd) {
  const { gw, gh, gn, R, B, Y } = C, { m, out, hull } = bd;
  const par = new Int32Array(gn).fill(-1);
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  for (let g = 0; g < gn; g++) if (out[g]) par[g] = g;
  const like = (g, t) => {
    const yg = Y[g], yt = Y[t], top = Math.max(yg, yt);
    return Math.abs(yt - yg) <= Math.max(8, 0.12 * top) && Math.abs(R[t] - yt - R[g] + yg) + Math.abs(B[t] - yt - B[g] + yg) <= Math.max(10, 0.08 * top);
  };
  for (let y = 0; y < gh; y++) for (let x = 0, g = y * gw; x < gw; x++, g++) {
    if (!out[g]) continue;
    if (x < gw - 1 && out[g + 1] && like(g, g + 1)) { const a = find(g), b = find(g + 1); if (a !== b) par[a] = b; }
    if (y < gh - 1 && out[g + gw] && like(g, g + gw)) { const a = find(g), b = find(g + gw); if (a !== b) par[a] = b; }
  }
  const nearB = bdDilate(m, gw, gh, 2), size = new Map(), inH = new Map(), nb = new Map(), rim = new Map();
  const inc = (mp, k) => mp.set(k, (mp.get(k) || 0) + 1);
  for (let y = 0; y < gh; y++) for (let x = 0, g = y * gw; x < gw; x++, g++) {
    if (!out[g]) continue;
    const r = find(g);
    inc(size, r);
    if (hull[g]) inc(inH, r);
    if (nearB[g]) inc(nb, r);
    if (x === 0 || y === 0 || x === gw - 1 || y === gh - 1 || !out[g - 1] || !out[g + 1] || !out[g - gw] || !out[g + gw] ||
        find(g - 1) !== r || find(g + 1) !== r || find(g - gw) !== r || find(g + gw) !== r) inc(rim, r);
  }
  const keep = new Uint8Array(gn), minSize = Math.max(12, gn * 0.003);
  for (let g = 0; g < gn; g++) {
    if (!out[g]) continue;
    const r = find(g), n = size.get(r);
    const rr = rim.get(r) || 1;
    // (and is a solid shape, not a thin stripe of a rug the backdrop happened to grow around)
    if (n >= minSize && n >= 3 * rr && (inH.get(r) || 0) >= 0.6 * n && (nb.get(r) || 0) >= 0.4 * rr) keep[g] = 1;
  }
  const ring = bdDilate(keep, gw, gh, 1);
  for (let g = 0; g < gn; g++) keep[g] = ring[g] && out[g] ? 1 : 0;
  return keep;
}

/**
 * 4. Surroundings: parts of the photo that are not backdrop and are connected to the frame (not
 * counting pieces that lie on the backdrop, bdLiesOn, and whatever those enclose).
 *  - Everything of such a part that lies outside the convex hull of the backdrop (beyond the sheet's
 *    edge: the wall, the floor, the rug) is surroundings.
 *  - What lies inside the hull is split into its connected pieces, and a piece is surroundings too
 *    when its contact with the frame and with the surroundings already found is long compared
 *    with its border along the backdrop (a sliver of rug in a dip of the sheet's hem).
 *  - Only parts that look different from the backdrop are kept as surroundings (see below), and from
 *    them the same floor or rug is followed a little further into the hull.
 * Returns the cells to paint, or null when there is nothing to paint.
 */
function bdOutside(C, bd) {
  const { gw, gh, gn, R, B, Y } = C, { m, hull } = bd;
  const paint = new Uint8Array(gn), q = new Int32Array(gn), lab = new Uint8Array(gn);
  // pieces that lie on the backdrop and only reach beyond its edge are never surroundings, nor is
  // anything they enclose (a label inside a collar): what counts as "outside" from here on is only
  // what the frame reaches without crossing the backdrop or such a piece
  const keep = bdLiesOn(C, bd), wall = Uint8Array.from(m);
  bd.keep = keep;
  for (let g = 0; g < gn; g++) if (keep[g]) wall[g] = 1;
  const out = bdFromFrame(wall, gw, gh);
  let any = 0;
  for (let g = 0; g < gn; g++) if (out[g] && !hull[g]) { paint[g] = 1; any = 1; }
  const isFrame = (g) => { const x = g % gw, y = (g / gw) | 0; return x === 0 || y === 0 || x === gw - 1 || y === gh - 1; };
  for (let s = 0; s < gn; s++) {
    if (!out[s] || paint[s] || lab[s]) continue;
    let qt = 0, outer = 0, border = 0;
    lab[s] = 1; q[qt++] = s;
    for (let qh = 0; qh < qt; qh++) {
      const g = q[qh], x = g % gw;
      let nb = 0, ou = isFrame(g) ? 1 : 0;
      for (let k = 0; k < 4; k++) {
        const t = k === 0 ? g - 1 : k === 1 ? g + 1 : k === 2 ? g - gw : g + gw;
        if (k === 0 ? x === 0 : k === 1 ? x === gw - 1 : (t < 0 || t >= gn)) continue;
        if (m[t]) nb = 1;
        else if (paint[t]) ou = 1;
        else if (out[t] && !lab[t]) { lab[t] = 1; q[qt++] = t; }
      }
      border += nb; outer += ou;
    }
    if (outer > 0 && outer >= 0.5 * border) { for (let k = 0; k < qt; k++) paint[q[k]] = 1; any = 1; }
  }
  if (!any) return null;
  // Only paint what really looks different from the backdrop: another colour, much darker or
  // lighter, or grainy (a rug, wood floor boards, a knit). On a plain background that does not fill
  // the photo evenly (a dark vignette corner, more tiles or planks of the same colour) the
  // "surroundings" are more of the same; the remover copes with those as it always has.
  const ys = [], us = [], vs = [];
  for (let g = 0; g < gn; g++) if (m[g]) { const yy = Math.max(1, Y[g]); ys.push(Y[g]); us.push(R[g] / yy); vs.push(B[g] / yy); }
  const med = (a) => { a.sort((p, r) => p - r); return a[a.length >> 1]; };
  const y0 = med(ys), u0 = med(us), v0 = med(vs), tex = C.tex;
  const differs = (g) => {
    const yy = Math.max(1, Y[g]);
    if (yy < 0.6 * y0 || yy > 1.3 * y0 + 10 || tex[g] > 0.05) return true;
    return Math.abs(R[g] / yy - u0) + Math.abs(B[g] / yy - v0) > 0.08 * Math.max(1, 60 / yy);
  };
  lab.fill(0);
  any = 0;
  for (let s = 0; s < gn; s++) {
    if (!paint[s] || lab[s]) continue;
    let qt = 0, diff = 0;
    lab[s] = 1; q[qt++] = s;
    for (let qh = 0; qh < qt; qh++) {
      const g = q[qh], x = g % gw;
      if (differs(g)) diff++;
      for (let k = 0; k < 4; k++) {
        const t = k === 0 ? g - 1 : k === 1 ? g + 1 : k === 2 ? g - gw : g + gw;
        if (k === 0 ? x === 0 : k === 1 ? x === gw - 1 : (t < 0 || t >= gn)) continue;
        if (paint[t] && !lab[t]) { lab[t] = 1; q[qt++] = t; }
      }
    }
    if (diff < 0.5 * qt) for (let k = 0; k < qt; k++) paint[q[k]] = 0;
    else any = 1;
  }
  if (!any) return null;
  // The same floor, rug or furniture reaching into the hull (a wedge of floor between the sheet's
  // corner and the frame) is followed from the surroundings found so far, cell by cell, as long as
  // the colour only changes as much as it does within a floor; a garment that touches the rug
  // differs in a step and is not entered.
  {
    let qt = 0;
    for (let g = 0; g < gn; g++) if (paint[g]) q[qt++] = g;
    for (let qh = 0; qh < qt; qh++) {
      const g = q[qh], x = g % gw, yg = Y[g], ug = R[g] - yg, vg = B[g] - yg;
      for (let k = 0; k < 4; k++) {
        const t = k === 0 ? g - 1 : k === 1 ? g + 1 : k === 2 ? g - gw : g + gw;
        if (k === 0 ? x === 0 : k === 1 ? x === gw - 1 : (t < 0 || t >= gn)) continue;
        if (paint[t] || !out[t]) continue;
        const yt = Y[t], top = Math.max(yg, yt, 40);
        if (Math.abs(yt - yg) > 0.12 * top) continue;
        if (Math.abs(R[t] - yt - ug) + Math.abs(B[t] - yt - vg) > Math.max(6, 0.08 * top)) continue;
        paint[t] = 1; q[qt++] = t;
      }
    }
  }
  return any ? paint : null;
}

/** Push-pull fill: cells with wt > 0 keep their value, the rest get a smooth blend of the nearby ones. */
function bdFill(vals, wt, gw, gh) {
  const levels = [{ v: vals, w: wt, gw, gh }];
  while (levels[levels.length - 1].gw > 1 || levels[levels.length - 1].gh > 1) {
    const L = levels[levels.length - 1], nw = Math.ceil(L.gw / 2), nh = Math.ceil(L.gh / 2), nc = vals.length;
    const v = Array.from({ length: nc }, () => new Float32Array(nw * nh)), w = new Float32Array(nw * nh);
    for (let y = 0; y < L.gh; y++) for (let x = 0; x < L.gw; x++) {
      const g = y * L.gw + x, wg = L.w[g];
      if (!wg) continue;
      const t = (y >> 1) * nw + (x >> 1);
      w[t] += wg;
      for (let c = 0; c < nc; c++) v[c][t] += L.v[c][g] * wg;
    }
    for (let t = 0; t < nw * nh; t++) if (w[t]) { for (let c = 0; c < nc; c++) v[c][t] /= w[t]; w[t] = Math.min(1, w[t]); }
    levels.push({ v, w, gw: nw, gh: nh });
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const L = levels[l], U = levels[l + 1];
    for (let y = 0; y < L.gh; y++) for (let x = 0; x < L.gw; x++) {
      const g = y * L.gw + x, a = Math.min(1, L.w[g]);
      if (a >= 1) continue;
      // bilinear from the coarser level
      const fx = Math.min(U.gw - 1, Math.max(0, (x - 0.5) / 2)), fy = Math.min(U.gh - 1, Math.max(0, (y - 0.5) / 2));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(U.gw - 1, x0 + 1), y1 = Math.min(U.gh - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
      for (let c = 0; c < L.v.length; c++) {
        const V = U.v[c];
        const up = (V[y0 * U.gw + x0] * (1 - ax) + V[y0 * U.gw + x1] * ax) * (1 - ay) + (V[y1 * U.gw + x0] * (1 - ax) + V[y1 * U.gw + x1] * ax) * ay;
        L.v[c][g] = L.v[c][g] * a + up * (1 - a);
      }
      L.w[g] = 1;
    }
  }
  return levels[0].v;
}

/**
 * Where the pieces lie: the convex hull of the holes in the backdrop (cells), taken in clusters. A pale
 * piece is only partly a hole (the rest of it merged into the backdrop) and its holes are many small
 * fragments, so holes less than ~8 cells apart are clustered first; a cluster counts when it adds up
 * to a real piece (>= 0.2 % of the photo). Lone specks (an enclosed bit of crease) do not.
 */
function bdPieceZone(C, bd) {
  const { gw, gh, gn } = C;
  const holes = new Uint8Array(gn), q = new Int32Array(gn), lab = new Int32Array(gn);
  for (let g = 0; g < gn; g++) holes[g] = !bd.m[g] && !bd.out[g] ? 1 : 0;
  const near = bdDilate(holes, gw, gh, 4);
  const big = new Uint8Array(gn);
  let id = 0;
  for (let s = 0; s < gn; s++) {
    if (!near[s] || lab[s]) continue;
    let qt = 0, area = 0;
    lab[s] = ++id; q[qt++] = s;
    for (let qh = 0; qh < qt; qh++) {
      const g = q[qh], x = g % gw;
      area += holes[g];
      for (let k = 0; k < 4; k++) {
        const t = k === 0 ? g - 1 : k === 1 ? g + 1 : k === 2 ? g - gw : g + gw;
        if (k === 0 ? x === 0 : k === 1 ? x === gw - 1 : (t < 0 || t >= gn)) continue;
        if (near[t] && !lab[t]) { lab[t] = id; q[qt++] = t; }
      }
    }
    if (area >= 0.002 * gn) for (let k = 0; k < qt; k++) if (holes[q[k]]) big[q[k]] = 1;
  }
  return bdHull(big, gw, gh);
}

/**
 * The backdrop's colour cast drifts across a real photo (mixed daylight and lamp light: one side of
 * the sheet yellowish, the other bluish) by more than the remover's colour model allows. Fit a smooth
 * surface (quadratic in x, y) to the cast (R/Y, B/Y) of backdrop cells, robustly (a pale garment that
 * merged into the backdrop must not drag it), leaving out cells right next to the pieces lying on the
 * backdrop. Returns the fitted cast per cell and the backdrop's median cast.
 */
function bdCastField(C, bd) {
  const { gw, gh, gn, R, B, Y } = C;
  const nearHole = bdDilate(bdPieceZone(C, bd), gw, gh, 3);
  const cu = new Float32Array(gn), cv = new Float32Array(gn), wt = new Float32Array(gn), idx = [];
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const g = gy * gw + gx, yy = Math.max(1, Y[g]);
    cu[g] = R[g] / yy; cv[g] = B[g] / yy;
    if (bd.m[g] && !nearHole[g] && Y[g] > 20) idx.push(g);
  }
  if (idx.length < 30) {           // too little clean backdrop to measure: no correction
    const z = new Float32Array(gn);
    return { su: z, sv: z, u0: 0, v0: 0 };
  }
  // robust quadratic on (every other) clean backdrop cell, compact arrays
  const K = idx.length, sub = idx.filter((g, k) => K < 4000 || (k & 1) === 0), M = sub.length;
  const xs = new Float32Array(M), ys = new Float32Array(M), ku = new Float32Array(M), kv = new Float32Array(M), kw = new Float32Array(M).fill(1);
  sub.forEach((g, k) => { const gx = g % gw, gy = (g / gw) | 0; xs[k] = gw > 1 ? (2 * gx) / (gw - 1) - 1 : 0; ys[k] = gh > 1 ? (2 * gy) / (gh - 1) - 1 : 0; ku[k] = cu[g]; kv[k] = cv[g]; });
  const us = Array.from(ku).sort((a, b) => a - b), vs = Array.from(kv).sort((a, b) => a - b);
  const u0 = us[M >> 1], v0 = vs[M >> 1];
  const terms = polyTerms(2), fu0 = new Float32Array(M), fv0 = new Float32Array(M);
  // Tukey-style weights: cells off the surface by more than ~0.04 stop counting
  const tukey = (du, dv) => { const r = (Math.abs(du) + Math.abs(dv)) / 0.04; return r >= 1 ? 0 : (1 - r * r) * (1 - r * r); };
  let cfU, cfV;
  for (let it = 0; it < 4; it++) {
    [cfU, cfV] = polyFit(terms, xs, ys, [ku, kv], kw, M);
    polyEvalAll(terms, cfU, xs, ys, M, fu0); polyEvalAll(terms, cfV, xs, ys, M, fv0);
    for (let k = 0; k < M; k++) kw[k] = tukey(ku[k] - fu0[k], kv[k] - fv0[k]);
  }
  // final weights for every clean backdrop cell
  const b6 = new Float64Array(terms.length >> 1);
  for (const g of idx) {
    const gx = g % gw, gy = (g / gw) | 0;
    polyBasis(terms, gw > 1 ? (2 * gx) / (gw - 1) - 1 : 0, gh > 1 ? (2 * gy) / (gh - 1) - 1 : 0, b6);
    let pu = 0, pv = 0;
    for (let k = 0; k < b6.length; k++) { pu += cfU[k] * b6[k]; pv += cfV[k] * b6[k]; }
    wt[g] = tukey(cu[g] - pu, cv[g] - pv);
  }
  const su = new Float32Array(gn), sv = new Float32Array(gn);
  // The quadratic only finds the outliers; the field itself is a weighted local average of the
  // inlying backdrop cells (follows the real drift more closely), carried flat into the cells
  // that have no backdrop nearby (never extrapolated: a polynomial swings off over the wall).
  const tmp = new Float32Array(gn), rr = Math.max(2, Math.round(Math.max(gw, gh) / 16));
  for (let g = 0; g < gn; g++) { su[g] = cu[g] * wt[g]; sv[g] = cv[g] * wt[g]; }
  for (let k = 0; k < 2; k++) { boxBlur(su, gw, gh, rr, tmp); boxBlur(sv, gw, gh, rr, tmp); boxBlur(wt, gw, gh, rr, tmp); }
  const ok = new Float32Array(gn);
  for (let g = 0; g < gn; g++) if (wt[g] > 0.05) { su[g] /= wt[g]; sv[g] /= wt[g]; ok[g] = 1; }
  const [fu, fv] = bdFill([su, sv], ok, gw, gh);
  return { su: fu, sv: fv, u0, v0 };
}

/** 5. A copy of the photo with the surroundings painted in the backdrop's colour. */
function bdPaint(img, C, bd, paint) {
  const { data, width: w, height: h } = img;
  const { cs, gw, gh, gn, R, G, B } = C;
  // paint one cell further into the backdrop too (its rim cells mix in the surroundings' colour),
  // and take the fill colours only from backdrop cells clear of the surroundings
  const zone = bdDilate(paint, gw, gh, 1);
  for (let g = 0; g < gn; g++) if (zone[g] && !paint[g] && !bd.m[g]) zone[g] = 0;
  const near = bdDilate(zone, gw, gh, 1), wt = new Float32Array(gn);
  for (let g = 0; g < gn; g++) wt[g] = bd.m[g] && !near[g] ? 1 : 0;
  const [fR, fG, fB] = bdFill([Float32Array.from(R), Float32Array.from(G), Float32Array.from(B)], wt, gw, gh);
  const { su, sv, u0, v0 } = bdCastField(C, bd);
  // per cell: the cast shift, and the colour the remover will see there (for backdropFinish)
  const du = new Float32Array(gn), dv = new Float32Array(gn), cR = new Float32Array(gn), cG = new Float32Array(gn), cB = new Float32Array(gn);
  const shift = (r, g, b, u, v, k) => {
    const yy = 0.299 * r + 0.587 * g + 0.114 * b, r2 = r - u * yy, b2 = b - v * yy;
    cR[k] = r2; cB[k] = b2; cG[k] = (yy - 0.299 * r2 - 0.114 * b2) / 0.587;
  };
  for (let g = 0; g < gn; g++) {
    du[g] = su[g] - u0; dv[g] = sv[g] - v0;
    if (zone[g]) shift(fR[g], fG[g], fB[g], du[g], dv[g], g); else shift(R[g], G[g], B[g], du[g], dv[g], g);
  }
  const out = new Uint8ClampedArray(data);
  // bilinear weights along x, once (for the smooth fill of the painted cells)
  const X0 = new Int32Array(w), X1 = new Int32Array(w), AX = new Float32Array(w), XC = new Int32Array(w);
  for (let x = 0; x < w; x++) {
    const gxf = Math.min(gw - 1, Math.max(0, (x + 0.5) / cs - 0.5));
    X0[x] = Math.floor(gxf); X1[x] = Math.min(gw - 1, X0[x] + 1); AX[x] = gxf - X0[x]; XC[x] = (x / cs) | 0;
  }
  for (let y = 0; y < h; y++) {
    const gyf = Math.min(gh - 1, Math.max(0, (y + 0.5) / cs - 0.5)), gy0 = Math.floor(gyf), gy1 = Math.min(gh - 1, gy0 + 1), ay = gyf - gy0;
    const row = ((y / cs) | 0) * gw;
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
      const g = row + XC[x];
      let r = data[i], gg = data[i + 1], bb = data[i + 2];
      if (zone[g]) {
        const gx0 = X0[x], gx1 = X1[x], ax = AX[x];
        const a = gy0 * gw + gx0, b = gy0 * gw + gx1, c = gy1 * gw + gx0, d = gy1 * gw + gx1;
        const w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
        r = fR[a] * w00 + fR[b] * w10 + fR[c] * w01 + fR[d] * w11;
        gg = fG[a] * w00 + fG[b] * w10 + fG[c] * w01 + fG[d] * w11;
        bb = fB[a] * w00 + fB[b] * w10 + fB[c] * w01 + fB[d] * w11;
      }
      // the cast field is very smooth: one shift per cell is enough
      const yy = 0.299 * r + 0.587 * gg + 0.114 * bb, r2 = r - du[g] * yy, b2 = bb - dv[g] * yy;
      out[i] = r2; out[i + 2] = b2;
      out[i + 1] = (yy - 0.299 * r2 - 0.114 * b2) / 0.587;
    }
  }
  return { img: { data: out, width: w, height: h }, zone, cR, cG, cB };
}

/**
 * The stage (hooked in before segment()). Returns null when there is nothing to do (no clear
 * backdrop, the backdrop fills the frame, or what lies around it looks like more of the same), else
 * { img: the photo with the surroundings painted over and the backdrop's cast evened out - what
 * segment()/finish() should work on; zone: painted cells; cR/cG/cB: the colour per cell in img;
 * C: the cells; bd: the backdrop; pieces: cells where the pieces lie } for backdropFinish().
 */
function backdropFirst(img) {
  const { width: w, height: h } = img;
  if (w * h < 4000) return null;
  const C = bdCells(img);
  const bd = bdPick(C);
  if (!bd) return null;
  const paint = bdOutside(C, bd);
  if (!paint) return null;
  const P = bdPaint(img, C, bd, paint);
  // where the pieces lie: the holes' zone, plus pieces that reach over the backdrop's edge or the frame
  const pieces = bdPieceZone(C, bd);
  for (let g = 0; g < C.gn; g++) if (bd.keep[g]) pieces[g] = 1;
  return { img: P.img, zone: P.zone, cR: P.cR, cG: P.cG, cB: P.cB, C, bd, pieces: bdDilate(pieces, C.gw, C.gh, 2) };
}

/**
 * After the cut (hooked in after finish()). On the box around the cut:
 *  1. nothing that was painted over can be part of the piece;
 *  2. leftover backdrop: bits of sheet still attached to the piece's outline (a crease running off
 *     the hem, the sheet in the gap under an arm, a pale scrap at a cuff). The piece's own colours
 *     are learnt from the inside of the cut (a small palette); a kept pixel that looks like the
 *     backdrop right there (same cast, any shade from shadow to plain), is not grainy, and is clearly
 *     unlike every colour of the piece is backdrop. Such pixels go in connected groups, and only
 *     groups that reach the outline: whatever the piece encloses (a beige neck label, a zip, a white
 *     logo) stays. A white piece on a white sheet has white in its palette, so nothing of it looks
 *     "unlike the piece" and nothing is removed;
 *  3. grainy areas (knit) where the pieces lie that the remover gave to the backdrop come back;
 *  4. holes enclosed by the piece that do not look like the backdrop are filled;
 *  5. a 1-2 px fringe of backdrop colour along the outline goes (bdDefringe);
 *  6. parts not connected to where the pieces lie, and specks, go.
 * Steps 2 and 5 only from a little above the gentle end of the slider (as tidy()/finish() do).
 */
function backdropFinish(mask, BD, P) {
  const { cs, gw, gh, gn } = BD.C, { data, width: fw, height: fh } = BD.img, zone = BD.zone, pz = BD.pieces;
  // 1. painted = not the piece; meanwhile find the box around the cut and the pieces' zone
  let bx0 = fw, by0 = fh, bx1 = -1, by1 = -1;
  for (let y = 0; y < fh; y++) {
    const row = ((y / cs) | 0) * gw;
    for (let x = 0, p = y * fw; x < fw; x++, p++) {
      const g = row + ((x / cs) | 0);
      if (zone[g]) mask[p] = 0;
      if (mask[p] || pz[g]) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
    }
  }
  if (bx1 < 0) return;
  // everything below works on that box (plus a margin), not the whole photo
  const x0 = Math.max(0, bx0 - 12), y0 = Math.max(0, by0 - 12), w = Math.min(fw, bx1 + 13) - x0, h = Math.min(fh, by1 + 13) - y0, n = w * h;
  const cm = new Uint8Array(n), cd = new Uint8ClampedArray(n * 4), CX = new Int32Array(w), CY = new Int32Array(h);
  for (let x = 0; x < w; x++) CX[x] = ((x + x0) / cs) | 0;
  for (let y = 0; y < h; y++) {
    CY[y] = ((y + y0) / cs | 0) * gw;
    cm.set(mask.subarray((y + y0) * fw + x0, (y + y0) * fw + x0 + w), y * w);
    cd.set(data.subarray(((y + y0) * fw + x0) * 4, ((y + y0) * fw + x0 + w) * 4), y * w * 4);
  }
  bdCleanCut(cm, cd, w, h, CX, CY, BD, P.u > 0.15);
  for (let y = 0; y < h; y++) mask.set(cm.subarray(y * w, y * w + w), (y + y0) * fw + x0);
}

/** Steps 2-6 of backdropFinish on the box around the cut (CX / CY: cell column / row offset per px). */
function bdCleanCut(mask, data, w, h, CX, CY, BD, strong) {
  const { gw, gh, gn } = BD.C, zone = BD.zone, pz = BD.pieces, grow = BD.bd.grow, n = w * h;
  // backdrop colour per cell, from the (painted, cast-flattened) image the remover saw
  const wt = new Float32Array(gn);
  for (let g = 0; g < gn; g++) wt[g] = grow[g] ? 1 : 0;
  const [fR, fG, fB] = bdFill([Float32Array.from(BD.cR), Float32Array.from(BD.cG), Float32Array.from(BD.cB)], wt, gw, gh);
  // palette of the piece: k-means on the deep inside of the cut (leftovers sit at the outline, so
  // only pixels at least a quarter of the piece's own thickness in from it are sampled)
  const din = bdInsideDist(mask, w, h);
  let dmax = 0;
  for (let p = 0; p < n; p++) if (din[p] > dmax) dmax = din[p];
  const core = new Uint8Array(n), dCore = Math.max(5, 0.25 * dmax);
  for (let p = 0; p < n; p++) core[p] = din[p] >= dCore ? 1 : 0;
  const pal = bdPalette(data, core, w, h);
  if (!pal.length) return;
  // fine grain (knit, weave) per pixel, and the backdrop's own grain level: a knitted piece is far
  // grainier than a sheet, whatever its colour - the one cue left for a cream piece on a cream sheet
  const tex = bdTexture(data, w, h, 0, 0, w, h), tb = [];
  for (let y = 0; y < h; y += 3) for (let x = 0, p = y * w; x < w; x += 3, p += 3) if (grow[CY[y] + CX[x]] && !mask[p]) tb.push(tex[p]);
  tb.sort((a, b) => a - b);
  const T = Math.max(0.02, 4 * (tb.length ? tb[tb.length >> 1] : 0.005));
  const bgl = new Uint8Array(n), shade = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0, p = y * w, i = p * 4; x < w; x++, p++, i += 4) {
      if (!strong || !mask[p] || tex[p] > T) continue;        // grainy: part of a piece
      const g = CY[y] + CX[x], r = data[i], gg = data[i + 1], b = data[i + 2];
      const yp = 0.299 * r + 0.587 * gg + 0.114 * b, yf = 0.299 * fR[g] + 0.587 * fG[g] + 0.114 * fB[g];
      const s = yp / Math.max(1, yf);
      if (s < 0.55 || s > 1.1) continue;                       // not a shade of the backdrop
      // cast difference in levels (backdrop colour scaled to this pixel's brightness)
      const dr = r - fR[g] * s, dg = gg - fG[g] * s, db = b - fB[g] * s;
      const dB = Math.sqrt(dr * dr + dg * dg + db * db);
      if (dB > 14) continue;
      let dP = 1e9;
      for (const c of pal) { const er = r - c[0], eg = gg - c[1], eb = b - c[2]; const d = er * er + eg * eg + eb * eb; if (d < dP) dP = d; }
      if (Math.sqrt(dP) > dB + 18) { bgl[p] = 1; shade[p] = s; }
    }
  }
  // Remove the groups that reach the outline and are not a big part of the piece. One shape is
  // spared: a broad, fully lit pale band lying between the piece and the outside for its whole length
  // could be a pale trim of the piece (a white hem band). Creases and patches stick OUT of the outline
  // (they border the outside more than the piece), the sheet seen under an arm or between the legs
  // sits IN a notch (bordered by the piece more than by the outside); shaded, thin or tiny groups go
  // whatever their shape.
  let area = 0;
  for (let p = 0; p < n; p++) area += mask[p];
  const dg = bdInsideDist(bgl, w, h);
  const notPiece = new Uint8Array(n);
  for (let p = 0; p < n; p++) notPiece[p] = mask[p] && !bgl[p] ? 0 : 1;
  const dp = bdInsideDist(notPiece, w, h, true);   // distance to the nearest pixel of the piece proper
  const q = new Int32Array(n), seen = new Uint8Array(n);
  for (let s0 = 0; s0 < n; s0++) {
    if (!bgl[s0] || seen[s0]) continue;
    let qt = 0, eOut = 0, eIn = 0, sum = 0, thick = 0, far = 0;
    seen[s0] = 1; q[qt++] = s0;
    for (let qh = 0; qh < qt; qh++) {
      const p = q[qh], x = p % w;
      sum += shade[p]; if (dg[p] > thick) thick = dg[p]; if (dp[p] > far) far = dp[p];
      let o = 0, i = 0;
      for (let k = 0; k < 4; k++) {
        const t = k === 0 ? p - 1 : k === 1 ? p + 1 : k === 2 ? p - w : p + w;
        if (k === 0 ? x === 0 : k === 1 ? x === w - 1 : (t < 0 || t >= n)) { o = 1; continue; }
        if (!mask[t]) o = 1;
        else if (!bgl[t]) i = 1;
        else if (!seen[t]) { seen[t] = 1; q[qt++] = t; }
      }
      eOut += o; eIn += i;
    }
    if (!eOut || qt >= 0.08 * area) continue;
    // (a trim also stays close to the rest of the piece all along: nothing of it lies further from
    // the piece than about twice its own width)
    const trimLike = eOut >= 0.75 * eIn && eOut <= 1.33 * eIn && sum / qt >= 0.93 && thick > 3 && qt >= 80 && far <= 2 * thick + 2;
    if (!trimLike) for (let k = 0; k < qt; k++) mask[q[k]] = 0;
  }
  // Grainy areas where the pieces lie that the remover gave to the backdrop (it takes a lit cream
  // knit on a cream sheet for a pocket of plain sheet) come back, when they are broad (an opening
  // removes thin crease lines) and touch the piece.
  const cand = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0, p = y * w; x < w; x++, p++) { const g = CY[y] + CX[x]; if (!mask[p] && tex[p] > T && pz[g] && !zone[g]) cand[p] = 1; }
  let op = cand;
  for (let k = 0; k < 3; k++) op = erode4(op, w, h, 0);
  for (let k = 0; k < 3; k++) op = dilate4(op, w, h);
  for (let p = 0; p < n; p++) op[p] &= cand[p];
  for (let s0 = 0; s0 < n; s0++) {
    if (op[s0] !== 1) continue;
    let qt = 0, touch = 0;
    op[s0] = 2; q[qt++] = s0;
    for (let qh = 0; qh < qt; qh++) {
      const p = q[qh], x = p % w;
      for (let k = 0; k < 4; k++) {
        const t = k === 0 ? p - 1 : k === 1 ? p + 1 : k === 2 ? p - w : p + w;
        if (k === 0 ? x === 0 : k === 1 ? x === w - 1 : (t < 0 || t >= n)) continue;
        if (mask[t]) touch = 1;
        else if (op[t] === 1) { op[t] = 2; q[qt++] = t; }
      }
    }
    if (touch) for (let k = 0; k < qt; k++) mask[q[k]] = 1;
  }
  // Holes enclosed by the piece that do not look like the backdrop (a beige neck label the remover
  // took for a pocket of plain sheet) are part of the piece: fill them. Holes that show the sheet
  // (inside a bag's handle) look like the backdrop and stay.
  {
    const seen = new Uint8Array(n);
    let area2 = 0, qt = 0;
    for (let p = 0; p < n; p++) area2 += mask[p];
    // the open background first (reached from the box's border), without looking at colours
    for (let p = 0; p < n; p++) {
      const x = p % w, y = (p / w) | 0;
      if (!mask[p] && (x === 0 || y === 0 || x === w - 1 || y === h - 1)) { seen[p] = 1; q[qt++] = p; }
    }
    for (let qh = 0; qh < qt; qh++) {
      const p = q[qh], x = p % w;
      if (x > 0 && !mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; q[qt++] = p - 1; }
      if (x < w - 1 && !mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; q[qt++] = p + 1; }
      if (p >= w && !mask[p - w] && !seen[p - w]) { seen[p - w] = 1; q[qt++] = p - w; }
      if (p + w < n && !mask[p + w] && !seen[p + w]) { seen[p + w] = 1; q[qt++] = p + w; }
    }
    for (let s0 = 0; s0 < n; s0++) {
      if (mask[s0] || seen[s0]) continue;
      let border = 0, unlike = 0;
      qt = 0; seen[s0] = 1; q[qt++] = s0;
      for (let qh = 0; qh < qt; qh++) {
        const p = q[qh], x = p % w, y = (p / w) | 0;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = 1;
        const g = CY[y] + CX[x], i = p * 4, r = data[i], gg = data[i + 1], b = data[i + 2];
        const yp = 0.299 * r + 0.587 * gg + 0.114 * b, yf = 0.299 * fR[g] + 0.587 * fG[g] + 0.114 * fB[g], sh = yp / Math.max(1, yf);
        const dr = r - fR[g] * sh, dg = gg - fG[g] * sh, db = b - fB[g] * sh;
        if (sh < 0.55 || sh > 1.1 || dr * dr + dg * dg + db * db > 14 * 14) unlike++;
        if (x > 0 && !mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; q[qt++] = p - 1; }
        if (x < w - 1 && !mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; q[qt++] = p + 1; }
        if (p >= w && !mask[p - w] && !seen[p - w]) { seen[p - w] = 1; q[qt++] = p - w; }
        if (p + w < n && !mask[p + w] && !seen[p + w]) { seen[p + w] = 1; q[qt++] = p + w; }
      }
      if (!border && qt < 0.05 * area2 && unlike >= 0.6 * qt) for (let k = 0; k < qt; k++) mask[q[k]] = 1;
    }
  }
  if (strong) bdDefringe(mask, data, w, h, CX, CY, fR, fG, fB);
  // Pieces lie where the holes in the backdrop are (and where pieces reach over the backdrop's
  // edge): a part of the cut not connected to that zone at all (a strip of skirting board the
  // backdrop grew over in a flat, low-contrast photo) is not a piece - when the zone exists and the
  // cut reaches into it. Specks (< 4 % of the biggest part) go too, as in tidy().
  {
    const lab = new Int32Array(n), sizes = [0], hits = [0];
    let inZone = 0, biggest = 0, id = 0;
    for (let s0 = 0; s0 < n; s0++) {
      if (!mask[s0] || lab[s0]) continue;
      let qt = 0, hit = 0;
      lab[s0] = ++id; q[qt++] = s0;
      for (let qh = 0; qh < qt; qh++) {
        const p = q[qh], x = p % w, y = (p / w) | 0;
        if (!hit && pz[CY[y] + CX[x]]) hit = 1;
        if (x > 0 && mask[p - 1] && !lab[p - 1]) { lab[p - 1] = id; q[qt++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !lab[p + 1]) { lab[p + 1] = id; q[qt++] = p + 1; }
        if (p >= w && mask[p - w] && !lab[p - w]) { lab[p - w] = id; q[qt++] = p - w; }
        if (p + w < n && mask[p + w] && !lab[p + w]) { lab[p + w] = id; q[qt++] = p + w; }
      }
      sizes.push(qt); hits.push(hit); inZone |= hit;
    }
    for (let k = 1; k <= id; k++) if ((!inZone || hits[k]) && sizes[k] > biggest) biggest = sizes[k];
    for (let p = 0; p < n; p++) { const k = lab[p]; if (k && ((inZone && !hits[k]) || sizes[k] < 0.04 * biggest)) mask[p] = 0; }
  }
}

/**
 * Defringe: an outline pixel whose colour (3x3 mean) is more backdrop than piece - projected on the
 * line from the backdrop's colour there to the colour of the piece a few px inside - goes. Two passes
 * (at most 2 px). Where piece and backdrop look alike (white on white) nothing is decided.
 */
function bdDefringe(mask, data, w, h, CX, CY, fR, fG, fB) {
  const n = w * h;
  const din = bdInsideDist(mask, w, h), src = new Int32Array(n).fill(-1), q = new Int32Array(n), dep = new Uint8Array(n);
  let qt = 0;
  for (let p = 0; p < n; p++) if (din[p] >= 3.5) { src[p] = p; q[qt++] = p; }
  for (let qh = 0; qh < qt; qh++) {
    const p = q[qh], x = p % w;
    if (dep[p] >= 6) continue;
    for (let k = 0; k < 4; k++) {
      const t = k === 0 ? p - 1 : k === 1 ? p + 1 : k === 2 ? p - w : p + w;
      if (k === 0 ? x === 0 : k === 1 ? x === w - 1 : (t < 0 || t >= n)) continue;
      if (mask[t] && src[t] < 0) { src[t] = src[p]; dep[t] = dep[p] + 1; q[qt++] = t; }
    }
  }
  const drop = [];
  for (let pass = 0; pass < 2; pass++) {
    drop.length = 0;
    for (let y = 0; y < h; y++) for (let x = 0, p = y * w; x < w; x++, p++) {
      if (!mask[p] || src[p] < 0) continue;
      if (!((x > 0 && !mask[p - 1]) || (x < w - 1 && !mask[p + 1]) || (y > 0 && !mask[p - w]) || (y < h - 1 && !mask[p + w]))) continue;
      const g = CY[y] + CX[x], si = src[p] * 4;
      const vr = data[si] - fR[g], vg = data[si + 1] - fG[g], vb = data[si + 2] - fB[g], v2 = vr * vr + vg * vg + vb * vb;
      if (v2 < 400) continue;
      let sr = 0, sg = 0, sb = 0, c = 0;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1), i = (yy * w + xx) * 4; xx <= Math.min(w - 1, x + 1); xx++, i += 4) { sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; c++; }
      const a = ((sr / c - fR[g]) * vr + (sg / c - fG[g]) * vg + (sb / c - fB[g]) * vb) / v2;
      if (a < 0.5) drop.push(p);
    }
    for (const p of drop) mask[p] = 0;
  }
}

/**
 * Fine grain per pixel: mean |Y - 3x3 mean of Y| over a 9x9 window, relative to the brightness.
 * Next to a strong outline (a dark piece against a white sheet) the step itself would read as grain,
 * so within 4 px of a step steeper than 12 % per pixel the grain is set to 0 (no evidence either way).
 * Only computed inside the box [x0, x1) x [y0, y1); 0 elsewhere.
 */
function bdTexture(data, w, h, x0, y0, x1, y1) {
  const W = x1 - x0, H = y1 - y0, out = new Float32Array(w * h);
  if (W < 3 || H < 3) return out;
  const n = W * H, Y = new Float32Array(n), A = new Float32Array(n), S = new Float32Array(n), tmp = new Float32Array(n);
  for (let y = 0; y < H; y++) for (let x = 0, p = y * W, i = ((y + y0) * w + x0) * 4; x < W; x++, p++, i += 4) Y[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  A.set(Y); boxBlur(A, W, H, 1, tmp);
  for (let y = 0; y < H; y++) for (let x = 0, p = y * W; x < W; x++, p++) {
    const gx = x > 0 && x < W - 1 ? A[p + 1] - A[p - 1] : 0, gy = y > 0 && y < H - 1 ? A[p + W] - A[p - W] : 0;
    S[p] = Math.sqrt(gx * gx + gy * gy) > 0.24 * Math.max(A[p], 40) ? 1 : 0;
  }
  for (let p = 0; p < n; p++) A[p] = Math.abs(Y[p] - A[p]);
  boxBlur(A, W, H, 4, tmp); boxBlur(Y, W, H, 4, tmp); boxBlur(S, W, H, 4, tmp);
  for (let y = 0; y < H; y++) for (let x = 0, p = y * W, o = (y + y0) * w + x0; x < W; x++, p++, o++) out[o] = S[p] > 1e-4 ? 0 : A[p] / Math.max(Y[p], 40);
  return out;
}

/** Chamfer distance (px) from each set pixel to the nearest unset pixel (and to the image edge,
 *  unless noEdge). */
function bdInsideDist(m, w, h, noEdge) {
  const E = noEdge ? 1e9 : 0;
  const d = new Float32Array(w * h), b = Math.SQRT2;
  for (let y = 0; y < h; y++) for (let x = 0, p = y * w; x < w; x++, p++) {
    if (!m[p]) continue;
    let v = E || Math.min(x + 1, y + 1);
    if (x > 0) v = Math.min(v, d[p - 1] + 1);
    if (y > 0) { v = Math.min(v, d[p - w] + 1); if (x > 0) v = Math.min(v, d[p - w - 1] + b); if (x < w - 1) v = Math.min(v, d[p - w + 1] + b); }
    d[p] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1, p = y * w + x; x >= 0; x--, p--) {
    if (!m[p]) continue;
    let v = E ? d[p] : Math.min(d[p], w - x, h - y);
    if (x < w - 1) v = Math.min(v, d[p + 1] + 1);
    if (y < h - 1) { v = Math.min(v, d[p + w] + 1); if (x < w - 1) v = Math.min(v, d[p + w + 1] + b); if (x > 0) v = Math.min(v, d[p + w - 1] + b); }
    d[p] = v;
  }
  return d;
}

/** Up to 8 main colours of the pixels in `sel` (k-means on a sample); rare ones (< 2 %) dropped. */
function bdPalette(data, sel, w, h) {
  const n = w * h, step = Math.max(1, Math.round(Math.sqrt(n / 12000)));
  const S = [];
  for (let y = 0; y < h; y += step) for (let x = 0, p = y * w; x < w; x += step, p += step) if (sel[p]) S.push(p * 4);
  if (S.length < 50) return [];
  const K = 8, cen = [];
  // start from samples spread over the brightness range
  const order = S.slice().sort((a, b) => (data[a] + data[a + 1] + data[a + 2]) - (data[b] + data[b + 1] + data[b + 2]));
  for (let k = 0; k < K; k++) { const i = order[Math.min(order.length - 1, Math.floor(((k + 0.5) / K) * order.length))]; cen.push([data[i], data[i + 1], data[i + 2]]); }
  const cnt = new Float64Array(K), acc = new Float64Array(K * 3);
  for (let it = 0; it < 6; it++) {
    cnt.fill(0); acc.fill(0);
    for (const i of S) {
      let best = 0, bd = 1e9;
      for (let k = 0; k < K; k++) { const c = cen[k], dr = data[i] - c[0], dg = data[i + 1] - c[1], db = data[i + 2] - c[2], d = dr * dr + dg * dg + db * db; if (d < bd) { bd = d; best = k; } }
      cnt[best]++; acc[best * 3] += data[i]; acc[best * 3 + 1] += data[i + 1]; acc[best * 3 + 2] += data[i + 2];
    }
    for (let k = 0; k < K; k++) if (cnt[k]) cen[k] = [acc[k * 3] / cnt[k], acc[k * 3 + 1] / cnt[k], acc[k * 3 + 2] / cnt[k]];
  }
  return cen.filter((c, k) => cnt[k] >= 0.02 * S.length);
}

/* ------------------------------------------------------------------ scene stage (graph cut) */

// =====================================================================================================
// SCENE STAGE: graph cut for photos that are NOT one plain background - a garment on a bed sheet in a
// room, with a wall, a floor, furniture and a rug around it. Everything below up to computeMask() is
// this stage; nothing above it was changed.
//
// WHERE IT HOOKS IN (computeMask, 4 changed lines):
//
//   S = segment(img, P); fg = tidy(S, P);                       <- unchanged
//   scene = sceneGate(S, fg) ? sceneCut(img, S, P) : null;      <- NEW: decide, and cut
//   if (scene) fg = scene.fg;                                   <- NEW: replaces tidy()'s mask
//   mask = finish(img, S, fg, P);                               <- unchanged (outline refinement)
//   if (scene) mask = sceneFinish(img, mask, scene);            <- NEW: smooth + trim + main piece
//   ...user erase seeds                                         <- unchanged
//
// sceneCut() returns a mask on segment()'s working grid (S.W x S.H, 1 = garment), i.e. exactly what
// tidy() returns, so finish() treats it like any other mask. When sceneGate() says no (the plain-
// background model cleared the whole frame) nothing here runs and results are bit-identical to before.
// sceneGate() reads tidy()'s output: if tidy() is changed to remove more (thin lines), it only sees
// fewer frame pixels kept - a room's wall, floor and rug are not thin, so the decision does not move.
//
// sceneCut, in short:
//   1. features: CIE Lab of the photo on the working grid; a coarse copy (~225 px long side).
//   2. automatic seeds (frameSeeds, barrierDistance): how much colour change a path from the frame
//      must cross to reach each pixel (minimum barrier distance). Wall, floor, rug and sheet run out
//      of the photo in their own colour and come out low; the garment costs its contrast with its
//      surroundings, however soft its outline. Stretches of the frame that look like something poking
//      out of the photo (a cut-off sleeve) do not seed, so such a garment still counts as enclosed.
//   3. GrabCut on the coarse grid: two Gaussian mixtures (garment / rest) in Lab, contrast-sensitive
//      smoothness on the 8-connected grid, exact min-cut (Boykov-Kolmogorov max-flow, gridMinCut);
//      re-fit and re-cut up to 5 times. Seed map, frame and slider are biases on the per-pixel costs.
//   4. local refinement at working resolution (2 rounds): only a band round the coarse piece may
//      change; the background model is re-fitted to that band (the sheet right round the garment) and
//      the garment model only to what that sheet model does not explain - this re-opens bag handles,
//      the gap between trouser legs and sheet showing under an arm.
//   5. keepMainPiece: the main central piece(s) (both shoes of a pair), small holes filled (a neck
//      label, a zip pull), big background-coloured holes (a bag handle) kept open.
// =====================================================================================================
const GDX = [1, -1, 0, 0, 1, -1, 1, -1], GDY = [0, 0, 1, -1, 1, -1, -1, 1]; // d ^ 1 = opposite direction

/**
 * Exact s-t minimum cut on an 8-connected W x H grid: Boykov-Kolmogorov max-flow (search trees grown
 * from both terminals, augment, adopt orphans; integer capacities so saturation is exact).
 * cap: Int32Array(N * 8), residual capacity of the edge from p to its neighbour in direction d (edges
 *      leaving the grid are ignored). tr: Int32Array(N), terminal residual: > 0 from the source,
 *      < 0 to the sink. Both are consumed. Returns Uint8Array, 1 = source side (garment).
 */
function gridMinCut(W, H, cap, tr) {
  const N = W * H, TERM = 8, ORPH = 9, NONE = 10, M = N + 1;
  const off = GDX.map((dx, d) => dx + GDY[d] * W);
  const valid = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = 0;
    for (let d = 0; d < 8; d++) { const xx = x + GDX[d], yy = y + GDY[d]; if (xx >= 0 && yy >= 0 && xx < W && yy < H) m |= 1 << d; }
    valid[y * W + x] = m;
  }
  const tree = new Uint8Array(N), parent = new Uint8Array(N).fill(NONE), ts = new Int32Array(N), dist = new Int32Array(N);
  const act = new Int32Array(M), inq = new Uint8Array(N), orph = new Int32Array(M);
  let ah = 0, at = 0, an = 0, oh = 0, ot = 0, on = 0, TIME = 0;
  const activate = (p) => { if (!inq[p]) { inq[p] = 1; act[at] = p; at = at + 1 === M ? 0 : at + 1; an++; } };
  const orphan = (p) => { parent[p] = ORPH; orph[ot] = p; ot = ot + 1 === M ? 0 : ot + 1; on++; };
  for (let p = 0; p < N; p++) {
    if (tr[p] > 0) { tree[p] = 1; parent[p] = TERM; dist[p] = 1; activate(p); }
    else if (tr[p] < 0) { tree[p] = 2; parent[p] = TERM; dist[p] = 1; activate(p); }
  }
  const augment = (a, ad) => {
    const b = a + off[ad];
    let bn = cap[a * 8 + ad], x = a;
    while (parent[x] !== TERM) { const d = parent[x], y = x + off[d], c = cap[y * 8 + (d ^ 1)]; if (c < bn) bn = c; x = y; }
    if (tr[x] < bn) bn = tr[x];
    x = b;
    while (parent[x] !== TERM) { const d = parent[x], c = cap[x * 8 + d]; if (c < bn) bn = c; x += off[d]; }
    if (-tr[x] < bn) bn = -tr[x];
    cap[a * 8 + ad] -= bn; cap[b * 8 + (ad ^ 1)] += bn;
    x = a;
    while (parent[x] !== TERM) {
      const d = parent[x], y = x + off[d];
      cap[x * 8 + d] += bn; cap[y * 8 + (d ^ 1)] -= bn;
      if (cap[y * 8 + (d ^ 1)] === 0) orphan(x);
      x = y;
    }
    tr[x] -= bn; if (tr[x] === 0) orphan(x);
    x = b;
    while (parent[x] !== TERM) {
      const d = parent[x], y = x + off[d];
      cap[y * 8 + (d ^ 1)] += bn; cap[x * 8 + d] -= bn;
      if (cap[x * 8 + d] === 0) orphan(x);
      x = y;
    }
    tr[x] += bn; if (tr[x] === 0) orphan(x);
  };
  const adopt = () => {
    while (on > 0) {
      const x = orph[oh]; oh = oh + 1 === M ? 0 : oh + 1; on--;
      const t = tree[x], vm = valid[x];
      let bestD = -1, bestDist = 1e9;
      for (let d = 0; d < 8; d++) {
        if (!((vm >> d) & 1)) continue;
        const q = x + off[d];
        if (tree[q] !== t || parent[q] === NONE) continue;
        if (t === 1 ? cap[q * 8 + (d ^ 1)] <= 0 : cap[x * 8 + d] <= 0) continue;
        let y = q, dd = 0;
        for (;;) {                       // does q still hang from a terminal?
          if (ts[y] === TIME) { dd += dist[y]; break; }
          const py = parent[y];
          dd++;
          if (py === TERM) { ts[y] = TIME; dist[y] = 1; break; }
          if (py === ORPH) { dd = 1e9; break; }
          y += off[py];
        }
        if (dd < 1e9) {
          if (dd < bestDist) { bestDist = dd; bestD = d; }
          for (let z = q, k = dd; ts[z] !== TIME; z += off[parent[z]]) { ts[z] = TIME; dist[z] = k--; }
        }
      }
      if (bestD >= 0) { parent[x] = bestD; ts[x] = TIME; dist[x] = bestDist + 1; continue; }
      for (let d = 0; d < 8; d++) {      // no valid parent: x becomes free, its children orphans
        if (!((vm >> d) & 1)) continue;
        const q = x + off[d];
        if (tree[q] !== t || parent[q] === NONE) continue;
        if (t === 1 ? cap[q * 8 + (d ^ 1)] > 0 : cap[x * 8 + d] > 0) activate(q);
        const pq = parent[q];
        if (pq !== TERM && pq !== ORPH && q + off[pq] === x) orphan(q);
      }
      parent[x] = NONE; tree[x] = 0;
    }
  };
  while (an > 0) {
    const p = act[ah]; ah = ah + 1 === M ? 0 : ah + 1; an--; inq[p] = 0;
    if (parent[p] === NONE) continue;
    let a = -1, ad = -1;
    const vm = valid[p];
    if (tree[p] === 1) {
      for (let d = 0; d < 8; d++) {
        if (!((vm >> d) & 1) || cap[p * 8 + d] <= 0) continue;
        const q = p + off[d];
        if (parent[q] === NONE) { tree[q] = 1; parent[q] = d ^ 1; ts[q] = ts[p]; dist[q] = dist[p] + 1; activate(q); }
        else if (tree[q] === 2) { a = p; ad = d; break; }
        else if (ts[q] <= ts[p] && dist[q] > dist[p]) { parent[q] = d ^ 1; ts[q] = ts[p]; dist[q] = dist[p] + 1; }
      }
    } else {
      for (let d = 0; d < 8; d++) {
        if (!((vm >> d) & 1)) continue;
        const q = p + off[d];
        if (cap[q * 8 + (d ^ 1)] <= 0) continue;
        if (parent[q] === NONE) { tree[q] = 2; parent[q] = d ^ 1; ts[q] = ts[p]; dist[q] = dist[p] + 1; activate(q); }
        else if (tree[q] === 1) { a = q; ad = d ^ 1; break; }
        else if (ts[q] <= ts[p] && dist[q] > dist[p]) { parent[q] = d ^ 1; ts[q] = ts[p]; dist[q] = dist[p] + 1; }
      }
    }
    if (a < 0) continue;
    TIME++;
    activate(p);                         // p may have more connections to the other tree
    augment(a, ad);
    adopt();
  }
  const out = new Uint8Array(N);
  for (let p = 0; p < N; p++) out[p] = tree[p] === 1 && parent[p] !== NONE ? 1 : 0;
  return out;
}

/** sRGB (0..255) -> CIE Lab (D65), into out[0..2]. */
const SRGB_LUT = new Float32Array(1025);
for (let i = 0; i <= 1024; i++) { const v = i / 1024; SRGB_LUT[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }


function labOf(r, g, b, out) {
  const lin = (v) => { const t = clamp(v, 0, 255) * (1024 / 255), i = t | 0; return i >= 1024 ? SRGB_LUT[1024] : SRGB_LUT[i] + (SRGB_LUT[i + 1] - SRGB_LUT[i]) * (t - i); };
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const R = lin(r), G = lin(g), B = lin(b);
  const fx = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), fy = f(0.2126 * R + 0.7152 * G + 0.0722 * B), fz = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  out[0] = 116 * fy - 16; out[1] = 500 * (fx - fy); out[2] = 200 * (fy - fz);
  return out;
}

/** sRGB (0..255, float) planes -> CIE Lab planes. */
function labPlanes(R, G, B, n) {
  const L = new Float32Array(n), A = new Float32Array(n), Bb = new Float32Array(n), o = [0, 0, 0];
  for (let p = 0; p < n; p++) { labOf(R[p], G[p], B[p], o); L[p] = o[0]; A[p] = o[1]; Bb[p] = o[2]; }
  return [L, A, Bb];
}

/** Box-average float planes by an integer factor k. */
function shrinkPlanes(planes, W, H, k) {
  const w = Math.ceil(W / k), h = Math.ceil(H / k);
  const out = planes.map(() => new Float32Array(w * h));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const y0 = y * k, y1 = Math.min(H, y0 + k), x0 = x * k, x1 = Math.min(W, x0 + k);
    const inv = 1 / ((y1 - y0) * (x1 - x0));
    for (let c = 0; c < planes.length; c++) {
      const src = planes[c]; let s = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0, p = yy * W + x0; xx < x1; xx++, p++) s += src[p];
      out[c][y * w + x] = s * inv;
    }
  }
  return { w, h, planes: out };
}

/** Weights of L, a, b in the seed distances: chroma counts most (shading and wrinkles change lightness). */
const SEED_WT = [0.5, 2, 2];

/**
 * Which frame pixels may seed the background. The frame is walked once round and cut into stretches
 * where the colour (averaged over 5 px either side, so a rug pattern does not count) changes sharply.
 * A stretch does not seed when it is something poking out of the photo rather than background running
 * out of it: shorter than 5 % of the frame, or shorter than 25 % with the SAME surface on both sides
 * of it (a sleeve cut off by the frame interrupts the sheet; a dresser between wall and floor does
 * not) - unless it has the colour of a stretch that does seed (the sheet showing between a sleeve and
 * the body where both reach the frame). So a garment that touches the frame still counts as enclosed.
 * Returns Uint8Array(n), 1 = seed.
 */
function frameSeeds(F, w, h) {
  const n = w * h, ring = [];
  for (let x = 0; x < w; x++) ring.push(x);
  for (let y = 1; y < h; y++) ring.push(y * w + w - 1);
  for (let x = w - 2; x >= 0; x--) ring.push((h - 1) * w + x);
  for (let y = h - 2; y > 0; y--) ring.push(y * w);
  const m = ring.length, R = 5, cut = new Uint8Array(m), seeds = new Uint8Array(n);
  const at = (i, c) => SEED_WT[c] * F[c][ring[((i % m) + m) % m]];
  const mean = (i0, len, c) => { let s = 0; for (let k = 0; k < len; k++) s += at(i0 + k, c); return s / Math.max(1, len); };
  const col = (i0, len) => [0, 1, 2].map((c) => mean(i0, len, c));
  const far = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]);
  let cuts = 0;
  for (let i = 0; i < m; i++) {
    let d = 0;
    for (let c = 0; c < 3; c++) { const v = mean(i + 1, R, c) - mean(i - R + 1, R, c); d += v * v; }
    if (d > 10 * 10) { cut[i] = 1; cuts++; }
  }
  if (cuts === 0 || cuts === m) { for (const p of ring) seeds[p] = 1; return seeds; }
  let i0 = 0;
  while (!cut[i0]) i0++;
  const runs = [];                       // stretches between cuts: [start, length]
  for (let k = 1, start = i0 + 1, len = 0; k <= m; k++) {
    const i = (i0 + k) % m;
    if (cut[i]) { if (len > 0) runs.push([start, len]); start = i + 1; len = 0; } else len++;
  }
  const big = runs.filter((r) => r[1] >= 2 * R), nb = big.length;
  const drop = runs.map(([st, len], j) => {
    if (len < 0.05 * m) return true;
    if (len >= 0.25 * m || nb < 3) return false;
    const bi = big.indexOf(runs[j]);
    const [ps, pl] = big[(bi - 1 + nb) % nb], [ns] = big[(bi + 1) % nb];
    const before = col(ps + pl - 2 * R, 2 * R), after = col(ns, 2 * R), self = col(st + R, Math.max(1, len - 2 * R));
    return far(before, after) < 10 && far(self, before) > 12 && far(self, after) > 12;
  });
  const bgCols = runs.filter((r, j) => !drop[j]).map(([st, len]) => col(st + Math.min(R, len >> 2), Math.max(1, len - 2 * Math.min(R, len >> 2))));
  let k = 0;
  for (let j = 0; j < runs.length; j++) {
    const [st, len] = runs[j];
    if (drop[j] && (len < 3 || !bgCols.some((c) => far(c, col(st + 1, len - 2)) < 8))) continue;
    for (let t = 0; t < len; t++) { seeds[ring[(st + t) % m]] = 1; k++; }
  }
  if (k < 0.3 * m) for (const p of ring) seeds[p] = 1;    // nothing sensible: the whole frame
  return seeds;
}

/**
 * Automatic seed map: minimum barrier distance from the frame seeds (raster-scan approximation, three
 * forward/backward rounds). The cost of a path is how far its colours spread (max - min, per channel,
 * weighted, summed), so a soft or gradual outline costs as much as a sharp one, and long walks over a
 * slightly uneven sheet cost nothing. Wall, floor, rug and sheet come out low; the garment costs at
 * least its contrast with what surrounds it.
 */
function barrierDistance(F, w, h, seeds) {
  const n = w * h, D = new Float32Array(n).fill(1e9);
  const V = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const U = [new Float32Array(n), new Float32Array(n), new Float32Array(n)], Lo = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let c = 0; c < 3; c++) for (let p = 0; p < n; p++) V[c][p] = U[c][p] = Lo[c][p] = SEED_WT[c] * F[c][p];
  for (let p = 0; p < n; p++) if (seeds[p]) D[p] = 0;
  const [V0, V1, V2] = V, [U0, U1, U2] = U, [L0, L1, L2] = Lo;
  const upd = (p, q) => {
    const u0 = U0[q] > V0[p] ? U0[q] : V0[p], l0 = L0[q] < V0[p] ? L0[q] : V0[p];
    const u1 = U1[q] > V1[p] ? U1[q] : V1[p], l1 = L1[q] < V1[p] ? L1[q] : V1[p];
    const u2 = U2[q] > V2[p] ? U2[q] : V2[p], l2 = L2[q] < V2[p] ? L2[q] : V2[p];
    const s = u0 - l0 + u1 - l1 + u2 - l2;
    if (s < D[p]) { D[p] = s; U0[p] = u0; L0[p] = l0; U1[p] = u1; L1[p] = l1; U2[p] = u2; L2[p] = l2; }
  };
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p++) { if (x > 0) upd(p, p - 1); if (y > 0) upd(p, p - w); }
    for (let y = h - 1, p = n - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--, p--) { if (x < w - 1) upd(p, p + 1); if (y < h - 1) upd(p, p + w); }
  }
  return D;
}

/**
 * Gaussian mixture in 3-D (Lab), packed per component as 10 numbers:
 * [log(weight) - log(norm), mean x, y, z, inverse covariance i00, i01, i02, i11, i12, i22].
 * A component with ln = -Infinity is empty.
 */
function gmmFromStats(K, st, total, minVar) {
  const g = { K, c: new Float64Array(10 * K) };
  for (let k = 0; k < K; k++) {
    const o = k * 10, c = st[o], q = g.c;
    if (c < 4) { q[o] = -Infinity; continue; }
    const mx = st[o + 1] / c, my = st[o + 2] / c, mz = st[o + 3] / c;
    const a = st[o + 4] / c - mx * mx + minVar, b = st[o + 5] / c - mx * my, cc = st[o + 6] / c - mx * mz;
    const d = st[o + 7] / c - my * my + minVar, e = st[o + 8] / c - my * mz, f = st[o + 9] / c - mz * mz + minVar;
    // inverse of the symmetric 3x3 [a b cc; b d e; cc e f]
    const A0 = d * f - e * e, B0 = cc * e - b * f, C0 = b * e - cc * d;
    let det = a * A0 + b * B0 + cc * C0;
    if (!(det > 1e-9)) det = 1e-9;
    const inv = 1 / det;
    q[o] = Math.log(c / total) - 0.5 * Math.log(det) - 2.7568;   // 1.5 * log(2 pi)
    q[o + 1] = mx; q[o + 2] = my; q[o + 3] = mz;
    q[o + 4] = A0 * inv; q[o + 5] = B0 * inv; q[o + 6] = C0 * inv;
    q[o + 7] = (a * f - cc * cc) * inv; q[o + 8] = (b * cc - a * e) * inv; q[o + 9] = (a * d - b * b) * inv;
  }
  return g;
}

/** log(weight * density) of component at offset o, at (x, y, z). */
function gmmTerm(q, o, x, y, z) {
  const dx = x - q[o + 1], dy = y - q[o + 2], dz = z - q[o + 3];
  return q[o] - 0.5 * (q[o + 4] * dx * dx + q[o + 7] * dy * dy + q[o + 9] * dz * dz + 2 * (q[o + 5] * dx * dy + q[o + 6] * dx * dz + q[o + 8] * dy * dz));
}

/** Log-likelihood of one point under the mixture (log-sum-exp over components). */
function gmmLogLik(g, x, y, z) {
  const q = g.c;
  let m = -Infinity, s = 0;
  for (let o = 0, e = 10 * g.K; o < e; o += 10) {
    if (q[o] === -Infinity) continue;
    const v = gmmTerm(q, o, x, y, z);
    if (v > m) { s = s * Math.exp(m - v) + 1; m = v; } else s += Math.exp(v - m);
  }
  return m === -Infinity ? -1e3 : m + Math.log(s);
}

/**
 * Log-likelihood of every pixel p < n (or only where use[p]) under the mixture, into out (Float32Array).
 * One tight loop per component instead of a call per pixel: much faster, and fast from the first call.
 */
function gmmLogLikAll(g, F, n, out, use) {
  const [X, Y, Z] = F, q = g.c, s = new Float32Array(n);
  out.fill(-Infinity);
  for (let o = 0; o < 10 * g.K; o += 10) {
    if (q[o] === -Infinity) continue;
    const ln = q[o], mx = q[o + 1], my = q[o + 2], mz = q[o + 3], a = q[o + 4], b = q[o + 5], c = q[o + 6], d = q[o + 7], e = q[o + 8], f = q[o + 9];
    for (let p = 0; p < n; p++) {
      if (use && !use[p]) continue;
      const dx = X[p] - mx, dy = Y[p] - my, dz = Z[p] - mz;
      const v = ln - 0.5 * (a * dx * dx + d * dy * dy + f * dz * dz + 2 * (b * dx * dy + c * dx * dz + e * dy * dz));
      const m = out[p];
      if (v > m) { s[p] = s[p] * Math.exp(m - v) + 1; out[p] = v; } else s[p] += Math.exp(v - m);
    }
  }
  for (let p = 0; p < n; p++) out[p] = out[p] === -Infinity ? -1e3 : out[p] + Math.log(s[p]);
  return out;
}

/**
 * Fit a K-component mixture to the pixels with lab[p] === cls. Without a previous model: k-means
 * (deterministic farthest-point start on a subsample). With one: GrabCut's hard EM step (each pixel to
 * its most likely component, then re-estimate). step > 1 fits on every step-th pixel only.
 */
function gmmFit(F, n, lab, cls, K, prev, minVar, step = 1) {
  const [X, Y, Z] = F, comp = new Uint8Array(n);
  let total = 0;
  for (let p = 0; p < n; p += step) if (lab[p] === cls) total++;
  const st = new Float64Array(10 * K);
  if (!total) return { K: 0, c: new Float64Array(0) };
  if (prev && prev.K) {
    const q = prev.c, best = new Float32Array(n).fill(-Infinity);
    for (let o = 0; o < 10 * prev.K; o += 10) {
      if (q[o] === -Infinity) continue;
      const k = o / 10, ln = q[o], mx = q[o + 1], my = q[o + 2], mz = q[o + 3], a = q[o + 4], b = q[o + 5], c = q[o + 6], d = q[o + 7], e = q[o + 8], f = q[o + 9];
      for (let p = 0; p < n; p += step) {
        if (lab[p] !== cls) continue;
        const dx = X[p] - mx, dy = Y[p] - my, dz = Z[p] - mz;
        const v = ln - 0.5 * (a * dx * dx + d * dy * dy + f * dz * dz + 2 * (b * dx * dy + c * dx * dz + e * dy * dz));
        if (v > best[p]) { best[p] = v; comp[p] = k; }
      }
    }
  } else {
    const stepS = Math.max(1, Math.floor(total / 3000)), sx = [], sy = [], sz = [];
    for (let p = 0, c = 0; p < n; p += step) if (lab[p] === cls && c++ % stepS === 0) { sx.push(X[p]); sy.push(Y[p]); sz.push(Z[p]); }
    const m = sx.length, cx = [], cy = [], cz = [], dmin = new Float64Array(m).fill(Infinity);
    let pick = 0;
    for (let k = 0; k < K && k < m; k++) {
      cx.push(sx[pick]); cy.push(sy[pick]); cz.push(sz[pick]);
      let far = 0, fv = -1;
      for (let i = 0; i < m; i++) {
        const dx = sx[i] - cx[k], dy = sy[i] - cy[k], dz = sz[i] - cz[k], d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < dmin[i]) dmin[i] = d2;
        if (dmin[i] > fv) { fv = dmin[i]; far = i; }
      }
      pick = far;
    }
    const kk = cx.length;
    for (let it = 0; it < 8; it++) {
      const sxx = new Float64Array(kk), syy = new Float64Array(kk), szz = new Float64Array(kk), cnt = new Float64Array(kk);
      for (let i = 0; i < m; i++) {
        let bk = 0, bd = Infinity;
        for (let k = 0; k < kk; k++) { const dx = sx[i] - cx[k], dy = sy[i] - cy[k], dz = sz[i] - cz[k], d2 = dx * dx + dy * dy + dz * dz; if (d2 < bd) { bd = d2; bk = k; } }
        sxx[bk] += sx[i]; syy[bk] += sy[i]; szz[bk] += sz[i]; cnt[bk]++;
      }
      for (let k = 0; k < kk; k++) if (cnt[k]) { cx[k] = sxx[k] / cnt[k]; cy[k] = syy[k] / cnt[k]; cz[k] = szz[k] / cnt[k]; }
    }
    for (let p = 0; p < n; p += step) {
      if (lab[p] !== cls) continue;
      let bk = 0, bd = Infinity;
      for (let k = 0; k < kk; k++) { const dx = X[p] - cx[k], dy = Y[p] - cy[k], dz = Z[p] - cz[k], d2 = dx * dx + dy * dy + dz * dz; if (d2 < bd) { bd = d2; bk = k; } }
      comp[p] = bk;
    }
  }
  for (let p = 0; p < n; p += step) {
    if (lab[p] !== cls) continue;
    const o = comp[p] * 10, x = X[p], y = Y[p], z = Z[p];
    st[o]++; st[o + 1] += x; st[o + 2] += y; st[o + 3] += z;
    st[o + 4] += x * x; st[o + 5] += x * y; st[o + 6] += x * z; st[o + 7] += y * y; st[o + 8] += y * z; st[o + 9] += z * z;
  }
  return gmmFromStats(K, st, total, minVar);
}

/** Chamfer (3-4) distance in px to the nearest pixel with m[p] = 1, capped at cap. */
function distanceTo(m, w, h, cap) {
  const n = w * h, d = new Float32Array(n);
  for (let p = 0; p < n; p++) d[p] = m[p] ? 0 : cap;
  for (let y = 0; y < h; y++) for (let x = 0, p = y * w; x < w; x++, p++) {
    let v = d[p];
    if (v === 0) continue;
    if (x > 0 && d[p - 1] + 1 < v) v = d[p - 1] + 1;
    if (y > 0) {
      if (d[p - w] + 1 < v) v = d[p - w] + 1;
      if (x > 0 && d[p - w - 1] + 1.4142 < v) v = d[p - w - 1] + 1.4142;
      if (x < w - 1 && d[p - w + 1] + 1.4142 < v) v = d[p - w + 1] + 1.4142;
    }
    d[p] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1, p = y * w + w - 1; x >= 0; x--, p--) {
    let v = d[p];
    if (v === 0) continue;
    if (x < w - 1 && d[p + 1] + 1 < v) v = d[p + 1] + 1;
    if (y < h - 1) {
      if (d[p + w] + 1 < v) v = d[p + w] + 1;
      if (x < w - 1 && d[p + w + 1] + 1.4142 < v) v = d[p + w + 1] + 1.4142;
      if (x > 0 && d[p + w - 1] + 1.4142 < v) v = d[p + w - 1] + 1.4142;
    }
    d[p] = v;
  }
  return d;
}


let BETA_Q = 0.5, BETA_K = 3;

/**
 * Contrast scale of the smoothness term: beta = 1 / (2 * BETA_K * median |dz|^2) over horizontal and
 * vertical neighbours. GrabCut uses the mean; the median keeps a patterned rug or a ribbed knit from
 * making every real outline look weak.
 */
function contrastBeta(F, w, h) {
  const [X, Y, Z] = F, hist = new Float64Array(512);
  let cnt = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (x + 1 < w) { const a = X[p] - X[p + 1], b = Y[p] - Y[p + 1], c = Z[p] - Z[p + 1]; hist[Math.min(511, ((a * a + b * b + c * c) * 4) | 0)]++; cnt++; }
    if (y + 1 < h) { const a = X[p] - X[p + w], b = Y[p] - Y[p + w], c = Z[p] - Z[p + w]; hist[Math.min(511, ((a * a + b * b + c * c) * 4) | 0)]++; cnt++; }
  }
  let acc = 0, b = 0;
  while (b < 511 && acc + hist[b] < cnt * BETA_Q) acc += hist[b++];
  return 1 / (2 * BETA_K * Math.max(0.5, (b + 0.5) / 4));
}

/**
 * Contrast-sensitive smoothness on the 8-connected grid: gamma * exp(-beta |dz|^2) / length (GrabCut).
 * Returns Int32Array(N * 8) of capacities (scaled by SC).
 */
function smoothnessCaps(F, w, h, gamma, SC, beta) {
  const n = w * h, [X, Y, Z] = F, cap = new Int32Array(n * 8);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    for (let d = 0; d < 8; d += 2) {      // 0: right, 2: down, 4: down-right, 6: up-right (+ their opposites)
      const xx = x + GDX[d], yy = y + GDY[d];
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const q = yy * w + xx, a = X[p] - X[q], b = Y[p] - Y[q], c = Z[p] - Z[q];
      const v = Math.round((SC * gamma * Math.exp(-beta * (a * a + b * b + c * c))) / (d >= 4 ? Math.SQRT2 : 1));
      cap[p * 8 + d] = v; cap[q * 8 + (d ^ 1)] = v;
    }
  }
  return cap;
}

/** Bilinear resample of a float map from (w0, h0) to (w1, h1) (pixel centres aligned). */
function resampleMap(src, w0, h0, w1, h1) {
  const out = new Float32Array(w1 * h1), sx = w0 / w1, sy = h0 / h1;
  for (let y = 0; y < h1; y++) {
    const fy = clamp((y + 0.5) * sy - 0.5, 0, h0 - 1), y0 = Math.min(h0 - 1, fy | 0), y1 = Math.min(h0 - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < w1; x++) {
      const fx = clamp((x + 0.5) * sx - 0.5, 0, w0 - 1), x0 = Math.min(w0 - 1, fx | 0), x1 = Math.min(w0 - 1, x0 + 1), wx = fx - x0;
      out[y * w1 + x] = (src[y0 * w0 + x0] * (1 - wx) + src[y0 * w0 + x1] * wx) * (1 - wy) + (src[y1 * w0 + x0] * (1 - wx) + src[y1 * w0 + x1] * wx) * wy;
    }
  }
  return out;
}

/** 8-connected components of m === 1: { label (Int32Array), comps: [{ size, sx, sy, frame }] }. */
function components8(m, w, h) {
  const n = w * h, label = new Int32Array(n), stack = new Int32Array(n), comps = [null];
  for (let s = 0; s < n; s++) {
    if (!m[s] || label[s]) continue;
    const id = comps.length, c = { size: 0, sx: 0, sy: 0, frame: 0 };
    comps.push(c);
    let sp = 0; stack[sp++] = s; label[s] = id;
    while (sp) {
      const p = stack[--sp], x = p % w, y = (p - x) / w;
      c.size++; c.sx += x; c.sy += y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) c.frame++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const q = yy * w + xx;
        if (m[q] && !label[q]) { label[q] = id; stack[sp++] = q; }
      }
    }
  }
  return { label, comps };
}

/**
 * Keep the main piece: the component with the best size x centrality, plus any other component at
 * least a quarter as good (the second shoe of a pair). Then fill holes (4-connected background pockets
 * not reaching the frame) smaller than holeRel x the kept area - a neck label, a zip pull, a shadow in
 * a fold - while big pockets (the opening of a bag handle) stay open.
 */
function keepMainPiece(m, w, h, holeRel) {
  const { label, comps } = components8(m, w, h);
  if (comps.length <= 1) return m;
  const score = comps.map((c) => {
    if (!c) return 0;
    const cx = c.sx / c.size / w - 0.5, cy = c.sy / c.size / h - 0.5;
    return c.size * Math.exp(-(cx * cx + cy * cy) / (2 * 0.3 * 0.3));
  });
  let best = 0;
  for (let i = 1; i < comps.length; i++) if (score[i] > best) best = score[i];
  const keep = score.map((s) => s >= 0.25 * best && s > 0);
  const out = new Uint8Array(w * h);
  let area = 0;
  for (let p = 0; p < w * h; p++) if (label[p] && keep[label[p]]) { out[p] = 1; area++; }
  // holes
  const n = w * h, seen = new Uint8Array(n), stack = new Int32Array(n), maxHole = holeRel * area;
  for (let s = 0; s < n; s++) {
    if (out[s] || seen[s]) continue;
    let sp = 0, cnt = 0, frame = false;
    stack[sp++] = s; seen[s] = 1;
    const list = [];
    while (sp) {
      const p = stack[--sp], x = p % w; cnt++;
      if (cnt <= maxHole + 1) list.push(p);
      if (x === 0 || x === w - 1 || p < w || p >= n - w) frame = true;
      if (x > 0 && !out[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < w - 1 && !out[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (p >= w && !out[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
      if (p + w < n && !out[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
    }
    if (!frame && cnt <= maxHole) for (const p of list) out[p] = 1;
  }
  return out;
}

/**
 * When to use the scene stage: the plain-background model could not clear the whole frame. On one
 * plain background (however uneven the light: vignettes, gradients, wrinkles, wood) segment() + tidy()
 * clear every pixel of the frame; in a room the wall, floor and rug stay, and even a photo filled with a
 * wrinkled sheet leaves a few frame pixels. A garment that runs out of the photo also leaves some -
 * the scene stage handles that too (see frameSeeds).
 */
/** Share of the working grid's outer edge that a mask keeps. */
function frameShare(S, fg) {
  const { W, H } = S;
  let kept = 0;
  for (let x = 0; x < W; x++) kept += fg[x] + fg[(H - 1) * W + x];
  for (let y = 1; y < H - 1; y++) kept += fg[y * W] + fg[y * W + W - 1];
  return kept / (2 * W + 2 * (H - 2));
}
const area = (m) => { let n = 0; for (let i = 0; i < m.length; i++) n += m[i]; return n; };

function sceneGate(S, fg) {
  const { W, H } = S;
  let kept = 0;
  for (let x = 0; x < W; x++) kept += fg[x] + fg[(H - 1) * W + x];
  for (let y = 1; y < H - 1; y++) kept += fg[y * W] + fg[y * W + W - 1];
  return kept >= 3;
}

/**
 * The graph cut. Returns { fg: mask on segment()'s working grid (S.W x S.H, 1 = garment), models: the
 * local colour mixtures (used by sceneFinish) } or null when no plausible garment was found (then the
 * plain-background result stands). P.u (tolerance slider) shifts the garment/background balance by up
 * to +-1.5 nats per pixel: "More" = tighter cut, "Less" = keeps more. dbg (optional, tests only)
 * receives intermediate maps.
 */
function sceneCut(img, S, P, dbg) {
  const { W, H, f } = S, N = W * H;
  const SC = 32, GAMMA = 50, K = 5, MINVAR = 2;
  // Lab of the photo on segment()'s grid, NOT blurred (segment()'s planes are): outlines stay crisp
  const [R0, G0, B0] = toPlanes(img.data, img.width, img.height, f, W, H);
  const Ffull = labPlanes(R0, G0, B0, N);
  const k = Math.max(1, Math.round(Math.max(W, H) / 225));
  const sh = shrinkPlanes(Ffull, W, H, k), w = sh.w, h = sh.h, n = w * h, F = sh.planes;

  // 1) automatic seeds. Small-scale texture (rug pattern, floorboard grain, knit ribs) is wiped first
  //    with a 3x3 opening + closing of the lightness, so a patterned rug reaches the frame as cheaply as a
  //    plain one; outlines of anything bigger than a few px survive.
  const tmpM = new Float32Array(n), Fs = F.map((c, ci) => {
    if (ci > 0) return c;               // chroma untouched: patterns are mostly light/dark, thin straps are not
    const a = new Float32Array(n), b = new Float32Array(n);
    minmax3(c, a, w, h, tmpM, false); minmax3(a, b, w, h, tmpM, true);   // opening
    minmax3(b, a, w, h, tmpM, true); minmax3(a, b, w, h, tmpM, false);   // closing
    return b;
  });
  const dist = barrierDistance(Fs, w, h, frameSeeds(Fs, w, h));
  // scale: the strongest enclosed contrast in the photo, but never so low that sheet wrinkles count
  const inner = new Float32Array((w - 2) * (h - 2));
  for (let y = 1, i = 0; y < h - 1; y++) for (let x = 1; x < w - 1; x++) inner[i++] = dist[y * w + x];
  inner.sort();
  const top = Math.max(15, inner[Math.floor(inner.length * 0.995)]);
  const lo = Math.max(8, 0.25 * top), hi = Math.max(16, 0.6 * top);
  const sal = new Float32Array(n);
  for (let p = 0; p < n; p++) sal[p] = clamp((dist[p] - lo) / (hi - lo), 0, 1);
  if (dbg) { dbg.w = w; dbg.h = h; dbg.sal = sal; dbg.dist = dist; dbg.top = top; dbg.Fs = Fs; }

  // per-pixel cost (nats, + = garment): colour models, seed map (weight 3), frame, slider
  const llF = new Float32Array(n), llB0 = new Float32Array(n);
  const unary = (gF, gB) => {
    const tr = new Int32Array(n), shift = -1.5 * (P.u - 1);
    gmmLogLikAll(gF, F, n, llF); gmmLogLikAll(gB, F, n, llB0);
    for (let p = 0; p < n; p++) {
      const x = p % w, onFrame = x === 0 || x === w - 1 || p < w || p >= n - w;
      const d = clamp(llF[p] - llB0[p], -25, 25) + 3 * (2 * sal[p] - 1) - (onFrame ? 4 : 0) + shift;
      tr[p] = Math.round(d * SC);
    }
    return tr;
  };

  // 2) GrabCut iterations on the coarse grid: global colour models, strong pull of the seed map
  let lab = new Uint8Array(n);
  for (let p = 0; p < n; p++) lab[p] = sal[p] >= 0.75 ? 1 : sal[p] <= 0.35 ? 0 : 2;   // 2: undecided, not used for the first fit
  const capC = smoothnessCaps(F, w, h, GAMMA, SC, contrastBeta(F, w, h));
  let gF = null, gB = null;
  for (let it = 0; it < 5; it++) {
    gF = gmmFit(F, n, lab, 1, K, gF, MINVAR, 2);
    gB = gmmFit(F, n, lab, 0, K, gB, MINVAR, 2);
    if (!gF.K || !gB.K) break;
    const next = gridMinCut(w, h, Int32Array.from(capC), unary(gF, gB));
    let changed = 0;
    for (let p = 0; p < n; p++) changed += next[p] !== lab[p];
    lab = next;
    if (changed < n * 0.001) break;
  }
  if (dbg) dbg.coarse = lab;
  if (!gF || !gF.K || !gB.K) return null;
  const fgC = keepMainPiece(lab, w, h, 0);
  let area = 0;
  for (let p = 0; p < n; p++) area += fgC[p];
  if (area < n * 0.002) return null;

  // 3) refinement at working resolution, local: only a band around the coarse piece can change, the
  //    background model is re-fitted to the band's background (the sheet right round the garment) and
  //    the seed map only breaks ties. This re-opens what the seed map wrongly called enclosed garment:
  //    the opening of a bag handle, the gap between trouser legs, sheet showing under an arm.
  const salF = resampleMap(sal, w, h, W, H);
  let fg = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) fg[y * W + x] = fgC[Math.min(h - 1, (y / k) | 0) * w + Math.min(w - 1, (x / k) | 0)];
  const beta = contrastBeta(Ffull, W, H), R = Math.max(6, Math.round(0.04 * Math.max(W, H)));
  const shift = -1.5 * (P.u - 1);
  let models = { fF: gF, fB: gB };
  for (let round = 0; round < 2; round++) {
    // work on the bounding box of the band only (outside it everything stays background)
    const dd = distanceTo(fg, W, H, R + 1);
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0, p = 0; y < H; y++) for (let x = 0; x < W; x++, p++) if (dd[p] <= R) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) break;
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1, cn = cw * ch;
    const crop = (a) => { const o = new a.constructor(cn); for (let y = 0; y < ch; y++) o.set(a.subarray((y0 + y) * W + x0, (y0 + y) * W + x0 + cw), y * cw); return o; };
    const Fc = Ffull.map(crop), salC = crop(salF), ddC = crop(dd), fgC2 = crop(fg), lab3 = new Uint8Array(cn);
    for (let p = 0; p < cn; p++) lab3[p] = fgC2[p] ? 1 : ddC[p] <= R ? 0 : 2;
    const fB = gmmFit(Fc, cn, lab3, 0, K, null, MINVAR, 2);
    if (!fB.K) break;
    // the garment model learns only from what the local background does NOT explain well: sheet seen
    // through a handle or between legs must not teach the garment model the sheet's colour
    const inBand = new Uint8Array(cn);
    let nRing = 0;
    for (let p = 0; p < cn; p++) { inBand[p] = lab3[p] < 2 ? 1 : 0; if (lab3[p] === 0) nRing++; }
    const llB = gmmLogLikAll(fB, Fc, cn, new Float32Array(cn), inBand), ringLL = new Float32Array(nRing);
    for (let p = 0, i = 0; p < cn; p++) if (lab3[p] === 0) ringLL[i++] = llB[p];
    ringLL.sort();
    const typical = ringLL[Math.floor(nRing * 0.25)];
    for (let p = 0; p < cn; p++) if (lab3[p] === 1 && llB[p] >= typical) lab3[p] = 2;
    const fF = gmmFit(Fc, cn, lab3, 1, K, null, MINVAR, 2);
    if (!fF.K) break;
    models = { fF, fB };
    const tr = new Int32Array(cn), llFc = gmmLogLikAll(fF, Fc, cn, new Float32Array(cn), inBand);
    for (let y = 0, p = 0; y < ch; y++) for (let x = 0; x < cw; x++, p++) {
      if (!inBand[p]) { tr[p] = -1000 * SC; continue; }
      const gx = x0 + x, gy = y0 + y, onFrame = gx === 0 || gy === 0 || gx === W - 1 || gy === H - 1;
      const d = clamp(llFc[p] - llB[p], -25, 25) + (2 * salC[p] - 1) - (onFrame ? 4 : 0) + shift;
      tr[p] = Math.round(d * SC);
    }
    const cut = gridMinCut(cw, ch, smoothnessCaps(Fc, cw, ch, GAMMA, SC, beta), tr);
    fg = new Uint8Array(N);
    for (let y = 0; y < ch; y++) fg.set(cut.subarray(y * cw, y * cw + cw), (y0 + y) * W + x0);
  }
  if (dbg) dbg.full = Uint8Array.from(fg);
  fg = keepMainPiece(fg, W, H, 0.03);
  return { fg, models };
}

/**
 * Full-resolution clean-up after finish():
 *  1. smooth the outline (blur + threshold). The threshold sits a little above one half, which pulls
 *     the outline about one pixel inwards: the outermost pixels of a garment on a sheet are half sheet,
 *     and renderSticker() also blends the photo just outside the mask into the edge - on the dark
 *     sticker that showed as a thin light line.
 *  2. trim: sheet left in the narrow end of a gap (between an arm and the body, between trouser legs),
 *     where the working-resolution cut could not afford two outlines so close together and finish()
 *     had no background close enough to compare with. From the outline inwards (at most TRIM_DEPTH px),
 *     a pixel goes when the local colour models (from sceneCut) call it background.
 *  3. keep the main piece, fill small holes.
 */
let EDGE_T = 0.7, TRIM_T = 1, TRIM_DEPTH = 10;


function sceneFinish(img, mask, scene) {
  const { data, width: w, height: h } = img, n = w * h;
  // 1) smooth
  const a = new Float32Array(n), tmp = new Float32Array(n);
  for (let p = 0; p < n; p++) a[p] = mask[p];
  boxBlur(a, w, h, 2, tmp); boxBlur(a, w, h, 2, tmp);
  const out = new Uint8Array(n);
  for (let p = 0; p < n; p++) out[p] = a[p] >= EDGE_T ? 1 : 0;
  // 2) trim (after smoothing, which would otherwise close a 2-px sliver again)
  const { fF, fB } = scene.models;
  if (fF && fB && fF.K && fB.K && TRIM_DEPTH > 0) {
    const seen = new Uint8Array(n), depth = new Uint8Array(n), queue = new Int32Array(n), lab = [0, 0, 0];
    let qh = 0, qt = 0;
    for (let p = 0; p < n; p++) {
      if (!out[p]) continue;
      const x = p % w;
      if ((x > 0 && !out[p - 1]) || (x < w - 1 && !out[p + 1]) || (p >= w && !out[p - w]) || (p + w < n && !out[p + w])) { seen[p] = 1; depth[p] = 1; queue[qt++] = p; }
    }
    while (qh < qt) {
      const p = queue[qh++], x = p % w, i = 4 * p;
      labOf(data[i], data[i + 1], data[i + 2], lab);    // the pixel itself: a sliver can be 2 px wide
      if (gmmLogLik(fF, lab[0], lab[1], lab[2]) - gmmLogLik(fB, lab[0], lab[1], lab[2]) > -TRIM_T) continue;
      out[p] = 0;
      if (depth[p] >= TRIM_DEPTH) continue;
      for (let k = 0; k < 4; k++) {
        const q = k === 0 ? p - 1 : k === 1 ? p + 1 : k === 2 ? p - w : p + w;
        if (k === 0 ? x === 0 : k === 1 ? x === w - 1 : (q < 0 || q >= n)) continue;
        if (out[q] && !seen[q]) { seen[q] = 1; depth[q] = depth[p] + 1; queue[qt++] = q; }
      }
    }
  }
  // 3) main piece, small holes
  return keepMainPiece(out, w, h, 0.03);
}

/**
 * Compute a foreground mask (Uint8Array, 1 = garment, 0 = background).
 * tolerance: 6..110, the "gentle <-> strong" slider. seeds: extra [x,y] (normalised 0..1) points
 * the user tapped to erase.
 */
export function computeMask(img, tolerance = DEFAULT_TOLERANCE, seeds = []) {
  const { data, width: w, height: h } = img;
  const n = w * h;
  const P = cutParams(tolerance);
  const S = segment(img, P);
  let fg = tidy(S, P);
  if (P.u > 0.15) {
    fg = prune(img, S, fg, P);
    dropSmall(fg, S.W, S.H, 1, Math.max(4, Math.round(S.W * S.H * 0.00008)), 0.04);
  }
  // A garment on a sheet in a room (wall, floor, rug around the sheet) rather than on one plain background.
  // The cut so far leaves part of the photo's edge kept; a piece that merely runs off the edge of a plain
  // photo does that too, so it counts as a room only when a backdrop with other things beyond it is found,
  // or when much of the edge is kept. Then the graph cut (sceneCut) decides; the backdrop-first cut checks
  // it, and is used instead when the graph cut lost a large part of the piece (one touching the frame).
  let mask = null;
  if (sceneGate(S, fg)) {
    const BD = backdropFirst(img);
    if (BD || frameShare(S, fg) > 0.25) {
      const scene = sceneCut(img, S, P);
      if (scene) mask = sceneFinish(img, finish(img, S, scene.fg, P), scene);
      if (BD) {
        const S2 = segment(BD.img, P);
        let fg2 = tidy(S2, P);
        if (P.u > 0.15) {
          fg2 = prune(BD.img, S2, fg2, P);
          dropSmall(fg2, S2.W, S2.H, 1, Math.max(4, Math.round(S2.W * S2.H * 0.00008)), 0.04);
        }
        const other = finish(BD.img, S2, fg2, P);
        backdropFinish(other, BD, P);
        if (!mask || area(mask) < 0.8 * area(other)) mask = other;
      }
    }
  }
  if (!mask) mask = finish(img, S, fg, P);

  // user-tapped erase seeds (e.g. the hole in a bag handle, a leftover patch): remove the connected
  // region whose colour is like the tapped pixel, following soft gradients along the way
  if (seeds && seeds.length) {
    const queue = new Int32Array(n), gone = new Uint8Array(n), tol = P.seedTol;
    for (const [sx, sy] of seeds) {
      const x0 = Math.min(w - 1, Math.max(0, Math.round(sx * w)));
      const y0 = Math.min(h - 1, Math.max(0, Math.round(sy * h)));
      const s = y0 * w + x0, r = data[s * 4], g = data[s * 4 + 1], b = data[s * 4 + 2];
      let qh = 0, qt = 0;
      if (!gone[s]) { gone[s] = 1; queue[qt++] = s; }
      while (qh < qt) {
        const p = queue[qh++], x = p % w, pi = p * 4;
        for (let k = 0; k < 4; k++) {
          const q = k === 0 ? p - 1 : k === 1 ? p + 1 : k === 2 ? p - w : p + w;
          if (k === 0 ? x === 0 : k === 1 ? x === w - 1 : (q < 0 || q >= n)) continue;
          if (gone[q]) continue;
          const dGlobal = dist(data, q * 4, r, g, b);
          if (dGlobal < tol || (dGlobal < tol * 1.6 && dist(data, q * 4, data[pi], data[pi + 1], data[pi + 2]) < tol * 0.18)) { gone[q] = 1; queue[qt++] = q; }
        }
      }
    }
    for (let p = 0; p < n; p++) if (gone[p]) mask[p] = 0;
    dropSmall(mask, w, h, 1, 0, 0.04);
  }
  return mask;
}

/** Euclidean-ish distance (chamfer 3-4) from the mask, in px. */
function distanceOutside(mask, w, h) {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let p = 0; p < d.length; p++) d[p] = mask[p] ? 0 : INF;
  const a = 1, b = Math.SQRT2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x; let v = d[p];
    if (x > 0) v = Math.min(v, d[p - 1] + a);
    if (y > 0) {
      v = Math.min(v, d[p - w] + a);
      if (x > 0) v = Math.min(v, d[p - w - 1] + b);
      if (x < w - 1) v = Math.min(v, d[p - w + 1] + b);
    }
    d[p] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const p = y * w + x; let v = d[p];
    if (x < w - 1) v = Math.min(v, d[p + 1] + a);
    if (y < h - 1) {
      v = Math.min(v, d[p + w] + a);
      if (x < w - 1) v = Math.min(v, d[p + w + 1] + b);
      if (x > 0) v = Math.min(v, d[p + w - 1] + b);
    }
    d[p] = v;
  }
  return d;
}

/** Edge colour of the sticker variant shown on dark backgrounds (the default edge is white). */
export const EDGE_DARK = [78, 72, 65];

/**
 * Render the sticker: item cut out, smooth border, soft shadow.
 * Returns { dataURL, darkURL, colors, width, height }: `dataURL` has the white border, `darkURL` the same
 * sticker with the soft dark border used on dark backgrounds (null when `dark` is false).
 */
export function renderSticker(img, mask, { border = 0.022, removeBg = true, dark = true } = {}) {
  const { data, width: w, height: h } = img;
  if (!removeBg) mask = new Uint8Array(w * h).fill(1);

  // bounding box
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; mask = new Uint8Array(w * h).fill(1); }

  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const r = Math.max(5, Math.round(Math.max(bw, bh) * border)); // border radius in px
  const pad = r + 14;
  const W = bw + pad * 2, H = bh + pad * 2;

  // local mask in padded space
  const m = new Uint8Array(W * H);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) m[(y + pad) * W + x + pad] = mask[(y + y0) * w + x + x0];

  // smooth the item edge with a tiny blur of the mask (anti-aliasing)
  const soft = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const p = y * W + x;
    soft[p] = (m[p] * 4 + m[p - 1] + m[p + 1] + m[p - W] + m[p + W]) / 8;
  }

  const dOut = distanceOutside(m, W, H);

  // item layer
  const itemC = document.createElement('canvas'); itemC.width = W; itemC.height = H;
  const ictx = itemC.getContext('2d');
  const itemData = ictx.createImageData(W, H);
  const id = itemData.data;
  // outline layer
  const lineC = document.createElement('canvas'); lineC.width = W; lineC.height = H;
  const lctx = lineC.getContext('2d');
  const lineData = lctx.createImageData(W, H);
  const ld = lineData.data;

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x, o = p * 4;
    const sx = x - pad + x0, sy = y - pad + y0;
    if (sx >= 0 && sy >= 0 && sx < w && sy < h && soft[p] > 0) {
      const si = (sy * w + sx) * 4;
      id[o] = data[si]; id[o + 1] = data[si + 1]; id[o + 2] = data[si + 2];
      id[o + 3] = Math.round(255 * Math.min(1, soft[p] * 1.15));
    }
    // smooth antialiased border edge
    const t = Math.max(0, Math.min(1, r + 0.5 - dOut[p]));
    if (t > 0) { ld[o] = 255; ld[o + 1] = 255; ld[o + 2] = 255; ld[o + 3] = Math.round(255 * t); }
  }
  ictx.putImageData(itemData, 0, 0);

  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const octx = out.getContext('2d');
  // shadow, border in the given colour, then the item on top
  const compose = ([er, eg, eb]) => {
    for (let o = 0; o < ld.length; o += 4) if (ld[o + 3]) { ld[o] = er; ld[o + 1] = eg; ld[o + 2] = eb; }
    lctx.putImageData(lineData, 0, 0);
    octx.clearRect(0, 0, W, H);
    octx.save();
    octx.shadowColor = 'rgba(60, 50, 40, 0.18)';
    octx.shadowBlur = 10;
    octx.shadowOffsetY = 3;
    octx.drawImage(lineC, 0, 0);
    octx.restore();
    octx.drawImage(lineC, 0, 0);
    octx.drawImage(itemC, 0, 0);
    return out.toDataURL('image/png');
  };
  const darkURL = dark ? compose(EDGE_DARK) : null;

  return {
    dataURL: compose([255, 255, 255]),
    darkURL,
    colors: dominantColors(img, mask),
    width: W, height: H,
  };
}

/** Quick preview with background tinted, for the tolerance UI. */
export function renderMaskPreview(img, mask) {
  const { data, width: w, height: h } = img;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const out = ctx.createImageData(w, h);
  const d = out.data;
  for (let p = 0; p < w * h; p++) {
    const o = p * 4;
    if (mask[p]) { d[o] = data[o]; d[o + 1] = data[o + 1]; d[o + 2] = data[o + 2]; d[o + 3] = 255; }
    else { d[o] = 0; d[o + 1] = 0; d[o + 2] = 0; d[o + 3] = 0; }
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

/** Most common colors of the foreground (quantized). Returns hex strings. */
export function dominantColors(img, mask, k = 3) {
  const { data, width: w, height: h } = img;
  const bins = new Map();
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 20000)));
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const p = y * w + x;
    if (!mask[p]) continue;
    const o = p * 4;
    const key = ((data[o] >> 4) << 8) | ((data[o + 1] >> 4) << 4) | (data[o + 2] >> 4);
    const b = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += data[o]; b.g += data[o + 1]; b.b += data[o + 2];
    bins.set(key, b);
  }
  const sorted = [...bins.values()].sort((a, b) => b.n - a.n);
  const picked = [];
  const top = sorted[0]?.n || 0;
  for (const b of sorted) {
    if (b.n < top * 0.12) break;
    const c = [b.r / b.n, b.g / b.n, b.b / b.n];
    if (picked.every((q) => Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) > 48)) picked.push(c);
    if (picked.length >= k) break;
  }
  return picked.map(([r, g, b]) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''));
}
// ---- category guess from the silhouette (used to pre-select a chip; null when unsure) ----

/**
 * Guess the app category of a cut-out from its mask alone: 'top', 'bottom', 'shoes', 'acc', or null when
 * the shape does not say so clearly. Garments are assumed roughly upright (tilts up to ~20 degrees are
 * straightened first). Cheap: works on a coarse grid, a few milliseconds.
 */
export function guessCategory(mask, w, h) {
  if (!mask || !w || !h) return null;
  const f = guessFeatures(mask, w, h);
  return f ? guessFromFeatures(f) : null;
}

/** Solidity (cells / convex hull area) and fill of the box along the main axis, for one component on the coarse grid. */
function pieceShape(st, n, gw, gh, ang) {
  const lo = new Int32Array(gh).fill(1 << 30), hi = new Int32Array(gh).fill(-1);
  const ca = Math.cos(ang), sa = Math.sin(ang);
  let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9, y0 = gh, y1 = -1;
  for (let i = 0; i < n; i++) {
    const p = st[i], x = p % gw, y = (p / gw) | 0;
    if (x < lo[y]) lo[y] = x; if (x > hi[y]) hi[y] = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    const u = ca * x + sa * y, v = -sa * x + ca * y;
    if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
  }
  // convex hull (monotone chain) of the cell corners at each row's two ends
  const pts = [];
  for (let y = y0; y <= y1; y++) if (hi[y] >= 0) pts.push([lo[y], y], [lo[y], y + 1], [hi[y] + 1, y], [hi[y] + 1, y + 1]);
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lw = [], up = [];
  for (const q of pts) { while (lw.length >= 2 && cross(lw[lw.length - 2], lw[lw.length - 1], q) <= 0) lw.pop(); lw.push(q); }
  for (let k = pts.length - 1; k >= 0; k--) { const q = pts[k]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  const hull = lw.slice(0, -1).concat(up.slice(0, -1));
  let area = 0;
  for (let i = 0; i < hull.length; i++) { const a = hull[i], b = hull[(i + 1) % hull.length]; area += a[0] * b[1] - b[0] * a[1]; }
  return { solid: n / Math.max(1, Math.abs(area) / 2), boxFill: n / Math.max(1, (u1 - u0 + 1) * (v1 - v0 + 1)) };
}

function guessFeatures(mask, w, h) {
  // 1) coarse occupancy grid (a cell counts when a quarter of it is garment)
  const s = Math.max(1, Math.round(Math.max(w, h) / 200));
  const gw = Math.ceil(w / s), gh = Math.ceil(h / s), gn = gw * gh;
  const cnt = new Uint16Array(gn);
  for (let y = 0; y < h; y++) { const gy = ((y / s) | 0) * gw, o = y * w; for (let x = 0; x < w; x++) if (mask[o + x]) cnt[gy + ((x / s) | 0)]++; }
  const g = new Uint8Array(gn), need = Math.max(1, (s * s) >> 2);
  let area = 0;
  for (let i = 0; i < gn; i++) if (cnt[i] >= need) { g[i] = 1; area++; }
  if (area < Math.max(30, gn * 0.004)) return null;

  // 2) components (8-connected); small specks are ignored
  const lab = new Int32Array(gn), st = new Int32Array(gn), comps = [];
  for (let s0 = 0; s0 < gn; s0++) {
    if (!g[s0] || lab[s0]) continue;
    const id = comps.length + 1; let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    lab[s0] = id; st[n++] = s0;
    for (let i = 0; i < n; i++) {
      const p = st[i], x = p % gw, y = (p / gw) | 0;
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
        const q = yy * gw + xx; if (g[q] && !lab[q]) { lab[q] = id; st[n++] = q; }
      }
    }
    const mx = sx / n, my = sy / n, cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my;
    const tr = cxx + cyy, det = cxx * cyy - cxy * cxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    comps.push({ n, mx, my, elong: Math.sqrt((tr / 2 + disc) / Math.max(1e-6, tr / 2 - disc)), ang, ...pieceShape(st, n, gw, gh, ang) });
  }
  comps.sort((a, b) => b.n - a.n);
  const big = comps.filter((c) => c.n >= 0.1 * area);
  let mainArea = 0; for (const c of big) mainArea += c.n;

  // 3) straighten: the tilt (within +-20 deg) about which the shape is most mirror-symmetric
  let cx = 0, cy = 0, n0 = 0;
  for (let i = 0; i < gn; i++) if (g[i]) { cx += i % gw; cy += (i / gw) | 0; n0++; }
  cx /= n0; cy /= n0;
  let R = 1;
  for (let i = 0; i < gn; i++) if (g[i]) { const d = Math.hypot(i % gw - cx, ((i / gw) | 0) - cy); if (d > R) R = d; }
  const B = 2, nb = Math.ceil((2 * R + 4) / B), bins = new Uint8Array(nb * nb), half = nb / 2;
  const pts = [];
  const step = Math.max(1, Math.floor(n0 / 6000));
  for (let i = 0, k = 0; i < gn; i++) if (g[i] && (k++ % step) === 0) pts.push(i % gw - cx, ((i / gw) | 0) - cy);
  let bestA = 0, bestS = -1;
  for (let a = -20; a <= 20; a += 2.5) {
    const c = Math.cos(a * Math.PI / 180), sn = Math.sin(a * Math.PI / 180);
    bins.fill(0);
    let mu = 0;
    for (let i = 0; i < pts.length; i += 2) mu += c * pts[i] + sn * pts[i + 1];
    mu /= pts.length / 2;
    for (let i = 0; i < pts.length; i += 2) {
      const u = c * pts[i] + sn * pts[i + 1] - mu, v = -sn * pts[i] + c * pts[i + 1];
      const bu = Math.floor(u / B + half), bv = Math.floor(v / B + half);
      if (bu >= 0 && bv >= 0 && bu < nb && bv < nb) bins[bv * nb + bu] = 1;
    }
    let tot = 0, hit = 0;
    for (let bv = 0; bv < nb; bv++) for (let bu = 0; bu < nb; bu++) {
      if (!bins[bv * nb + bu]) continue;
      tot++;
      const mu2 = nb - 1 - bu;
      if (bins[bv * nb + mu2] || (mu2 > 0 && bins[bv * nb + mu2 - 1]) || (mu2 < nb - 1 && bins[bv * nb + mu2 + 1])) hit++;
    }
    const sc = hit / Math.max(1, tot) - Math.abs(a) * 0.0005;   // prefer upright on ties
    if (sc > bestS) { bestS = sc; bestA = a; }
  }
  let ang = bestA;
  if (bestS < 0.85) {
    // not clearly symmetric (a shoe or a cap from the side): take the tilt with the tightest bounding box,
    // which lines up a flat sole or hem
    let bestArea = 1e18;
    for (let a = -20; a <= 20; a += 2.5) {
      const c = Math.cos(a * Math.PI / 180), sn = Math.sin(a * Math.PI / 180);
      let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
      for (let i = 0; i < pts.length; i += 2) {
        const u = c * pts[i] + sn * pts[i + 1], v = -sn * pts[i] + c * pts[i + 1];
        if (u < a0) a0 = u; if (u > a1) a1 = u; if (v < b0) b0 = v; if (v > b1) b1 = v;
      }
      const ar = (a1 - a0) * (b1 - b0) * (1 + Math.abs(a) * 0.001);
      if (ar < bestArea) { bestArea = ar; ang = a; }
    }
  }
  // 4) straightened raster, 48 x 48 over the straightened bounding box
  const ca = Math.cos(ang * Math.PI / 180), sa = Math.sin(ang * Math.PI / 180);
  let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
  for (let i = 0; i < gn; i++) if (g[i]) {
    const x = i % gw - cx, y = ((i / gw) | 0) - cy, u = ca * x + sa * y, v = -sa * x + ca * y;
    if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
  }
  const bw = u1 - u0 + 1, bh = v1 - v0 + 1, N = 48, rs = new Uint8Array(N * N);
  let filled = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = u0 + (i + 0.5) * bw / N - 0.5, v = v0 + (j + 0.5) * bh / N - 0.5;
    const x = Math.round(ca * u - sa * v + cx), y = Math.round(sa * u + ca * v + cy);
    if (x >= 0 && y >= 0 && x < gw && y < gh && g[y * gw + x]) { rs[j * N + i] = 1; filled++; }
  }
  // rows: runs of at least 2 bins, extents
  const runs = [], ext = new Float32Array(N), lefts = new Float32Array(N), rights = new Float32Array(N), rowFill = new Float32Array(N);
  for (let j = 0; j < N; j++) {
    const r = []; let i = 0;
    while (i < N) { if (!rs[j * N + i]) { i++; continue; } let e = i; while (e < N && rs[j * N + e]) e++; if (e - i >= 2) r.push([i, e]); i = e; }
    runs.push(r);
    let l = -1, rr = -1;
    for (let k = 0; k < N; k++) if (rs[j * N + k]) { if (l < 0) l = k; rr = k; rowFill[j]++; }
    rowFill[j] /= N;
    ext[j] = l < 0 ? 0 : (rr - l + 1) / N; lefts[j] = l; rights[j] = rr;
  }
  // column heights (top-most to bottom-most bin), for side views
  const colTop = new Float32Array(N);
  for (let i = 0; i < N; i++) { let t = -1; for (let j = 0; j < N; j++) if (rs[j * N + i]) { t = j; break; } colTop[i] = t < 0 ? N : t; }
  // holes (a bag handle, a necklace): background cells the outside cannot reach, on the coarse grid
  // thickened by one cell so a thin strap still closes its loop
  const gd = new Uint8Array(gn);
  let gx0 = gw, gx1 = -1, gy0 = gh, gy1 = -1;
  for (let i = 0; i < gn; i++) if (g[i]) {
    const x = i % gw, y = (i / gw) | 0;
    if (x < gx0) gx0 = x; if (x > gx1) gx1 = x; if (y < gy0) gy0 = y; if (y > gy1) gy1 = y;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < gw && yy < gh) gd[yy * gw + xx] = 1; }
  }
  const seen = new Uint8Array(gn); let qn = 0;
  for (let x = 0; x < gw; x++) for (const p of [x, (gh - 1) * gw + x]) if (!gd[p] && !seen[p]) { seen[p] = 1; st[qn++] = p; }
  for (let y = 0; y < gh; y++) for (const p of [y * gw, y * gw + gw - 1]) if (!gd[p] && !seen[p]) { seen[p] = 1; st[qn++] = p; }
  while (qn) {
    const p = st[--qn], x = p % gw;
    if (x > 0 && !gd[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; st[qn++] = p - 1; }
    if (x < gw - 1 && !gd[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; st[qn++] = p + 1; }
    if (p >= gw && !gd[p - gw] && !seen[p - gw]) { seen[p - gw] = 1; st[qn++] = p - gw; }
    if (p + gw < gn && !gd[p + gw] && !seen[p + gw]) { seen[p + gw] = 1; st[qn++] = p + gw; }
  }
  let holes = 0, holeY = 0, nHoles = 0;
  for (let i = 0; i < gn; i++) if (!gd[i] && !seen[i]) { holes++; holeY += (i / gw) | 0; }
  for (let i = 0; i < gn; i++) if (!gd[i] && !seen[i]) {
    // count separate holes that are not tiny
    let k = 0; seen[i] = 2; st[k++] = i;
    for (let a = 0; a < k; a++) { const p = st[a], x = p % gw; for (const q of [x > 0 ? p - 1 : -1, x < gw - 1 ? p + 1 : -1, p - gw, p + gw]) if (q >= 0 && q < gn && !gd[q] && !seen[q]) { seen[q] = 2; st[k++] = q; } }
    if (k >= 6) nHoles++;
  }
  const bbA = Math.max(1, (gx1 - gx0 + 1) * (gy1 - gy0 + 1));
  holeY = holes ? (holeY / holes - gy0) / Math.max(1, gy1 - gy0) : 0;
  holes /= bbA;
  return {
    asp: bh / bw, fill: filled / (N * N), sym: bestS, ang, comps: big, mainShare: mainArea / area, area,
    runs, ext, rowFill, lefts, rights, colTop, holes, holeY, nHoles, N,
  };
}

function guessFromFeatures(F) {
  const { asp, fill, sym, comps, runs, ext, rowFill, colTop, holes, holeY, nHoles, N } = F;
  const band = (a, b) => { const r = []; for (let j = Math.floor(a * N); j < Math.ceil(b * N); j++) r.push(j); return r; };
  const share = (rows, fn) => rows.filter(fn).length / Math.max(1, rows.length);
  const mean = (rows, arr) => rows.reduce((s, j) => s + arr[j], 0) / Math.max(1, rows.length);
  const maxExt = (rows) => rows.reduce((s, j) => Math.max(s, ext[j]), 0);
  // two runs of real width with a gap between them, the gap near the middle
  const twoLegs = (j) => {
    const r = runs[j]; if (r.length !== 2) return false;
    const [a, b] = r, gap0 = a[1], gap1 = b[0], mid = (gap0 + gap1) / 2;
    return a[1] - a[0] >= 0.1 * N && b[1] - b[0] >= 0.1 * N && gap1 - gap0 >= 0.03 * N && Math.abs(mid - N / 2) <= 0.18 * N;
  };
  const nRuns = (k) => (j) => runs[j].length === k;

  // two separate, similar pieces side by side: a pair of shoes (each long), or glasses / earrings (each round)
  if (comps.length === 2 && F.mainShare > 0.85) {
    const [a, b] = comps;
    const side = Math.abs(a.mx - b.mx) >= 0.8 * Math.abs(a.my - b.my);
    if (b.n >= 0.45 * a.n && side) {
      // a shoe seen from above is a rounded oblong: 1.7-3.4 times as long as wide, nearly convex, filling about
      // three quarters of its box (gloves and earrings are not convex, hair clips and socks are longer or boxier)
      const shoe = (c) => c.elong >= 1.7 && c.elong <= 3.4 && c.solid >= 0.9 && c.boxFill >= 0.66 && c.boxFill <= 0.86;
      if (shoe(a) && shoe(b)) return 'shoes';
      if (a.elong < 1.45 && b.elong < 1.45 && asp < 0.75) return 'acc';
    }
    return null;
  }
  if (comps.length > 2) return null;

  // very long and narrow: scarf, tie, watch strap / belt, glasses with folded arms
  // (a pair of jeans folded lengthwise is about 3 times as tall as wide; a hanging scarf or tie 4 times or more)
  if (asp >= 3.8 || asp <= 0.3) return 'acc';
  if (asp >= 2.6) return null;
  // otherwise a filled box (a folded garment, a clutch) says nothing
  if (fill > 0.9) return null;
  // a loop with little inside: necklace, a bag on a long strap
  if (holes >= 0.15 && fill < 0.5) return 'acc';
  // a hole in the upper part above a solid body: a bag with its handle
  // (two small loops side by side are more likely the straps of a top)
  if (((nHoles === 1 && holes >= 0.02) || holes >= 0.06) && holeY < 0.5 && mean(band(0.6, 0.95), ext) > 0.6) return 'acc';

  const all = band(0.03, 0.95), top = band(0.03, 0.25), low = band(0.62, 0.95), mid = band(0.3, 0.7);
  // two lobes along most of the height: a pair of shoes touching, or glasses
  const twoAll = share(all, nRuns(2));
  if (twoAll >= 0.7) return asp >= 0.6 ? 'shoes' : asp <= 0.5 ? 'acc' : null;
  // glasses with the arms open: two lenses side by side low down, little else
  if (share(band(0.55, 0.95), nRuns(2)) >= 0.6 && asp < 0.8 && fill < 0.55) return 'acc';
  // legs: trousers, shorts, leggings
  if (share(low, twoLegs) >= 0.55 && share(top, nRuns(1)) >= 0.7 && asp >= 0.7) return 'bottom';

  // tops: sleeves hang down beside the body, or stick out at the shoulders
  const sleeves = (j) => {
    const r = runs[j]; if (r.length < 3 || r.length > 4) return false;
    for (let k = 0; k < r.length; k++) { if (r[k][1] - r[k][0] < 0.05 * N) return false; if (k && r[k][0] - r[k - 1][1] < 0.03 * N) return false; }
    return true;
  };
  if (share(mid, sleeves) >= 0.3 && asp >= 0.7) return 'top';
  const body = mean(band(0.6, 0.92), ext), shoulders = maxExt(band(0.05, 0.45));
  if (shoulders >= 1.3 * body && asp >= 0.6 && asp <= 1.6 && sym >= 0.9 && fill >= 0.4 && maxExt(band(0.5, 1)) < 0.95) return 'top';
  // straps at the top (tank) over a solid body: one at each side (a bag's handle is two runs close together)
  const sideStraps = (j) => { const r = runs[j]; return r.length === 2 && r[0][0] <= 0.35 * N && r[1][1] >= 0.65 * N && r[1][0] - r[0][1] >= 0.1 * N; };
  if (share(band(0.0, 0.15), sideStraps) >= 0.5 && mean(low, ext) >= 0.8 && asp >= 1.1 && holes < 0.005) return 'top';
  // little at the top (thin straps) over a tall solid body: cami, slip dress
  const bodyRows = all.filter((j) => rowFill[j] >= 0.6);
  let offC = 0, offN = 0;
  for (const j of band(0.02, 0.2)) for (const [a, b] of runs[j].length ? runs[j] : []) for (let i = a; i < b; i++) { offC += Math.abs(i + 0.5 - N / 2); offN++; }
  const strapsAtSides = offN > 0 && offC / offN >= 0.2 * N;
  if (mean(band(0.02, 0.2), rowFill) < 0.2 && strapsAtSides && bodyRows.length >= 0.5 * N && asp >= 1.2) {
    const bw = mean(bodyRows, ext), tall = (bodyRows.length / N) * asp / Math.max(0.2, bw);
    if (tall >= 1.0) return 'top';
  }
  // widening downward: dress (tall) or skirt (squat)
  const tExt = mean(band(0.03, 0.2), ext), bExt = mean(band(0.8, 0.95), ext);
  const mExt = mean(band(0.4, 0.6), ext);   // ...and it widens gradually (not a box with a handle on top)
  if (bExt >= 1.4 * tExt && bExt >= 0.85 && mExt <= 0.92 * bExt && sym >= 0.8 && share(all, (j) => runs[j].length <= 1) >= 0.85) {
    if (asp >= 1.15 && tExt <= 0.5) return 'top';
    // a skirt has a straight waistband (a beanie or a hat has a rounded crown)
    const j0 = Math.round(0.03 * N), j1 = Math.round(0.2 * N);
    if (asp <= 1.1 && asp >= 0.7 && tExt >= 0.45 && ext[j0] >= 0.8 * ext[j1]) return 'bottom';
  }
  let pa = 0; for (let i = 0; i < N; i++) pa += Math.abs(colTop[i] - colTop[N - 1 - i]); pa /= N * N;
  // hat: a dome on a wide brim, widest at the bottom
  if (pa < 0.06 && asp <= 0.85 && asp >= 0.35 && sym >= 0.82 && tExt <= 0.6 && maxExt(band(0.6, 1)) >= 0.95 && bExt >= 1.5 * tExt) return 'acc';
  // seen from the side (the top outline is lopsided): a shoe ramps down from the ankle to the toe over a flat
  // sole; a cap drops from its crown to a long flat visor
  if (asp <= 0.85 && asp >= 0.3 && pa >= 0.08 && mean(band(0.85, 0.95), ext) >= 0.75) {
    const k = Math.round(0.3 * N);
    let l = 0, r = 0; for (let i = 0; i < k; i++) { l += colTop[i]; r += colTop[N - 1 - i]; }
    const lowEnd = l > r ? 0 : 1, seg = Math.round(0.4 * N);
    let lowCols = 0;
    for (let i = 0; i < seg; i++) if (colTop[lowEnd === 0 ? i : N - 1 - i] >= 0.62 * N) lowCols++;
    const lowShare = lowCols / seg;
    if (lowShare >= 0.7) return null;   // a cap from the side - or a shoe: too close to call (3 of 4 right on test shapes)
    if (lowShare <= 0.45) return 'shoes';
  }
  return null;
}

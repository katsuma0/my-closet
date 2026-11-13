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
        // Accept what matches the model; what climbs smoothly above it (a hot spot - shadows and
        // garments only ever lead down from the bare background, or up with a jump); and, along the
        // frame itself, anything that changes as gently as lighting does.
        if (like(q) || (cast(q) && ((cY[q] >= v * 0.995 && cY[q] > mY[q]) || (ring[q] && ring[g] && Math.abs(cY[q] - v) < 0.035 * v)))) { seen[q] = 1; queue[qt++] = q; }
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
  const fg = tidy(S, P);
  const mask = finish(img, S, fg, P);

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

/**
 * Render the sticker: item cut out, smooth white border, soft shadow.
 * Returns { dataURL, colors, width, height }.
 */
export function renderSticker(img, mask, { border = 0.022, removeBg = true } = {}) {
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
  lctx.putImageData(lineData, 0, 0);

  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const octx = out.getContext('2d');
  octx.save();
  octx.shadowColor = 'rgba(60, 50, 40, 0.18)';
  octx.shadowBlur = 10;
  octx.shadowOffsetY = 3;
  octx.drawImage(lineC, 0, 0);
  octx.restore();
  octx.drawImage(lineC, 0, 0);
  octx.drawImage(itemC, 0, 0);

  return {
    dataURL: out.toDataURL('image/png'),
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

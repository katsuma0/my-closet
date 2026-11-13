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

function dist(d, i, r, g, b) {
  const dr = d[i] - r, dg = d[i + 1] - g, db = d[i + 2] - b;
  // weighted so subtle chroma differences (beige on cream) still register
  return Math.sqrt((2 * dr * dr + 4 * dg * dg + 3 * db * db) / 3);
}

function estimateBackground(img) {
  const { data, width: w, height: h } = img;
  const rs = [], gs = [], bs = [];
  const push = (x, y) => { const i = (y * w + x) * 4; rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]); };
  const step = Math.max(1, Math.floor((w + h) / 400));
  for (let x = 0; x < w; x += step) { push(x, 0); push(x, h - 1); push(x, 1); push(x, h - 2); }
  for (let y = 0; y < h; y += step) { push(0, y); push(w - 1, y); push(1, y); push(w - 2, y); }
  const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  return [med(rs), med(gs), med(bs)];
}

/**
 * Compute a foreground mask (Uint8Array 0/1).
 * tolerance: 5..80. seeds: extra [x,y] (normalized 0..1) points the user tapped to erase.
 */
export function computeMask(img, tolerance = 32, seeds = []) {
  const { data, width: w, height: h } = img;
  const n = w * h;
  const bg = new Uint8Array(n); // 1 = background
  const [br, bgc, bb] = estimateBackground(img);
  const tol = tolerance;
  const queue = new Int32Array(n);
  let head = 0, tail = 0;

  const tryPush = (p, parent, refR, refG, refB, localTol) => {
    if (bg[p]) return;
    const i = p * 4;
    const dGlobal = dist(data, i, refR, refG, refB);
    let ok = dGlobal < localTol;
    if (!ok && parent >= 0) {
      // follow soft gradients / shadows along the background
      const dLocal = dist(data, i, data[parent * 4], data[parent * 4 + 1], data[parent * 4 + 2]);
      ok = dLocal < localTol * 0.18 && dGlobal < localTol * 1.6;
    }
    if (ok) { bg[p] = 1; queue[tail++] = p; }
  };

  const flood = (refR, refG, refB, localTol) => {
    while (head < tail) {
      const p = queue[head++];
      const x = p % w, y = (p / w) | 0;
      if (x > 0) tryPush(p - 1, p, refR, refG, refB, localTol);
      if (x < w - 1) tryPush(p + 1, p, refR, refG, refB, localTol);
      if (y > 0) tryPush(p - w, p, refR, refG, refB, localTol);
      if (y < h - 1) tryPush(p + w, p, refR, refG, refB, localTol);
    }
  };

  for (let x = 0; x < w; x++) { tryPush(x, -1, br, bgc, bb, tol); tryPush((h - 1) * w + x, -1, br, bgc, bb, tol); }
  for (let y = 0; y < h; y++) { tryPush(y * w, -1, br, bgc, bb, tol); tryPush(y * w + w - 1, -1, br, bgc, bb, tol); }
  flood(br, bgc, bb, tol);

  // user-tapped erase seeds (e.g. the hole in a bag handle)
  for (const [sx, sy] of seeds) {
    const x = Math.min(w - 1, Math.max(0, Math.round(sx * w)));
    const y = Math.min(h - 1, Math.max(0, Math.round(sy * h)));
    const p = y * w + x, i = p * 4;
    head = tail = 0;
    if (!bg[p]) { bg[p] = 1; queue[tail++] = p; }
    flood(data[i], data[i + 1], data[i + 2], tol * 0.9);
  }

  // enclosed background pockets (inside a bag handle, between straps) that
  // closely match the background colour are removed too
  {
    const strict = tol * 0.55, seen = new Uint8Array(n), comp = new Int32Array(n);
    for (let s = 0; s < n; s++) {
      if (bg[s] || seen[s] || dist(data, s * 4, br, bgc, bb) >= strict) continue;
      let ch = 0, ct = 0; comp[ct++] = s; seen[s] = 1;
      while (ch < ct) {
        const p = comp[ch++], x = p % w;
        const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p + w < n ? p + w : -1];
        for (const q of nb) if (q >= 0 && !bg[q] && !seen[q] && dist(data, q * 4, br, bgc, bb) < strict) { seen[q] = 1; comp[ct++] = q; }
      }
      if (ct > n * 0.002) for (let k = 0; k < ct; k++) bg[comp[k]] = 1;
    }
  }

  let mask = new Uint8Array(n);
  for (let p = 0; p < n; p++) mask[p] = bg[p] ? 0 : 1;

  // morphological open (remove specks) then close (fill pinholes)
  mask = dilate(erode(mask, w, h), w, h);
  mask = erode(dilate(mask, w, h), w, h);
  mask = keepMainComponents(mask, w, h);
  return mask;
}

function erode(m, w, h) {
  const o = new Uint8Array(m.length);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x;
    o[p] = m[p] & m[p - 1] & m[p + 1] & m[p - w] & m[p + w];
  }
  return o;
}
function dilate(m, w, h) {
  const o = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    o[p] = m[p] | (x > 0 && m[p - 1]) | (x < w - 1 && m[p + 1]) | (y > 0 && m[p - w]) | (y < h - 1 && m[p + w]) ? 1 : 0;
  }
  return o;
}

function keepMainComponents(m, w, h) {
  const label = new Int32Array(m.length);
  const sizes = [0];
  const stack = new Int32Array(m.length);
  let cur = 0;
  for (let p = 0; p < m.length; p++) {
    if (!m[p] || label[p]) continue;
    cur++; let sp = 0, size = 0;
    stack[sp++] = p; label[p] = cur;
    while (sp) {
      const q = stack[--sp]; size++;
      const x = q % w;
      const nb = [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, q - w, q + w];
      for (const r of nb) if (r >= 0 && r < m.length && m[r] && !label[r]) { label[r] = cur; stack[sp++] = r; }
    }
    sizes.push(size);
  }
  if (cur === 0) return m;
  const biggest = Math.max(...sizes);
  const o = new Uint8Array(m.length);
  for (let p = 0; p < m.length; p++) if (label[p] && sizes[label[p]] >= biggest * 0.04) o[p] = 1;
  return o;
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

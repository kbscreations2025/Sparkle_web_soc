const sharp = require("sharp");

/**
 * Lifting a piece of jewellery off its background — without redrawing it.
 *
 * A generative "remove the background" (GPT's transparent mode) returns a
 * clean alpha, but it returns it around a *re-imagined* piece: bails change
 * shape, a solitaire becomes a cluster, an open setting fills in. For a
 * product photo that is a different product. So the cutout here is made from
 * the photo's own pixels: the background is modelled and lifted off, and
 * every pixel of the piece is the one that was photographed, at full size.
 *
 * It works on what product photography almost always is — a piece on a
 * plain studio backdrop, white, grey, cream or black, flat or gently
 * graded. `analyse` says whether a photo is that; a busy one (a table, a
 * hand, a scene) is first moved onto plain white by an image model, and the
 * cutout is then taken from that (see jobs/productBackground.js).
 *
 * The pipeline, all on raw pixels:
 *  1. A background *plate* — the backdrop's colour at every point, so a
 *     vignette or a light falloff is part of the backdrop and not mistaken
 *     for the piece. Grown from the border inward, refined twice.
 *  2. A flood fill from the border through backdrop-coloured, edge-free
 *     pixels — and through contact shadows, which are the backdrop darkened
 *     without changing hue — so only what is connected to the outside can
 *     be backdrop. White diamonds on a white backdrop survive because they
 *     are walled in by the setting's edges, and because they are textured.
 *  3. Enclosed openings — an open centre, the inside of a chain link — are
 *     backdrop too, when they are flat and match the plate closely.
 *  4. A soft edge: alpha from colour distance across a thin boundary band,
 *     with the backdrop's colour unmixed from the edge pixels so a white
 *     halo doesn't follow the piece onto a dark background.
 *
 * Pure CPU, no model call: a cutout costs no provider quota.
 */

/** Long edge the analysis runs at. Uploads are capped at 2048 by the client already. */
const MAX_SIDE = 2400;

// ── Colour ─────────────────────────────────────────────────────────────────

/** sRGB byte → linear light, once. */
const LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function labF(t) {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

/** RGB bytes (3 per pixel) → three Float32 planes of CIELAB. */
function toLab(rgb, count) {
  const L = new Float32Array(count);
  const A = new Float32Array(count);
  const B = new Float32Array(count);
  for (let p = 0, i = 0; p < count; p++, i += 3) {
    const r = LINEAR[rgb[i]];
    const g = LINEAR[rgb[i + 1]];
    const b = LINEAR[rgb[i + 2]];
    const x = labF((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
    const y = labF(r * 0.2126 + g * 0.7152 + b * 0.0722);
    const z = labF((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
    L[p] = 116 * y - 16;
    A[p] = 500 * (x - y);
    B[p] = 200 * (y - z);
  }
  return { L, A, B };
}

// ── Small image-processing helpers ─────────────────────────────────────────

/** Sobel gradient magnitude of a plane. */
function gradient(plane, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const tl = plane[p - w - 1];
      const t = plane[p - w];
      const tr = plane[p - w + 1];
      const l = plane[p - 1];
      const r = plane[p + 1];
      const bl = plane[p + w - 1];
      const b = plane[p + w];
      const br = plane[p + w + 1];
      const gx = tr + 2 * r + br - tl - 2 * l - bl;
      const gy = bl + 2 * b + br - tl - 2 * t - tr;
      out[p] = Math.sqrt(gx * gx + gy * gy) / 4;
    }
  }
  return out;
}

/** Local standard deviation of a plane over a (2r+1)² window, via integral images. */
function localStd(plane, w, h, r) {
  const W = w + 1;
  const sum = new Float64Array(W * (h + 1));
  const sq = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    let rowSq = 0;
    for (let x = 0; x < w; x++) {
      const v = plane[y * w + x];
      rowSum += v;
      rowSq += v * v;
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + rowSum;
      sq[(y + 1) * W + x + 1] = sq[y * W + x + 1] + rowSq;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const n = (y1 - y0) * (x1 - x0);
      const s = sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0];
      const q = sq[y1 * W + x1] - sq[y0 * W + x1] - sq[y1 * W + x0] + sq[y0 * W + x0];
      const mean = s / n;
      out[y * w + x] = Math.sqrt(Math.max(0, q / n - mean * mean));
    }
  }
  return out;
}

/** Indices of the outermost pixel ring. */
function borderIndices(w, h) {
  const list = [];
  for (let x = 0; x < w; x++) list.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) list.push(y * w, y * w + w - 1);
  return list;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = Float32Array.from(values).sort();
  return sorted[sorted.length >> 1];
}

/**
 * The backdrop's colour everywhere: the average of known-backdrop pixels in a
 * coarse grid, holes filled in from their neighbours, smoothed and stretched
 * back to full size. Coarse on purpose — a backdrop varies slowly, and a fine
 * plate would start to trace the piece itself.
 */
function buildPlate({ L, A, B }, mask, w, h, fallback) {
  const cells = 40;
  const cw = Math.max(1, Math.ceil(w / cells));
  const ch = Math.max(1, Math.ceil(h / cells));
  const gw = Math.ceil(w / cw);
  const gh = Math.ceil(h / ch);
  const sums = new Float64Array(gw * gh * 3);
  const counts = new Float64Array(gw * gh);

  for (let y = 0; y < h; y++) {
    const gy = Math.floor(y / ch);
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!mask[p]) continue;
      const g = gy * gw + Math.floor(x / cw);
      sums[g * 3] += L[p];
      sums[g * 3 + 1] += A[p];
      sums[g * 3 + 2] += B[p];
      counts[g] += 1;
    }
  }

  const grid = new Float32Array(gw * gh * 3);
  const known = new Uint8Array(gw * gh);
  const minCount = (cw * ch) / 6;
  for (let g = 0; g < gw * gh; g++) {
    if (counts[g] >= minCount) {
      grid[g * 3] = sums[g * 3] / counts[g];
      grid[g * 3 + 1] = sums[g * 3 + 1] / counts[g];
      grid[g * 3 + 2] = sums[g * 3 + 2] / counts[g];
      known[g] = 1;
    }
  }
  if (!known.some(Boolean)) {
    for (let g = 0; g < gw * gh; g++) grid.set(fallback, g * 3);
  } else {
    // Unknown cells (under the piece) take the average of their known
    // neighbours, ring by ring, until the grid is full.
    let pending = known.reduce((n, k) => n + (k ? 0 : 1), 0);
    while (pending > 0) {
      const next = known.slice();
      let filled = 0;
      for (let gy = 0; gy < gh; gy++) {
        for (let gx = 0; gx < gw; gx++) {
          const g = gy * gw + gx;
          if (known[g]) continue;
          let n = 0;
          let l = 0;
          let a = 0;
          let b = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const ny = gy + dy;
              const nx = gx + dx;
              if (ny < 0 || nx < 0 || ny >= gh || nx >= gw) continue;
              const q = ny * gw + nx;
              if (!known[q]) continue;
              l += grid[q * 3];
              a += grid[q * 3 + 1];
              b += grid[q * 3 + 2];
              n += 1;
            }
          }
          if (n) {
            grid[g * 3] = l / n;
            grid[g * 3 + 1] = a / n;
            grid[g * 3 + 2] = b / n;
            next[g] = 1;
            filled += 1;
          }
        }
      }
      known.set(next);
      pending -= filled;
      if (!filled) break;
    }
  }

  // Two passes of a 3×3 box blur on the grid: a plate with corners would put
  // seams into the cutout's edge.
  for (let pass = 0; pass < 2; pass++) {
    const copy = grid.slice();
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        for (let c = 0; c < 3; c++) {
          let s = 0;
          let n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const ny = gy + dy;
              const nx = gx + dx;
              if (ny < 0 || nx < 0 || ny >= gh || nx >= gw) continue;
              s += copy[(ny * gw + nx) * 3 + c];
              n += 1;
            }
          }
          grid[(gy * gw + gx) * 3 + c] = s / n;
        }
      }
    }
  }

  // Bilinear back up to full size.
  const plate = { L: new Float32Array(w * h), A: new Float32Array(w * h), B: new Float32Array(w * h) };
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / ch - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(gh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / cw - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(gw - 1, x0 + 1);
      const tx = fx - x0;
      const p = y * w + x;
      for (let c = 0; c < 3; c++) {
        const v00 = grid[(y0 * gw + x0) * 3 + c];
        const v01 = grid[(y0 * gw + x1) * 3 + c];
        const v10 = grid[(y1 * gw + x0) * 3 + c];
        const v11 = grid[(y1 * gw + x1) * 3 + c];
        const v = (v00 * (1 - tx) + v01 * tx) * (1 - ty) + (v10 * (1 - tx) + v11 * tx) * ty;
        (c === 0 ? plate.L : c === 1 ? plate.A : plate.B)[p] = v;
      }
    }
  }
  return plate;
}

/**
 * The backdrop's region: everything reachable from the border through pixels
 * that pass `allowed`. A BFS over a typed-array queue — a recursive fill
 * would overflow the stack on the first large backdrop.
 */
function floodFromBorder(allowed, w, h) {
  const region = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  for (const p of borderIndices(w, h)) {
    if (allowed(p) && !region[p]) {
      region[p] = 1;
      queue[tail++] = p;
    }
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0 && !region[p - 1] && allowed(p - 1)) (region[p - 1] = 1), (queue[tail++] = p - 1);
    if (x < w - 1 && !region[p + 1] && allowed(p + 1)) (region[p + 1] = 1), (queue[tail++] = p + 1);
    if (y > 0 && !region[p - w] && allowed(p - w)) (region[p - w] = 1), (queue[tail++] = p - w);
    if (y < h - 1 && !region[p + w] && allowed(p + w)) (region[p + w] = 1), (queue[tail++] = p + w);
  }
  return region;
}

/** Connected components of `mask` (4-neighbour), as an id per pixel and each component's size. */
function components(mask, w, h) {
  const label = new Int32Array(w * h).fill(-1);
  const sizes = [];
  const queue = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || label[start] !== -1) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    label[start] = id;
    while (head < tail) {
      const p = queue[head++];
      const x = p % w;
      const y = (p - x) / w;
      const n = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of n) {
        if (q >= 0 && mask[q] && label[q] === -1) {
          label[q] = id;
          queue[tail++] = q;
        }
      }
    }
    sizes.push(tail);
  }
  return { label, sizes };
}

/** Euclidean distance transform-lite: distance (in pixels, capped) to the nearest pixel where `target` is set. */
function distanceTo(target, w, h, cap) {
  const dist = new Uint8Array(w * h).fill(cap);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  for (let p = 0; p < w * h; p++) {
    if (target[p]) {
      dist[p] = 0;
      queue[tail++] = p;
    }
  }
  while (head < tail) {
    const p = queue[head++];
    const d = dist[p];
    if (d + 1 >= cap) continue;
    const x = p % w;
    const y = (p - x) / w;
    const n = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
    for (const q of n) {
      if (q >= 0 && dist[q] > d + 1) {
        dist[q] = d + 1;
        queue[tail++] = q;
      }
    }
  }
  return dist;
}

// ── The cutout ─────────────────────────────────────────────────────────────

/** Decodes to raw RGB at the working size, EXIF orientation applied. */
async function decode(buffer, maxSide = MAX_SIDE) {
  const { data, info } = await sharp(buffer, { failOn: "none" })
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    // A PNG that is already a cutout: its clear areas become a white backdrop
    // to lift off again, rather than whatever colour the empty pixels hold.
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { rgb: data, w: info.width, h: info.height };
}

/**
 * Separates backdrop from piece. Returns the per-pixel alpha (0–255), the
 * plate, the shadow strength under the piece, and how confident it is that
 * the photo was on a plain backdrop at all.
 *
 * `semantic`, when given, is a 0–1 map of where a vision model sees the
 * piece (see services/segmentation.js). Colour alone cannot separate a white
 * gold band from a white backdrop — they are the same colour — so where the
 * two disagree on backdrop-coloured pixels, the model's outline decides.
 * Colour still decides every edge it can: the model's mask is coarse, and a
 * gold edge against white is placed far more exactly by its colour.
 */
function separate(rgb, w, h, semantic = null) {
  const count = w * h;
  const lab = toLab(rgb, count);
  const grad = gradient(lab.L, w, h);
  const texture = localStd(lab.L, w, h, 2);

  // First guess at the backdrop: the border's median colour.
  const border = borderIndices(w, h);
  const seed = [median(border.map((p) => lab.L[p])), median(border.map((p) => lab.A[p])), median(border.map((p) => lab.B[p]))];

  const distance = (plate) => {
    const D = new Float32Array(count);
    for (let p = 0; p < count; p++) {
      const dl = lab.L[p] - plate.L[p];
      const da = lab.A[p] - plate.A[p];
      const db = lab.B[p] - plate.B[p];
      D[p] = Math.sqrt(dl * dl * 0.6 + da * da + db * db);
    }
    return D;
  };

  /**
   * A contact shadow: darker than the plate at the same hue, smooth, and not
   * a hard edge. Allowed into the backdrop's flood so it is lifted off with it.
   */
  const shadowLike = (plate, p) => {
    const ratio = lab.L[p] / Math.max(1, plate.L[p]);
    if (ratio < 0.45 || ratio > 1.02) return false;
    const chroma = Math.hypot(lab.A[p] - plate.A[p], lab.B[p] - plate.B[p]);
    return chroma < 6 && texture[p] < 2.2;
  };

  let plate = { L: new Float32Array(count).fill(seed[0]), A: new Float32Array(count).fill(seed[1]), B: new Float32Array(count).fill(seed[2]) };
  let region = null;
  let D = null;
  // Coarse to fine: a wide first fill only to learn the backdrop, then a
  // tighter one against the refined plate.
  for (const [limit, edge] of [
    [16, 7],
    [9, 5],
    [6, 4],
  ]) {
    D = distance(plate);
    const currentPlate = plate;
    region = floodFromBorder((p) => grad[p] < edge && (D[p] < limit || shadowLike(currentPlate, p)), w, h);
    plate = buildPlate(lab, region, w, h, seed);
  }
  D = distance(plate);

  // The fill stops at edges, so the backdrop's own antialiased rim against the
  // piece is left out of `region`. Grow it one pixel into anything that is
  // still clearly backdrop-coloured.
  for (let pass = 0; pass < 2; pass++) {
    const grown = region.slice();
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (region[p] || D[p] > 4) continue;
        if (region[p - 1] || region[p + 1] || region[p - w] || region[p + w]) grown[p] = 1;
      }
    }
    region = grown;
  }

  // Enclosed openings: flat, plate-coloured pockets the border fill can't
  // reach — the open centre of a pendant, the inside of a chain link.
  const pocket = new Uint8Array(count);
  for (let p = 0; p < count; p++) {
    if (!region[p] && D[p] < 4.5 && texture[p] < 1.6) pocket[p] = 1;
  }
  const { label, sizes } = components(pocket, w, h);
  // Big enough to be an opening rather than a highlight on polished metal.
  const minPocket = Math.max(6, Math.round(count * 0.00002));
  const pocketMean = new Float64Array(sizes.length);
  for (let p = 0; p < count; p++) if (label[p] >= 0) pocketMean[label[p]] += texture[p];
  for (let p = 0; p < count; p++) {
    const id = label[p];
    if (id < 0) continue;
    if (sizes[id] >= minPocket && pocketMean[id] / sizes[id] < 1.1) region[p] = 1;
  }

  // Alpha: solid inside the piece, zero across the backdrop, and a soft ramp
  // on the boundary from how far each pixel's colour is from the plate.
  const toBackdrop = distanceTo(region, w, h, 4);
  const notRegion = new Uint8Array(count);
  for (let p = 0; p < count; p++) notRegion[p] = region[p] ? 0 : 1;
  const toPiece = distanceTo(notRegion, w, h, 3);

  const alpha = new Uint8Array(count);
  const shadow = new Float32Array(count);
  for (let p = 0; p < count; p++) {
    if (region[p]) {
      // Backdrop — except its rim right against the piece, which carries
      // part of the piece's edge.
      if (toPiece[p] <= 1) {
        const t = Math.min(1, Math.max(0, (D[p] - 3) / 22));
        alpha[p] = Math.round(255 * t * t * (3 - 2 * t) * 0.85);
      }
      const ratio = lab.L[p] / Math.max(1, plate.L[p]);
      if (ratio < 0.985) shadow[p] = Math.min(1, (1 - ratio) * 1.15);
    } else if (toBackdrop[p] <= 2) {
      const t = Math.min(1, Math.max(0, (D[p] - 2) / 20));
      alpha[p] = Math.round(255 * Math.max(t * t * (3 - 2 * t), toBackdrop[p] === 2 ? 0.85 : 0.35));
    } else {
      alpha[p] = 255;
    }
  }

  if (semantic) refineWithSemantic({ alpha, region, D, texture, semantic, shadow, w, h });

  // How sure: a plain backdrop is one the fill reached nearly all the border
  // through, and whose pixels sit close to the plate.
  let borderHit = 0;
  for (const p of border) if (region[p]) borderHit += 1;
  let noise = 0;
  let backdropCount = 0;
  for (let p = 0; p < count; p += 7) {
    if (!region[p]) continue;
    noise += D[p];
    backdropCount += 1;
  }
  const backdropShare = (region.reduce((n, v) => n + v, 0) / count);
  const meanNoise = backdropCount ? noise / backdropCount : 99;
  const plain = borderHit / border.length > 0.85 && meanNoise < 3.2 && backdropShare > 0.12;

  return { alpha, plate, shadow, plain, stats: { borderShare: borderHit / border.length, meanNoise, backdropShare } };
}

const smoothstep = (lo, hi, v) => {
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/**
 * Folds a vision model's outline of the piece into the colour-based alpha,
 * in place. The rules, per pixel:
 *
 *  - Colour-distinct detail (gold, a coloured stone — clearly not the
 *    backdrop's colour, and textured or strongly different) is piece if it
 *    is connected to where the model is sure the piece is. That keeps a fine
 *    chain the coarse mask missed, and drops a speck of dust it didn't.
 *  - Where the model is sure it's the piece, it is — this is what restores a
 *    white band on a white backdrop.
 *  - Where the model is sure it's backdrop, it is — a reflection under the
 *    piece, a shadow, a mark on the sweep.
 *  - Along the mask's soft edge, colour places the edge where colour can
 *    tell; on backdrop-coloured pixels the mask's own falloff does.
 */
function refineWithSemantic({ alpha, region, D, texture, semantic: S, shadow, w, h }) {
  const count = w * h;
  const colourDistinct = new Uint8Array(count);
  const strong = new Uint8Array(count);
  const candidate = new Uint8Array(count);
  for (let p = 0; p < count; p++) {
    // A shadow is backdrop however dark it gets.
    const isShadow = region[p] && shadow[p] > 0.04;
    colourDistinct[p] = D[p] >= 12 && !isShadow ? 1 : 0;
    strong[p] = colourDistinct[p] && (D[p] >= 22 || texture[p] >= 2.5) ? 1 : 0;
    candidate[p] = strong[p] || S[p] >= 0.5 ? 1 : 0;
  }

  // Keep only what is joined to the confident core of the piece.
  const { label, sizes } = components(candidate, w, h);
  const anchored = new Uint8Array(sizes.length);
  for (let p = 0; p < count; p++) if (label[p] >= 0 && S[p] >= 0.65) anchored[label[p]] = 1;
  const kept = new Uint8Array(count);
  for (let p = 0; p < count; p++) kept[p] = label[p] >= 0 && anchored[label[p]] ? 1 : 0;
  // One pixel of grace around kept detail, for its own antialiased rim.
  const nearKept = distanceTo(kept, w, h, 3);

  // Small backdrop-coloured pockets walled in by strong metal — the inside of
  // a chain link — are openings even where the coarse mask paints over them.
  const pocketMask = new Uint8Array(count);
  for (let p = 0; p < count; p++) if (!strong[p] && D[p] < 4.5 && texture[p] < 1.6) pocketMask[p] = 1;
  const pockets = components(pocketMask, w, h);
  const maxPocket = Math.max(20, Math.round(count * 0.0015));
  const boundary = new Float64Array(pockets.sizes.length);
  const boundaryStrong = new Float64Array(pockets.sizes.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const id = pockets.label[p];
      if (id < 0) continue;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (pockets.label[q] === id) continue;
        boundary[id] += 1;
        if (strong[q]) boundaryStrong[id] += 1;
      }
    }
  }
  const isOpening = (p) => {
    const id = pockets.label[p];
    return id >= 0 && pockets.sizes[id] <= maxPocket && boundary[id] > 0 && boundaryStrong[id] / boundary[id] > 0.7;
  };

  for (let p = 0; p < count; p++) {
    const s = S[p];
    const fromMask = Math.round(255 * smoothstep(0.25, 0.75, s));
    if (strong[p] && kept[p]) {
      alpha[p] = Math.max(alpha[p], fromMask);
    } else if (isOpening(p)) {
      alpha[p] = 0;
    } else if (s >= 0.9) {
      alpha[p] = 255;
    } else if (s <= 0.1) {
      // Backdrop — bar the soft rim of detail kept just beside it.
      alpha[p] = nearKept[p] <= 1 && D[p] >= 6 ? alpha[p] : 0;
    } else {
      alpha[p] = colourDistinct[p] ? alpha[p] : fromMask;
    }
  }
}

/** The plate back in sRGB bytes, for unmixing the backdrop from edge pixels. */
function plateRgbAt(plate, p) {
  const fy = (plate.L[p] + 16) / 116;
  const fx = fy + plate.A[p] / 500;
  const fz = fy - plate.B[p] / 200;
  const inv = (t) => (t * t * t > 0.008856 ? t * t * t : (t - 16 / 116) / 7.787);
  const X = inv(fx) * 0.95047;
  const Y = inv(fy);
  const Z = inv(fz) * 1.08883;
  const lin = [X * 3.2406 + Y * -1.5372 + Z * -0.4986, X * -0.9689 + Y * 1.8758 + Z * 0.0415, X * 0.0557 + Y * -0.204 + Z * 1.057];
  return lin.map((c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  });
}

/**
 * A model's mask (any size, one channel, 0–255, covering the same frame as
 * the photo) at the working size, as 0–1. Smoothed a little: the model's
 * mask is coarse, and stretched up its cells would show as steps.
 */
async function semanticAt({ data, width, height }, w, h) {
  const scale = Math.max(w / width, h / height);
  const resized = await sharp(Buffer.from(data), { raw: { width, height, channels: 1 } })
    .resize(w, h, { fit: "fill", kernel: "cubic" })
    .blur(Math.max(0.5, scale * 0.6))
    // Without this sharp hands a one-channel input back as three, and every
    // index below would read the wrong pixel.
    .extractChannel(0)
    .raw()
    .toBuffer();
  const out = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) out[p] = resized[p] / 255;
  return out;
}

/**
 * Whether a photo is on a plain backdrop — answered on a small copy, so the
 * route can price a run (a busy photo needs a model call first) without
 * holding a full-size decode.
 */
async function analyse(buffer) {
  const { rgb, w, h } = await decode(buffer, 480);
  const { plain, stats } = separate(rgb, w, h);
  // The small copy's own size — its proportions are the photo's, which is
  // what choosing an output aspect ratio needs.
  return { plain, width: w, height: h, ...stats };
}

/** Gemini's image aspect ratios, as numbers, for picking the nearest to a photo. */
const ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

/** The supported ratio closest to `width / height` — compared in log space, so 2:1 and 1:2 are equally far from 1:1. */
function nearestAspectRatio(width, height) {
  const target = Math.log(width / Math.max(1, height));
  let best = "1:1";
  let bestDistance = Infinity;
  for (const ratio of ASPECT_RATIOS) {
    const [a, b] = ratio.split(":").map(Number);
    const distance = Math.abs(Math.log(a / b) - target);
    if (distance < bestDistance) {
      best = ratio;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The cutout itself: an RGBA PNG at the photo's own size (up to MAX_SIDE),
 * plus what compositing it again needs — the alpha and the shadow the
 * backdrop carried — and whether the backdrop was plain enough to trust.
 */
async function cutOut(buffer, { semantic = null } = {}) {
  const { rgb, w, h } = await decode(buffer);
  const { alpha, plate, shadow, plain, stats } = separate(rgb, w, h, semantic ? await semanticAt(semantic, w, h) : null);

  const rgba = Buffer.alloc(w * h * 4);
  for (let p = 0, i = 0, o = 0; p < w * h; p++, i += 3, o += 4) {
    const a = alpha[p];
    if (a > 0 && a < 250) {
      // Unmix the backdrop: the edge pixel is part piece, part plate, and
      // only the piece's part should travel to a new background.
      const bg = plateRgbAt(plate, p);
      const t = Math.max(a / 255, 0.2);
      for (let c = 0; c < 3; c++) rgba[o + c] = Math.max(0, Math.min(255, Math.round(bg[c] + (rgb[i + c] - bg[c]) / t)));
    } else {
      rgba[o] = rgb[i];
      rgba[o + 1] = rgb[i + 1];
      rgba[o + 2] = rgb[i + 2];
    }
    rgba[o + 3] = a;
  }

  const png = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 8 }).toBuffer();
  return { png, width: w, height: h, alpha, shadow, plain, stats };
}

// ── Compositing ────────────────────────────────────────────────────────────

/** "#rrggbb" → { r, g, b }, white for anything malformed. */
function parseHex(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  const value = match ? parseInt(match[1], 16) : 0xffffff;
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

/** The tight box around everything with any opacity. */
function boundingBox(alpha, w, h, threshold = 12) {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? { left: 0, top: 0, width: w, height: h } : { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * Places a cutout on a new background.
 *
 * @param background `{ kind: "transparent" }` or `{ kind: "color", hex }`.
 * @param shadow     "none" | "natural" (the photo's own contact shadow,
 *                   re-laid on the new colour) | "soft" (a gentle drop shadow
 *                   drawn from the piece's own outline).
 * @param framing    "original" keeps the photo's canvas; "square" centres the
 *                   piece on a square canvas with an even margin — what a
 *                   catalogue or marketplace listing expects.
 */
async function composite(cut, { background, shadow = "none", framing = "original", margin = 0.08 }) {
  const { png, width: w, height: h, alpha } = cut;

  // Framing first: where the piece lands on which canvas.
  let canvas = { width: w, height: h };
  let place = { left: 0, top: 0 };
  let piece = png;
  let pieceAlpha = alpha;
  let shadowPlane = cut.shadow;
  let crop = { left: 0, top: 0, width: w, height: h };
  if (framing === "square") {
    crop = boundingBox(alpha, w, h);
    const side = Math.round(Math.max(crop.width, crop.height) / (1 - margin * 2));
    canvas = { width: side, height: side };
    place = { left: Math.round((side - crop.width) / 2), top: Math.round((side - crop.height) / 2) };
    piece = await sharp(png).extract(crop).png().toBuffer();
    pieceAlpha = new Uint8Array(crop.width * crop.height);
    shadowPlane = new Float32Array(crop.width * crop.height);
    for (let y = 0; y < crop.height; y++) {
      for (let x = 0; x < crop.width; x++) {
        const src = (y + crop.top) * w + x + crop.left;
        pieceAlpha[y * crop.width + x] = alpha[src];
        shadowPlane[y * crop.width + x] = cut.shadow[src];
      }
    }
  }
  const pw = framing === "square" ? crop.width : w;
  const ph = framing === "square" ? crop.height : h;

  const layers = [];

  if (shadow === "soft") {
    // The piece's own outline, blurred and dropped a little — light from
    // above, so the shadow falls just below and slightly behind.
    const blur = Math.max(2, Math.round(Math.max(pw, ph) * 0.012));
    const offset = Math.max(1, Math.round(Math.max(pw, ph) * 0.012));
    const mask = Buffer.alloc(pw * ph);
    for (let p = 0; p < pw * ph; p++) mask[p] = Math.round(pieceAlpha[p] * 0.32);
    const blurred = await sharp(mask, { raw: { width: pw, height: ph, channels: 1 } }).blur(blur).extractChannel(0).raw().toBuffer();
    const rgba = Buffer.alloc(pw * ph * 4);
    for (let p = 0; p < pw * ph; p++) rgba[p * 4 + 3] = blurred[p];
    layers.push({
      input: await sharp(rgba, { raw: { width: pw, height: ph, channels: 4 } }).png().toBuffer(),
      left: place.left,
      top: Math.min(canvas.height - ph, place.top + offset),
    });
  } else if (shadow === "natural") {
    // The photo's own shadow, as darkness only — so it sits correctly on any
    // colour rather than carrying the old backdrop's grey with it.
    const rgba = Buffer.alloc(pw * ph * 4);
    for (let p = 0; p < pw * ph; p++) rgba[p * 4 + 3] = Math.round(Math.min(1, shadowPlane[p]) * 255 * 0.9);
    layers.push({ input: await sharp(rgba, { raw: { width: pw, height: ph, channels: 4 } }).png().toBuffer(), left: place.left, top: place.top });
  }

  layers.push({ input: piece, left: place.left, top: place.top });

  const base =
    background?.kind === "color"
      ? { ...parseHex(background.hex), alpha: 1 }
      : { r: 0, g: 0, b: 0, alpha: 0 };

  const out = sharp({ create: { width: canvas.width, height: canvas.height, channels: 4, background: base } }).composite(layers);
  // An opaque result goes out as a high-quality JPEG — a photo at PNG size
  // is several times the bytes for nothing a viewer can see. Full chroma, so
  // a brand colour's edge against the metal doesn't smear (see thumbnail.js).
  // Only a transparent result needs PNG.
  return background?.kind === "color"
    ? {
        buffer: await out.flatten({ background: base }).jpeg({ quality: 95, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer(),
        mimeType: "image/jpeg",
      }
    : { buffer: await out.png({ compressionLevel: 8 }).toBuffer(), mimeType: "image/png" };
}

module.exports = { analyse, cutOut, composite, nearestAspectRatio };

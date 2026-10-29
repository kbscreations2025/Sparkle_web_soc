const sharp = require("sharp");

/**
 * Putting a generated edit back into the photo it was made from.
 *
 * An image model asked to change one thing in a photo redraws all of it, and
 * the redraw is never quite the photo: the colour drifts (skin and pale
 * backdrops come back pinker, more so with every turn), and the frame shifts
 * or zooms by a few percent. For a customer's own photo that is a different
 * photo. So the model's answer is used only where the change is — the
 * jewellery, old and new, and a margin round it — and every other pixel is
 * the original's.
 *
 * Three steps, all on raw pixels:
 *  1. Framing. The image sent is padded with its own mirrored edges to the
 *     nearest shape the model returns, so the answer comes back in the same
 *     frame and can be cropped back to the photo.
 *  2. Alignment. The answer is matched to the photo outside the change — a
 *     scale-and-shift search on brightness, which a colour cast doesn't
 *     disturb — so a slight zoom doesn't double every edge at the seam.
 *  3. Colour. How far the answer's colours are from the photo's is measured
 *     all round the change and carried smoothly into it (a membrane, as in
 *     Poisson cloning), so the new piece and the skin regrown where the old
 *     one was take the photo's own colours, and the seam disappears.
 */

/** The frame shapes Gemini's image models return. */
const MODEL_RATIOS = [
  [1, 1],
  [4, 5],
  [5, 4],
  [3, 4],
  [4, 3],
  [2, 3],
  [3, 2],
  [9, 16],
  [16, 9],
  [21, 9],
];

/** Long edges the alignment runs at: a coarse search, then a fine one. */
const COARSE_SIDE = 64;
const FINE_SIDE = 256;
/** Long edge of the aligned copy outlined by the vision model — its masks are coarse anyway. */
const OUTLINE_SIDE = 1024;

/**
 * How far the answer may have zoomed or shifted and still be found. Wider
 * than the model ever drifts on its own; a bigger move is a different photo.
 */
const SCALE_RANGE = 0.08;
const SHIFT_RANGE = 0.05;

/**
 * Below this the model moved or re-posed what it was meant to leave alone,
 * and pasting its edit back would show a seam. Measured on outlines and
 * creases (a band-pass of brightness) rather than on brightness itself:
 * smooth skin and a plain backdrop correlate even when they are well out of
 * place, edges only when they line up. 1 = identical.
 */
const MIN_MATCH = 0.5;

/** A change outlined over more of the photo than this is a failed outline, not a piece of jewellery. */
const MAX_NEW_SHARE = 0.3;

/** SOR weight for the colour membrane — fast convergence without overshoot. */
const OMEGA = 1.85;

/** An error whose message is meant for the person, settled rather than transient. */
function exposedError(message, code) {
  const err = new Error(message);
  err.expose = true;
  err.noRetry = true;
  err.code = code;
  return err;
}

/** Encoded image bytes, upright and flattened onto white, in sRGB — the photo and the answer are both read this way. */
function srgbPipeline(base64) {
  return sharp(Buffer.from(base64, "base64"), { failOn: "none" }).rotate().flatten({ background: "#ffffff" }).toColourspace("srgb");
}

/** A `{ base64 }` image as raw sRGB pixels: what every later step reads, and what the result is made of. */
async function decodeImage({ mimeType, base64 }) {
  const { data, info } = await srgbPipeline(base64).raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`expected an RGB image, got ${info.channels} channels`);
  return { data, width: info.width, height: info.height, mimeType };
}

/** `width × height` scaled so its long edge is `side`, never enlarged. */
function sizeFor(width, height, side) {
  const scale = Math.min(1, side / Math.max(width, height));
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
}

/**
 * The nearest shape the model returns, and where the image sits inside it.
 * `innerWidth`/`innerHeight` are the image's own size, in the frame's units.
 */
function frameFor(width, height) {
  const ratio = width / height;
  const distance = ([w, h]) => Math.abs(Math.log(w / h / ratio));
  const [rw, rh] = MODEL_RATIOS.reduce((best, candidate) => (distance(candidate) < distance(best) ? candidate : best));
  const target = rw / rh;
  const frameWidth = target > ratio ? Math.round(height * target) : width;
  const frameHeight = target > ratio ? height : Math.round(width / target);
  return {
    aspectRatio: `${rw}:${rh}`,
    width: frameWidth,
    height: frameHeight,
    left: Math.floor((frameWidth - width) / 2),
    top: Math.floor((frameHeight - height) / 2),
    innerWidth: width,
    innerHeight: height,
  };
}

/**
 * What the model is shown: the image padded with its own mirrored edges to
 * the frame, so the model is asked for a shape it can return without
 * stretching or cropping it.
 */
async function prepareForModel(image) {
  const frame = frameFor(image.width, image.height);
  const buffer = await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 3 } })
    .extend({
      top: frame.top,
      bottom: frame.height - image.height - frame.top,
      left: frame.left,
      right: frame.width - image.width - frame.left,
      extendWith: "mirror",
    })
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
    .toBuffer();
  return { frame, send: { mimeType: "image/jpeg", base64: buffer.toString("base64") } };
}

// ── Pixel helpers ──────────────────────────────────────────────────────────

/**
 * Where each column (or row) of a `count`-wide grid over the photo falls in
 * the frame, as 0–1 of the frame's width (or height).
 */
function axisMap(count, offset, inner, frameSize) {
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) out[i] = (offset + ((i + 0.5) / count) * inner) / frameSize;
  return out;
}

/** Bilinear read of a 3-channel image (any indexable array) at pixel `(x, y)`, clamped to its edges. */
function sample3(src, width, height, x, y, out) {
  if (x < 0) x = 0;
  else if (x > width - 1) x = width - 1;
  if (y < 0) y = 0;
  else if (y > height - 1) y = height - 1;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1 < width ? x0 + 1 : x0;
  const y1 = y0 + 1 < height ? y0 + 1 : y0;
  const wx = x - x0;
  const wy = y - y0;
  const i00 = (y0 * width + x0) * 3;
  const i10 = (y0 * width + x1) * 3;
  const i01 = (y1 * width + x0) * 3;
  const i11 = (y1 * width + x1) * 3;
  for (let c = 0; c < 3; c++) {
    const top = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * wx;
    const bottom = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * wx;
    out[c] = top + (bottom - top) * wy;
  }
}

/** A one-channel buffer resized to `width × height`. */
async function resize1(data, fromWidth, fromHeight, width, height) {
  return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width: fromWidth, height: fromHeight, channels: 1 } })
    .resize(width, height, { fit: "fill" })
    .extractChannel(0)
    .raw()
    .toBuffer();
}

/** A one-channel buffer blurred, optionally thresholded back to 0/255. */
async function blur1(data, width, height, sigma, threshold = null) {
  const out = await sharp(data, { raw: { width, height, channels: 1 } })
    .blur(Math.max(0.3, sigma))
    .extractChannel(0)
    .raw()
    .toBuffer();
  if (threshold !== null) for (let i = 0; i < out.length; i++) out[i] = out[i] > threshold ? 255 : 0;
  return out;
}

/** A segmentation mask at the photo's size, as 0/255. */
async function maskAt(mask, width, height) {
  const out = await resize1(mask.data, mask.width, mask.height, width, height);
  for (let i = 0; i < out.length; i++) out[i] = out[i] > 127 ? 255 : 0;
  return out;
}

/** Brightness of a raw RGB image at `width × height`. */
async function lumaAt(rgb, fromWidth, fromHeight, width, height) {
  return sharp(rgb, { raw: { width: fromWidth, height: fromHeight, channels: 3 } })
    .resize(width, height, { fit: "fill" })
    .greyscale()
    .extractChannel(0)
    .raw()
    .toBuffer();
}

/**
 * Outlines and creases: brightness with its finest grain (noise, pores — which
 * a model redraws differently every time) and its broad shading both taken
 * out, leaving the edges a faithful edit keeps in place.
 */
async function bandPass(luma, width, height) {
  const [fine, broad] = await Promise.all([blur1(luma, width, height, 1), blur1(luma, width, height, 4)]);
  const out = new Float32Array(luma.length);
  for (let i = 0; i < out.length; i++) out[i] = fine[i] - broad[i];
  return out;
}

// ── Alignment ──────────────────────────────────────────────────────────────

/**
 * One scale of the search: the photo's brightness, which of its pixels count
 * (not the jewellery), and the answer's brightness at the same density.
 */
async function alignmentLevel({ photo, answer, frame, exclude }, side) {
  const { w, h } = sizeFor(photo.width, photo.height, side);
  const aw = Math.max(2, Math.round((answer.width * w) / photo.width));
  const ah = Math.max(2, Math.round((answer.height * h) / photo.height));
  const [lumaPhoto, lumaAnswer, excluded] = await Promise.all([
    lumaAt(photo.data, photo.width, photo.height, w, h),
    lumaAt(answer.data, answer.width, answer.height, aw, ah),
    resize1(exclude, photo.width, photo.height, w, h),
  ]);
  const weight = new Uint8Array(w * h);
  let counted = 0;
  for (let i = 0; i < weight.length; i++) {
    if (excluded[i] < 8) {
      weight[i] = 1;
      counted++;
    }
  }
  const [bandPhoto, bandAnswer] = await Promise.all([bandPass(lumaPhoto, w, h), bandPass(lumaAnswer, aw, ah)]);
  return {
    w,
    h,
    aw,
    ah,
    luma: { photo: lumaPhoto, answer: lumaAnswer },
    band: { photo: bandPhoto, answer: bandAnswer },
    weight,
    counted,
    fx: axisMap(w, frame.left, frame.innerWidth, frame.width),
    fy: axisMap(h, frame.top, frame.innerHeight, frame.height),
  };
}

/**
 * How well the answer, moved by `[a, b, tx, ty]`, matches the photo: the
 * correlation of their brightness (or of their outlines, `on: "band"`) over
 * the pixels that count. Correlation rather than difference, so an overall
 * cast or exposure change — exactly the drift this is here to undo — doesn't
 * read as a mismatch.
 */
function matchScore(level, [a, b, tx, ty], on = "luma") {
  const { w, h, aw, ah, weight, fx, fy } = level;
  const { photo: lumaPhoto, answer: lumaAnswer } = level[on];
  let n = 0;
  let sp = 0;
  let sa = 0;
  let spp = 0;
  let saa = 0;
  let spa = 0;
  for (let v = 0; v < h; v++) {
    const y = (0.5 + b * (fy[v] - 0.5) + ty) * ah - 0.5;
    if (y < 0 || y > ah - 1) continue;
    const y0 = Math.floor(y);
    const y1 = y0 + 1 < ah ? y0 + 1 : y0;
    const wy = y - y0;
    const row0 = y0 * aw;
    const row1 = y1 * aw;
    for (let u = 0; u < w; u++) {
      const i = v * w + u;
      if (!weight[i]) continue;
      const x = (0.5 + a * (fx[u] - 0.5) + tx) * aw - 0.5;
      if (x < 0 || x > aw - 1) continue;
      const x0 = Math.floor(x);
      const x1 = x0 + 1 < aw ? x0 + 1 : x0;
      const wx = x - x0;
      const top = lumaAnswer[row0 + x0] + (lumaAnswer[row0 + x1] - lumaAnswer[row0 + x0]) * wx;
      const bottom = lumaAnswer[row1 + x0] + (lumaAnswer[row1 + x1] - lumaAnswer[row1 + x0]) * wx;
      const g = top + (bottom - top) * wy;
      const p = lumaPhoto[i];
      n++;
      sp += p;
      sa += g;
      spp += p * p;
      saa += g * g;
      spa += p * g;
    }
  }
  // A move that pushes most of the photo off the answer can't be judged.
  if (n < 0.8 * level.counted || n < 50) return -1;
  const covariance = spa - (sp * sa) / n;
  const varPhoto = spp - (sp * sp) / n;
  const varAnswer = saa - (sa * sa) / n;
  return varPhoto > 0 && varAnswer > 0 ? covariance / Math.sqrt(varPhoto * varAnswer) : -1;
}

/** Refines a starting move by trying a step either way on each knob, halving the steps as it settles. */
function patternSearch(level, start) {
  let best = start.slice();
  let bestScore = matchScore(level, best);
  const steps = [0.01, 0.01, 0.004, 0.004];
  for (let round = 0; round < 400 && steps[0] > 0.0005; round++) {
    let improved = false;
    for (let k = 0; k < 4; k++) {
      for (const direction of [1, -1]) {
        const candidate = best.slice();
        candidate[k] += direction * steps[k];
        const score = matchScore(level, candidate);
        if (score > bestScore + 1e-6) {
          best = candidate;
          bestScore = score;
          improved = true;
        }
      }
    }
    if (!improved) for (let k = 0; k < 4; k++) steps[k] /= 2;
  }
  return { params: best, score: bestScore };
}

/**
 * The move that lines the answer up with the photo: `[a, b, tx, ty]`, a scale
 * about the frame's centre and a shift, all in fractions of the frame.
 */
async function align(input) {
  const [coarse, fine] = await Promise.all([alignmentLevel(input, COARSE_SIDE), alignmentLevel(input, FINE_SIDE)]);

  // Every uniform zoom and shift in range, on the small copy.
  const candidates = [];
  for (let s = 1 - SCALE_RANGE; s <= 1 + SCALE_RANGE + 1e-9; s += 0.02) {
    for (let tx = -SHIFT_RANGE; tx <= SHIFT_RANGE + 1e-9; tx += 0.0125) {
      for (let ty = -SHIFT_RANGE; ty <= SHIFT_RANGE + 1e-9; ty += 0.0125) {
        const params = [s, s, tx, ty];
        candidates.push({ params, score: matchScore(coarse, params) });
      }
    }
  }
  candidates.sort((x, y) => y.score - x.score);

  // The best few, and no move at all, each refined on the larger copy —
  // then judged on outlines, which only agree when they truly line up.
  const starts = [[1, 1, 0, 0], ...candidates.slice(0, 3).map((entry) => entry.params)];
  const { params } = starts.map((start) => patternSearch(fine, start)).reduce((x, y) => (y.score > x.score ? y : x));
  return { params, score: matchScore(fine, params, "band") };
}

/** The answer, moved into line, resampled onto a `width × height` grid over the photo. */
function warpAnswer(answer, frame, [a, b, tx, ty], width, height) {
  const fx = axisMap(width, frame.left, frame.innerWidth, frame.width);
  const fy = axisMap(height, frame.top, frame.innerHeight, frame.height);
  const out = Buffer.alloc(width * height * 3);
  const px = [0, 0, 0];
  for (let v = 0; v < height; v++) {
    const y = (0.5 + b * (fy[v] - 0.5) + ty) * answer.height - 0.5;
    for (let u = 0; u < width; u++) {
      const x = (0.5 + a * (fx[u] - 0.5) + tx) * answer.width - 0.5;
      sample3(answer.data, answer.width, answer.height, x, y, px);
      const i = (v * width + u) * 3;
      out[i] = px[0];
      out[i + 1] = px[1];
      out[i + 2] = px[2];
    }
  }
  return out;
}

// ── Colour ─────────────────────────────────────────────────────────────────

/** Separable box blur of a one-channel float field, zero outside its edges. */
function boxBlur(field, width, height, radius) {
  const temp = new Float32Array(field.length);
  const out = new Float32Array(field.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = Math.max(0, x - radius); k <= Math.min(width - 1, x + radius); k++) sum += field[y * width + k];
      temp[y * width + x] = sum;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = Math.max(0, y - radius); k <= Math.min(height - 1, y + radius); k++) sum += temp[k * width + x];
      out[y * width + x] = sum;
    }
  }
  return out;
}

/**
 * The colour correction for the changed area: photo minus answer, measured
 * where they should agree (outside the change), then carried into the change
 * as the smoothest field that meets those values at its edge — solved by
 * over-relaxation on a small grid, since the drift itself is smooth.
 *
 * Returns three interleaved float channels at `width × height`.
 */
function colourField(photo, answer, inside, width, height) {
  const count = width * height;
  const known = new Float32Array(count);
  for (let i = 0; i < count; i++) known[i] = inside[i] ? 0 : 1;
  const weight = boxBlur(boxBlur(known, width, height, 2), width, height, 2);

  const field = new Float32Array(count * 3);
  for (let c = 0; c < 3; c++) {
    const diff = new Float32Array(count);
    for (let i = 0; i < count; i++) diff[i] = known[i] ? photo[i * 3 + c] - answer[i * 3 + c] : 0;
    const smooth = boxBlur(boxBlur(diff, width, height, 2), width, height, 2);
    for (let i = 0; i < count; i++) field[i * 3 + c] = known[i] && weight[i] > 1e-3 ? smooth[i] / weight[i] : 0;
  }

  // The changed area's box, and the mean of the edge just outside it as a starting guess.
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  const edge = [0, 0, 0];
  let edgeCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (inside[i]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        continue;
      }
      const touches =
        (x > 0 && inside[i - 1]) || (x < width - 1 && inside[i + 1]) || (y > 0 && inside[i - width]) || (y < height - 1 && inside[i + width]);
      if (touches) {
        for (let c = 0; c < 3; c++) edge[c] += field[i * 3 + c];
        edgeCount++;
      }
    }
  }
  if (x1 < 0) return field;
  for (let c = 0; c < 3; c++) edge[c] = edgeCount ? edge[c] / edgeCount : 0;
  for (let i = 0; i < count; i++) if (inside[i]) for (let c = 0; c < 3; c++) field[i * 3 + c] = edge[c];

  for (let round = 0; round < 4000; round++) {
    let largest = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * width + x;
        if (!inside[i]) continue;
        let n = 0;
        let s0 = 0;
        let s1 = 0;
        let s2 = 0;
        const add = (j) => {
          s0 += field[j * 3];
          s1 += field[j * 3 + 1];
          s2 += field[j * 3 + 2];
          n++;
        };
        if (x > 0) add(i - 1);
        if (x < width - 1) add(i + 1);
        if (y > 0) add(i - width);
        if (y < height - 1) add(i + width);
        if (!n) continue;
        const sums = [s0, s1, s2];
        for (let c = 0; c < 3; c++) {
          const step = OMEGA * (sums[c] / n - field[i * 3 + c]);
          field[i * 3 + c] += step;
          if (Math.abs(step) > largest) largest = Math.abs(step);
        }
      }
    }
    if (largest < 0.02) break;
  }
  return field;
}

/** A 0/1 grid grown by one cell in every direction. */
function growByOne(grid, width, height) {
  const out = new Uint8Array(grid.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = 0;
      for (let dy = -1; dy <= 1 && !on; dy++) {
        for (let dx = -1; dx <= 1 && !on; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < width && yy < height && grid[yy * width + xx]) on = 1;
        }
      }
      out[y * width + x] = on;
    }
  }
  return out;
}

// ── The whole step ─────────────────────────────────────────────────────────

/**
 * The model's answer, put back into the photo: its pixels inside the change,
 * colour-matched to the photo; the photo's own pixels everywhere else.
 *
 * @param photo     the original, from `decodeImage` — what the result is made of
 * @param frame     the frame the image sent to the model was padded to
 * @param answer    the model's image, `{ base64 }`
 * @param oldMask   the outline of the piece being replaced, from services/segmentation.js
 * @param outline   `(buffer) => mask | null` — outlines the jewellery in the aligned answer
 * @throws an exposed error with code "misaligned" when the answer can't be lined up
 */
async function compositeIntoPhoto({ photo, frame, answer, oldMask, outline }) {
  const { width, height } = photo;
  const long = Math.max(width, height);
  // Enough margin to take in the old piece's shadow and the outline's coarse edge.
  const grow = Math.max(6, Math.round(long * 0.02));
  const feather = Math.max(2, grow / 4);

  // The answer, back in the frame it was asked for, at the photo's own scale.
  const answerWidth = Math.round((frame.width * width) / frame.innerWidth);
  const answerHeight = Math.round((frame.height * height) / frame.innerHeight);
  const answerData = await srgbPipeline(answer.base64).resize(answerWidth, answerHeight, { fit: "fill" }).raw().toBuffer();
  const answerImage = { data: answerData, width: answerWidth, height: answerHeight };

  // The old piece's outline at the photo's size, resized once: it is also where
  // the changed area starts below, grown in place once the alignment is done.
  let changed = await maskAt(oldMask, width, height);
  // The old piece and its surroundings are where the photo and the answer are meant to differ.
  const oldArea = await blur1(changed, width, height, grow / 2, 5);

  const { params, score } = await align({ photo, answer: answerImage, frame, exclude: oldArea });
  if (score < MIN_MATCH) {
    throw exposedError("The model changed more of the photo than the jewellery — try again.", "misaligned");
  }

  // The new piece, outlined in the aligned answer. Best-effort: without it the
  // old piece's area (grown wider) is all that is taken from the answer.
  const outlineSize = sizeFor(width, height, OUTLINE_SIDE);
  const aligned = await sharp(warpAnswer(answerImage, frame, params, outlineSize.w, outlineSize.h), {
    raw: { width: outlineSize.w, height: outlineSize.h, channels: 3 },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
  const newMask = await outline(aligned).catch(() => null);

  let outlinedNew = false;
  if (newMask) {
    const added = await maskAt(newMask, width, height);
    let share = 0;
    for (let i = 0; i < added.length; i++) if (added[i]) share++;
    if (share / added.length <= MAX_NEW_SHARE) {
      for (let i = 0; i < changed.length; i++) if (added[i]) changed[i] = 255;
      outlinedNew = true;
    } else {
      console.warn(`[photoComposite] ignoring an outline of the new piece covering ${Math.round((share / added.length) * 100)}% of the photo`);
    }
  }
  const alpha = await blur1(await blur1(changed, width, height, (outlinedNew ? grow : grow * 1.5) / 2, 5), width, height, feather);
  changed = null;

  // The changed area's box at full size — the only pixels that can differ from the photo.
  let bx0 = width;
  let by0 = height;
  let bx1 = -1;
  let by1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!alpha[y * width + x]) continue;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
    }
  }

  const out = Buffer.from(photo.data);
  if (bx1 >= 0) {
    // The colour correction, solved on a small grid: the drift is smooth.
    const grid = sizeFor(width, height, FINE_SIDE);
    const [photoSmall, answerSmall, alphaSmall] = await Promise.all([
      sharp(photo.data, { raw: { width, height, channels: 3 } }).resize(grid.w, grid.h, { fit: "fill" }).blur(1).raw().toBuffer(),
      sharp(warpAnswer(answerImage, frame, params, grid.w, grid.h), { raw: { width: grid.w, height: grid.h, channels: 3 } })
        .blur(1)
        .raw()
        .toBuffer(),
      resize1(alpha, width, height, grid.w, grid.h),
    ]);
    const inside = new Uint8Array(grid.w * grid.h);
    for (let i = 0; i < inside.length; i++) inside[i] = alphaSmall[i] > 0 ? 1 : 0;
    const field = colourField(photoSmall, answerSmall, growByOne(inside, grid.w, grid.h), grid.w, grid.h);

    const [a, b, tx, ty] = params;
    const fx = axisMap(width, frame.left, frame.innerWidth, frame.width);
    const fy = axisMap(height, frame.top, frame.innerHeight, frame.height);
    const px = [0, 0, 0];
    const fix = [0, 0, 0];
    for (let y = by0; y <= by1; y++) {
      const sy = (0.5 + b * (fy[y] - 0.5) + ty) * answerHeight - 0.5;
      const gy = ((y + 0.5) * grid.h) / height - 0.5;
      for (let x = bx0; x <= bx1; x++) {
        const i = y * width + x;
        const weight = alpha[i];
        if (!weight) continue;
        const sx = (0.5 + a * (fx[x] - 0.5) + tx) * answerWidth - 0.5;
        sample3(answerData, answerWidth, answerHeight, sx, sy, px);
        sample3(field, grid.w, grid.h, ((x + 0.5) * grid.w) / width - 0.5, gy, fix);
        const k = weight / 255;
        for (let c = 0; c < 3; c++) {
          const original = photo.data[i * 3 + c];
          const value = Math.min(255, Math.max(0, px[c] + fix[c]));
          out[i * 3 + c] = Math.round(original + (value - original) * k);
        }
      }
    }
  }

  // A PNG stays lossless; anything else is a near-lossless JPEG, so the
  // untouched pixels come back as they went in.
  const encoder = sharp(out, { raw: { width, height, channels: 3 } });
  const isPng = photo.mimeType === "image/png";
  const encoded = isPng
    ? await encoder.png({ compressionLevel: 8 }).toBuffer()
    : await encoder.jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer();

  return {
    output: { mimeType: isPng ? "image/png" : "image/jpeg", base64: encoded.toString("base64") },
    match: score,
    outlinedNew,
  };
}

module.exports = { decodeImage, prepareForModel, compositeIntoPhoto, exposedError };

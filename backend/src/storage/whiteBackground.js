const sharp = require("sharp");

/**
 * Makes a near-white product-shot background exactly #FFFFFF.
 *
 * Image models asked for "pure white" still hand back 244–250 off-white, a
 * faint warm or cool tint, or a pale grey vignette — invisible alone, obvious
 * beside a true-white catalogue page. The prompts ask for #FFFFFF (see
 * PURE_WHITE_NOTE in prompts/shared.js); this makes it so on the saved result.
 *
 * Only for an image whose background already is near-white and neutral: the
 * border is checked first, and anything with a scene, a hand, a coloured
 * backdrop or a deliberately cream or ivory one is left alone. And only
 * bright, colourless pixels move — gold, coloured stones and anything darker
 * than a light grey are untouched — with no hard edge where it stops:
 *
 *  1. The background's own colour is measured on the border, and bright
 *     neutral pixels are lifted so that colour lands on 255, 255, 255 — which
 *     takes out the tint and the off-white together.
 *  2. Light neutral pixels joined to the border (a vignette, the outer edge
 *     of a shadow) are eased the rest of the way: white from 244 up, unchanged
 *     at 232, smoothly between — so a soft shadow fades out instead of meeting
 *     the white at a line.
 */

/** A border pixel this light and this colourless counts as background. */
const BACKDROP_MIN = 225;
const BACKDROP_CHROMA = 10;
/** Share of the border that must be background for the image to qualify. */
const BORDER_SHARE = 0.85;
/** The most the background is lifted by — a darker one is a grey backdrop, not an off-white one. */
const MAX_LIFT = 1.09;
/** Step 2's ramp: unchanged at RAMP_LOW, white at RAMP_HIGH. */
const RAMP_LOW = 232;
const RAMP_HIGH = 244;
const RAMP_CHROMA = 14;

const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

function median(values) {
  const sorted = Float64Array.from(values).sort();
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

/**
 * The image with its background made pure white, as `{ buffer, mimeType }` in
 * the same format it came in — or null when it doesn't qualify (no near-white
 * neutral background, a transparent one) or is already pure white.
 */
async function purifyWhiteBackground(buffer, mimeType) {
  if (!/^image\/(png|jpe?g|webp)$/i.test(mimeType || "")) return null;
  const meta = await sharp(buffer).metadata();
  // A cut-out on transparency has no background to whiten.
  if (meta.hasAlpha) {
    const { isOpaque } = await sharp(buffer).stats();
    if (!isOpaque) return null;
  }

  const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  // ── is this a white-background shot? ──
  const depth = Math.max(2, Math.round(Math.min(width, height) * 0.01));
  const reds = [];
  const greens = [];
  const blues = [];
  let border = 0;
  let pure = 0;
  const sample = (x, y) => {
    const i = (y * width + x) * 3;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    border++;
    if (r === 255 && g === 255 && b === 255) pure++;
    if (Math.min(r, g, b) >= BACKDROP_MIN && Math.max(r, g, b) - Math.min(r, g, b) <= BACKDROP_CHROMA) {
      reds.push(r);
      greens.push(g);
      blues.push(b);
    }
  };
  for (let d = 0; d < depth; d++) {
    for (let x = 0; x < width; x++) {
      sample(x, d);
      sample(x, height - 1 - d);
    }
    for (let y = depth; y < height - depth; y++) {
      sample(d, y);
      sample(width - 1 - d, y);
    }
  }
  if (reds.length / border < BORDER_SHARE) return null;
  if (pure === border) return null;

  const lift = [median(reds), median(greens), median(blues)].map((value) => Math.min(255 / Math.max(value, 1), MAX_LIFT));

  // ── 1. lift bright neutrals so the background lands on white ──
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const low = Math.min(r, g, b);
    const weight = smoothstep(200, 235, low) * (1 - smoothstep(10, 22, Math.max(r, g, b) - low));
    if (weight <= 0) continue;
    data[i] = Math.min(255, Math.round(r + (r * lift[0] - r) * weight));
    data[i + 1] = Math.min(255, Math.round(g + (g * lift[1] - g) * weight));
    data[i + 2] = Math.min(255, Math.round(b + (b * lift[2] - b) * weight));
  }

  // ── 2. ease the light neutral region joined to the border up to white ──
  const light = (p) => {
    const i = p * 3;
    const low = Math.min(data[i], data[i + 1], data[i + 2]);
    return low >= RAMP_LOW && Math.max(data[i], data[i + 1], data[i + 2]) - low <= RAMP_CHROMA;
  };
  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const push = (p) => {
    if (!seen[p] && light(p)) {
      seen[p] = 1;
      queue[tail++] = p;
    }
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % width;
    const y = (p - x) / width;
    const i = p * 3;
    for (let c = 0; c < 3; c++) {
      const v = data[i + c];
      data[i + c] = Math.round(v + (255 - v) * smoothstep(RAMP_LOW, RAMP_HIGH, v));
    }
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (y > 0) push(p - width);
    if (y < height - 1) push(p + width);
  }

  const raw = sharp(data, { raw: { width, height, channels: 3 } });
  if (/png/i.test(mimeType)) return { buffer: await raw.png().toBuffer(), mimeType: "image/png" };
  if (/webp/i.test(mimeType)) return { buffer: await raw.webp({ quality: 95 }).toBuffer(), mimeType: "image/webp" };
  return { buffer: await raw.jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer(), mimeType: "image/jpeg" };
}

module.exports = { purifyWhiteBackground };

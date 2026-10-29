const sharp = require("sharp");
const { routeTextCall } = require("../aiRouting");

/**
 * Where in a photo the piece of jewellery is, as a vision model sees it.
 *
 * Gemini 2.5 can answer a segmentation prompt with a probability mask per
 * object: a box in 0–1000 coordinates and a small PNG covering that box. It
 * is coarse (the PNG is ~256px across the box) but it is aligned to the photo
 * by construction — the model returns where things are, it doesn't redraw
 * them — and it knows a white-gold band from a white backdrop, which no
 * amount of colour arithmetic can. The cutout uses it only to settle what
 * colour can't (see services/cutout.js); every edge colour can place, colour
 * places.
 *
 * Unreliable in one known way: some answers carry the model's internal mask
 * tokens ("<start_of_mask><seg_54>…") instead of a PNG, which nothing outside
 * Google can decode. Measured at about one answer in three, so several are
 * asked for at once and the first usable one wins.
 */

const SEGMENT_MODEL = "gemini-2.5-flash";

/** Long edge of the copy sent — the mask is coarse anyway, and a smaller image is a faster answer. */
const SEND_SIDE = 1024;

/** Asked at once; the first answer with a real PNG wins. */
const ATTEMPTS = 3;
const ROUNDS = 2;

const PROMPT =
  "Give the segmentation masks for the jewellery (the whole piece: metal, stones, band, prongs, bail and chain — not its shadow or reflection). " +
  'Output a JSON list of segmentation masks where each entry contains the 2D bounding box in the key "box_2d", the segmentation mask in key "mask", ' +
  'and the text label in the key "label". Use descriptive labels. Each "mask" must be a base64-encoded PNG image (starting with "data:image/png;base64,").';

/** The JSON list out of an answer that may be fenced or wrapped in prose. */
function parseList(text) {
  const cleaned = String(text || "").replace(/```(?:json)?/g, "");
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const list = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

/** An entry's `box_2d` as four finite numbers (y0, x0, y1, x1 in 0–1000), or null. */
function boxOf(item) {
  const box = Array.isArray(item?.box_2d) ? item.box_2d.map(Number) : null;
  return box && box.length === 4 && box.every((v) => Number.isFinite(v)) ? box : null;
}

/**
 * One answer → a full-frame mask at the sent copy's size, or null when the
 * answer has nothing usable in it.
 */
async function toFrameMask(list, width, height) {
  const frame = Buffer.alloc(width * height);
  let used = 0;
  for (const item of list) {
    const box = boxOf(item);
    const encoded = typeof item?.mask === "string" ? item.mask : "";
    if (!box || !encoded.includes("base64,")) continue;

    const [y0, x0, y1, x1] = box;
    const left = Math.max(0, Math.round((x0 / 1000) * width));
    const top = Math.max(0, Math.round((y0 / 1000) * height));
    const boxW = Math.min(width - left, Math.round(((x1 - x0) / 1000) * width));
    const boxH = Math.min(height - top, Math.round(((y1 - y0) / 1000) * height));
    if (boxW < 2 || boxH < 2) continue;

    let mask;
    try {
      mask = await sharp(Buffer.from(encoded.slice(encoded.indexOf("base64,") + 7), "base64"))
        .greyscale()
        .resize(boxW, boxH, { fit: "fill" })
        .extractChannel(0)
        .raw()
        .toBuffer();
    } catch {
      continue; // mask tokens, or a truncated PNG
    }
    for (let y = 0; y < boxH; y++) {
      for (let x = 0; x < boxW; x++) {
        const p = (top + y) * width + left + x;
        if (mask[y * boxW + x] > frame[p]) frame[p] = mask[y * boxW + x];
      }
    }
    used += 1;
  }
  if (!used) return null;
  // A mask with almost nothing in it is a failed answer, not an empty photo.
  let covered = 0;
  for (let p = 0; p < frame.length; p += 4) if (frame[p] > 127) covered += 1;
  return covered / (frame.length / 4) > 0.003 ? frame : null;
}

/**
 * The boxes in one answer, filled, as a full-frame mask at the sent copy's
 * size — or null when it has none. Coarse, but the boxes are right even when
 * the masks beside them are tokens.
 */
function toBoxMask(list, width, height) {
  const frame = Buffer.alloc(width * height);
  let used = 0;
  for (const item of list) {
    const box = boxOf(item);
    if (!box) continue;
    const [y0, x0, y1, x1] = box;
    const left = Math.max(0, Math.round((x0 / 1000) * width));
    const top = Math.max(0, Math.round((y0 / 1000) * height));
    const right = Math.min(width, Math.round((x1 / 1000) * width));
    const bottom = Math.min(height, Math.round((y1 / 1000) * height));
    if (right - left < 2 || bottom - top < 2) continue;
    for (let y = top; y < bottom; y++) frame.fill(255, y * width + left, y * width + right);
    used += 1;
  }
  return used ? frame : null;
}

/**
 * The piece's mask for `buffer`, as `{ data, width, height }` (one channel,
 * 0–255, covering the whole photo at the sent size), or null when no attempt
 * produced one. Never throws: the cutout simply goes on without it.
 *
 * `boxes: true` is for a caller that needs only where the piece is, not its
 * outline (Replacement): when every answer's masks are tokens, the boxes they
 * came with are filled instead, flagged `fromBoxes`. Off by default — a
 * cutout needs the outline itself, and a filled box would lift the backdrop
 * inside it out with the piece.
 */
async function segmentPiece({ tenant, buffer, boxes: allowBoxes = false }) {
  let send;
  try {
    send = await sharp(buffer, { failOn: "none" })
      .rotate()
      .resize({ width: SEND_SIDE, height: SEND_SIDE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 90 })
      .toBuffer({ resolveWithObject: true });
  } catch (err) {
    console.warn("[segmentation] could not prepare the photo:", err.message);
    return null;
  }
  const { width, height } = send.info;
  const image = { mimeType: "image/jpeg", base64: send.data.toString("base64") };

  const attempt = async () => {
    const { output } = await routeTextCall({
      tenant,
      modelId: SEGMENT_MODEL,
      images: [image],
      prompt: PROMPT,
      // Google's guidance for detection and segmentation: no thinking.
      thinkingBudget: 0,
      temperature: 0.2,
      // A base64 PNG per object is long; a short budget truncates it.
      maxOutputTokens: 30000,
    });
    if (output.blocked) throw new Error("segmentation answer was blocked");
    const list = parseList(output.text);
    const mask = list ? await toFrameMask(list, width, height) : null;
    if (mask) return { data: mask, width, height };
    // Whoever asked for boxes is served by the first answer with any — not
    // kept waiting on a slower attempt that might still bring a mask.
    const boxed = allowBoxes && list ? toBoxMask(list, width, height) : null;
    if (boxed) return { data: boxed, width, height, fromBoxes: true };
    throw new Error("segmentation answer had no usable mask");
  };

  // Two rounds at most: a photo the model keeps answering in mask tokens is
  // not worth a third wait, and colour alone is a fair cut for most pieces.
  for (let round = 1; round <= ROUNDS; round++) {
    try {
      const found = await Promise.any(Array.from({ length: ATTEMPTS }, attempt));
      if (found.fromBoxes) console.warn("[segmentation] using the answer's boxes instead of a mask");
      return found;
    } catch (err) {
      const reasons = err?.errors?.map((entry) => entry.message).join("; ") || err.message;
      console.warn(`[segmentation] round ${round}/${ROUNDS} gave no usable mask:`, reasons);
    }
  }
  if (!allowBoxes) console.warn("[segmentation] cutting out by colour alone");
  return null;
}

module.exports = { segmentPiece };

const { isOwnPublicUrl } = require("../storage/ownUrl");

/**
 * The Live Lookbook document: checking what the builder saves, and shaping
 * what the public page is sent.
 *
 * The document's shape is the frontend's (lib/lookbook/types.ts), and the
 * builder already fills every default, so this does not re-describe each card
 * field by field. It enforces what matters on a page that anyone with the
 * link can open:
 *
 *   · Bounded size. A save is capped as a whole (MAX_DESIGN_BYTES, like
 *     Marketing Kit's MAX_DESIGN_BYTES), and so is every string, list and
 *     level of nesting.
 *   · Pictures are Sparkle's own. Every `url`, `thumbnailUrl` and `posterUrl`
 *     must point into this app's public bucket, or the picture is dropped. A
 *     public page can't be made to load a tracking pixel or hotlink another
 *     site, and no `data:` blob gets stored inline.
 *   · Colours are colours. A `…Color` field must be a hex value, because the
 *     page writes it into a style attribute.
 *   · Links are web links. A "link" button must be http(s). The page builds
 *     the WhatsApp, email and phone links itself, from their bare values.
 *
 * The renderer escapes text and re-checks colours and links on its own side
 * too. This is the server's half of the same rule, not the only half.
 */

/** A whole saved page, serialised. Pictures are urls, so a long page is tens of KB, nowhere near this. */
const MAX_DESIGN_BYTES = 500_000;
const MAX_CARDS = 60;
const MAX_LIST = 60;
const MAX_STRING = 5000;
const MAX_DEPTH = 8;
const MAX_KEYS = 60;

const CARD_TYPES = ["hero", "gallery", "spotlight", "before_after", "video", "story", "specs", "contact", "spacer"];
const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const URL_KEYS = new Set(["url", "thumbnailUrl", "posterUrl"]);
// Control characters other than tab and newline: never typed, and some break a page's layout.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

class DesignError extends Error {
  constructor(message, code = "invalid_design") {
    super(message);
    this.code = code;
  }
}

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * A design as the builder sends it: a JSON string. Sent as a string rather
 * than as nested JSON because requireAuth rewrites any body string starting
 * with "stored:" into image bytes (middleware/inlineImages.js), and a
 * paragraph of a page's own text may begin that way.
 */
function parseDesign(raw) {
  if (typeof raw !== "string") throw new DesignError("The page could not be read");
  if (raw.length > MAX_DESIGN_BYTES) {
    throw new DesignError("This page is too large to save. Remove some cards and try again.", "design_too_large");
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new DesignError("The page could not be read");
  }
  return sanitizeDesign(value);
}

function sanitizeDesign(value) {
  if (!isPlainObject(value) || value.version !== 1) throw new DesignError("This page is in a format Sparkle doesn't know");

  const cards = (Array.isArray(value.cards) ? value.cards : [])
    .filter((card) => isPlainObject(card) && CARD_TYPES.includes(card.type) && typeof card.id === "string" && card.id)
    .slice(0, MAX_CARDS)
    .map((card) => ({ ...clean(card, 1), id: card.id.slice(0, 40), type: card.type }));

  return {
    version: 1,
    theme: isPlainObject(value.theme) ? clean(value.theme, 1) : {},
    cards,
    meta: isPlainObject(value.meta) ? clean(value.meta, 1) : {},
  };
}

function clean(value, depth, key) {
  if (depth > MAX_DEPTH) return undefined;
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") return cleanString(value, key);
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_LIST)
      .map((item) => clean(item, depth + 1, key))
      .filter((item) => item !== undefined && item !== null);
  }
  if (isPlainObject(value)) {
    const out = {};
    let kept = 0;
    for (const [childKey, child] of Object.entries(value)) {
      if (kept >= MAX_KEYS) break;
      if (!KEY_PATTERN.test(childKey)) continue;
      const cleaned = clean(child, depth + 1, childKey);
      if (cleaned === undefined) continue;
      out[childKey] = cleaned;
      kept += 1;
    }
    return cleanShape(out);
  }
  return undefined;
}

function cleanString(value, key) {
  const text = value.replace(CONTROL_CHARS, "").slice(0, MAX_STRING);
  if (key && URL_KEYS.has(key)) return isOwnPublicUrl(text) ? text : null;
  if (key && /color$/i.test(key)) return HEX_COLOR.test(text) ? text : null;
  // Pictures travel as uploads, never inline.
  if (text.startsWith("data:")) return "";
  return text;
}

/** Rules that look at more than one field of an object. */
function cleanShape(object) {
  // A picture or clip whose original isn't one of ours is no picture.
  if ((object.kind === "image" || object.kind === "video") && "url" in object && !object.url) return null;
  // A "link" button opens a web address and nothing else — no javascript:, no data:.
  if (object.kind === "link" && typeof object.value === "string" && !/^https?:\/\/\S+$/i.test(object.value.trim())) {
    return { ...object, value: "" };
  }
  return object;
}

/**
 * What the public page is sent, from the saved design.
 *
 * Hidden cards are dropped, and a price the owner chose to hide is removed,
 * not merely flagged. A flag would still put the number in the page's
 * source, one "view source" away from the client it was hidden from.
 */
function publicDesign(design) {
  const cards = (design?.cards || [])
    .filter((card) => !card.hidden)
    .map((card) => {
      if (card.type === "specs" && !card.showPrices) {
        return { ...card, rows: (card.rows || []).map((row) => ({ ...row, price: "" })) };
      }
      if (card.type === "spotlight" && !card.showPrice) return { ...card, price: "" };
      return card;
    });
  return { version: 1, theme: design?.theme || {}, cards, meta: design?.meta || {} };
}

/** Every picture on a page, in page order — the first one with a stored original. */
function firstMedia(design, { kinds = ["image"] } = {}) {
  for (const card of design?.cards || []) {
    const candidates = [card.media, card.after, card.before, ...(card.items || []).map((item) => item?.media)];
    const found = candidates.find((media) => media && kinds.includes(media.kind) && media.url);
    if (found) return found;
  }
  return null;
}

/** The small picture a list of lookbooks shows for this one. */
function coverOf(design) {
  const media = firstMedia(design, { kinds: ["image", "video"] });
  if (!media) return null;
  return media.kind === "video" ? media.posterUrl || null : media.thumbnailUrl || media.url;
}

module.exports = {
  MAX_DESIGN_BYTES,
  CARD_TYPES,
  DesignError,
  parseDesign,
  sanitizeDesign,
  publicDesign,
  firstMedia,
  coverOf,
};

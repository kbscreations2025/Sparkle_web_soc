/**
 * Styled on Model's choices. The ids and the pose order must match the
 * backend's prompts/onModel.js, which describes each to the model.
 */

/** The backend's MAX_ON_MODEL_PIECES. */
export const MAX_ON_MODEL_PIECES = 12;

/** Past this, fine details start to blur in one frame — the page suggests splitting the look. */
export const ON_MODEL_SOFT_LIMIT = 6;

/** How many images one run can make — the backend's MAX_ON_MODEL_IMAGES. */
export const ON_MODEL_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];

/** What each uploaded piece is. "auto" leaves it to the photo. */
export const PIECE_TYPES = [
  { id: "auto", label: "Auto-detect" },
  { id: "ring", label: "Ring" },
  { id: "earrings", label: "Earrings" },
  { id: "necklace", label: "Necklace" },
  { id: "pendant", label: "Pendant" },
  { id: "bracelet", label: "Bracelet / bangle" },
  { id: "charm", label: "Charm" },
  { id: "anklet", label: "Anklet" },
] as const;

export type PieceType = (typeof PIECE_TYPES)[number]["id"];

/** How the pieces are worn together. */
export const ARRANGEMENTS = [
  { id: "auto", label: "Auto", hint: "Each piece where it belongs — necklaces layered, rings spread across fingers, bracelets stacked, charms on one chain." },
  { id: "set", label: "Matching set", hint: "Worn together as one complete set — earrings, necklace, ring, bracelet, each in its place." },
  { id: "layered", label: "Layered necklaces", hint: "Every necklace and pendant at graduated lengths — shows customers how to layer them." },
  { id: "charms", label: "Charms on one chain", hint: "All the charms gathered together on a single necklace." },
  { id: "stacked", label: "Stacked rings & bracelets", hint: "Rings across her fingers and bracelets stacked on one wrist, hands close to the camera." },
] as const;

/** The cinematic colour grade. Swatches are a hint of each look. */
export const TONES = [
  { id: "warm_cinematic", label: "Warm cinematic", swatch: "linear-gradient(135deg,#f2c27b,#7a4a2a)" },
  { id: "soft_editorial", label: "Soft editorial", swatch: "linear-gradient(135deg,#f6efe6,#d6c3ad)" },
  { id: "moody", label: "Moody low-light", swatch: "linear-gradient(135deg,#5a3f2b,#0f0b09)" },
  { id: "golden_hour", label: "Golden hour", swatch: "linear-gradient(135deg,#ffd37f,#d3714a)" },
  { id: "riviera", label: "Sunlit Riviera", swatch: "linear-gradient(135deg,#f7f2e8,#5d90b9)" },
  { id: "evening", label: "Evening glamour", swatch: "linear-gradient(135deg,#55391f,#141018)" },
] as const;

/** One pose per image, in the order the backend uses them. */
export const ON_MODEL_POSES = [
  "Open shirt, below the chin",
  "Hand at the jaw",
  "Chin on wrist",
  "Lapel pull",
  "Hair sweep",
  "Over the shoulder",
  "Collarbone close-up",
  "Leaning in",
] as const;

/** Ideas that fill the description box with one click. */
export const ON_MODEL_BRIEF_IDEAS = [
  "South Asian model with long dark hair, black silk top, a Paris balcony at dusk",
  "Red-haired model in an oversized white shirt, a sunlit loft with linen curtains",
  "Model in a sharp black blazer, moody hotel-bar lighting",
  "Freckled model in a cream knit, golden hour by the sea",
];

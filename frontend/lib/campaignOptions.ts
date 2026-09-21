/**
 * Campaign Kit's styling options, as the picker shows them.
 *
 * The ids are the contract with `backend/src/prompts/campaignKit.js`, which
 * holds the prompt wording each one actually sends — an id the backend
 * doesn't recognise falls back rather than failing the run. Only the labels
 * live here, so a wording change never needs a frontend deploy.
 */

/** A colour chip beside each box, so the lining is picked by eye. */
export const BOX_STYLE_OPTIONS = [
  { id: "none", label: "No box", swatch: "transparent" },
  { id: "white-velvet", label: "White Velvet", swatch: "#f2efe9" },
  { id: "cream-velvet", label: "Cream Velvet", swatch: "#e8dcc0" },
  { id: "navy-velvet", label: "Navy Velvet", swatch: "#1c2b4a" },
  { id: "black-velvet", label: "Black Velvet", swatch: "#161616" },
  { id: "charcoal-velvet", label: "Charcoal Velvet", swatch: "#33343a" },
  { id: "burgundy-velvet", label: "Burgundy Velvet", swatch: "#5c1a2b" },
  { id: "emerald-velvet", label: "Emerald Velvet", swatch: "#1f4d3a" },
  { id: "rose-velvet", label: "Rose Velvet", swatch: "#d9a8ab" },
  { id: "champagne-satin", label: "Champagne Satin", swatch: "#e6d3a3" },
  { id: "gold-velvet", label: "Gold Velvet", swatch: "#a1782e" },
  { id: "grey-suede", label: "Grey Suede", swatch: "#8a8781" },
  { id: "plum-velvet", label: "Plum Velvet", swatch: "#4a2545" },
] as const;

/**
 * Poses for the two lifestyle shots. "Auto" is sent as no pick at all,
 * which is what makes the backend choose two different poses for the pair
 * rather than the same one twice.
 */
export const POSE_OPTIONS = [
  { id: "auto", label: "Auto (Varied)" },
  { id: "hand-near-face", label: "Hand Near Face" },
  { id: "over-shoulder", label: "Over-the-Shoulder" },
  { id: "profile-gaze", label: "Profile Gaze" },
  { id: "collarbone-touch", label: "Collarbone Touch" },
  { id: "candid-laugh", label: "Candid Laugh" },
  { id: "chin-tilt", label: "Chin Tilt" },
  { id: "walking-motion", label: "Walking Motion" },
  { id: "hand-in-hair", label: "Hand in Hair" },
] as const;

/** Styling for the two studio shots. "None" keeps the piece bare on the backdrop. */
export const STUDIO_PROP_OPTIONS = [
  { id: "auto", label: "Auto (Varied)" },
  { id: "none", label: "None — Bare" },
  { id: "pearls", label: "Scattered Pearls" },
  { id: "flowers", label: "Fresh Flowers" },
  { id: "ribbon", label: "Silk Ribbon" },
  { id: "draped-chain", label: "Draped Chain" },
  { id: "botanicals", label: "Dried Botanicals" },
  { id: "mirror", label: "Mirror Reflection" },
  { id: "water", label: "Water Droplets" },
  { id: "silk-fabric", label: "Draped Silk" },
] as const;

/**
 * `w`/`h` are the glyph the chip draws, the same shapes the image tools
 * show — the outline is what tells 4:5 from 9:16 at a glance, so the picker
 * looks and reads the same wherever a shape is chosen.
 */
export const CAMPAIGN_ASPECTS = [
  { id: "square", label: "1:1", w: 14, h: 14 },
  { id: "portrait", label: "4:5", w: 12, h: 15 },
  { id: "landscape", label: "16:9", w: 18, h: 10 },
  { id: "story", label: "9:16", w: 9, h: 16 },
] as const;

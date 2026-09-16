const { buildReferenceNote } = require("./shared");

/** Maps the Visual Style chip to a prompt fragment describing that look. */
const STYLE_GUIDE = {
  photorealistic: "photorealistic, professional product photography, ultra-sharp",
  "product-studio": "clean white studio background, soft box lighting, luxury product shot",
  "luxury-campaign": "luxury brand campaign, editorial lighting, high fashion, cinematic",
  "dark-velvet": "dark velvet background, dramatic moody lighting, deep shadows",
  "warm-gold": "warm golden light, honey tones, lifestyle luxury photography",
  "ice-editorial": "ice blue background, cool tones, editorial fashion jewellery",
};

/** Maps the Aspect Ratio chip to the framing instruction Gemini responds to. */
const ASPECT_TEXT = {
  square: "square 1:1 aspect ratio",
  landscape: "wide 16:9 landscape aspect ratio",
  portrait: "tall 4:5 portrait aspect ratio",
  story: "tall 9:16 vertical aspect ratio",
};

/**
 * Nudges each parallel variation toward a distinct shot rather than near-
 * identical duplicates, without asking for a different design — only appended
 * when more than one image was requested.
 */
function variationNote(count) {
  if (count <= 1) return "";
  return " Generate a single distinct hero shot for this variation — vary the framing or angle subtly from the other variations while keeping the same jewelry design.";
}

/** Builds the prompt for an initial (non-refinement) generation. */
function buildTextToImagePrompt({ description, style, aspect, count = 1 }) {
  const desc =
    description?.trim() ||
    "an elegant, beautifully designed piece of fine jewelry — the artist's own tasteful choice of type, metal, stones and setting";
  const enriched = `${desc}. ${STYLE_GUIDE[style] || ""}. Fine jewellery photography, high resolution.`;
  const aspectNote = ASPECT_TEXT[aspect] || ASPECT_TEXT.square;
  return (
    `${enriched} Image orientation: ${aspectNote}. Show the complete piece from a single fixed elegant hero angle, ` +
    `fully framed with nothing cropped.${variationNote(count)}`
  );
}

/** Wraps a refinement instruction the same way Image Cleaning's refine step does. */
function buildTextToImageRefinePrompt({ instruction, referenceCount = 0 }) {
  return (
    `Modify this jewelry photograph (the first image): ${instruction}. ` +
    "Keep the same photorealistic product photography quality, composition, and style. Only apply the specifically requested changes." +
    buildReferenceNote(referenceCount)
  );
}

module.exports = { buildTextToImagePrompt, buildTextToImageRefinePrompt, STYLE_GUIDE, ASPECT_TEXT };

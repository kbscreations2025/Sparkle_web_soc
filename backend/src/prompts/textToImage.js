const { buildReferenceNote } = require("./shared");

/** Maps the Visual Style chip to a prompt fragment describing that look. */
const STYLE_GUIDE = {
  photorealistic: "photorealistic, professional product photography, ultra-sharp",
  "product-studio": "clean white studio background, soft box lighting, luxury product shot",
  "luxury-campaign": "luxury brand campaign, editorial lighting, high fashion, cinematic",
  "dark-velvet": "dark velvet background, dramatic moody lighting, deep shadows",
};

/**
 * The jewel-toned velvets "Dark Velvet" draws from — one at random per image,
 * so a run doesn't come back on the same black cloth every time.
 */
const VELVET_COLOURS = [
  "deep navy blue",
  "rich maroon",
  "emerald green",
  "royal purple",
  "burgundy wine",
  "midnight black",
  "deep teal",
  "dark forest green",
  "plum",
  "sapphire blue",
  "oxblood red",
  "charcoal grey",
];

/** The look for a style — "Dark Velvet" with a velvet colour picked for this image. */
function styleGuideFor(style) {
  if (style !== "dark-velvet") return STYLE_GUIDE[style] || "";
  const colour = VELVET_COLOURS[Math.floor(Math.random() * VELVET_COLOURS.length)];
  return `${colour} velvet background with a soft plush texture, dramatic moody lighting, deep shadows`;
}

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
function buildTextToImagePrompt({ description, style, aspect, count = 1, hasReference = false }) {
  const desc =
    description?.trim() ||
    (hasReference
      ? "Recreate the attached reference piece faithfully as a finished photograph"
      : "an elegant, beautifully designed piece of fine jewelry — the artist's own tasteful choice of type, metal, stones and setting");
  const enriched = `${desc}. ${styleGuideFor(style)}. Fine jewellery photography, high resolution.`;
  const aspectNote = ASPECT_TEXT[aspect] || ASPECT_TEXT.square;
  const prompt =
    `${enriched} Image orientation: ${aspectNote}. Show the complete piece from a single fixed elegant hero angle, ` +
    `fully framed with nothing cropped.${variationNote(count)}`;

  // Same wording as Text to Sketch's reference, so the two tools treat a
  // starting photo alike: the photo sets the design, the brief overrides it.
  return hasReference
    ? `A reference jewellery photo is attached — keep that exact design (its jewelry type, silhouette, stones, setting and details) and change only what the design brief below asks for. Where the brief specifies something, it wins over the reference; everything it does not mention stays as in the photo.\n\n${prompt}`
    : prompt;
}

/**
 * What each design variation changes — one per image, in turn, so a run of
 * four comes back as four different design options rather than one design
 * four times.
 */
const VARIATION_FOCI = [
  "redesign the setting — a different way of holding the main stone (for example bezel, prongs of a different style, a halo or a raised basket)",
  "redesign the band or body — a different profile, width, split, twist, or pavé and texture treatment",
  "redesign the stone layout — a different arrangement of the stones: side stones, a halo, a cluster, or a different main stone shape",
  "redesign the decorative details — different gallery, milgrain, engraving, openwork or motif work, giving it a fresh character",
  "reimagine the overall silhouette — a bolder or more delicate proportion while keeping the same spirit",
  "combine two of these changes — setting and band — for a clearly new design option",
];

/**
 * A new design option grown out of the reference photo: same kind of piece
 * and the same design language, but a genuinely different design — not the
 * same piece from another angle.
 */
function buildTextToImageVariationPrompt({ description, style, aspect, index = 0, total = 1 }) {
  const focus = VARIATION_FOCI[index % VARIATION_FOCI.length];
  const aspectNote = ASPECT_TEXT[aspect] || ASPECT_TEXT.square;
  const brief = description?.trim();

  return [
    `A reference jewellery photo is attached. Create design option ${index + 1} of ${total}: a NEW jewellery design inspired by the reference — not a copy of it and not the same piece from a different angle.`,
    "Keep from the reference: the type of piece (a ring stays a ring), its overall style and design language, the metal colour and the main stone, unless the brief below says otherwise.",
    `For this option, ${focus}. The change must be clearly visible, so this design is easy to tell apart from the reference and from the other options.`,
    brief ? `Design brief to apply on top: ${brief}.` : "",
    `${styleGuideFor(style)}. Fine jewellery photography, high resolution. Image orientation: ${aspectNote}.`,
    "Show the complete piece from a single, standard elegant hero angle similar to the reference, fully framed with nothing cropped.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Wraps a refinement instruction the same way Image Cleaning's refine step does. */
function buildTextToImageRefinePrompt({ instruction, referenceCount = 0 }) {
  return (
    `Modify this jewelry photograph (the first image): ${instruction}. ` +
    "Keep the same photorealistic product photography quality, composition, and style. Only apply the specifically requested changes." +
    buildReferenceNote(referenceCount)
  );
}

module.exports = { buildTextToImagePrompt, buildTextToImageVariationPrompt, VARIATION_FOCI, buildTextToImageRefinePrompt, STYLE_GUIDE, ASPECT_TEXT };

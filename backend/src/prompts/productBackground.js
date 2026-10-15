/**
 * Product Background's prompts.
 *
 * Every one of them is an instruction to change what is *around* a piece of
 * jewellery and nothing *about* it. The customer's real product is the
 * subject: a background tool that quietly redesigns the ring has produced a
 * photo of a different ring. Hence the preservation block every prompt
 * carries, worded as the cleaning prompts word it.
 *
 * Plain backgrounds (transparent, white, a colour) mostly don't come here at
 * all — the piece is cut out of the photo's own pixels and composited (see
 * services/cutout.js). A model is only asked to move a piece onto plain white
 * first when its photo is too busy to cut from directly.
 */

const PRESERVE =
  "PRESERVATION — the most important rule: the jewellery must stay EXACTLY as it is in the photo. Same design, shape and proportions; " +
  "same metal colour and finish; every stone identical in count, cut, size, colour and position; same setting, prongs, gallery, bail, " +
  "clasp, chain links, engraving and texture; same viewing angle. Do not redesign, simplify, straighten, repair, add or remove anything on the piece.";

const NO_EXTRAS = "No text, logos, watermarks, borders, hands, people or extra jewellery.";

/**
 * The scenes on offer. `scene` is what the model is told; `label` and `hint`
 * are for the picker — kept here so the two lists can't drift apart (the
 * frontend reads them from /api/product-background/themes).
 */
const THEMES = [
  {
    id: "marble",
    label: "Marble",
    hint: "White Carrara, soft daylight",
    scene: "a polished white Carrara marble surface with soft grey veining, bright diffused daylight from one side, a gentle natural shadow under the piece",
  },
  {
    id: "velvet",
    label: "Velvet",
    hint: "Deep jewel-tone velvet",
    scene: "rich deep-emerald velvet with soft folds, like a fine jewellery boutique display, warm directional light that makes the metal glow",
  },
  {
    id: "silk",
    label: "Silk",
    hint: "Draped champagne satin",
    scene: "softly draped champagne silk satin with gentle folds and a subtle sheen, warm soft light",
  },
  {
    id: "podium",
    label: "Podium",
    hint: "Minimal display plinth",
    scene: "a minimal cream cylindrical display podium with soft geometric shadows against a pale pastel backdrop — premium e-commerce styling",
  },
  {
    id: "wood",
    label: "Wood",
    hint: "Warm walnut, window light",
    scene: "a warm natural walnut wood surface with fine grain, soft window light, shallow depth of field",
  },
  {
    id: "stone",
    label: "Slate",
    hint: "Dark stone, editorial",
    scene: "a dark slate stone surface with subtle texture, moody editorial lighting with one soft highlight",
  },
  {
    id: "mirror",
    label: "Mirror",
    hint: "Black glass reflection",
    scene: "a glossy black reflective glass surface showing a clean mirror reflection of the piece, dark seamless studio backdrop",
  },
  {
    id: "botanical",
    label: "Botanical",
    hint: "Leaves and linen",
    scene: "fresh green leaves and soft dappled botanical shadows on a light linen surface, natural daylight",
  },
  {
    id: "bridal",
    label: "Bridal",
    hint: "Ivory petals and lace",
    scene: "soft white rose petals and delicate ivory lace, romantic bridal mood, soft diffused light",
  },
  {
    id: "festive",
    label: "Festive",
    hint: "Golden bokeh, marigolds",
    scene: "warm golden bokeh lights and a few marigold petals on a rich surface — a celebratory Indian festive mood",
  },
  {
    id: "beach",
    label: "Beach",
    hint: "Sand, sun and sea",
    scene: "smooth pale sand in warm sunlight with a softly blurred turquoise sea behind",
  },
  {
    id: "gradient",
    label: "Studio",
    hint: "Seamless soft gradient",
    scene: "a seamless studio sweep with a soft gradient from warm beige to light cream, professional studio lighting and a soft natural contact shadow",
  },
];

const THEME_BY_ID = new Map(THEMES.map((theme) => [theme.id, theme]));

/** What changes between versions of the same scene, so four aren't four copies. */
const VARIATION_NOTES = [
  "Arrange the setting simply, with the piece centred.",
  "Vary the composition: a slightly different arrangement of the surroundings and a different light direction.",
  "Vary the composition: a closer, more intimate framing of the setting with softer light.",
  "Vary the composition: a wider, airier framing with the setting styled differently.",
];

/**
 * A piece placed into a scene — a preset, the person's own words, or a
 * backdrop photo they supplied as the second image.
 */
function buildScenePrompt({ themeId, customScene, hasBackdrop, index = 0, total = 1 }) {
  const theme = THEME_BY_ID.get(themeId);
  const scene = customScene?.trim() || theme?.scene || THEMES[0].scene;

  const setting = hasBackdrop
    ? "Place THIS EXACT piece of jewellery (the first image) naturally into the second image, which is the background to use. " +
      "Keep the second image's scene as it is; match its perspective, light direction and colour temperature, and give the piece a realistic contact shadow " +
      `or reflection where it rests.${customScene?.trim() ? ` The person adds: ${customScene.trim()}` : ""}`
    : `Create a premium jewellery product photograph by placing THIS EXACT piece of jewellery (the first image) into this setting: ${scene}.`;

  return [
    setting,
    PRESERVE,
    "Only the surroundings change, and the light where the piece meets them (its shadow or reflection on the new surface). " +
      "The piece is the hero: sharply in focus, well lit, centred with comfortable space around it; the setting complements it and never competes with it.",
    total > 1 ? `This is version ${index + 1} of ${total}. ${VARIATION_NOTES[index % VARIATION_NOTES.length]}` : "",
    NO_EXTRAS,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * A busy photo moved onto plain white, only so it can be cut out cleanly.
 * Flat and shadowless on purpose: anything that isn't the piece must read as
 * backdrop to the cutout that follows.
 */
const PLAIN_WHITE_PROMPT = [
  "Put this exact piece of jewellery on a perfectly plain, flat, uniform pure white (#FFFFFF) background. " +
    "Remove everything that is not the jewellery — hands, skin, clothing, props, display stands, surfaces, text. " +
    "Where something hid part of the piece (a neck behind a chain, fingers around a band), complete the piece faithfully and only from what is visible.",
  PRESERVE,
  "Keep the piece at the same size and position in the frame. No shadow, no reflection, no gradient and no vignette: the entire background is one flat white.",
  NO_EXTRAS,
].join("\n\n");

/** A follow-up typed in the chat, applied to the latest result. */
function buildRefinePrompt({ instruction }) {
  return [
    `Edit this jewellery product photograph (the first image) as follows: ${instruction}.`,
    "This is a background tool: change the background, setting, lighting or framing as asked.",
    PRESERVE,
    "Apply only the requested change and keep everything else as it is.",
    NO_EXTRAS,
  ].join("\n\n");
}

module.exports = { THEMES, THEME_BY_ID, buildScenePrompt, buildRefinePrompt, PLAIN_WHITE_PROMPT };

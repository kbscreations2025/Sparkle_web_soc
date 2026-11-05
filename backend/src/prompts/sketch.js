const {
  PENCIL_MASTER_PROMPT,
  GOUACHE_MASTER_PROMPT,
  CHARCOAL_MASTER_PROMPT,
  INK_MASTER_PROMPT,
} = require("./sketchMasterPrompts");
const { buildReferenceNote, PURE_WHITE_NOTE, ONE_OPTION_NOTE } = require("./shared");
const { RELATED_DIRECTIONS } = require("./intent");
const { VARIATION_FOCI, referenceNote } = require("./textToImage");

/**
 * The instructions behind the three sketch tools.
 *
 * Text to Sketch and Image to Sketch both draw, but from different starting
 * points — a written brief versus a photograph — so each has its own framing
 * around the same four master prompts. Sketch to Image goes the other way and
 * shares nothing with them.
 *
 * The two `STYLE_GUIDE` maps below look like duplicates and are not: they
 * describe the same four media for different jobs, in different words, and are
 * the fallback only for a style id the UI no longer offers. Kept apart on
 * purpose.
 */

const MASTER_PROMPTS = {
  pencil: PENCIL_MASTER_PROMPT,
  gouache: GOUACHE_MASTER_PROMPT,
  charcoal: CHARCOAL_MASTER_PROMPT,
  ink: INK_MASTER_PROMPT,
};

const ASPECT_TEXT = {
  square: "Square 1:1 composition",
  portrait: "Tall 4:5 portrait composition",
  landscape: "Wide 16:9 landscape composition",
  story: "Tall 9:16 vertical composition",
};

/** Nudges parallel variations apart without asking for a different design. */
function variationNote(count) {
  if (count <= 1) return "";
  return " Generate a single distinct rendering for this variation — vary the framing or angle subtly from the other variations while keeping the same design.";
}

// ── Text to Sketch ──────────────────────────────────────────────────────────

/** Each sketch style: the drawing technique + the surface it is drawn on. */
const TEXT_SKETCH_STYLE_GUIDE = {
  pencil: {
    desc: "A rough hand-drawn pencil sketch, drawn with a soft  HB graphite pencil on slightly textured off-white sketchbook paper. Loose, gestural linework with visible construction lines, uneven pressure, and light cross-hatching for shading. Some lines are sketchy and doubled-up, a few smudges of graphite, imperfect and unfinished in places. Monochrome greyscale, no color. Looks like a quick artists study, not a polished render.",
    paper: "bright white fine-art paper",
  },
  gouache: { desc: "", paper: "toned grey or deep-black illustration board" },
  ink: {
    desc: "a clean pen-and-ink line illustration — confident, precise linework with fine stippling and hatching for shading",
    paper: "smooth white paper",
  },
  charcoal: {
    desc: "a soft charcoal drawing — rich velvety blacks, smudged atmospheric shadows and dramatic high-contrast lighting",
    paper: "lightly textured warm off-white paper",
  },
};

function buildTextToSketchPrompt({ description, style, aspect, count = 1, hasReference }) {
  const aspectNote = ASPECT_TEXT[aspect] ?? ASPECT_TEXT.square;

  const brief = `JEWELLERY DESIGN BRIEF (this is the exact design to draw — read it closely and follow every specified detail precisely: jewelry type, metal, center stone type/shape/size, setting and prong style, accent or side stones, and any other described element. Do not invent, substitute, omit or alter any design detail the brief specifies; only fill in genuinely unspecified details with sensible, elegant choices. Pay special attention to any exact number stated in the brief — e.g. a stated prong count such as "6 Prong" or "4 Prong" means the finished ring must show exactly that many prongs, clearly countable around the center stone; the same exactness applies to stated stone counts, carat sizes, and any other numeric spec): ${description}.`;

  const master = MASTER_PROMPTS[style];
  let prompt = master
    ? `${brief}\n\n${master}\n\n${aspectNote}.`
    : buildGenericSketchPrompt(brief, TEXT_SKETCH_STYLE_GUIDE[style] ?? TEXT_SKETCH_STYLE_GUIDE.pencil, aspectNote);

  prompt += variationNote(count);

  if (hasReference) prompt = `${referenceNote(hasReference)}\n\n${prompt}`;

  return prompt;
}

/**
 * "Make variations" on a reference photo: design option `index` of `total`,
 * a new design grown out of the reference and drawn in the chosen medium —
 * each option changing a different part (see VARIATION_FOCI).
 */
function buildTextToSketchVariationPrompt({ description, style, aspect, index = 0, total = 1 }) {
  const focus = VARIATION_FOCI[index % VARIATION_FOCI.length];
  const brief = description?.trim();
  const sketch = buildTextToSketchPrompt({
    description: brief
      ? `a new design option based on the attached reference piece, with this direction applied: ${brief}`
      : "a new design option based on the attached reference piece",
    style,
    aspect,
    count: 1,
    hasReference: false,
  });

  return [
    `A reference jewellery photo is attached. Draw design option ${index + 1} of ${total}: a NEW jewellery design inspired by the reference — not a copy of it and not the same piece from a different angle.`,
    "Keep from the reference: the type of piece (a ring stays a ring), its overall style and design language, the metal and the main stone, unless the brief says otherwise.",
    `For this option, ${focus}. The change must be clearly visible, so this design is easy to tell apart from the reference and from the other options.`,
    "",
    sketch,
  ].join("\n");
}

/** Fallback for a style id with no master prompt of its own. */
function buildGenericSketchPrompt(brief, style, aspectNote) {
  return `${brief}

STYLE — Render as ${style.desc}, drawn by a master jeweler on ${style.paper} as a polished presentation illustration.

RENDER THE PIECE AS A REALISTIC THREE-DIMENSIONAL OBJECT (never a flat outline):
- Convey true volume and depth through graduated tonal shading — soft mid-tones and deep core shadows built up by hand with hatching and blending, the way a jeweler's pencil sketch does.
- Suggest the metal's form (yellow / white / rose gold or platinum) with matte tonal gradients and gentle shading only — never glossy, mirror-like, or reflective.
- Draw every gemstone with clean individual facet line-work and soft internal tonal shading to imply the cut. Colored stones are shown with even, muted hand-shaded tone in their hue.
- Define all structural detail with precision: prongs, bezels, gallery, basket, milgrain, pavé stones, filigree, engraving, and the exact profile of the band or chain.

NO SHINE — CRITICAL:
- This is a hand-drawn sketch, NOT a photograph. Do NOT add bright white specular highlights, sparkle glints, twinkle or starburst marks, lens flare, or glossy reflective shine anywhere on the stones or the metal.
- All sense of depth, cut and material comes ONLY from matte pencil/graphite tonal shading and facet line-work — there are no shiny hotspots, no glare, and no white star sparkles.

COMPOSITION & PRESENTATION:
- The jewelry piece is the sole hero — centered and shown at a single fixed, elegant three-quarter hero angle that fully reveals its design.
- A consistent implied light direction from the upper-left guides the shading, with a delicate contact shadow grounding the piece on the paper.
- ${aspectNote}. Subtle paper grain and texture. NO photographic background, NO model, NO hands, NO mannequin — only the design sketch on its paper surface.

FINISH — CRITICAL:
- The result must look like a COMPLETE, refined, museum-quality FINISHED design illustration — fully rendered edge to edge, never a rough, faint, or unfinished draft.
- Accurate real-world jewelry proportions, exquisite craftsmanship, and gallery-worthy presentation. This is the hero design plate from a high-end atelier's sketchbook.`;
}

function buildTextToSketchRefinePrompt({ instruction, referenceCount = 0 }) {
  return (
    `Modify this hand-drawn jewelry design sketch (the first image): ${instruction}.` +
    buildReferenceNote(referenceCount) +
    " PRESERVE EXACTLY the same hand-drawn sketch technique, medium, paper, shading, linework and overall composition — do NOT convert it into a photograph. Keep it a matte hand-drawn sketch: do NOT add any bright white sparkle glints, starburst/twinkle marks, lens flare, or glossy shine on the stones or metal. Only apply the single specifically requested change. The result must remain a polished, realistic, fully finished jewelry design sketch."
  );
}

// ── Image to Sketch ─────────────────────────────────────────────────────────

/** The same four media described for redrawing a photograph, not a brief. */
const IMAGE_SKETCH_STYLE_GUIDE = {
  pencil: {
    medium:
      "a museum-quality graphite pencil rendering with professional cross-hatching, feathered gradients, smooth tonal blending and refined grayscale values",
    surface: "premium bright white archival drawing paper",
    finish: "luxury jeweler presentation sketch",
  },
  ink: {
    medium: "a precision pen-and-ink illustration using elegant line weights, stippling and controlled hatching",
    surface: "smooth white illustration paper",
    finish: "high-end luxury design illustration",
  },
  charcoal: {
    medium:
      "a professional charcoal rendering with rich velvety blacks, atmospheric smudging and expressive tonal transitions",
    surface: "warm textured artist paper",
    finish: "gallery-grade charcoal artwork",
  },
  gouache: {
    medium:
      "a traditional haute-joaillerie gouache illustration using opaque matte paint and delicate hand-painted tonal modeling",
    surface: "toned grey or deep-black illustration board",
    finish: "",
  },
};

const IMAGE_SKETCH_PREAMBLE =
  "You are a world-class master jewelry illustrator working from a PHOTOGRAPH of a real jewelry piece supplied above. Reproduce that EXACT piece — its silhouette, proportions, symmetry, stone count and positions, prong style, setting, gallery, shank profile and metal tone — with zero invented, added, omitted or altered design elements. The photo is your exact blueprint.";

function buildImageToSketchPrompt({ style, count = 1 }) {
  const master = MASTER_PROMPTS[style];
  if (master) return `${IMAGE_SKETCH_PREAMBLE}\n\n${master}` + variationNote(count);

  const guide = IMAGE_SKETCH_STYLE_GUIDE[style] ?? IMAGE_SKETCH_STYLE_GUIDE.pencil;

  return (
    `You are a world-class master jewelry illustrator. You are given a PHOTOGRAPH of a real jewelry piece. Your task is to redraw THAT EXACT piece, entirely by hand, as a ${guide.finish}.

REFERENCE FIDELITY — the supplied photograph is your exact blueprint:
- Reproduce the piece's design precisely: overall silhouette and proportions, symmetry, and every stone's position, shape and size.
- Preserve exactly: prong count and placement, halo layout, pavé and stone rows, gallery, basket, bezels, shank profile (including split shank), cathedral shoulders, filigree, milgrain, engraving, chain style, clasp, and pendant / earring / bracelet construction.
- Match the metal colour shown in the photo (yellow / white / rose gold, platinum or silver) as the tone of the drawing; keep two-tone colour boundaries exactly where they appear.
- Do NOT redesign, simplify, stylise, add, or omit anything. Every detail visible in the photo must appear in the sketch at the same position and proportion; nothing absent should be invented.

ARTISTIC MEDIUM — render ONLY as ${guide.medium}, drawn on ${guide.surface}.
This must unmistakably be hand-created artwork. It must NEVER resemble a photograph, a 3D / CGI / product render, an AI render, or a digital painting.

THREE-DIMENSIONAL FORM — build believable volume using ONLY matte hand techniques: tonal shading, cross-hatching, feathered gradients, soft core shadows and a delicate contact shadow. A single soft implied light from the upper-left guides the shading only.

NO SHINE — CRITICAL: this is a hand-drawn sketch, not a photograph. Do NOT add specular highlights, sparkle glints, twinkle or starburst marks, lens flare, mirror or chrome reflections, glossy shine, or bright white hotspots anywhere on the stones or the metal. Represent gemstone cuts with clean facet line-work and soft internal tonal shading only — never photographic brilliance.

COMPOSITION — the single jewelry piece only, centred and large on the paper surface, shown from the SAME viewing angle as the photograph. No background scene, no table, no hands, no model, no props, no labels, no measurements, no watermark. Keep subtle, understated paper grain.

FINAL REQUIREMENT — produce ONE fully finished, refined, gallery-quality illustration. Not a rough concept, not a partial draft, not photorealistic, not CGI.` +
    variationNote(count)
  );
}

function buildImageToSketchRefinePrompt({ instruction, referenceCount = 0 }) {
  return (
    `Modify this hand-drawn jewelry design sketch (the first image): ${instruction}.` +
    buildReferenceNote(referenceCount) +
    " PRESERVE EXACTLY the same hand-drawn medium, paper, shading, linework, the jewelry design, and the viewing angle — do NOT turn it into a photograph. Keep it matte: no sparkle glints, starburst marks, lens flare or glossy shine on the stones or metal. Apply only the single specifically requested change."
  );
}

// ── Sketch to Image ─────────────────────────────────────────────────────────

/*
 * Short on purpose. The sketch carries the design, and the more words sit
 * beside it the more the model renders from the words instead: a 19,000-
 * character prompt, plus a spec that summed a stacked double heart up as
 * "intertwined", came back as the stock interlocking-hearts pendant — while a
 * two-line "turn this into the real piece" on the same sketch came back as the
 * drawing. Every rule below earns its place; add to them sparingly.
 *
 * Two prompts. The default renders the sketch as drawn; VARIATIONS — only when
 * the notes ask for other designs (see resolveSketchMode in prompts/intent.js)
 * — grows new designs out of it.
 *
 * The render prompt was cut to a few lines after a side-by-side test (Nov
 * 2026: two coloured band sheets drawn as face + profile, three pencil
 * pendants, every model, two renders each). The longer prompt, with a count
 * sheet a vision model wrote first, told the renderer to show "the main view"
 * of a two-view sheet: Sparkle 3 Pro answered with two rings stacked, and the
 * count sheet misread one band as "144 pavé stones" and the other as an
 * "8-sided frame". This version — make the ONE piece every view agrees on,
 * shown at three-quarters — rendered every sketch correctly on GPT Image 2
 * both times, and on Nano Banana 2.1 all but once.
 */

/** What on a design sheet is the piece, and what is only there to explain it — for variations. */
const SHEET_RULES = `READ THE SHEET
- Render ONE piece: the main drawing. If the sheet shows the piece more than once — say a top view and a side view — show it as seen in the main view (the largest, or the first), and use the other views only to understand its form. The photograph never shows two objects.
- Small close-up or profile drawings of a part — often a stone setting seen from the side — are detail views. Use them to understand depth and construction; never render them as separate objects.
- Construction circles, centre lines, guide lines, measurements, arrows, written notes and shading hatches are drawing aids, not metal. Leave them out.
- Coloured marks over the drawing (circles, arrows, highlights) are the jeweller's annotations: follow what they point to, and never render the marks themselves.
- If several images are attached, they are views of ONE piece: make one photograph of it, in the orientation of the first image — never a multi-view sheet or several pieces.`;

const METAL_RULES = `- Metal, in this order: what the jeweller notes say; else a metal the sketch is coloured or labelled with; else 18K yellow gold. Grey pencil is graphite, not white gold.
  · Yellow gold: rich, warm, natural 18K — not orange, brassy or pale.
  · White gold / platinum: bright, cool, mirror-polished — never dull or flat grey.
  · Rose gold: soft, warm rose-pink — not copper or orange.
  One metal throughout, except clearly drawn two-tone areas, whose boundaries stay exactly where they are drawn.`;

const PHOTO_RULES = `THE PHOTOGRAPH
- A premium jewellery e-commerce photograph: tack-sharp focus across the whole piece, a soft large key light from the upper left with gentle fill, clean highlights and natural contrast.
- The metal reflects only a clean studio — no camera, room or equipment reflections, no black patches.
- Background: pure, seamless, uniform white (#FFFFFF) — never off-white, cream or grey, and no gradient or vignette. The paper, its tone and its texture are gone. No props, hands, stand or box, and no visible floor shadow.
- The piece is complete, uncropped and centred, with generous white space on every side.
- It is a real photograph: no pencil lines, hatching, smudges or paper grain — never an illustration, concept art or plastic-looking CGI.`;

/**
 * The render. A coloured CAD sheet's colours are its metals; pencil shading is
 * not — "grey = white gold" alone turned plain pencil pendants white gold.
 */
const SKETCH_TO_IMAGE_PROMPT = `Turn this jewellery design drawing into a photorealistic studio product photograph of the exact piece it shows, made in real metal and diamonds.

- Copy the design exactly: the same outline, parts, openings, stones (number, shape, size and position) and proportions. Do not add, remove, simplify or reinvent anything; only clean shaky pencil lines into the precise edges they were meant to be.
- The drawing shows ONE piece. If it is drawn from more than one side — for example a ring's face drawn as a flat strip beside its round profile — make the single piece that matches all the views and photograph it at a three-quarter angle. Never show two pieces, and never join, cross or stack the views. A single drawing keeps its drawn viewpoint and orientation.
- Metal: what the notes say; else the drawing's colours (yellow = yellow gold, grey or silver = white gold); plain pencil = 18K yellow gold. Stones are white diamonds.
- Pure white #FFFFFF background — never off-white, cream or grey, and no gradient — soft studio light, sharp focus, the whole piece in frame and centred. No pencil lines, paper texture, guide lines or written notes in the photograph.`;

const SKETCH_VARIATION_PROMPT = `TASK — A NEW DESIGN GROWN FROM THIS SKETCH

The attached image is a jeweller's hand-drawn design sketch, and the jeweller has asked for design variations. Create a NEW piece that grows out of this sketch — one a designer would place beside it in the same collection — and show it as a photograph of the real piece.

STAY RELATED TO THE SKETCH
- Keep: the type of jewellery, the core motif (the shapes that make this design recognisable), and its design language and character.
- Change: what the direction below asks for, enough that the result is clearly a different piece. A copy of the sketch, a recolour of it or the same piece from another angle is a FAILURE — and so is a design that no longer looks related to the sketch.

${SHEET_RULES}

MATERIALS
- Real, manufacturable jewellery: believable metal thickness, polished edges, clean joins and secure settings.
${METAL_RULES}
- Stones are white diamonds unless the notes say otherwise, with crisp facets, natural brilliance and controlled sparkle.

${PHOTO_RULES}`;

/**
 * Sketch to Image must keep the sketch's viewpoint, so its variations differ
 * only in lighting and framing — never angle, unlike the shared `variationNote`.
 */
function sketchToImageVariationNote(count) {
  if (count <= 1) return "";
  return "\n\nVARIATION: This is one of several renders of the same sketch. Make it a distinct photograph through subtle differences in lighting and highlight placement only. Keep the same design, the same orientation and the same viewpoint as the sketch.";
}

/**
 * The jeweller's own words for a variation: they steer it wherever they say
 * something — including over the prompt's "Keep" list. Naming only metal,
 * stones and finish here let "a different motif of round diamonds and rubies"
 * lose to "keep the core motif": both options came back with the reference's
 * own flowers.
 */
function jewellerNotes(description) {
  const notes = description?.trim();
  if (!notes) return "";
  return (
    "\n\nJEWELLER NOTES — THESE OVERRIDE THE SKETCH AND THE KEEP LIST ABOVE\n" +
    "Wherever they name a metal, stones, a centre stone, a motif, a finish or any other change, do exactly that — " +
    "a new motif they describe replaces the sketch's motif.\n\n" +
    notes
  );
}

/**
 * The render: the drawing alone decides the design. No count sheet any more —
 * a vision model used to read the sketch first and pass its counts along, and
 * on a two-view band sheet it miscounted ("144 pavé stones", an "8-sided
 * frame") with the renderer following its numbers over the drawing. The
 * jeweller's notes are kept short too, in the form the test ran with.
 */
function buildSketchToImagePrompt({ description, count = 1 }) {
  const notes = description?.trim();
  return (
    SKETCH_TO_IMAGE_PROMPT +
    (notes ? `

Jeweller's notes (these win where they say something): ${notes}` : "") +
    sketchToImageVariationNote(count)
  );
}

/**
 * One shot of a "variations" run: the sketch as the starting point, and a
 * direction of its own, so parallel shots come back as a family rather than as
 * near-copies of each other.
 */
function buildSketchVariationPrompt({ description, index = 0, total = 1 }) {
  const direction = RELATED_DIRECTIONS[index % RELATED_DIRECTIONS.length];
  const which = total > 1 ? `This is variation ${index + 1} of ${total} and must differ clearly from the others. ` : "";
  // Last, after the notes: notes asking for "2 designs" must not turn one image into two pieces.
  return (
    `${SKETCH_VARIATION_PROMPT}\n\nDIRECTION FOR THIS VARIATION\n${which}${direction}` +
    jewellerNotes(description) +
    `\n\n${ONE_OPTION_NOTE}`
  );
}

function buildSketchToImageRefinePrompt({ instruction, referenceCount = 0 }) {
  return (
    `Apply this modification to this jewelry photograph (the first image): ${instruction}.` +
    buildReferenceNote(referenceCount) +
    " Keep the same photorealistic product photography style, professional studio lighting, and all structural details. Only apply the specifically requested changes. " +
    PURE_WHITE_NOTE
  );
}

module.exports = {
  buildTextToSketchPrompt,
  buildTextToSketchVariationPrompt,
  buildTextToSketchRefinePrompt,
  buildImageToSketchPrompt,
  buildImageToSketchRefinePrompt,
  buildSketchToImagePrompt,
  buildSketchVariationPrompt,
  buildSketchToImageRefinePrompt,
};

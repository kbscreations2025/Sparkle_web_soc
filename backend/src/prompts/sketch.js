const {
  PENCIL_MASTER_PROMPT,
  GOUACHE_MASTER_PROMPT,
  CHARCOAL_MASTER_PROMPT,
  INK_MASTER_PROMPT,
} = require("./sketchMasterPrompts");
const { buildReferenceNote } = require("./shared");
const { RELATED_DIRECTIONS } = require("./intent");
const { VARIATION_FOCI } = require("./textToImage");

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

  if (hasReference) {
    prompt = `A reference jewellery photo is attached — keep that exact design (its jewelry type, silhouette, stones, setting and details) and change only what the design brief below asks for. Where the brief specifies something, it wins over the reference; everything it does not mention stays as in the photo.\n\n${prompt}`;
  }

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
 * — grows new designs out of it. They share how to read the sheet, the metals
 * and the photograph.
 */

/** What on a design sheet is the piece, and what is only there to explain it. */
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
- Background: pure, seamless, uniform white (#FFFFFF). The paper, its tone and its texture are gone. No props, hands, stand or box, and no visible floor shadow.
- The piece is complete, uncropped and centred, with generous white space on every side.
- It is a real photograph: no pencil lines, hatching, smudges or paper grain — never an illustration, concept art or plastic-looking CGI.`;

const SKETCH_TO_IMAGE_PROMPT = `TASK — TURN THIS SKETCH INTO A PHOTOGRAPH OF THE REAL PIECE

The attached image is a jeweller's hand-drawn design sketch. Turn it into a photograph of that exact piece, made in real metal and stones. This is a faithful render of an existing design — not a design task, and not a reinterpretation.

THE SKETCH IS THE BLUEPRINT
- Reproduce exactly what is drawn: the outline, every part, where each part sits, how the parts join, cross, overlap or stay apart, every opening, every stone, and the size of everything relative to everything else.
- Overlay test: laid over the sketch, the photographed piece lines up with the drawing — same shapes, same positions, same proportions, same number of everything.
- Unusual is correct. An asymmetric, unconventional or unfamiliar design is rendered exactly as drawn. Swapping it for a more familiar, more balanced or more typical piece that merely looks similar is the main way this task fails.
- Do not add, remove, merge, simplify or "improve" anything. Where something is unclear, follow what is visible in the drawing — never invent.
- Keep the main view's viewpoint and orientation — what is drawn horizontal stays horizontal. Do not rotate, tilt or re-pose the piece.

${SHEET_RULES}

CLEAN UP LINE QUALITY ONLY
- A shaky line becomes the clean line it was meant to be, a wobbly circle a precise stone of the same size in the same place, doubled strokes a single edge. Follow the average path of the strokes, never a new, nicer path.
- Where the design is clearly symmetrical, tidy hand wobble so both sides match; never force symmetry onto a design drawn asymmetrical.
- Complete only what is clearly unfinished, and only its structure: a ring drawn as a head alone gets its full shank and shoulders in the drawn style; a halo or stone row that trails off continues with the same stone size and spacing; a pendant with no bail gets a clean, minimal one in its own design language; a cut-off earring post or hook, or a partly drawn bangle or bracelet, is completed along the drawn line. A pendant drawn without a chain is shown on its own.

MATERIALS
- Every drawn shape becomes real metal with believable thickness, polished edges, clean joins and manufacturable settings — without reshaping, re-proportioning or restructuring any of it.
${METAL_RULES}
- Stones: exactly the drawn number, positions, sizes and shapes — round becomes a round brilliant; pear, oval, marquise, heart, cushion, princess, emerald, baguette and trillion keep their cut. White diamonds unless the notes say otherwise, with crisp facets, natural brilliance and controlled sparkle.
- Settings follow the drawing: a bezel stays a bezel, the drawn prong count stays the same, pavé and bead-set stones run exactly along the drawn strips. Milgrain is a row of tiny raised beads; openwork keeps every gap and strut.

${PHOTO_RULES}

FINAL CHECK — compare with the sketch before finishing: same outline, same parts in the same places, same openings, same stone count and positions, same proportions. Wherever the photograph differs from the drawing, follow the drawing.`;

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
 * The jeweller's own words, which win wherever they say something. For a
 * render everything they leave unsaid stays as drawn; a variation is free to
 * move it.
 */
function jewellerNotes(description, { variation = false } = {}) {
  const notes = description?.trim();
  if (!notes) return "";
  const scope = variation
    ? "Wherever they name a metal, stones, a finish or a direction, follow it."
    : "Wherever they name a metal, stones, a finish or a change, that wins over the sketch and over every rule above; everything they do not mention stays exactly as the sketch shows.";
  return `\n\nJEWELLER NOTES — THESE OVERRIDE THE SKETCH\n${scope}\n\n${notes}`;
}

/**
 * Read by a vision model before rendering (see jobs/sketchTools.js), and
 * pasted into the render prompt — so it is limited to what a renderer gets
 * wrong from the drawing alone: which drawing on the sheet to render, exact
 * counts (a 36-stone halo comes back with 26 without one), and which way an
 * elongated stone runs (an east–west setting gets "corrected" to north–south).
 *
 * It must never describe shapes or layout. The renderer copies shapes from the
 * sketch far better than from words, and draws whatever familiar piece the
 * words name instead: "intertwined double heart" and "two curved elements"
 * each turned a small heart stacked on a large one into a stock pendant, while
 * the same sketch rendered from the drawing alone came back right.
 */
const SKETCH_ANALYSIS_PROMPT = `You are a senior jewellery CAD technician preparing a hand-drawn jewellery design sheet for manufacture. If several images are given, they show ONE piece.

A renderer will also see the sheet and will copy every shape from the drawing itself. From you it needs only the two things it is likely to get wrong: which drawing on the sheet to render, and exact counts. Do NOT describe shapes, outlines or how the parts are arranged — the drawing does that, and a written description only pulls the renderer towards a familiar design. Never name the design or compare it to a known style or symbol.

Write two short sections.

SHEET
- Which drawing is the main view, and where it is on the sheet (e.g. "top half", "centre").
- Any other drawings, and what each is: another full view of the same piece (from which angle), or a small detail view of a part (which part).
- Drawing aids present: construction circles, centre or guide lines, measurements, written notes, coloured annotations.
- Colour or metal, only if the drawing is coloured or labelled; otherwise "uncoloured pencil".

COUNTS — in the main view
- Each group of stones: where it runs, in a few plain words; then its count, stone shape and setting (pavé, bead, bezel, prong, channel). Count one by one, going around. If unsure, give the best count and a range, e.g. "approx. 24 (22–26)".
- Centre stone(s): shape; if it is elongated, which way its long axis runs on the drawing (horizontal, vertical or diagonal); setting; and the number of prongs if prongs are drawn.
- The number of sides of any polygonal frame.

Output only these two sections. No preamble.`;

function buildSketchToImagePrompt({ description, count = 1, spec = null }) {
  let prompt = SKETCH_TO_IMAGE_PROMPT;

  if (spec) {
    // Numbers and the sheet only, and second to the drawing: a spec told to
    // win over the model's own eyes lets one wrong word decide the render.
    prompt +=
      "\n\nTECHNICIAN'S COUNT SHEET\n" +
      "A technician has read this sketch for what is easy to get wrong. Use it to know which drawing to render and what to leave out, and make the stone counts, prong counts, numbers of sides and the direction an elongated stone runs match it — an east–west stone stays east–west. It deliberately says nothing about shapes or layout: take every shape, position and proportion from the drawing alone. Anything it does not list is rendered as drawn.\n\n" +
      spec;
  }

  return prompt + jewellerNotes(description) + sketchToImageVariationNote(count);
}

/**
 * One shot of a "variations" run: the sketch as the starting point, and a
 * direction of its own, so parallel shots come back as a family rather than as
 * near-copies of each other.
 */
function buildSketchVariationPrompt({ description, index = 0, total = 1 }) {
  const direction = RELATED_DIRECTIONS[index % RELATED_DIRECTIONS.length];
  const which = total > 1 ? `This is variation ${index + 1} of ${total} and must differ clearly from the others. ` : "";
  return `${SKETCH_VARIATION_PROMPT}\n\nDIRECTION FOR THIS VARIATION\n${which}${direction}` + jewellerNotes(description, { variation: true });
}

function buildSketchToImageRefinePrompt({ instruction, referenceCount = 0 }) {
  return (
    `Apply this modification to this jewelry photograph (the first image): ${instruction}.` +
    buildReferenceNote(referenceCount) +
    " Keep the same photorealistic product photography style, pure white background, professional studio lighting, and all structural details. Only apply the specifically requested changes."
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
  SKETCH_ANALYSIS_PROMPT,
};

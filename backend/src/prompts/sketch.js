const {
  PENCIL_MASTER_PROMPT,
  GOUACHE_MASTER_PROMPT,
  CHARCOAL_MASTER_PROMPT,
  INK_MASTER_PROMPT,
} = require("./sketchMasterPrompts");
const { buildReferenceNote } = require("./shared");

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
    prompt = `A reference jewellery photo is attached — use it as the visual starting point for the design (its jewelry type, silhouette and general design language), then apply the design brief below on top of it, favouring anything the brief specifies over the reference where they conflict.\n\n${prompt}`;
  }

  return prompt;
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

const SKETCH_TO_IMAGE_LINES = `MASTER TASK — SKETCH TO JEWELLERY IMAGE

You are an expert high-end jewellery designer, master jewellery CAD specialist, jewellery rendering artist, and luxury product photographer with decades of professional experience.

INPUT:
The uploaded image is an ORIGINAL HAND-DRAWN JEWELLERY DESIGN SKETCH.

If more than one image is provided, they are DIFFERENT VIEWS OF ONE SINGLE PIECE of jewellery. Use all of them together to understand the full design, then render ONE product image of that one piece, in the orientation of the first (main) view. Do NOT produce a multi-view sheet, a collage, or several pieces.

Your task is to convert this exact hand-drawn design into a highly refined, realistic, professional jewellery product image while preserving the original design with maximum possible fidelity.

THE ORIGINAL SKETCH IS THE ABSOLUTE SOURCE OF TRUTH (except where the jeweller notes, if any, say otherwise).

This is a DESIGN-PRESERVATION task.

It is NOT a redesign.
It is NOT a reinterpretation.
It is NOT an opportunity to create a more fashionable or commercially attractive jewellery design.

The final jewellery must remain recognizably the SAME DESIGN shown in the uploaded sketch.

PRIORITY ORDER: DESIGN FIDELITY > CLEANLINESS > BEAUTIFICATION.

THE OVERLAY TEST: if the final photograph were laid semi-transparently over the sketch, the outline of the piece, every stone, every opening and every structural line should sit on top of its drawn counterpart. Same shapes, same positions, same sizes relative to each other, same number of everything. A designer comparing the two side by side must say "that is exactly my drawing, made real" — not "that is similar to my drawing".

Do NOT "improve" the design. A more balanced, more elegant, more commercial or more typical version of the piece is a FAILURE. Rendering what is drawn — even if it is unusual, asymmetrical or unconventional — is SUCCESS.

==================================================
1. FIRST PRIORITY — UNDERSTAND THE ORIGINAL DESIGN
==================================================

Carefully analyze the uploaded sketch before rendering.

Identify and preserve:

- Overall jewellery type
- Overall silhouette
- Outer contour
- Inner contour
- Major structural components
- Central element
- Halo/frame structure
- Stone positions
- Stone count
- Stone shapes
- Prong positions
- Decorative elements
- Open spaces
- Cut-outs
- Engraved lines
- Connecting elements
- Bail / attachment elements
- Symmetry
- Curves
- Angles
- Layering
- Relative proportions
- Relationship between every component

Treat every visible line, boundary, opening, stone indication, contour, and structural feature as meaningful design information.

DO NOT treat the sketch as a vague inspiration image.

Treat it as a jewellery design blueprint.

==================================================
2. ABSOLUTE DESIGN PRESERVATION
==================================================

PRESERVE THE ORIGINAL DESIGN.

Do NOT:

- redesign it
- modernize it
- beautify it by changing the design
- simplify it
- add fashionable jewellery elements
- remove small details
- change proportions
- change symmetry
- change stone positions, count, relative sizes or shapes
- change the outer or inner silhouette
- change the number of layers
- change the geometry or curvature
- change the orientation or perspective
- invent decorative elements, stones, prongs, halos or metal frames

The output must represent the SAME physical jewellery design represented by the sketch.

If a design decision is uncertain, follow the visible evidence in the sketch rather than inventing a new design.

==================================================
3. LINE-BY-LINE STRUCTURAL FIDELITY
==================================================

Every meaningful structural line should translate into an appropriate jewellery structure:

- Outer pencil contour → outer jewellery contour
- Inner contour → inner metal boundary
- Stone circle → gemstone
- Repeated stone markings → repeated gemstones
- Small connecting lines → metal connections
- Open gaps → actual open spaces
- Parallel lines → layered metal structure
- Engraving marks → engraved metal detail
- Prong indications → actual prongs
- Decorative curves → actual metal curves
- Geometric divisions → physical jewellery construction

Do NOT erase structural information simply because the original drawing is rough.

Do NOT merge separate components.

Do NOT turn multiple distinct components into one generic smooth surface.

==================================================
4. CLEAN UP THE HAND-DRAWN DESIGN — WITHOUT CHANGING IT
==================================================

The original drawing may contain rough pencil lines, uneven line thickness, faint areas, construction marks, shaky curves, imperfect circles, rough stone indications, overlapping sketch lines and incomplete-looking lines.

Clean these ONLY at the level of line quality: a shaky line becomes the clean curve it was clearly meant to be, a wobbly circle becomes a precise stone of the SAME size and position, doubled sketch strokes become one edge. Follow the designer's intended line — the average path of the strokes — never a new, "nicer" path.

Cleanup never changes a shape, a proportion, a count, a spacing, or the overall silhouette.

The cleanup must NEVER change the underlying design.

Think "professionally cleaned jewellery designer sketch", NOT "new jewellery design inspired by the sketch."

==================================================
5. INCOMPLETE OR FAINT AREAS
==================================================

Some areas of a hand-drawn sketch may be faint, partially visible, or unfinished.

Complete an area when its intended structure can be inferred from visible geometry, symmetry, repetition, continuation of lines, or clearly established design logic. When completing:

- continue the existing curve and structural lines
- maintain the existing symmetry, proportions and spacing
- maintain the existing design language
- do NOT introduce a new decorative concept

Completion applies ONLY to parts that are clearly missing, cut off or faded — never to parts that are drawn. Anything that is drawn is rendered as drawn, not redrawn. The final piece must be a COMPLETE, wearable piece of jewellery, so apply these standard completions where needed:

- RINGS: if only the head/top is drawn and the shank fades away, complete the full shank, both shoulders and the underside of the band in a smooth arc matching the drawn style and proportions.
- HALOS: if halo stones are drawn on one side but trail off, complete the full halo with consistent stone size and spacing.
- PENDANTS: if the bail is missing or only partly sketched, add a clean, minimal bail matching the pendant's design language.
- EARRINGS: if the ear wire or post is cut off, complete it naturally along the drawn line.
- BANGLES & BRACELETS: if the arc is only partly drawn, complete the full closed circle or full cuff width.
- NECKLACES: if only the pendant is drawn with no chain, render the pendant alone, centred. If a chain fragment is shown, complete the full chain symmetrically.

Completion is of STRUCTURE ONLY. If an area is genuinely ambiguous beyond these cases, preserve the visible structure rather than creatively inventing a new component.

==================================================
6. SYMMETRY
==================================================

Where the original design is clearly symmetrical, keep it symmetrical — tidy small hand-drawing wobble so both sides match, but keep the drawn shape, size and spacing.

If one side is clearly defined and the other is faint or partially drawn, complete the opposite side by faithfully mirroring the established design: identical stone count, stone spacing, metal thickness, curves, decorative elements and proportions.

Do not use symmetry to invent a feature that has no evidence in the sketch, and do not force symmetry onto a design that is clearly drawn asymmetrical.

==================================================
7. JEWELLERY MATERIAL CONVERSION
==================================================

Convert the cleaned design into physically realistic jewellery that looks like an actual professionally manufactured piece.

Metal should have realistic thickness, realistic edges, realistic polished surfaces, physically believable reflections, crisp highlight transitions, realistic curvature, realistic setting construction, realistic prongs and joins, and manufacturing precision.

The metal must look like real polished precious metal — not plastic, not liquid, not exaggerated CGI chrome.

==================================================
8. METAL COLOUR
==================================================

Decide the metal in this order:

1. If the jeweller notes specify a metal, use that metal.
2. Otherwise, if the sketch is clearly coloured or labelled with a metal, use that metal.
3. Otherwise (a plain pencil or graphite sketch with no colour), use 18K YELLOW GOLD.

A grey pencil sketch does NOT mean white gold — grey is just the colour of graphite.

Metal appearances:

- YELLOW GOLD: rich, warm, natural luxury 18K yellow gold — not orange, not brassy, not pale.
- WHITE GOLD / PLATINUM: bright, cool, mirror-polished white metal with clean bright highlights — never dull or flat grey.
- ROSE GOLD: soft, warm, natural rose-pink gold — not copper, not orange.

The metal must remain physically metallic with realistic highlights and reflections. Once the metal is decided, keep it consistent across the whole piece (except clearly drawn two-tone areas, whose colour boundaries must stay sharp and exactly where drawn).

==================================================
9. GEMSTONES AND DIAMONDS
==================================================

Translate gemstone indications from the sketch into realistic gemstones.

PRESERVE gemstone count, position, size relationship, shape, orientation and arrangement. Do not add, remove or multiply stones.

Stone shapes follow the drawing: round → round brilliant; triangular → trillion; rectangular → baguette or emerald cut; oval, pear, marquise, heart, cushion → that cut.

Unless the jeweller notes say otherwise, stones are white diamonds.

Diamonds must have realistic facet geometry, crisp facet boundaries, natural brilliance, subtle fire, realistic transparency and physically believable reflections — expensive and professionally photographed, with controlled, natural sparkle.

==================================================
10. PRONGS AND SETTINGS
==================================================

Every gemstone must have a physically believable setting that follows the setting structure drawn in the sketch.

Keep the prong count as drawn (a four-prong setting stays four-prong). Keep prongs clean, properly positioned, proportional to the stone, and symmetrical where appropriate.

==================================================
11. MICRO-DETAIL
==================================================

Preserve every visible design detail that can be translated into physical jewellery: tiny stones, small beads, milgrain, engraved lines, channels, openwork, cut-outs, lattice structures, decorative borders, inner and outer frames, wire details, claws, stone separators, metal gaps, negative spaces, layered construction and repeated patterns.

Render milgrain as a continuous row of tiny raised beads. Render every gap and strut of openwork individually. Do not simplify these details into generic smooth surfaces.

==================================================
12. REALISTIC JEWELLERY MANUFACTURING
==================================================

The final object must look physically manufacturable: believable thickness, clean transitions, realistic joints, physically possible stone settings, realistic edge thickness.

Manufacturing realism must NEVER override the original design. Give the drawn shapes real metal thickness and real settings — do not reshape, thicken into different proportions, or restructure them to make them "more manufacturable". Preserve the design first.

==================================================
13. CAMERA / VIEWPOINT
==================================================

Preserve the viewing orientation of the original (main) sketch as closely as possible.

Do not arbitrarily rotate the jewellery, do not introduce a dramatically different perspective, and do not change the relationship between front-facing and side-facing elements.

==================================================
14. PRODUCT PHOTOGRAPHY AND LIGHTING
==================================================

Present the piece as a premium luxury jewellery catalogue photograph: professional macro product photography, tack-sharp focus across the entire piece (every prong tip and facet edge in focus, no depth-of-field blur), extremely high micro-detail, accurate metal reflections and natural gemstone brilliance.

Lighting: controlled luxury jewellery studio lighting — a soft large-area key light from the upper-left, gentle controlled fill from the opposite side, and subtle rim highlights where physically appropriate. Clean premium highlights across the metal, with structural detail clearly visible and balanced, natural contrast.

==================================================
15. REFLECTION CONTROL
==================================================

The metal must reflect only a clean, controlled jewellery studio: soft white highlights and smooth tonal gradients. No reflections of a camera, lens, photographer, studio equipment or room, and no random black reflection patches on the metal.

==================================================
16. BACKGROUND AND COMPOSITION
==================================================

Background: completely pure, seamless, uniform white (#FFFFFF) — no gradient, vignette, tint, texture, floor or backdrop.

The jewellery must be isolated: no props, hands, mannequin, display stand, jewellery box or decorative objects.

Place the complete piece centred horizontally and vertically, occupying an elegant amount of the frame with generous white breathing room on every side. Never crop any part of the piece.

No visible ground shadow, no dramatic cast shadow and no floating-object effect — the piece appears cleanly isolated on pure white.

==================================================
17. FINAL IMAGE STYLE
==================================================

FINAL RESULT: a photorealistic, professionally manufactured luxury jewellery piece photographed in a premium jewellery studio, suitable for luxury e-commerce, brand websites, premium catalogues, print and social media advertising.

The output is a PHOTOGRAPH. Remove ALL sketch lines, pencil marks, graphite smudges, construction lines, hatching and paper texture. There must be zero visual evidence that the image was derived from a sketch.

It must not look like an AI redesign, concept art, a 3D cartoon, generic or fantasy jewellery, an illustration, a sketch, a painting, or plastic CGI.

==================================================
FINAL DIRECTIVE
==================================================

The result must be the SAME jewellery design as the sketch — same silhouette, same structural elements, same stone count, positions and shapes, same proportions, same decorative elements and open spaces, same orientation — realised as a real, manufacturable piece in a premium photograph.

PRESERVE THE DESIGN.
REFINE THE DESIGN.
REALIZE THE DESIGN.

DO NOT REDESIGN THE JEWELLERY.

FINAL CHECK — compare against the sketch one more time: same outline, same number of stones in the same places, same openings, same proportions. If anything differs from the drawing, follow the drawing.`.split("\n");

/**
 * Sketch to Image must keep the sketch's viewpoint, so its variations differ
 * only in lighting and framing — never angle, unlike the shared `variationNote`.
 */
function sketchToImageVariationNote(count) {
  if (count <= 1) return "";
  return "\n\nVARIATION: This is one of several renders of the same sketch. Make it a distinct photograph through subtle differences in lighting and highlight placement only. Keep the same design, the same orientation and the same viewpoint as the sketch.";
}

/**
 * Read by a vision model before rendering (see jobs/sketchTools.js). Its
 * answer is pasted into the render prompt as the design spec, so it must be
 * plain, numeric and literal — what is drawn, not what would look good.
 */
const SKETCH_ANALYSIS_PROMPT = `You are a senior jewellery CAD technician reading a hand-drawn jewellery design sketch so it can be manufactured exactly. If several images are given, they are views of ONE piece.

Write a precise DESIGN SPEC of what is DRAWN. Be literal and numeric. Do not suggest improvements, do not describe what would look nice, do not guess materials unless written or coloured.

COUNT CAREFULLY. Count stones in every row/ring one by one, going around. Count polygon sides one by one. If a count is uncertain, give your best count and the range, e.g. "approx. 24 (22–26)".

Cover, in this order, using short bullet lines:

1. TYPE: ring / pendant / earring / etc. Viewpoint (front, top-down, three-quarter, side).
2. SILHOUETTE: outer shape of the whole piece — exact shape name and number of sides if polygonal (e.g. "12-sided dodecagon, flat edges, slightly rounded corners"), width-to-height ratio.
3. STRUCTURE FROM OUTSIDE IN: list every concentric frame / band / ring / layer, in order from the outermost to the centre. For each: its shape, number of sides, whether it is plain metal or set with stones, and approximate thickness relative to the piece.
4. STONES: for EACH group — location (which band/row), count, shape (round, princess, marquise, pear, heart...), relative size (e.g. "tiny, about 1/15 of the piece width"), setting type (pavé, bezel, prong, channel). Centre stone: shape, cut, size relative to the piece, how many prongs and where they sit (e.g. "4 round prongs at 2, 4, 8, 10 o'clock").
5. OPENINGS / NEGATIVE SPACE: any gaps, cut-outs, galleries.
6. DECORATIVE DETAIL: milgrain, engraving, beading, borders, scrolls — where and how many.
7. ATTACHMENTS: bail, chain, posts, shank — what is drawn and how it connects.
8. COLOUR / METAL: only if the sketch is coloured or labelled; otherwise write "uncoloured pencil".
9. MOST DISTINCTIVE FEATURES: the 3–5 things a designer would point to first to recognise THIS design (e.g. "pavé-set dodecagon halo of ~24 stones between two plain dodecagon bands").

Output only the spec. No preamble.`;

function buildSketchToImagePrompt({ description, count = 1, spec = null }) {
  const lines = [...SKETCH_TO_IMAGE_LINES];

  if (spec) {
    lines.push(
      "",
      "==================================================",
      "MEASURED DESIGN SPEC — READ FROM THIS SKETCH",
      "==================================================",
      "",
      "A jewellery technician has studied this exact sketch and recorded what is drawn. Treat every shape, number of sides and stone count below as a HARD REQUIREMENT. Render exactly this many stones in exactly these positions, and exactly these shapes. Where the spec and your own impression disagree, follow the spec and the sketch — never a simpler or more typical design.",
      "",
      spec
    );
  }

  if (description?.trim()) {
    lines.push(
      "",
      "==================================================",
      "JEWELLER NOTES — THESE OVERRIDE THE SKETCH",
      "==================================================",
      "",
      "Apply these exactly. Wherever they specify metal, stones, finish or a change, they take priority over the sketch and over every preservation rule above. Everything they do not mention stays exactly as the sketch shows.",
      "",
      description.trim()
    );
  }

  return lines.join("\n") + sketchToImageVariationNote(count);
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
  buildTextToSketchRefinePrompt,
  buildImageToSketchPrompt,
  buildImageToSketchRefinePrompt,
  buildSketchToImagePrompt,
  buildSketchToImageRefinePrompt,
  SKETCH_ANALYSIS_PROMPT,
};

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

const SKETCH_TO_IMAGE_LINES = [
  "MASTER TASK:",
  "You are a world-class jewellery rendering artist and CAD specialist with 20+ years of experience converting hand-drawn jewellery sketches into final photorealistic catalogue images.",
  "Your output will be used directly in luxury e-commerce and print catalogues.",
  "Produce a flawless, photorealistic jewellery product photograph from the sketch provided.",
  "",
  "STEP 1 — ANALYSE THE SKETCH BEFORE RENDERING:",
  "Before generating anything, carefully study the entire sketch and identify:",
  "(a) Which parts of the jewellery piece are fully and clearly drawn.",
  "(b) Which parts are partially drawn, fading out, cut off, missing, or only implied by surrounding lines.",
  "(c) The complete intended design — what the finished piece would look like if every part were fully sketched.",
  "(d) The exact jewellery type (ring, pendant, necklace, earring, bracelet, bangle, brooch, etc.).",
  "(e) The number and placement of every stone, prong, decorative element, and structural component.",
  "",
  "STEP 2 — COMPLETE INCOMPLETE OR MISSING SKETCH AREAS:",
  "If any section of the sketch is unfinished, partially drawn, cut off, or structurally incomplete, you MUST complete it before rendering. Rules:",
  "— Use the visible, fully-drawn portion as the sole authoritative design reference. Do NOT invent anything new.",
  "— For RINGS: if only the top (head) is drawn and the shank curves away and fades, complete the full shank, both shoulders, and the underside of the band in a smooth symmetrical arc that matches the drawn style and proportions.",
  "— For SYMMETRIC PIECES: if one side is drawn and the other fades or is missing, mirror the drawn side exactly — same stone count, same decorative elements, same proportions.",
  "— For HALOS: if the halo stones are shown on one side but trail off on the other, complete the full 360° halo with consistent stone size and spacing.",
  "— For PENDANTS: if the pendant body is drawn but the bail is absent or only partially sketched, add a clean minimal bail top that matches the design language of the pendant body.",
  "— For EARRINGS: if the ear wire or post end is cut off, complete it naturally following the drawn line trajectory.",
  "— For BANGLES & BRACELETS: if the arc is drawn only partially, complete the full closed circle or the full cuff width.",
  "— For NECKLACES: if only the pendant is shown with no chain, render the pendant in isolation centred on white. If a chain fragment is shown, complete the full chain symmetrically.",
  "— The completed area must match the exact line style, curvature character, and design vocabulary of the drawn area — it must be indistinguishable from the original drawn portion.",
  "— Completion is of structure only — do not add decorative elements not implied by the sketch.",
  "",
  "STEP 3 — STRUCTURAL FIDELITY (NON-NEGOTIABLE):",
  "Treat the sketch (including your completed version from Step 2) as a certified engineering blueprint.",
  "Your job is to RENDER it in photorealism — NOT to redesign, simplify, improve, or reinterpret it in any way.",
  "Every element drawn or completed must appear in the final rendered output at the exact same position, proportion, and spatial relationship.",
  "DO NOT add any decorative element that is not in the sketch.",
  "DO NOT remove, omit, or collapse any element that is in the sketch.",
  "DO NOT simplify curves, smooth out intentional angles, or merge separate elements.",
  "DO NOT resize, rescale, or rebalance any component relative to others.",
  "If you are uncertain about a detail — render it exactly as drawn, not as you would redesign it.",
  "",
  "MICRO-DETAIL PRESERVATION (critical — these make or break the result):",
  "Filigree patterns, openwork lattice, cutout voids, perforations — render every individual gap, strut, and twist faithfully, not as an approximation.",
  "Stone count and exact placement — every single stone marked in the sketch must become a rendered gemstone; do not add, remove, or reposition any stone.",
  "Stone shapes must match exactly — triangular drawn stone = trillion cut; rectangular = baguette or emerald cut; round = round brilliant.",
  "Prong count, prong style, and prong tip shape — 4-prong stays 4-prong; pointed claw tips stay pointed; rounded tips stay rounded.",
  "Halo shape and stone layout — cushion-outline halo stays cushion; round halo stays round; individual stone positions in the halo must be preserved.",
  "Two-tone and mixed-metal boundaries — render the colour boundary exactly where the sketch shows it.",
  "Proportions of every component relative to the whole piece — pendant head to bail ratio, ring head to shank width, center stone to halo frame, band width to ring height.",
  "Overall silhouette and outer contour — the outer edge of the complete piece must match the sketch silhouette exactly.",
  "Milgrain bead rows — render as a continuous row of tiny raised beads, not as a decorative line.",
  "Engraving lines and surface texture hatching in the sketch → render as actual engraved grooves or surface texture on the metal.",
  "Split-shank gap shape, twist wire direction, rope pattern pitch — every structural detail counts.",
  "",
  "METAL RENDERING:",
  "Yellow gold areas → render as warm, highly polished 18K yellow gold with crisp environmental reflections.",
  "White gold / silver / platinum areas → render as cool, mirror-polished platinum or rhodium-plated white gold.",
  "Rose gold areas → render as authentic warm rose gold tone.",
  "Two-tone areas → keep colour boundaries sharp and exactly where drawn; do not blend or feather.",
  "Metal surfaces must show physical realism: sharp highlight streaks, accurate environmental reflections, micro-surface smoothness.",
  "",
  "GEMSTONE RENDERING:",
  "Diamonds → crisp sharp facet edges, high optical brilliance, natural dispersion fire, eye-clean transparency.",
  "Coloured gemstones → accurate stone type colour, correct depth and saturation, life-like internal light behaviour.",
  "No fantasy starburst overlays, no cartoon sparkle halos, no exaggerated glow effects.",
  "Facets must look physically cut — not painted or illustrated.",
  "",
  "COMPOSITION AND BACKGROUND:",
  "Place the complete jewellery piece perfectly centred in the frame, both horizontally and vertically.",
  "The piece must have clear breathing room on all sides — do not crop any part of the jewellery.",
  "Background must be pure white (#FFFFFF) — no gradients, no vignette, no backdrop shadows.",
  "No props, no hands, no display stands, no background elements — strictly isolated product shot.",
  "",
  "PHOTOGRAPHY AND LIGHTING:",
  "Professional luxury jewellery studio lighting: soft large-area key light from upper-left at 45°, gentle fill from right, subtle rim light from rear.",
  "Absolute tack-sharp focus across the entire piece — every prong tip, every facet edge, every filigree strand in sharp focus.",
  "No depth-of-field blur anywhere on the jewellery.",
  "Ultra-high resolution, maximum texture detail, premium luxury e-commerce and print catalogue quality.",
  "",
  "OUTPUT QUALITY:",
  "The output is a photorealistic studio photograph — NOT an illustration, NOT a cartoonistic render.",
  "Remove ALL sketch lines, pencil marks, graphite smudges, construction lines, hatching, and paper texture from the final image.",
  "The final image must show zero visual evidence that it was derived from a sketch.",
  "A master jeweller looking at the output must be able to identify every structural element, stone count, and design detail faithfully reproduced.",
];

function buildSketchToImagePrompt({ description, count = 1 }) {
  const lines = [...SKETCH_TO_IMAGE_LINES];

  if (description?.trim()) {
    lines.push("", "JEWELLER NOTES — APPLY THESE EXACTLY, CHANGE NOTHING ELSE:", description.trim());
  }

  return lines.join("\n") + variationNote(count);
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
};

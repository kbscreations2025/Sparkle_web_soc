/**
 * Image to Video: an existing photograph animated, never redesigned.
 *
 * The camera and mood presets are the user's whole vocabulary here — there
 * is no free-text scene — so each one carries both what the user is shown
 * (`description`) and what the model is sent (`value`). The frontend renders
 * the first; only the second ever leaves this process.
 */

/**
 * Every preset except Macro Sparkle explicitly keeps the whole piece in
 * frame. Left implicit, Veo drifts into a crop that cuts the piece in half —
 * which for a product video is the one unusable outcome.
 */
const CAMERA_STYLES = [
  {
    id: "orbit",
    label: "Slow 360° Orbit",
    description: "One complete turntable revolution — front, side, back, side, home. Loops seamlessly.",
    /*
     * Spelled out to the point of pedantry because the obvious phrasing
     * does not work. Asked for "a 360-degree orbit", Veo reads the number
     * as a style of movement rather than an amount and delivers a pretty
     * drift of thirty or forty degrees. What makes it complete the turn is
     * stating the revolution as a budget with a start, a rate and an end:
     * one revolution, constant speed, last frame back at the first.
     *
     * A turntable (piece rotating, camera locked) rather than a true camera
     * orbit, which is also how a real jewellery 360 is shot: the background
     * and lighting hold still, so the only thing moving is the piece, and
     * the clip loops without a seam.
     */
    value:
      "a jewellery turntable shot: the piece rotates through EXACTLY ONE COMPLETE 360-degree revolution about its own vertical axis over the full length of the clip, at a perfectly constant rotation speed, passing through front, then one side, then the full back, then the other side, and arriving back at the exact starting angle on the final frame so the clip loops seamlessly. The rotation must never pause, reverse, stall, speed up or swing back and forth — it is one continuous turn in a single direction, and by the end every side of the piece has been shown. The camera itself is locked off at a fixed distance and a fixed height, and the background and lighting do not move — only the piece turns. The ENTIRE piece stays fully visible within frame at all times, never cropped",
  },
  {
    id: "push-in",
    label: "Push-In Reveal",
    description: "Starts on the full piece, then eases in slightly closer — the whole design stays in frame throughout.",
    value:
      "a gentle cinematic push-in that starts on a wide framing of the complete piece and moves only moderately closer — the ENTIRE piece must remain fully visible within frame the whole time, never zooming so close that any part of the jewelry leaves the frame",
  },
  {
    id: "pan",
    label: "Elegant Pan",
    description: "The camera glides smoothly side to side across the piece, always showing it in full.",
    value:
      "a slow, smooth horizontal pan across the piece at a fixed distance, catching the light along its length — the ENTIRE piece stays fully visible within frame throughout, never cropped",
  },
  {
    id: "static",
    label: "Static Hero Hold",
    description: "The camera stays perfectly still on the full piece, with only light and reflections moving.",
    value:
      "a locked-off static hero shot at a comfortable distance showing the ENTIRE piece fully in frame, motionless camera, with only subtle realistic light movement across the surface",
  },
  {
    id: "tilt",
    label: "Gentle Tilt Reveal",
    description: "The camera tilts smoothly from top to bottom of the piece, keeping it fully framed.",
    value:
      "a slow, smooth vertical tilt from the top to the bottom of the piece at a fixed distance — the ENTIRE piece stays fully visible within frame throughout, never cropped",
  },
  {
    id: "macro",
    label: "Macro Sparkle (Close-Up)",
    description: "The only close-up option — the lens drifts across the gemstones to show facets and sparkle in fine detail.",
    value:
      "a macro lens drifting slowly across the gemstones for a detailed close-up, catching facet detail and light refraction",
  },
  {
    id: "tabletop",
    label: "Tabletop Reveal",
    description: "An overhead camera descends slowly from directly above — the full piece always in view.",
    value:
      "a top-down tabletop reveal, the camera descending slowly from directly above — the ENTIRE piece remains fully visible within frame throughout, never cropped",
  },
];

/**
 * Each description states where the light comes from, so the result is
 * predictable, and every value asks for realistic shine — no cartoonish
 * glints or blown-out highlights, just how light behaves on polished metal.
 */
const MOOD_STYLES = [
  {
    id: "studio",
    label: "Luxury Studio",
    description: "Soft, even light from the upper-left on a clean white/grey backdrop — classic catalogue look.",
    value:
      "a clean white/grey studio background, soft diffused key light from the upper-left with gentle fill removing harsh shadows",
  },
  {
    id: "golden",
    label: "Golden Hour",
    description: "Warm, low-angle light from one side on a soft honey-toned backdrop — romantic and warm.",
    value: "a soft honey-toned backdrop with warm, low-angle golden-hour lighting from one side",
  },
  {
    id: "dark",
    label: "Dark Velvet",
    description: "Moody rim light from behind the piece on a deep black backdrop — dramatic and high-contrast.",
    value: "a dramatic deep black velvet background, moody rim/edge lighting from behind the piece for high contrast",
  },
  {
    id: "editorial",
    label: "Bright Editorial",
    description: "Crisp, bright light from directly above on a light backdrop — clean high-fashion energy.",
    value: "a bright, light editorial backdrop with crisp, even lighting from directly above, high-fashion campaign energy",
  },
  {
    id: "lifestyle",
    label: "Soft Lifestyle",
    description: "Soft natural light from a window angle with a warm, gently blurred background.",
    value: "a warm, gently blurred lifestyle background with soft natural window light coming from one side",
  },
  {
    id: "plain-black",
    label: "Plain Black",
    description: "Pure solid black background, soft light from the upper-front — nothing but the piece in frame.",
    value:
      "a pure solid black background with no texture, gradient or props, soft even light from the upper-front so the piece reads clearly against the black",
  },
  {
    id: "plain-white",
    label: "Plain White",
    description: "Pure seamless white background, soft even light from directly above — clean e-commerce look.",
    value:
      "a pure seamless white background with only a soft contact shadow beneath the piece, soft even light from directly above",
  },
];

/**
 * The vision pass that runs before the clip.
 *
 * "Don't change the design" is an instruction Veo cannot check itself
 * against: it has pixels, and no statement of what the piece actually is,
 * so a stone it renders slightly wrong is not a contradiction of anything.
 * Reading the piece into an explicit written spec first, and handing that to
 * Veo alongside the photos, gives it something falsifiable to hold to —
 * "seven round brilliants per shoulder" is a fact a frame can violate.
 *
 * Deliberately NOT the Image to Text prompt (prompts/imageToText.js). That
 * one is tuned to recreate a *photograph*, so it specifies background,
 * lighting and camera — all of which the user has already chosen here
 * through the camera and mood presets, and all of which would fight them.
 * This one is structure only, and is capped: a spec that runs longer than
 * the direction around it starts to crowd out the camera instruction.
 */
const DESIGN_SPEC_PROMPT = `You are a GIA-certified gemologist examining a piece of jewellery so that it can be reproduced exactly.

Study the photograph(s) and write a precise structural specification of the PIECE ITSELF.

Cover, in this order, only what is actually visible:
• Type and sub-type (solitaire engagement ring, tennis bracelet, drop earring, …)
• Metal: colour and finish of each distinct component; two-tone boundaries
• Centre/primary stone: cut, shape, proportions, length-to-width ratio, orientation, colour
• Setting: type, EXACT prong count, prong tip style, setting height, gallery/basket design
• Halo: present or absent; if present, its shape and the NUMBER of stones
• Accent stones: setting style, shape, how far they run along the band, and the COUNT per side
• Band/shank: profile, taper, width relative to the head, split or solid
• Decorative detail: milgrain, engraving, filigree, cutouts, texture — and exactly where

RULES
— Output only the specification. No preamble, no headings, no bullet points.
— One continuous block of comma-separated factual descriptors.
— State every count as a number. Counts are the detail most often lost.
— Describe ONLY the jewellery. Say nothing about background, lighting, shadows, camera angle, framing or photographic style.
— No evaluative adjectives: not "beautiful", not "elegant", not "stunning".
— Describe only what you can see. Never guess at a detail the photograph does not show.
— Keep it under 180 words.`;

/** Same pass, told that the photographs are one object rather than several. */
function buildDesignSpecPrompt(viewCount = 1) {
  if (viewCount <= 1) return DESIGN_SPEC_PROMPT;
  return `${DESIGN_SPEC_PROMPT}

NOTE: You are given ${viewCount} photographs of ONE SINGLE piece from different angles — not ${viewCount} different pieces. Combine them into one specification of that one piece, and use the extra angles to describe the sides and back that a single photograph could not show.`;
}

/** Keep shine physically realistic, never over-the-top or fake-looking. */
const REALISTIC_SHINE_CLAUSE =
  "Reflections, sparkle and shine on the metal and gemstones must look physically realistic — natural light behaviour, true to how real polished metal and cut stones catch light — never exaggerated, cartoonish, over-the-top, or blown out.";

/**
 * The entire piece stays in frame. Macro Sparkle is the one intentional
 * exception, and it is opt-in and clearly labelled as such.
 */
const FULL_FRAME_CLAUSE =
  "Unless the chosen camera style is explicitly a close-up, the ENTIRE piece must remain fully visible within the frame for the whole clip — never crop or zoom in so tightly that any part of the jewelry leaves frame.";

const DEFAULT_NEGATIVE_PROMPT =
  "redesigned jewelry, altered structure, extra or missing gemstones, added or removed embellishments, changed proportions, changed stone count, warping, melting metal, morphing or shifting gemstones, extra or duplicated jewelry, distorted proportions, flickering, cropped out of frame, jewelry cut off, over-exaggerated sparkle, cartoonish glints, blown-out highlights, unrealistic lens flare, text, logo, watermark, low quality, blurry";

function cameraValue(id) {
  return (CAMERA_STYLES.find((style) => style.id === id) ?? CAMERA_STYLES[0]).value;
}

function moodValue(id) {
  return (MOOD_STYLES.find((style) => style.id === id) ?? MOOD_STYLES[0]).value;
}

/**
 * Animating an existing photo.
 *
 * Opens by forbidding redesign rather than closing with it: this is filming
 * a real piece, and a model that improvises a stone has produced a video of
 * something the jeweller does not sell.
 */
function buildImageAnimationPrompt({ camera, mood, description, viewCount = 1, designSpec } = {}) {
  const multiView = viewCount > 1;
  const spec = designSpec?.trim();

  return [
    "CRITICAL — DO NOT alter the jewelry in any way: this is filming existing jewelry, not redesigning it. Its exact structure, geometry, proportions, stone count, stone placement, prong style, metal colour and every design detail must stay 100% IDENTICAL to the source image in every single frame.",
    /*
     * Placed immediately after the do-not-alter rule and before any
     * direction about movement, because it is the definition that rule
     * refers to — read in the other order it becomes a description of the
     * shot rather than a constraint on the subject.
     */
    spec
      ? `The piece in the photograph(s) is EXACTLY this, and must remain exactly this in every frame: ${spec} Every count, shape and proportion in that specification is a hard requirement — if a frame would show a different number of stones, a different setting, a different band profile or a different metal, that frame is wrong.`
      : "",
    /*
     * Multi-view runs hand Veo up to three ASSET references, and without this
     * it reads them as three different pieces and cuts between them. Said
     * plainly: they are one object, and the angles are there so the parts the
     * camera swings past are the real ones rather than invented.
     */
    multiView
      ? `The ${viewCount} reference images are ${viewCount} photographed views of ONE SINGLE piece of jewelry — the same physical object from different angles, NOT different pieces. Reconstruct that one piece from all of them and film it as one continuous object: every side the camera reveals must match the corresponding reference view exactly. Never show more than one piece, never cut between the reference images, and never invent an angle that contradicts them.`
      : "",
    `Animate this jewelry product photo into a short cinematic video. Camera: ${cameraValue(camera)}.`,
    /*
     * Only on the turntable, and only with references: this is the one
     * combination where the extra views have somewhere specific to go. It
     * tells the model the references are not just "the same piece" but the
     * angles the rotation is about to pass through, which is what stops the
     * back half of the turn being invented.
     */
    camera === "orbit" && multiView
      ? `Use the ${viewCount} reference views as the true appearance of the piece at the angles the rotation passes through — as the turn reaches the angle a reference was photographed from, the piece must match that reference. The back of the piece is shown in the references; film that, do not invent it.`
      : "",
    `Setting & lighting: ${moodValue(mood)}.`,
    FULL_FRAME_CLAUSE,
    REALISTIC_SHINE_CLAUSE,
    "Only add camera motion, light movement and background/atmosphere as described — never redesign, embellish, resize or reposition the jewelry itself.",
    description?.trim() ? `Additional direction: ${description.trim()}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/*
 * Verified live against this account: the API rejected anything outside
 * 4–8 seconds as "out of bound" at the time it was tested, so values above
 * that may still be refused server-side depending on model and tier.
 */
const DURATION_OPTIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const DEFAULT_DURATION = 8;
const MIN_DURATION = 4;
const MAX_DURATION = 15;

/**
 * Veo 3.1 accepts at most 3 ASSET reference images — a fourth is refused —
 * and the SDK is explicit that `image` (first frame) cannot be sent
 * alongside them, so a multi-view run is references-only with no pinned
 * opening frame. This cap is the provider's and cannot be raised here.
 */
const MAX_REFERENCE_IMAGES = 3;

/**
 * How many views a run accepts, which is deliberately larger than what Veo
 * will take as references.
 *
 * The two numbers do different jobs. Veo sees the first three as pictures.
 * Every view, including the rest, is read by the design-spec pass, and that
 * pass has no provider limit — a gallery shot, an underside, a profile all
 * sharpen the written specification that the clip is then held to. So an
 * extra angle is never wasted; it stops being a *reference* and becomes
 * evidence for the spec.
 *
 * Six rather than more: each view is a ~1.3MB base64 JPEG in the queued
 * payload, against a 25mb body limit, and past half a dozen angles of one
 * piece the spec stops getting sharper.
 */
const MAX_VIEWS = 6;

/**
 * What reference mode actually accepts on the Gemini Developer API.
 *
 * Every one of these was learned from a 400: the mode is preview, and the
 * SDK's types happily accept combinations the service rejects with a flat
 * "Your use case is currently not supported", which says nothing about
 * which argument was the problem. So a multi-view run is pinned to the one
 * combination that works, rather than passing the user's picks through and
 * failing minutes later in the queue:
 *
 *   - Fast and Lite do NOT support reference images. Standard only.
 *   - 16:9 only — 9:16 is rejected.
 *   - 8 seconds only — 4s and 6s are rejected.
 *   - 720p only — 1080p is rejected.
 *   - `negativePrompt` is rejected alongside references.
 *   - `image`/`lastFrame` cannot be combined with them.
 *
 * Single-view runs are unaffected and keep the full range of options.
 */
const REFERENCE_MODE = {
  model: "veo-3.1-generate-preview",
  aspectRatio: "16:9",
  resolution: "720p",
  durationSeconds: 8,
  /** Passed verbatim to the API, which wants it lowercase — the SDK's own enum says "ASSET" and is rejected. */
  referenceType: "asset",
};

const ASPECT_RATIOS = ["16:9", "9:16"];
const DEFAULT_ASPECT_RATIO = "16:9";
const RESOLUTIONS = ["720p", "1080p"];
const DEFAULT_RESOLUTION = "720p";

module.exports = {
  CAMERA_STYLES,
  MOOD_STYLES,
  DEFAULT_NEGATIVE_PROMPT,
  buildImageAnimationPrompt,
  buildDesignSpecPrompt,
  DURATION_OPTIONS,
  DEFAULT_DURATION,
  MIN_DURATION,
  MAX_DURATION,
  MAX_REFERENCE_IMAGES,
  MAX_VIEWS,
  REFERENCE_MODE,
  ASPECT_RATIOS,
  DEFAULT_ASPECT_RATIO,
  RESOLUTIONS,
  DEFAULT_RESOLUTION,
};

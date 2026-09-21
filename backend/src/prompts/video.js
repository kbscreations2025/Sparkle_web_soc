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
    description: "An elegant, slow 360° rotation around the piece — every angle revealed, the whole piece always in view.",
    value:
      "a slow, smooth, elegant 360-degree orbit around the piece at a fixed comfortable distance, revealing every angle — the ENTIRE piece stays fully visible within frame at all times, never cropped",
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
function buildImageAnimationPrompt({ camera, mood, description } = {}) {
  return [
    "CRITICAL — DO NOT alter the jewelry in any way: this is filming existing jewelry, not redesigning it. Its exact structure, geometry, proportions, stone count, stone placement, prong style, metal colour and every design detail must stay 100% IDENTICAL to the source image in every single frame.",
    `Animate this jewelry product photo into a short cinematic video. Camera: ${cameraValue(camera)}.`,
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

const ASPECT_RATIOS = ["16:9", "9:16"];
const DEFAULT_ASPECT_RATIO = "16:9";
const RESOLUTIONS = ["720p", "1080p"];
const DEFAULT_RESOLUTION = "720p";

module.exports = {
  CAMERA_STYLES,
  MOOD_STYLES,
  DEFAULT_NEGATIVE_PROMPT,
  buildImageAnimationPrompt,
  DURATION_OPTIONS,
  DEFAULT_DURATION,
  MIN_DURATION,
  MAX_DURATION,
  ASPECT_RATIOS,
  DEFAULT_ASPECT_RATIO,
  RESOLUTIONS,
  DEFAULT_RESOLUTION,
};

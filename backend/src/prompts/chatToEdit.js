/**
 * Chat to Edit has no single big prompt the way Image Cleaning does — every
 * turn is instruction-driven, so the prompt is assembled per request rather
 * than sent as-is. These are the fixed parts of that assembly: two safety
 * notes appended to every edit, kept here (not typed inline in the route) so
 * they're easy to find and adjust without hunting through request-handling
 * code.
 */
const { buildReferenceNote } = require("./shared");

const SCALE_NOTE =
  "SCALE: if the image contains jewelry, keep it rendered at true-to-life scale — small and " +
  "delicate, never oversized, chunky, or exaggerated, in correct proportion to the hand, ear, or " +
  "neck it sits on.";

const ANATOMY_NOTE =
  "ANATOMY: if the image contains a person, they must have exactly ONE head, exactly TWO arms, " +
  "and exactly TWO hands with exactly FIVE fingers each — never more, never fewer, no fused, " +
  "duplicated, or floating limbs. Keep every visible body part complete, correct, and naturally " +
  "proportioned.";

/**
 * Each edit runs on the previous result, so any small colour drift compounds
 * turn after turn — in practice a warm, reddish/pink cast creeping into the
 * metal, the white background and skin. Spelled out on every edit; a request
 * that does change a colour ("in rose gold") still wins for that one thing.
 */
const COLOR_NOTE =
  "COLOUR: keep every colour exactly as it is in the first image — the same white balance, colour " +
  "temperature, exposure and saturation; the metal's exact tone (yellow gold stays the same yellow, " +
  "white metal stays neutral); the stones' colours; a white background pure neutral white; skin tones " +
  "unchanged. Do NOT add any warm, red, pink, magenta or orange tint or colour cast anywhere. Only " +
  "change a colour if the instruction explicitly asks for it.";

/**
 * Builds one turn's prompt. `instruction` is whatever the user typed (already
 * carrying any annotation-guidance prefix the client adds); `referenceCount`
 * is how many reference images ride along after the base image, purely as
 * visual inspiration — never to be copied into the result wholesale.
 */
function buildChatEditPrompt(instruction, referenceCount = 0) {
  const referenceNote = buildReferenceNote(referenceCount);

  return (
    `Edit this photograph (the first image) exactly as instructed: ${instruction}.${referenceNote} ` +
    "Keep the same photorealistic quality, composition, and everything not specifically mentioned " +
    `unchanged. Only apply the requested change. ${COLOR_NOTE} ${SCALE_NOTE} ${ANATOMY_NOTE}`
  );
}

module.exports = { SCALE_NOTE, ANATOMY_NOTE, COLOR_NOTE, buildChatEditPrompt };

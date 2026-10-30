/**
 * Wording shared by every tool that accepts reference images alongside a base
 * one — Chat to Edit today, Image Cleaning's refine step too. Kept in one
 * place so the two never drift into subtly different phrasing for the same
 * instruction to the model.
 */
function buildReferenceNote(referenceCount) {
  if (!referenceCount) return "";
  return (
    ` ${referenceCount > 1 ? `${referenceCount} additional reference images are` : "A second reference image is"} ` +
    "also attached, purely as visual inspiration for the requested change (e.g. a detail, style " +
    "or element to borrow) — apply that idea onto the FIRST image, do not copy or blend in the " +
    "reference(s)' own subject, composition or background."
  );
}

/**
 * Keeps a cleaned photo looking from where the original did.
 *
 * Every cleaning prompt already listed "same viewing angle" among dozens of
 * rules — and a ring photographed from the side still came back turned to
 * face the camera. The prompts call the result a catalogue product shot, and
 * the model's idea of one is the front "hero" angle, so a side or back view
 * read as a mistake to correct and the unseen face of the piece was invented
 * to fill it. Generic wording lost to that pull; this names the views, says
 * outright that an unusual one is not to be fixed, and sits first, ahead of
 * everything that pulls the other way, with a check at the very end.
 */
const VIEW_LOCK = `VIEW LOCK — THE MOST IMPORTANT RULE, ABOVE EVERYTHING BELOW:
Keep the jewellery seen from EXACTLY the same viewpoint as in the input photo. First look at which side of the piece faces the camera — the face of the centre stone (front view), the head and band in profile (side view), the back of the setting or the inside of the band (back view), looking down onto it (top view), a three-quarter angle, or lying flat — and keep exactly that view.
- A side, back, top or unusual angle is NOT a mistake to correct. Do not turn the piece towards the camera, do not rotate it into the usual catalogue "hero" angle, and do not show any part of it — the face of a stone, the front of a setting, the far side of the band — that the input does not show.
- Every part keeps its place relative to the others: a stone seen edge-on stays edge-on, a band seen edge-on stays a thin edge, an upright piece stays upright and a tilted one keeps its tilt.
- Re-centring the piece in the frame or scaling it to fill the frame is fine; turning or re-posing it is not.
- Where a part is hidden, cut off or out of focus in the input, keep it that way — never reconstruct an unseen side.`;

const VIEW_CHECK =
  "FINAL CHECK — VIEWPOINT: compare the result with the input. Apart from its position and size in the frame, the piece must face the camera the same way, with the same outline and the same parts visible. If it has turned, it is wrong — keep the input's view.";

/** The same rule for a follow-up edit on a cleaned result, in one line. */
const VIEW_KEEP_NOTE =
  " Keep the jewellery seen from exactly the same viewpoint as in the first image — never turn or re-pose it — unless the request asks for a different angle.";

/**
 * "Remove engravings, hallmarks & brand stamps" on the cleaning form — on by
 * default. Most built-in cleaning prompts say to KEEP markings legible, so
 * this has to say plainly that it overrides them, or the two would fight and
 * the model would split the difference (a half-erased "750"). Pattern that is
 * part of the design is spelled out as staying, so "remove the stamp" can't
 * turn into "smooth off the milgrain".
 */
const REMOVE_MARKINGS_NOTE = `MARKINGS — THIS OVERRIDES every instruction above about keeping, preserving or making legible any engraving, hallmark, stamp, karat mark, logo or brand mark: REMOVE THEM ALL.
- Take off every engraving, hallmark, purity or karat stamp (e.g. "925", "750", "375", "18K", "14KT"), maker's mark, logo and brand stamp — inside and outside the band, on the clasp, on the back of the setting, anywhere on the piece.
- Where one was, show clean, smooth metal continuing exactly as the metal around it: the same colour, polish, curvature and reflections, with no trace, dent, shadow or ghost outline of the marking.
- Remove ONLY markings. Anything that is part of the piece's design — milgrain, filigree, a pattern or texture across the metal, decorative engraving that forms the motif — is NOT a marking and stays exactly as it is.`;

/** The same box unticked: the markings stay. Cleaning 2's prompt no longer says so itself. */
const KEEP_MARKINGS_NOTE =
  "MARKINGS: keep every engraving, hallmark, purity or karat stamp, maker's mark, logo and brand stamp exactly as it is — the same text, position, size and depth, crisp and legible. Never alter, invent or erase one.";

module.exports = { buildReferenceNote, VIEW_LOCK, VIEW_CHECK, VIEW_KEEP_NOTE, REMOVE_MARKINGS_NOTE, KEEP_MARKINGS_NOTE };

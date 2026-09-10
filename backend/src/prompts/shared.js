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

module.exports = { buildReferenceNote };

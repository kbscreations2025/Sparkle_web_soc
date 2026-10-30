/**
 * The optional labels a person can put on a conversation so they can find it
 * again from History — a design number today, more (a description) later.
 *
 * Kept as one list so every tool that offers them, and every route that
 * reads or edits them, agrees on what they are and how long they may be.
 * Adding a field here and to Conversation.details is the whole schema change.
 */
const DETAIL_FIELDS = [{ key: "designNo", label: "Design no.", maxLength: 50 }];

const DESIGN_NO_MAX = DETAIL_FIELDS.find((field) => field.key === "designNo").maxLength;

/**
 * The form a design number is matched on: upper-case letters and digits only.
 * People write the same code as "R-1203", "r 1203" and "R1203" — stripping
 * the punctuation makes all three one key, so a search for any of them finds
 * the others.
 */
function designNoKey(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * The details a request sent, cleaned up for storing — or null when there is
 * nothing to store. A design number is kept as typed (trimmed and capped) for
 * display, beside its key for searching. One with no letters or digits in it
 * at all ("--") is treated as not given.
 */
function readDetails(body) {
  const raw = typeof body?.designNo === "string" ? body.designNo.trim().slice(0, DESIGN_NO_MAX) : "";
  const key = designNoKey(raw);
  if (!key) return null;
  return { designNo: raw, designNoKey: key };
}

/** What a reader is shown — never the search key, which is ours. */
function publicDetails(details) {
  return { designNo: details?.designNo || null };
}

module.exports = { DETAIL_FIELDS, DESIGN_NO_MAX, designNoKey, readDetails, publicDetails };

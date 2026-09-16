const mongoose = require("mongoose");

/**
 * A word one organisation has taught the spellchecker through "Add to
 * dictionary" — a house spelling, a brand name, a collection name.
 *
 * Scoped to a tenant rather than a user: a brand name is right for everyone in
 * the organisation, and making each person teach it again would mean the
 * underlines stay wrong for most of them.
 *
 * `normalized` is the uniqueness key (lowercased, diacritics stripped) so
 * "Pavé" and "pave" cannot both be stored; `term` keeps the spelling the user
 * actually typed, which is what gets offered back as a correction.
 */
const lexiconTermSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
    term: { type: String, required: true, trim: true, maxlength: 80 },
    normalized: { type: String, required: true, trim: true, maxlength: 80 },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// One entry per word per organisation, and the query every check runs.
lexiconTermSchema.index({ tenantId: 1, normalized: 1 }, { unique: true });

module.exports = mongoose.model("LexiconTerm", lexiconTermSchema);

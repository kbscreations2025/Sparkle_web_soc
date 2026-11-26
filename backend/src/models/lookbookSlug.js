const mongoose = require("mongoose");

/**
 * Who holds each public lookbook link — one row per name.
 *
 * The unique index on `slug` is the whole point. Checking "is it taken?" and
 * then writing could lose a race between two people choosing the same name;
 * inserting a row either wins the name or fails, with nothing in between.
 *
 * A lookbook's current name is the row with `current: true`. Names it was
 * published under before stay as `current: false` rows, so an old link in
 * someone's chat still lands on the page (the public route redirects it).
 * Deleting a lookbook deletes its rows, which frees the names for anyone.
 */
const lookbookSlugSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, maxlength: 80 },
    lookbookId: { type: mongoose.Schema.Types.ObjectId, ref: "Lookbook", required: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
    current: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "lookbook_slugs" }
);

lookbookSlugSchema.index({ slug: 1 }, { unique: true });
// A lookbook's own names — to retire one on rename, or free them all on delete.
lookbookSlugSchema.index({ lookbookId: 1 });

module.exports = mongoose.model("LookbookSlug", lookbookSlugSchema);

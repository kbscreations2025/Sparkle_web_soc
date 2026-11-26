const mongoose = require("mongoose");

/**
 * A Live Lookbook: an animated marketing page built out of cards, shared as a
 * public link (/l/<slug> on the frontend) that anyone holding it can open
 * without signing in.
 *
 * Two copies of the page live here. `design` is the working copy the builder
 * saves as the person edits. `published` is the snapshot a client sees, and
 * only Publish writes it. Half-finished edits never reach someone who has the
 * link open on their phone, and "Unpublished changes" is just the two
 * revisions differing.
 *
 * Image bytes never live here. Every picture is an R2 url, either picked
 * from the person's library or uploaded through the library upload path
 * (storage/libraryImage.js), so even a long page stays a few dozen KB.
 *
 * The page's public name is `slug`, but who holds a name is decided by the
 * lookbook_slugs collection (models/lookbookSlug.js), whose unique index is
 * what keeps two pages from claiming the same link.
 */

const LOOKBOOK_STATUSES = ["draft", "published"];

const publishedSchema = new mongoose.Schema(
  {
    /** The page as published: hidden cards and hidden prices already taken out (services/lookbookDesign.js). */
    design: { type: mongoose.Schema.Types.Mixed, required: true },
    title: { type: String, default: "", maxlength: 200 },
    /** Which save of `design` this is, so a later save shows as "unpublished changes". */
    revision: { type: Number, required: true },
    publishedAt: { type: Date, required: true },
    /**
     * A 1200×630 JPEG for link previews (WhatsApp, iMessage, Slack), made from
     * the page's lead picture after each publish. Null until it has been made,
     * or when it couldn't be; the page then offers the picture's own
     * thumbnail instead.
     */
    ogImageUrl: { type: String, default: null },
  },
  { _id: false }
);

const lookbookSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    userName: { type: String, required: true, trim: true, maxlength: 200 },

    /** The person's name for the page. Also its title on the web, unless the page sets its own. */
    title: { type: String, default: "Untitled lookbook", trim: true, maxlength: 200 },
    /** The link's current name, mirrored from lookbook_slugs for display. */
    slug: { type: String, default: null, maxlength: 80 },
    status: { type: String, enum: LOOKBOOK_STATUSES, default: "draft", required: true },

    /** The working copy: theme, cards and meta (see the frontend's lib/lookbook/types.ts). */
    design: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Bumped by every save, and checked on the next, so two tabs can't silently overwrite each other. */
    revision: { type: Number, default: 0 },
    published: { type: publishedSchema, default: null },
    /**
     * Set once, at the first publish. From then on a renamed link keeps its old
     * name pointing here, since it may already be in someone's chat; a page
     * that was never published has no such link to keep.
     */
    firstPublishedAt: { type: Date, default: null },

    /** A small picture for the list of lookbooks, taken from the page's first photo. */
    coverUrl: { type: String, default: null },

    /*
     * Room for the next phases, not built yet: a PIN to open the page and a
     * date it stops opening. Nothing writes these today. When something does,
     * the public read (services/lookbooks.js, `isOpenToPublic`) already refuses
     * a page past its date and one with a PIN, so a half-built phase can't
     * leave a page more open than its owner set. Analytics belong in a
     * collection of their own, keyed by lookbook, rather than on this document.
     */
    access: {
      pinHash: { type: String, default: null },
      expiresAt: { type: Date, default: null },
    },

    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "lookbooks" }
);

// "My lookbooks", newest first.
lookbookSchema.index({ tenantId: 1, userId: 1, deletedAt: 1, _id: -1 });

module.exports = mongoose.model("Lookbook", lookbookSchema);
module.exports.LOOKBOOK_STATUSES = LOOKBOOK_STATUSES;

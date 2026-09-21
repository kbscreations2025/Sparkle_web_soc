const mongoose = require("mongoose");

/**
 * A saved Marketing Kit — one Brand Story narrative, or one Affinity catalog
 * deck.
 *
 * Unlike a Generation, which is an immutable audit record of a single model
 * call, this is a working document: the user reopens it and edits titles,
 * captions, card sizes and note boxes, so it is updated in place. Both exist
 * and answer different questions — "what did this run cost, and what was it
 * sent?" versus "what is this deck?".
 *
 * Image bytes never live here. Every picture is an R2 pointer: an
 * eight-piece Affinity kit with sheet pages would be tens of megabytes
 * inline and would breach MongoDB's 16MB document ceiling outright.
 */

const MARKETING_KIT_TYPES = ["brand_story", "affinity", "campaign"];
const MARKETING_KIT_STATUSES = ["draft", "ready", "failed"];
const MARKETING_KIT_IMAGE_ROLES = ["product", "sheet", "model"];

/** One stored upload. */
const imageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: MARKETING_KIT_IMAGE_ROLES, required: true },
    r2Bucket: { type: String, required: true },
    r2Key: { type: String, required: true },
    url: { type: String, required: true },
    /**
     * A grid-sized copy, written beside the original. Null where the resize
     * failed, and every reader falls back to `url` — so a null here costs
     * bandwidth and nothing else.
     */
    thumbnailKey: { type: String, default: null },
    thumbnailUrl: { type: String, default: null },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    fileName: { type: String, default: null, maxlength: 300 },
    /** Set when this page was rendered out of a PDF, so the source file stays identifiable. */
    pdfName: { type: String, default: null, maxlength: 300 },
    pdfPage: { type: Number, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

/**
 * An Excel sheet carries no image, so its extracted text is the only copy —
 * capped so one pathological workbook cannot push the document toward the
 * 16MB ceiling on its own.
 */
const sheetExcelSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true, maxlength: 300 },
    text: { type: String, required: true, maxlength: 200_000 },
  },
  { _id: false }
);

/** Affinity only — one catalog piece, its hero photo and its own production sheet. */
const pieceSchema = new mongoose.Schema(
  {
    /** Position in the uploaded set. An item's `index` refers to this. */
    index: { type: Number, required: true },
    productImage: { type: imageSchema, default: null },
    sheetImages: { type: [imageSchema], default: [] },
    sheetExcel: { type: [sheetExcelSchema], default: [] },
    designerInitial: { type: String, default: "", maxlength: 40 },
    /**
     * Denormalised from the sheet arrays — the Existing-style vs New-Ideation
     * split that both the job and the result view key off. Stored rather than
     * recomputed so the two can't disagree about which pieces the model was
     * allowed to describe.
     */
    hasProductionSheet: { type: Boolean, required: true },
  },
  { _id: true }
);

const noteSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    text: { type: String, default: "", maxlength: 2000 },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
  },
  { _id: false }
);

const affinityItemSchema = new mongoose.Schema(
  {
    index: { type: Number, required: true },
    category: { type: String, default: "", maxlength: 100 },
    title: { type: String, default: "", maxlength: 300 },
    caption: { type: String, default: "", maxlength: 1000 },
    sourceCode: { type: String, default: null, maxlength: 100 },
    size: { type: String, enum: ["sm", "md", "lg"], default: "md" },
    width: { type: Number, default: undefined },
    height: { type: Number, default: undefined },
    notes: { type: [noteSchema], default: undefined },
  },
  { _id: false }
);

const brandStorySchema = new mongoose.Schema(
  {
    images: { type: [imageSchema], default: [] },
    sheetImages: { type: [imageSchema], default: [] },
    /** The current narrative — the user may have edited it. */
    analysis: { type: String, default: "", maxlength: 50_000 },
    /** Exactly as first generated. Never edited, so AI copy stays distinguishable from human. */
    originalAnalysis: { type: String, default: "", maxlength: 50_000 },
  },
  { _id: false }
);

const affinitySchema = new mongoose.Schema(
  {
    pieces: { type: [pieceSchema], default: [] },
    collectionName: { type: String, default: "", maxlength: 300 },
    tagline: { type: String, default: "", maxlength: 500 },
    /** The cover slide's draggable split, as a percentage. Document state, not a preference. */
    coverSplit: { type: Number, default: 50, min: 0, max: 100 },
    items: { type: [affinityItemSchema], default: [] },
    originalItems: { type: [affinityItemSchema], default: [] },
  },
  { _id: false }
);

/**
 * Campaign Kit only — one of the four shots a kit is made of.
 *
 * Points at the Asset the runner already wrote rather than re-uploading the
 * picture: the bytes are in R2 once, and this is the deck's view of them.
 * `caption` is the editable half, the same way an Affinity item's is.
 */
const campaignShotSchema = new mongoose.Schema(
  {
    /** "lifestyleWarm" | "lifestyleDramatic" | "studioClean" | "studioLuxury". */
    id: { type: String, required: true, maxlength: 60 },
    label: { type: String, required: true, maxlength: 120 },
    assetId: { type: mongoose.Schema.Types.ObjectId, ref: "Asset", default: null },
    url: { type: String, required: true },
    thumbnailUrl: { type: String, default: null },
    caption: { type: String, default: "", maxlength: 1000 },
  },
  { _id: false }
);

/**
 * Campaign Kit: four shots of one piece — two worn, two alone.
 *
 * Unlike the other two kinds, its pictures are Assets from a normal image
 * generation, so nothing here holds bytes of its own except the inputs,
 * which are what a re-run would need.
 */
const campaignSchema = new mongoose.Schema(
  {
    modelImage: { type: imageSchema, default: null },
    sourceImages: { type: [imageSchema], default: [] },
    shots: { type: [campaignShotSchema], default: [] },
    /** What was picked in the builder — box, poses, props, aspect, notes. */
    options: { type: mongoose.Schema.Types.Mixed, default: {} },
    /** The shots as generated. Never edited, same rule as `originalItems`. */
    originalShots: { type: [campaignShotSchema], default: [] },
  },
  { _id: false }
);

const marketingKitSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    userName: { type: String, required: true, trim: true, maxlength: 200 },

    kind: { type: String, enum: MARKETING_KIT_TYPES, required: true },
    title: { type: String, default: "", trim: true, maxlength: 300 },
    status: { type: String, enum: MARKETING_KIT_STATUSES, default: "ready", required: true },
    model: {
      provider: { type: String, required: true },
      modelId: { type: String, required: true },
      modelLabel: { type: String, default: null },
      _id: false,
    },
    /** Links back to the immutable audit record for the call that produced this. */
    generationId: { type: mongoose.Schema.Types.ObjectId, ref: "Generation", default: null },

    brandStory: { type: brandStorySchema, default: null },
    affinity: { type: affinitySchema, default: null },
    campaign: { type: campaignSchema, default: null },

    /**
     * Why a kit ended up `failed`. Written when the run produced something
     * but storing it didn't — without this a failed save is invisible, and
     * the user is left with a result on screen and no document behind it.
     */
    error: { type: String, default: null, maxlength: 500 },

    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "marketing_kits" }
);

/*
 * Sorted and paginated on `_id`, never `createdAt` — `_id` is unique, so a
 * cursor on it cannot skip or repeat a row, and every index below ends in
 * the field actually sorted on.
 */
// "My kits", newest first.
marketingKitSchema.index({ tenantId: 1, userId: 1, deletedAt: 1, _id: -1 });
// An admin's view across every user.
marketingKitSchema.index({ tenantId: 1, deletedAt: 1, _id: -1 });
// Filtered to one kind.
marketingKitSchema.index({ tenantId: 1, kind: 1, deletedAt: 1, _id: -1 });

module.exports = mongoose.model("MarketingKit", marketingKitSchema);
module.exports.MARKETING_KIT_TYPES = MARKETING_KIT_TYPES;
module.exports.MARKETING_KIT_STATUSES = MARKETING_KIT_STATUSES;
module.exports.MARKETING_KIT_IMAGE_ROLES = MARKETING_KIT_IMAGE_ROLES;

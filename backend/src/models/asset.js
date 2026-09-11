const mongoose = require("mongoose");
const {
  GENERATION_TOOLS,
  ASSET_KINDS,
  ASSET_ROLES,
  ASSET_TYPES,
  ASSET_STATUSES,
} = require("../generations");

/**
 * One image, in or out. The bytes live in S3 — this row is the pointer plus
 * enough metadata to list a gallery without fetching anything.
 *
 * Never store image data here. A base64 payload is fine in transit (browser →
 * route → model → route) but putting it in Mongo would blow the 16MB document
 * limit and drag every query that touches the collection.
 */
const assetSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    userName: { type: String, required: true, trim: true, maxlength: 200 },

    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true },
    generationId: { type: mongoose.Schema.Types.ObjectId, ref: "Generation", required: true },

    // ── denormalised from the parent generation ──
    // A flat "all my images" gallery filters and labels on these, and joining
    // back to the generation for every tile would defeat the point.
    tool: { type: String, enum: GENERATION_TOOLS, required: true },
    modelLabel: { type: String, default: null },
    quality: { type: String, default: null },

    kind: { type: String, enum: ASSET_KINDS, required: true },
    role: { type: String, enum: ASSET_ROLES, required: true },
    type: { type: String, enum: ASSET_TYPES, required: true },

    // ── where the bytes actually are ──
    s3Bucket: { type: String, required: true },
    s3Key: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },

    // Measured at upload, from the same decode that produces the thumbnail.
    // Null on rows written before that existed, and on anything the decoder
    // couldn't read — a gallery reserving layout space has to tolerate both.
    width: { type: Number, default: null },
    height: { type: Number, default: null },

    /**
     * A small WebP copy of the same picture, written beside the original at
     * upload time. A grid of 24 tiles pulling full-size results is tens of
     * megabytes; the same grid on thumbnails is under one.
     *
     * Null means there isn't one — a row written before this existed, or a
     * resize that failed. Every reader falls back to the original, so a null
     * here costs bandwidth and nothing else.
     */
    thumbnail: {
      type: new mongoose.Schema(
        {
          s3Key: { type: String, required: true },
          mimeType: { type: String, required: true },
          sizeBytes: { type: Number, required: true },
          width: { type: Number, required: true },
          height: { type: Number, required: true },
        },
        { _id: false }
      ),
      default: null,
    },

    /** sha256 of the bytes. Detects a re-upload of the same file, and proves S3 still holds what we wrote. */
    checksum: { type: String, required: true },

    status: { type: String, enum: ASSET_STATUSES, default: "ready", required: true },

    // Soft delete: the S3 object goes first, this row stays so a generation
    // that referenced it can still explain itself.
    deletedAt: { type: Date, default: null },
  },
  // No updatedAt: an asset's bytes are immutable, so the row never meaningfully changes.
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Replaying one generation — every image it read and wrote.
assetSchema.index({ generationId: 1 });
// The flat gallery. _id descending doubles as newest-first, since ObjectIds
// carry their creation time.
assetSchema.index({ tenantId: 1, tool: 1, _id: -1 });
assetSchema.index({ tenantId: 1, userId: 1, _id: -1 });
assetSchema.index({ checksum: 1 });

module.exports = mongoose.model("Asset", assetSchema);

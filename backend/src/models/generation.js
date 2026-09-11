const mongoose = require("mongoose");
const { GENERATION_TOOLS, GENERATION_STATUSES, ASSET_ROLES } = require("../generations");

/**
 * A denormalised copy of an Asset, embedded so a history thread renders from
 * the generation alone. The Asset rows stay the source of truth — these are a
 * snapshot of how it looked when the run happened.
 */
const assetSnapshotSchema = new mongoose.Schema(
  {
    assetId: { type: mongoose.Schema.Types.ObjectId, ref: "Asset", required: true },
    url: { type: String, required: true },
    /**
     * The grid-sized copy. Null where there isn't one, and every reader falls
     * back to `url` — so this being absent is a bandwidth cost, never a
     * broken tile. Carried here rather than looked up from the Asset because
     * History renders from these snapshots alone and never joins.
     */
    thumbnailUrl: { type: String, default: null },
    role: { type: String, enum: ASSET_ROLES, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
  },
  { _id: false }
);

/**
 * One run of one tool — a click of Generate, or one refinement of an earlier
 * result. Holds everything needed to explain what was asked and what came
 * back, so a run can be audited or replayed long after the fact.
 */
const generationSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    userName: { type: String, required: true, trim: true, maxlength: 200 },

    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true },
    /** Turn number within the conversation, starting at 1. Orders the thread. */
    sequence: { type: Number, required: true },

    tool: { type: String, enum: GENERATION_TOOLS, required: true },

    // A refinement points at what it refined; both point at the run that
    // started the chain, so the whole thread is one query rather than a walk.
    parentGenerationId: { type: mongoose.Schema.Types.ObjectId, ref: "Generation", default: null },
    rootGenerationId: { type: mongoose.Schema.Types.ObjectId, ref: "Generation", default: null },

    status: { type: String, enum: GENERATION_STATUSES, default: "pending", required: true },

    model: {
      provider: { type: String, required: true },
      /** The id actually sent upstream, e.g. "gemini-3-pro-image". */
      modelId: { type: String, required: true },
      /** What the user saw, e.g. "Sparkle 3 Pro Image". Kept so history reads the way the UI did. */
      modelLabel: { type: String, default: null },
    },

    /**
     * Which key produced this — the `_id` of a `tenant.aiProviders` entry, not
     * a ref, because those are subdocuments. Records the key even after it is
     * rotated or disabled, which is what makes "why did this one fail?"
     * answerable.
     */
    aiProviderId: { type: mongoose.Schema.Types.ObjectId, default: null },

    request: {
      /** What the person typed. Null on a default run, where the built-in prompt is used as-is. */
      userPrompt: { type: String, default: null },
      /** What was actually sent upstream. The only field that explains the output. */
      finalPrompt: { type: String, required: true },
      // Per-tool and free-form on purpose: every tool has its own knobs, and
      // pinning them here would mean a schema change per tool.
      params: { type: mongoose.Schema.Types.Mixed, default: {} },
      inputAssetIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Asset" }],
      inputAssets: [assetSnapshotSchema],
    },

    response: {
      outputAssetIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Asset" }],
      outputAssets: [assetSnapshotSchema],
      /** Some models return commentary alongside the image. */
      text: { type: String, default: null },
      error: {
        type: new mongoose.Schema(
          { message: { type: String, required: true }, code: { type: String, default: null } },
          { _id: false }
        ),
        default: null,
      },
      generationTimeMs: { type: Number, default: null },
      completedAt: { type: Date, default: null },
    },

    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Rendering one thread in order.
generationSchema.index({ conversationId: 1, sequence: 1 });
// History, and an org admin looking at one person's work.
generationSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
generationSchema.index({ tenantId: 1, tool: 1, createdAt: -1 });
// Finding runs that died mid-flight.
generationSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model("Generation", generationSchema);

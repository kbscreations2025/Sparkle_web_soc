const mongoose = require("mongoose");
const { GENERATION_TOOLS } = require("../generations");

/**
 * One thread of work in one tool — the first run plus every refinement of it.
 * A tool with no refine step still gets one per run, so history has a single
 * shape to render whatever produced it.
 */
const conversationSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // Denormalised from User.name so an org's history list can show who made
    // what without joining every row.
    userName: { type: String, required: true, trim: true, maxlength: 200 },

    tool: { type: String, enum: GENERATION_TOOLS, required: true },

    // Cut from the prompt at creation. Only a caption for the history list.
    title: { type: String, trim: true, maxlength: 200, default: "" },

    /** First output image of the thread — the thumbnail in the history list. */
    previewUrl: { type: String, default: null },

    // Sorts the list. Distinct from updatedAt, which also moves for a rename
    // or any other touch that isn't new work.
    lastGenerationAt: { type: Date, default: Date.now },

    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// The history list: this person's threads, newest work first.
conversationSchema.index({ tenantId: 1, userId: 1, lastGenerationAt: -1 });
conversationSchema.index({ tenantId: 1, tool: 1, lastGenerationAt: -1 });

module.exports = mongoose.model("Conversation", conversationSchema);

const mongoose = require("mongoose");

/**
 * A saved model photo — the person a piece of jewellery gets placed onto.
 *
 * Not a Generation, and deliberately its own collection rather than a role on
 * one. A generation is an immutable record of one run; this is a reusable
 * input that outlives the run that made it, gets renamed, gets shared with
 * the organization, and is picked from a list months later. Some of these
 * were never generated at all — a directly uploaded photo saves here too,
 * with no run behind it.
 *
 * The bytes live in R2, as everywhere else. `imageUrl` is derived from
 * `r2Key` at write time and stored so a picker doesn't recompute it per row.
 */
const lifestyleModelSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // Denormalised, same as everywhere else, so an admin list can name the
    // creator without a join.
    userName: { type: String, required: true, trim: true, maxlength: 200 },

    name: { type: String, required: true, trim: true, maxlength: 100 },

    /**
     * What was asked for, when this one was generated. Free-form rather than
     * a strict shape: it is displayed and used to prefill the builder, never
     * queried on, and the builder's options change more often than a schema
     * should.
     */
    attrs: { type: mongoose.Schema.Types.Mixed, default: {} },
    notes: { type: String, default: null, maxlength: 300 },

    /**
     * NEVER REPLACED IN PLACE. Lifestyle and Campaign Kit runs point at this
     * photo (`params.modelRef`) instead of keeping their own copy, so a run
     * from months ago shows whatever is at this key. A new or edited photo is a
     * new model (or at least a new key) — never an overwrite of this one.
     */
    imageUrl: { type: String, required: true },
    r2Key: { type: String, required: true },
    thumbnailUrl: { type: String, default: null },

    /**
     * Set on the shared models that replaced the built-in presets (Model 4 and
     * Model 5) — what lets the seed script (scripts/seedLifestylePresets.js)
     * run twice without making duplicates. Null on every other model.
     */
    presetNumber: { type: Number, default: null },

    /**
     * Hard delete, by an admin, of a photo that must really go (a real
     * person's picture they asked to have removed). The R2 objects are deleted
     * and every run that pointed at it shows "model removed" instead. A plain
     * delete only sets `deletedAt` and keeps the photo, so past runs still show it.
     */
    purgedAt: { type: Date, default: null },

    /**
     * Visible to everyone in the organization rather than only its creator.
     * Only an org admin may set it — a model is a photograph of a person, so
     * sharing one is a decision, not a convenience.
     */
    isPublic: { type: Boolean, default: false, required: true },
    publicizedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    publicizedAt: { type: Date, default: null },

    status: { type: String, enum: ["active", "archived"], default: "active", required: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "lifestyle_models" }
);

// "My models" — a person's own, newest first.
lifestyleModelSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
// The shared feed everyone in the organization can pick from.
lifestyleModelSchema.index({ tenantId: 1, isPublic: 1, createdAt: -1 });
// An admin's view of every model in the organization.
lifestyleModelSchema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model("LifestyleModel", lifestyleModelSchema);

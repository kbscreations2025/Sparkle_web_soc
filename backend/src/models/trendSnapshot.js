const mongoose = require("mongoose");

/**
 * One month's jewellery design trends for one audience and jewellery type, as
 * a model with live web search read them — the flames on the Jewelry
 * Builder's options, what each row's "Trending" choice draws from, and the
 * direction a "Trending" or "Modern" design follows.
 *
 * Kept per organisation: the refresh runs on that organisation's own keys, so
 * one account never pays for another's list. `period` is the month ("2026-10");
 * a new month is a new row, refreshed the first time anyone opens the builder.
 *
 * `failedAt` marks a refresh that didn't work (no web-capable key, a bad
 * answer), so a broken setup falls back to the curated list for a while rather
 * than retrying the search on every page load.
 */
const trendSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 60 },
    hint: { type: String, default: "", trim: true, maxlength: 80 },
    cue: { type: String, required: true, trim: true, maxlength: 400 },
    picks: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const trendSnapshotSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
    audience: { type: String, enum: ["women", "men", "general"], required: true },
    type: { type: String, required: true, trim: true, maxlength: 40 },
    period: { type: String, required: true },
    trends: { type: [trendSchema], default: [] },
    /** What is in fashion per builder row, `{ settingStyle: ["Bezel"] }` — the builder's flame marks. */
    trending: { type: mongoose.Schema.Types.Mixed, default: {} },
    failedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One list per organisation, audience, type and month — and the lookup every
// builder load makes.
trendSnapshotSchema.index({ tenantId: 1, audience: 1, type: 1, period: 1 }, { unique: true });

module.exports = mongoose.model("TrendSnapshot", trendSnapshotSchema);

const mongoose = require("mongoose");
const { GENERATION_TOOLS } = require("../generations");

/**
 * `queued` and `running` are the live states a client polls; the last three
 * are terminal. Deliberately not reusing GENERATION_STATUSES: that vocabulary
 * describes a generation record, this one describes a unit of queued work,
 * and they stop matching the moment a job is cancelled before it ever ran.
 */
const JOB_STATUSES = ["queued", "running", "completed", "failed", "cancelled"];

/**
 * One unit of queued background work — the durable half of the job queue.
 *
 * Redis (via BullMQ) owns the *scheduling*: what runs next, retries, locks.
 * This collection owns the *record*: what was asked for, by whom, how it
 * ended. That split is why a browser reload no longer loses anything — the
 * client re-reads its in-flight jobs from here (GET /api/jobs) rather than
 * holding the only copy in React state.
 *
 * Image bytes are deliberately NOT stored here. They travel in the BullMQ
 * payload in Redis and are dropped with the job when it settles. Putting a
 * 25MB base64 body (the configured jsonBodyLimit) in a document would blow
 * Mongo's 16MB limit outright, and would make every job listing drag megabytes
 * it never renders. `request` keeps only what describes the run.
 */
const jobSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // Denormalised so a queue list can name who queued it without a join —
    // same reasoning as Asset/Generation.
    userName: { type: String, required: true, trim: true, maxlength: 200 },

    /**
     * What the worker should run, e.g. "cleaning.generate". The registry maps
     * this to a handler (see jobs/registry.js), which is what keeps the queue
     * generic: a new tool registers a new type, and nothing here changes.
     */
    type: { type: String, required: true },
    // Which product surface this belongs to, for filtering a per-tool queue.
    tool: { type: String, enum: GENERATION_TOOLS, required: true },

    status: { type: String, enum: JOB_STATUSES, default: "queued", required: true },

    /** What was asked for — never the images themselves. Shown in the queue UI. */
    request: { type: mongoose.Schema.Types.Mixed, default: {} },

    /**
     * A thumbnail of the input, so the queue can show *which* photo is being
     * worked on rather than a row of identical spinners.
     *
     * The one exception to "no image bytes here", and only because it is a
     * ~96px JPEG of a few kilobytes. The route enforces that size (see
     * MAX_PREVIEW_BYTES) — without a cap this field is a way to smuggle a
     * full-resolution image into every job listing.
     */
    preview: { type: String, default: null },
    /** What it produced: generationId/conversationId, so the UI can go fetch it. */
    result: { type: mongoose.Schema.Types.Mixed, default: null },

    error: {
      message: { type: String, default: null },
      // The provider's own code (HTTP status or error code), for triage.
      code: { type: String, default: null },
    },

    attempts: { type: Number, default: 0, min: 0 },
    maxAttempts: { type: Number, default: 1, min: 1 },
    /**
     * 0–100. Advanced continuously while a run is in flight, not only at
     * phase boundaries — see the ramp in worker.js. Written here at intervals
     * rather than on every tick: the live figure travels over the socket, and
     * this field only has to be close enough for a page that reloads
     * mid-generation.
     */
    progress: { type: Number, default: 0, min: 0, max: 100 },

    /** Which stage the run is in, for a label the percentage can't give — "preparing", "generating", "saving". */
    phase: { type: String, default: null },

    /**
     * How long this run was predicted to take, fixed at the moment it started.
     * The providers report no progress of their own, so this is what a
     * percentage and a "time left" are computed against. See jobs/estimate.js.
     */
    estimatedMs: { type: Number, default: null },

    /** How long it actually took. Written on completion, and the sample every future estimate is drawn from. */
    durationMs: { type: Number, default: null },

    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// The queue panel: this person's jobs, newest first — usually filtered to the
// two live statuses, which is why status leads the sort key.
jobSchema.index({ userId: 1, status: 1, createdAt: -1 });
// An admin/ops view of everything an organization has queued.
jobSchema.index({ tenantId: 1, createdAt: -1 });
// Duration sampling for the progress estimate (jobs/estimate.js) — it runs on
// the way into every job, so it must not be a collection scan.
jobSchema.index({ type: 1, "request.model": 1, status: 1, finishedAt: -1 });

module.exports = mongoose.model("Job", jobSchema);
module.exports.JOB_STATUSES = JOB_STATUSES;

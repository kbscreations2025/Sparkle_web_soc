const mongoose = require("mongoose");

/**
 * Every movement of credit, append-only.
 *
 * The accounts collection is a running total and can be rebuilt; this is the
 * record and cannot. Nothing here is ever updated or deleted — a correction
 * is another entry, which is what makes a balance explicable months later.
 */
const LEDGER_KINDS = ["grant", "revoke", "transfer_in", "transfer_out", "hold", "settle", "refund", "adjust"];

const creditLedgerSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: "CreditAccount", required: true },
    /** Null on an organization-pool entry. */
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    kind: { type: String, enum: LEDGER_KINDS, required: true },

    /**
     * Signed, from the holder's point of view: a grant is positive, a
     * settlement negative. A hold is recorded as 0 — nothing has been spent
     * yet, only frozen — with the frozen figure in `held`. Summing `amount`
     * over every entry therefore gives the balance, with no need to know
     * which kinds count.
     */
    amount: { type: Number, required: true, default: 0 },
    /** What a hold froze, and what its settle/refund is closing out. */
    held: { type: Number, default: 0 },

    /** Balance after this entry, for reading a statement without re-summing. */
    balanceAfter: { type: Number, default: null },

    // ── what this paid for ────────────────────────────────────────────────
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: "Job", default: null },
    generationId: { type: mongoose.Schema.Types.ObjectId, ref: "Generation", default: null },
    tool: { type: String, default: null },

    /**
     * The quote, frozen at the moment of the hold and reused at settlement.
     *
     * Copied rather than referenced so that editing a price while a video is
     * rendering cannot change what that render costs — and so the question
     * the pricing model was built to answer ("why was this billed 12
     * credits?") stays answerable after the rule is retired.
     */
    pricingRuleId: { type: mongoose.Schema.Types.ObjectId, ref: "CreditPricingRule", default: null },
    modelId: { type: String, default: null },
    quality: { type: String, default: null },
    unit: { type: String, default: null },
    unitPrice: { type: Number, default: null },
    units: { type: Number, default: null },

    // ── who and why ───────────────────────────────────────────────────────
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorName: { type: String, default: null },
    reason: { type: String, default: null, maxlength: 500 },

    /**
     * What makes this entry unique. Prefix first, so a scan by kind is a
     * prefix match: `settle:<jobId>`, `refund:<jobId>`,
     * `hold:<accountId>:<hint>`, `grant:<accountId>:<stamp>`. The hold and
     * grant shapes are not job-keyed at all — a hold is taken before the job
     * exists, and a grant has no job.
     *
     * The unique index on it is the defence against double-billing, and it
     * is a hard guarantee rather than a careful one. BullMQ hands a job to
     * another worker when a lock lapses (worker.js is explicit that this
     * would otherwise mean "duplicate images and double billing"), and a
     * retried settlement must be impossible, not merely unlikely. The insert
     * is attempted first and the account is only moved if it succeeded, so a
     * duplicate delivery fails here and touches no balance.
     */
    idempotencyKey: { type: String, required: true },
  },
  { timestamps: true, collection: "credit_ledger" }
);

creditLedgerSchema.index({ idempotencyKey: 1 }, { unique: true });
// A holder's statement, newest first.
creditLedgerSchema.index({ accountId: 1, createdAt: -1 });
// Everything an organization has spent, for the admin view.
creditLedgerSchema.index({ tenantId: 1, createdAt: -1 });
/*
 * Deliberately no index on `jobId`. Nothing queries by it — a hold is found
 * by its idempotency key, a settle and a refund insert rather than search,
 * and the reaper works off the jobs collection — so an index here would be
 * write amplification on every entry for no read. Add one when something
 * actually reads a job's entries.
 */

module.exports = mongoose.model("CreditLedger", creditLedgerSchema);
module.exports.LEDGER_KINDS = LEDGER_KINDS;

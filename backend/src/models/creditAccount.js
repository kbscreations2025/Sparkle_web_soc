const mongoose = require("mongoose");

/**
 * Who holds credits: one row per user, plus one per organization.
 *
 * ── why three balance fields ────────────────────────────────────────────
 * `balance` is what the holder owns, `reserved` is what in-flight jobs have
 * frozen, and `available` is what can be spent right now. The invariant,
 * which every operation below preserves, is:
 *
 *     balance - reserved === available
 *
 * `available` is stored rather than computed because it is what every spend
 * is guarded on. A guard on a stored field is an indexed comparison inside
 * the update filter, which makes the whole operation atomic in one round
 * trip; comparing two fields would need `$expr` and lose that. The atomicity
 * is the point — see `hold()` below.
 *
 * ── integers ────────────────────────────────────────────────────────────
 * Every amount is a whole credit, where 1 credit = 1 US cent (see
 * scripts/seedPricing.js). Nothing here is ever a float: provider rates like
 * 0.134 are converted to credits at the pricing layer, and letting a
 * fraction reach a balance is how you end up storing 0.30000000000000004.
 */
const creditAccountSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },

    /**
     * Null means this is the organization's own pool rather than a person's
     * account. The pool is where a super admin's grant to an organization
     * lands, and what an org admin distributes from.
     *
     * Nothing spends from the pool today: a run is charged to the user who
     * asked for it, and a user with no credits is refused rather than
     * falling back to the pool. That was a deliberate choice — see the
     * "strict allocation" decision — and the pool exists so the later
     * distribution step has somewhere to draw from.
     */
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    balance: { type: Number, default: 0, min: 0 },
    reserved: { type: Number, default: 0, min: 0 },
    available: { type: Number, default: 0, min: 0 },

    /** Running totals, for display. Derived from the ledger and never spent against. */
    lifetimeGranted: { type: Number, default: 0, min: 0 },
    lifetimeSpent: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, collection: "credit_accounts" }
);

// One account per holder. `userId: null` is a real value Mongo indexes, so
// the organization pool gets its own row under the same unique key.
creditAccountSchema.index({ tenantId: 1, userId: 1 }, { unique: true });

/** The account for one holder, created on first sight rather than at signup. */
creditAccountSchema.statics.ensure = async function ensure(tenantId, userId = null) {
  return this.findOneAndUpdate(
    { tenantId, userId },
    { $setOnInsert: { balance: 0, reserved: 0, available: 0 } },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
  );
};

/**
 * Freezes `amount` against this account.
 *
 * The filter is the guard: `available: { $gte: amount }` and the decrement
 * happen in one atomic document update, so two jobs queued at the same
 * instant cannot both pass a check that only one of them can afford. Reading
 * the balance and then writing it would leave exactly that gap.
 *
 * @returns the updated account, or null when the account cannot afford it —
 *          null is the caller's "insufficient credits", not an error.
 */
creditAccountSchema.statics.hold = async function hold(accountId, amount) {
  if (amount <= 0) return this.findById(accountId);

  return this.findOneAndUpdate(
    { _id: accountId, available: { $gte: amount } },
    { $inc: { available: -amount, reserved: amount } },
    { returnDocument: "after" }
  );
};

/**
 * Converts a hold into a charge.
 *
 * `actual` may be less than `held` — four images were paid for and two came
 * back — and the difference returns to `available` in the same update. That
 * is the whole reason holds exist rather than charging up front.
 */
creditAccountSchema.statics.settle = async function settle(accountId, held, actual) {
  const spend = Math.max(0, Math.min(actual, held));

  return this.findOneAndUpdate(
    { _id: accountId },
    {
      $inc: {
        reserved: -held,
        balance: -spend,
        available: held - spend,
        lifetimeSpent: spend,
      },
    },
    { returnDocument: "after" }
  );
};

/** Releases a hold in full: the job failed, was cancelled, or never ran. */
creditAccountSchema.statics.release = async function release(accountId, held) {
  return this.findOneAndUpdate(
    { _id: accountId },
    { $inc: { reserved: -held, available: held } },
    { returnDocument: "after" }
  );
};

/** Adds credits. Grants and transfers both land here. */
creditAccountSchema.statics.credit = async function credit(accountId, amount) {
  return this.findOneAndUpdate(
    { _id: accountId },
    { $inc: { balance: amount, available: amount, lifetimeGranted: Math.max(0, amount) } },
    { returnDocument: "after" }
  );
};

/**
 * Takes credits back, never below what is spendable.
 *
 * Guarded on `available` rather than `balance`: credits frozen by a job
 * already in flight are spoken for, and clawing them back would leave that
 * job unable to settle.
 */
creditAccountSchema.statics.debit = async function debit(accountId, amount) {
  return this.findOneAndUpdate(
    { _id: accountId, available: { $gte: amount } },
    { $inc: { balance: -amount, available: -amount } },
    { returnDocument: "after" }
  );
};

module.exports = mongoose.model("CreditAccount", creditAccountSchema);

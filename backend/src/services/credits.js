const CreditAccount = require("../models/creditAccount");
const CreditLedger = require("../models/creditLedger");
const CreditPricingRule = require("../models/creditPricingRule");

/**
 * The credit system: what a run costs, freezing it while the run happens,
 * and charging for what was actually delivered.
 *
 * ── the shape of a charge ───────────────────────────────────────────────
 * A run is quoted when it is queued and charged when it finishes, and the
 * two numbers are allowed to differ. Four images are quoted; if two come
 * back, two are charged and the rest is returned. Nothing is charged for a
 * run that fails.
 *
 * Between those points the credits are *frozen*: taken out of what the user
 * can spend, but not yet spent. That is what stops ten simultaneous jobs
 * from each passing an affordability check that only the first can really
 * afford.
 *
 * ── what is billed ──────────────────────────────────────────────────────
 * The primary model only. A job that also makes a helper call — Image to
 * Video reads the piece with a text model before filming it, Marketing Kit
 * writes copy alongside its shots — is billed for the video or the images,
 * and the helper is absorbed. At current rates that helper is 3 credits
 * against 800 for a clip, and pricing it separately would cost an exact
 * quote on the button for a rounding error on the invoice.
 */

/**
 * Credit totals per organization, in one aggregate rather than a query per
 * row. Sums every account under a tenant — the pool and each member — and
 * keeps the pool separately, since granting to an organization and granting
 * to its people are different acts.
 *
 * `tenantIds` narrows it. Without that the single-organization pages were
 * grouping the whole collection and discarding all but one row.
 */
async function totalsByTenant(tenantIds = null) {
  const rows = await CreditAccount.aggregate([
    ...(tenantIds ? [{ $match: { tenantId: { $in: [].concat(tenantIds) } } }] : []),
    {
      $group: {
        _id: "$tenantId",
        balance: { $sum: "$balance" },
        reserved: { $sum: "$reserved" },
        available: { $sum: "$available" },
        pool: { $sum: { $cond: [{ $eq: ["$userId", null] }, "$balance", 0] } },
      },
    },
  ]);
  return new Map(rows.map((row) => [String(row._id), row]));
}

/**
 * Per-member balances for one organization, keyed by user id.
 *
 * Here rather than in a route because three routes need it and two of them
 * had copied it — and all three feed the same `Member` shape to the same
 * table, so a field added to one copy and not the other shows up as
 * `undefined` for one caller only.
 */
async function balancesByUser(tenantId) {
  const accounts = await CreditAccount.find({ tenantId, userId: { $ne: null } })
    .select("userId balance reserved available")
    .lean();

  return new Map(
    accounts.map((account) => [
      String(account.userId),
      { balance: account.balance, reserved: account.reserved, available: account.available },
    ])
  );
}

/** Errors the caller is expected to handle rather than log. */
class InsufficientCreditsError extends Error {
  constructor(required, available) {
    super("You do not have enough credits for this run.");
    this.name = "InsufficientCreditsError";
    this.code = "insufficient_credits";
    this.required = required;
    this.available = available;
  }
}

/**
 * How many priced units a request is worth.
 *
 * `per_image` counts the pictures asked for, `per_second` the length of the
 * clip, and `per_request` is always one. A unit that cannot be read from the
 * request falls back to 1 rather than 0: an unpriced run is a revenue leak,
 * and a wrong-but-visible charge is easier to notice and fix than a free one.
 */
function unitsFor(unit, { count, durationSeconds } = {}) {
  if (unit === "per_second") return Math.max(1, Math.round(durationSeconds || 1));
  if (unit === "per_image") return Math.max(1, Math.round(count || 1));
  return 1;
}

/**
 * What one run will cost, and under which rule.
 *
 * `modelId` must be the real model id. Image to Video's `request.model` is a
 * composite — "veo-3.1-generate-preview:720p:8s:3views" — built for the
 * duration estimator, and it matches no pricing rule; that route keeps the
 * clean id in `request.modelId`. Callers pass `request.modelId ?? request.model`,
 * and getting this wrong bills every video at the catch-all rate.
 */
async function quote({ tenantId, tool, modelId, quality, count, durationSeconds }) {
  const rules = await CreditPricingRule.findApplicable({ tenantId, tool, modelId, quality });
  // The seeded catch-all (modelId: null) means this is effectively never
  // empty — but a database seeded differently is not this code's business to
  // assume, and a run with no price must not be a free run.
  const rule = rules[0] || null;
  if (!rule) return null;

  const units = unitsFor(rule.unit, { count, durationSeconds });
  const unitPrice = Math.max(0, Math.round(rule.creditsPerUnit));

  return {
    ruleId: rule._id,
    ruleLabel: rule.label,
    unit: rule.unit,
    unitPrice,
    units,
    cost: unitPrice * units,
    modelId: modelId || null,
    quality: quality || null,
  };
}

/**
 * Writes a ledger entry, or reports that this exact entry already exists.
 *
 * Every balance change goes through here first, and only moves the account
 * if the insert was genuinely new. That ordering is what makes a repeated
 * settlement a no-op instead of a second charge.
 */
async function record(entry) {
  try {
    return { entry: await CreditLedger.create(entry), duplicate: false };
  } catch (err) {
    // 11000 is Mongo's duplicate-key error: this exact movement is already
    // recorded, so the balance was already moved for it.
    if (err.code === 11000) return { entry: null, duplicate: true };
    throw err;
  }
}

/**
 * Freezes the cost of a run before it is queued.
 *
 * @throws {InsufficientCreditsError} when the account cannot cover it — the
 *         route turns this into a 402 and never queues the job.
 * @returns what was frozen, to be stored on the job and closed out later.
 */
async function holdForRun({ tenantId, userId, userName, tool, priced, jobHint }) {
  const account = await CreditAccount.ensure(tenantId, userId);
  if (priced.cost <= 0) return { accountId: account._id, ...priced, held: 0 };

  const updated = await CreditAccount.hold(account._id, priced.cost);
  if (!updated) throw new InsufficientCreditsError(priced.cost, account.available);

  await record({
    tenantId,
    accountId: account._id,
    userId,
    kind: "hold",
    amount: 0,
    held: priced.cost,
    balanceAfter: updated.balance,
    tool,
    pricingRuleId: priced.ruleId,
    modelId: priced.modelId,
    quality: priced.quality,
    unit: priced.unit,
    unitPrice: priced.unitPrice,
    units: priced.units,
    actorUserId: userId,
    actorName: userName,
    // Nothing has a job id yet — the hold has to succeed before the job is
    // created, or a job could start that was never paid for. The key is
    // made unique by the account and the clock, and rewritten with the real
    // job id by `attachJob` once the queue has accepted it.
    idempotencyKey: `hold:${account._id}:${jobHint}`,
  });

  return { accountId: account._id, ...priced, held: priced.cost };
}

/** Links a hold to the job it paid for, once the queue has accepted it. */
async function attachJob(jobHint, accountId, jobId) {
  await CreditLedger.updateOne({ idempotencyKey: `hold:${accountId}:${jobHint}` }, { $set: { jobId } });
}

/**
 * Charges a finished run for what it actually delivered.
 *
 * `deliveredUnits` is the real count — `deliveredCount` from the batch
 * runner, which is already the number of pictures that came back rather
 * than the number asked for. Anything frozen beyond it is returned.
 */
async function settleRun({ credits, jobId, generationId, deliveredUnits }) {
  if (!credits?.held) return null;

  const actual = Math.min(credits.held, Math.max(0, Math.round(deliveredUnits ?? credits.units)) * credits.unitPrice);

  const { duplicate } = await record({
    tenantId: credits.tenantId,
    accountId: credits.accountId,
    userId: credits.userId,
    kind: "settle",
    amount: -actual,
    held: credits.held,
    tool: credits.tool,
    jobId,
    generationId: generationId || null,
    pricingRuleId: credits.ruleId,
    modelId: credits.modelId,
    quality: credits.quality,
    unit: credits.unit,
    unitPrice: credits.unitPrice,
    units: Math.round(actual / (credits.unitPrice || 1)),
    // A synchronous route has no job to key on — Chat to Edit answers in the
    // request rather than through the queue — so it falls back to the hint
    // the hold was taken under, which is unique per hold. Without this every
    // such run would key on "settle:null" and the second one would be
    // silently dropped as a duplicate.
    idempotencyKey: `settle:${jobId || credits.jobHint}`,
  });
  // Already settled — a re-delivered job, not a second charge.
  if (duplicate) return null;

  return CreditAccount.settle(credits.accountId, credits.held, actual);
}

/**
 * Returns a hold in full: the run failed for good, or was cancelled.
 *
 * Deliberately NOT called between attempts. A job that will be retried keeps
 * its hold — releasing and re-taking it would let a user at their limit be
 * locked out by their own retry.
 */
async function refundRun({ credits, jobId, reason }) {
  if (!credits?.held) return null;

  const { duplicate } = await record({
    tenantId: credits.tenantId,
    accountId: credits.accountId,
    userId: credits.userId,
    kind: "refund",
    amount: 0,
    held: credits.held,
    tool: credits.tool,
    jobId,
    pricingRuleId: credits.ruleId,
    modelId: credits.modelId,
    reason: reason || null,
    // A hold released before the job was ever created has no job id to key
    // on — the queue refusing the work is exactly that case — so it falls
    // back to the hint the hold was taken under, which is unique per hold.
    idempotencyKey: `refund:${jobId || credits.jobHint}`,
  });
  if (duplicate) return null;

  return CreditAccount.release(credits.accountId, credits.held);
}

/** A super admin putting credits into an organization pool or a person's account. */
async function grant({ tenantId, userId = null, amount, actorUserId, actorName, reason }) {
  const account = await CreditAccount.ensure(tenantId, userId);
  const updated = await CreditAccount.credit(account._id, amount);

  await record({
    tenantId,
    accountId: account._id,
    userId,
    kind: "grant",
    amount,
    balanceAfter: updated.balance,
    actorUserId,
    actorName,
    reason: reason || null,
    idempotencyKey: `grant:${account._id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
  });

  return updated;
}

/**
 * Taking credits back.
 *
 * Capped at what is spendable, so credits frozen by a job already running
 * cannot be pulled out from under it — that job still has to settle.
 */
async function revoke({ tenantId, userId = null, amount, actorUserId, actorName, reason }) {
  const account = await CreditAccount.ensure(tenantId, userId);
  const updated = await CreditAccount.debit(account._id, amount);
  if (!updated) throw new InsufficientCreditsError(amount, account.available);

  await record({
    tenantId,
    accountId: account._id,
    userId,
    kind: "revoke",
    amount: -amount,
    balanceAfter: updated.balance,
    actorUserId,
    actorName,
    reason: reason || null,
    idempotencyKey: `revoke:${account._id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
  });

  return updated;
}

/**
 * Moves credits between two holders inside one organization — the pool out
 * to a member, or a member's unspent balance back to the pool.
 *
 * This is what an organization admin does, and it is deliberately not a
 * grant: it can only move credit the organization already has. An admin who
 * could mint their own would have an unlimited budget, so issuing new credit
 * stays with platform staff.
 *
 * The debit is taken first and guarded on `available`, so a transfer can
 * never leave the source overdrawn — and if the credit that follows fails,
 * the ledger holds the debit alone, which the pair of entries makes visible
 * rather than silently losing the difference.
 *
 * `from`/`to` are user ids, or null for the organization's pool.
 */
async function transfer({ tenantId, fromUserId, toUserId, amount, actorUserId, actorName, reason }) {
  // Independent of each other — one round trip, not two.
  const [source, target] = await Promise.all([
    CreditAccount.ensure(tenantId, fromUserId),
    CreditAccount.ensure(tenantId, toUserId),
  ]);

  const debited = await CreditAccount.debit(source._id, amount);
  if (!debited) throw new InsufficientCreditsError(amount, source.available);

  const stamp = `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const common = { tenantId, actorUserId, actorName, reason: reason || null };

  await record({
    ...common,
    accountId: source._id,
    userId: fromUserId,
    kind: "transfer_out",
    amount: -amount,
    balanceAfter: debited.balance,
    idempotencyKey: `transfer_out:${source._id}:${stamp}`,
  });

  const credited = await CreditAccount.credit(target._id, amount);

  await record({
    ...common,
    accountId: target._id,
    userId: toUserId,
    kind: "transfer_in",
    amount,
    balanceAfter: credited.balance,
    idempotencyKey: `transfer_in:${target._id}:${stamp}`,
  });

  return { source: debited, target: credited };
}

module.exports = {
  InsufficientCreditsError,
  totalsByTenant,
  balancesByUser,
  transfer,
  quote,
  holdForRun,
  attachJob,
  settleRun,
  refundRun,
  grant,
  revoke,
};

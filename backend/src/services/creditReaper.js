const Job = require("../models/job");
const credit = require("./credits");

/**
 * Releases credits frozen by runs that will never finish.
 *
 * Every normal path closes its own hold: a run that succeeds settles, a run
 * that fails for good refunds. This exists for the paths that cannot. A
 * worker killed mid-generation leaves a job `running` with its credits
 * frozen and nothing left alive to charge or release them; so does a
 * settlement that threw after the images were saved. Without a sweep those
 * credits are gone from the user's balance permanently, with no record of
 * anything having been bought.
 *
 * Two rules, and the second is the careful one:
 *
 *   - A job in a terminal state with an unsettled hold is closed at once.
 *     It is finished; whatever it was going to do, it has done.
 *
 *   - A job still `queued` or `running` is only touched once it is far older
 *     than any honest run could be. A slow Veo render is genuinely minutes
 *     long, and refunding a job that is still working would let it settle
 *     against a hold that no longer exists. `STALE_AFTER_MS` is set well
 *     past the queue's own lock duration times its attempt count for that
 *     reason.
 */

/** Well beyond the slowest legitimate run, including every retry of it. */
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

/**
 * How often the sweep runs. Cheap because of the partial index on
 * `{credits.settled, status, createdAt}` in models/job.js — without it this
 * is a scan of every job ever created.
 */
const SWEEP_EVERY_MS = 10 * 60 * 1000;

async function sweepOnce() {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);

  const orphaned = await Job.find({
    "credits.held": { $gt: 0 },
    "credits.settled": false,
    $or: [
      { status: { $in: ["failed", "cancelled", "completed"] } },
      { status: { $in: ["queued", "running"] }, createdAt: { $lt: cutoff } },
    ],
  })
    .limit(500)
    .exec();

  let released = 0;
  for (const job of orphaned) {
    try {
      /*
       * Always a refund, never a charge — even for a job marked completed.
       *
       * A completed job whose hold is still open is one where settlement
       * failed after the work was saved. The user has their images and we
       * have no reliable count to bill; charging on a guess here would be
       * worse than the revenue we lose by releasing it, and the refund is
       * recorded in the ledger where it can be found and corrected.
       */
      await credit.refundRun({
        credits: { ...job.credits.toObject(), tenantId: job.tenantId, userId: job.userId, tool: job.tool },
        jobId: job._id,
        reason: `reaped — ${job.status} job with an open hold`,
      });

      job.credits.settled = true;
      await job.save();
      released += 1;
    } catch (err) {
      console.error(`[credits] could not reap the hold on job ${job._id}:`, err.message);
    }
  }

  if (released > 0) console.log(`[credits] released ${released} orphaned hold(s)`);
  return released;
}

/**
 * Starts sweeping. Called once at worker startup — a crash is exactly what
 * leaves holds open, so the first sweep runs immediately rather than waiting
 * out the interval.
 */
function startCreditReaper() {
  sweepOnce().catch((err) => console.error("[credits] startup sweep failed:", err.message));

  const timer = setInterval(
    () => sweepOnce().catch((err) => console.error("[credits] sweep failed:", err.message)),
    SWEEP_EVERY_MS
  );
  // Nothing should hold the process open purely to run a sweep.
  timer.unref?.();

  return { stop: () => clearInterval(timer) };
}

module.exports = { startCreditReaper, sweepOnce, STALE_AFTER_MS };

const Job = require("../models/job");
const credit = require("./credits");

/**
 * Closes out runs the last worker left unfinished. Runs once, at worker
 * startup — no timer, no repeated queries.
 *
 * Every normal path closes its own hold: a run that succeeds settles, a run
 * that fails for good refunds. A worker killed mid-generation does neither,
 * and leaves a job `running` with its credits frozen. When the worker comes
 * back, those runs are ended rather than resumed:
 *
 *   - A job still `running` was interrupted. It is marked failed and its hold
 *     refunded. BullMQ may re-deliver it once its lock expires, but
 *     processJob skips any job already in a terminal state, so it is not run
 *     again or charged twice.
 *
 *   - A job already finished, failed or cancelled with its hold still open
 *     (a settle or refund that threw) is refunded.
 *
 * Always a refund, never a charge — even for a job marked completed: the user
 * has their images, there is no reliable count to bill, and the refund is in
 * the ledger where it can be found and corrected.
 *
 * `queued` jobs are left alone: they are waiting in Redis and this worker is
 * about to pick them up.
 *
 * Assumes one worker. With several replicas, a starting replica would end
 * runs another, healthy replica is still working on.
 */
const INTERRUPTED_MESSAGE = "Interrupted — the server restarted during this run. Your credits were returned.";

async function closeInterruptedJobs() {
  const jobs = await Job.find({
    $or: [
      { status: "running" },
      { status: { $in: ["failed", "cancelled", "completed"] }, "credits.held": { $gt: 0 }, "credits.settled": false },
    ],
  }).exec();

  let closed = 0;
  for (const job of jobs) {
    try {
      const interrupted = job.status === "running";
      const holdOpen = job.credits?.held > 0 && !job.credits.settled;

      if (holdOpen) {
        await credit.refundRun({
          credits: { ...job.credits.toObject(), tenantId: job.tenantId, userId: job.userId, tool: job.tool },
          jobId: job._id,
          reason: interrupted ? "interrupted — worker restarted" : `closed at startup — ${job.status} job with an open hold`,
        });
        job.credits.settled = true;
      }

      if (interrupted) {
        job.status = "failed";
        job.error = { message: INTERRUPTED_MESSAGE, code: "interrupted" };
        job.finishedAt = new Date();
      }

      await job.save();
      closed += 1;
    } catch (err) {
      console.error(`[credits] could not close job ${job._id}:`, err.message);
    }
  }

  if (closed > 0) console.log(`[credits] closed ${closed} unfinished job(s) from before the restart`);
  return closed;
}

module.exports = { closeInterruptedJobs };

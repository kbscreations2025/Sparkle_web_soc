const Job = require("../models/job");
const credit = require("./credits");
const { getQueueForType } = require("../queue");

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
 * ONLY ITS OWN JOBS. Production and every developer's machine each have their
 * own Redis, but they can share one MongoDB. A local `npm run dev` restart
 * used to end every `running` job in that database — production's live runs
 * included, on every backend file save (29 colleagues' runs on 2026-11-06).
 * So a running job is closed only when this worker's own queue holds it
 * (BullMQ's job id is the Mongo id), or when it has been running far longer
 * than any run can take — an orphan, whoever owned it.
 *
 * Still assumes one worker per Redis: two replicas on the same queue would
 * end each other's runs at startup.
 */
const INTERRUPTED_MESSAGE = "Interrupted — the server restarted during this run. Your credits were returned.";

/** No run lasts this long; a job "running" past it has no worker left, whoever owned it. */
const ORPHANED_AFTER_MS = 2 * 60 * 60 * 1000;

/** A hold closed this recently may still be settling on the deployment that ran it. */
const SETTLING_GRACE_MS = 10 * 60 * 1000;

/**
 * Whether this worker's own queue knows the job. Unsure (Redis unreachable)
 * counts as no: leaving a run alone is recoverable, killing someone's is not.
 */
async function inOwnQueue(job) {
  try {
    return Boolean(await getQueueForType(job.type).getJob(String(job._id)));
  } catch {
    return false;
  }
}

async function closeInterruptedJobs() {
  const jobs = await Job.find({
    $or: [
      { status: "running" },
      { status: { $in: ["failed", "cancelled", "completed"] }, "credits.held": { $gt: 0 }, "credits.settled": false },
    ],
  }).exec();

  let closed = 0;
  let skipped = 0;
  const now = Date.now();

  for (const job of jobs) {
    try {
      const interrupted = job.status === "running";

      if (interrupted) {
        const started = (job.startedAt || job.createdAt)?.getTime?.() ?? now;
        const orphaned = now - started > ORPHANED_AFTER_MS;
        if (!orphaned && !(await inOwnQueue(job))) {
          skipped += 1;
          continue;
        }
      } else if (job.updatedAt && now - job.updatedAt.getTime() < SETTLING_GRACE_MS) {
        skipped += 1;
        continue;
      }

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
  if (skipped > 0) console.log(`[credits] left ${skipped} job(s) another worker may still be running`);
  return closed;
}

module.exports = { closeInterruptedJobs };

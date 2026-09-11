const { Worker, UnrecoverableError } = require("bullmq");
const config = require("./config");
const { createRedisConnection, closeRedisConnections, throttledLogger } = require("./redis");
const { getJobHandler } = require("./jobs/registry");
const { estimateDurationMs } = require("./jobs/estimate");
const { classifyProviderError } = require("./aiRouting");
const { logAudit } = require("./auditLog");
const Job = require("./models/job");

// Registers every handler. Required for its side effect, before any job runs.
require("./jobs");

/** How often a run in flight reports a new percentage to the browser. */
const TICK_MS = 1000;

/** How often those ticks are also written to Mongo. Higher, because the document only has to be right for a page that reloads mid-run — the live figure rides the socket. */
const PERSIST_EVERY_MS = 5000;

/**
 * Shapes elapsed time into a percentage across one phase.
 *
 * An exponential approach rather than a straight line, because the estimate
 * is a median and half of all runs will therefore overrun it. A linear bar
 * would hit the end of its phase and sit there — the exact frozen-percentage
 * problem this replaces. This curve reaches ~80% of the band at the predicted
 * time and keeps creeping after, approaching the phase end without ever
 * arriving: still moving on a slow run, and never claiming work is done
 * before the provider has answered.
 */
function rampedPercent(from, to, elapsedMs, estimatedMs) {
  const fraction = estimatedMs > 0 ? elapsedMs / estimatedMs : 0;
  return from + (to - from) * (1 - Math.exp(-1.6 * fraction));
}

/**
 * Runs one queued job.
 *
 * Mongo is updated at each transition rather than only at the end, because
 * that document is what a reloaded browser reads to find out what is still in
 * flight — a job whose state only existed in Redis would be invisible to the
 * very page that is waiting for it.
 */
async function processJob(bullJob) {
  const { jobId } = bullJob.data;

  const job = await Job.findById(jobId);
  // Nothing to retry against: the record this job describes is gone, so no
  // number of attempts will make it exist again.
  if (!job) throw new UnrecoverableError(`job ${jobId} has no record in the database`);

  // Already settled, so running it now would contradict what the user was
  // told. Happens when a cancel landed first, or when an enqueue timed out,
  // was reported as failed, and Redis accepted it anyway once it recovered.
  if (["cancelled", "failed", "completed"].includes(job.status)) {
    return { skipped: job.status };
  }

  job.status = "running";
  job.startedAt = job.startedAt || new Date();
  job.attempts = bullJob.attemptsMade + 1;
  job.error = { message: null, code: null };
  // What this run is predicted to cost, from what recent identical runs
  // actually cost. Fixed now and not revised mid-run: a bar whose target
  // moves under it jumps backwards, which reads as a bug.
  job.estimatedMs = await estimateDurationMs(job.type, job.request?.model);
  await job.save();

  // Every push to the browser goes through BullMQ's progress event, which the
  // API process bridges to Socket.IO (see startQueueEventsBridge) — the worker
  // is a separate service and holds no sockets of its own.
  //
  // The payload is an object rather than a bare number so the bridge can
  // overlay the live figure onto the stored document: Mongo is written every
  // few seconds, the socket every second, and the client should see the
  // faster of the two.
  let lastPersistedAt = 0;
  const publish = async (percent, phase, { persist = false } = {}) => {
    const rounded = Math.max(0, Math.min(100, Math.round(percent)));
    job.progress = rounded;
    if (phase) job.phase = phase;

    if (persist || Date.now() - lastPersistedAt >= PERSIST_EVERY_MS) {
      lastPersistedAt = Date.now();
      await job.save();
    }
    await bullJob.updateProgress({
      percent: rounded,
      phase: job.phase,
      estimatedMs: job.estimatedMs,
      startedAt: job.startedAt,
    });
  };

  // Doubles as the first push to the browser: BullMQ's `active` event fires
  // before this document says "running", so reporting progress here is what
  // makes the client's queued → running transition land in the right order.
  const setProgress = (percent, phase) => publish(percent, phase, { persist: true });
  await setProgress(5, "preparing");

  /**
   * Runs `fn` while walking the bar from `from` towards `to`.
   *
   * This is the whole fix for a percentage that used to sit still: the
   * provider call is nearly all of a job's wall time and reports nothing
   * while it runs, so without a clock driving the bar there is simply
   * nothing to send between the two milestones either side of it.
   *
   * The ticker is cleared in a `finally`, so a throw can't leave an interval
   * running against a settled job.
   */
  const withProgress = async ({ from, to, phase }, fn) => {
    const startedAt = Date.now();
    await publish(from, phase, { persist: true });

    const ticker = setInterval(() => {
      publish(rampedPercent(from, to, Date.now() - startedAt, job.estimatedMs), phase).catch((err) =>
        console.error(`[worker] progress tick failed for ${jobId}:`, err.message)
      );
    }, TICK_MS);
    // Nothing should be kept alive purely by a progress bar.
    ticker.unref?.();

    try {
      return await fn();
    } finally {
      clearInterval(ticker);
    }
  };

  try {
    const handler = getJobHandler(job.type);
    const result = await handler({ job, data: bullJob.data, setProgress, withProgress });

    job.status = "completed";
    job.result = result;
    job.progress = 100;
    job.phase = "done";
    job.finishedAt = new Date();
    // The sample every future estimate for this model is drawn from.
    job.durationMs = job.startedAt ? job.finishedAt - job.startedAt : null;
    await job.save();

    return result;
  } catch (err) {
    const attemptsAllowed = bullJob.opts.attempts || 1;
    const willRetry = !(err instanceof UnrecoverableError) && bullJob.attemptsMade + 1 < attemptsAllowed;
    const { message, code } = classifyProviderError(err, job.request?.provider);

    // Back to `queued` between attempts so the queue panel keeps showing it as
    // pending work rather than flashing "failed" and then un-failing.
    job.status = willRetry ? "queued" : "failed";
    job.error = { message, code };
    if (!willRetry) job.finishedAt = new Date();
    await job.save();

    if (!willRetry) {
      // The success path is already audited inside recordGeneration; this is
      // the matching row for a run that never got that far.
      logAudit({
        tenantId: job.tenantId,
        actorUserId: job.userId,
        actorName: job.userName,
        action: "generation.failed",
        status: "failure",
        targetType: "generation",
        targetId: String(job._id),
        message,
        metadata: { tool: job.tool, jobType: job.type, code, attempts: job.attempts, viaQueue: true },
      });
    }

    console.error(`[worker] job ${jobId} (${job.type}) failed:`, err.message);
    // Rethrown so BullMQ decides retry vs. dead — this function must not
    // swallow the failure or the job would be recorded as successful.
    throw err;
  }
}

/**
 * Starts consuming. Called by this file when run directly (the production
 * worker service) and by server.js in development, where one process is
 * friendlier than making `npm run dev` mean two terminals.
 */
function startWorker() {
  const worker = new Worker(config.queue.name, processJob, {
    connection: createRedisConnection("worker"),
    concurrency: config.queue.concurrency,
    // Must outlast the slowest honest run. Too low and BullMQ concludes a
    // worker died mid-generation and hands the same job to another one, so a
    // slow provider turns into duplicate images and double billing.
    lockDuration: config.queue.lockDurationMs,
  });

  worker.on("failed", (bullJob, err) => {
    console.error(`[worker] ${bullJob?.id ?? "unknown"} failed:`, err.message);
  });
  // Throttled: a worker whose Redis is unreachable re-emits this on every
  // reconnect attempt, which is a flood rather than information.
  const logWorkerError = throttledLogger("worker");
  worker.on("error", (err) => logWorkerError(err.message));
  worker.on("ready", () =>
    console.log(`[worker] consuming "${config.queue.name}" (concurrency ${config.queue.concurrency})`)
  );

  return worker;
}

module.exports = { startWorker, processJob };

// ── standalone entrypoint ───────────────────────────────────────────────────
// `npm run worker`. Own process, own Mongo connection, no HTTP server — this
// is what runs as a Render background worker alongside the web service.
if (require.main === module) {
  const { connectDb } = require("./db");

  (async () => {
    await connectDb();
    const worker = startWorker();

    // Finish in-flight jobs before exiting instead of abandoning them mid-run
    // to be re-delivered after the lock expires.
    const shutdown = async (signal) => {
      console.log(`[worker] ${signal} — finishing in-flight jobs…`);
      await worker.close();
      await closeRedisConnections();
      process.exit(0);
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  })().catch((err) => {
    console.error("[worker] startup failed:", err.message);
    process.exit(1);
  });
}

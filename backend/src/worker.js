const { Worker, UnrecoverableError } = require("bullmq");
const config = require("./config");
const { createRedisConnection, closeRedisConnections, throttledLogger } = require("./redis");
const { getJobHandler } = require("./jobs/registry");
const { LANE_IDS, laneConfig } = require("./jobs/lanes");
const { estimateDurationMs } = require("./jobs/estimate");
const { classifyProviderError } = require("./aiRouting");
const { logAudit } = require("./auditLog");
const credit = require("./services/credits");
const { startCreditReaper } = require("./services/creditReaper");
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
 * Ceiling for a job's stored result.
 *
 * A result travels three times over — written to Mongo, carried through
 * Redis, pushed down a socket — so it is meant to be ids and urls. The
 * text-out tools broke that assumption by design: Image to Text's answer is
 * the deliverable, and Affinity's is a whole parsed deck.
 *
 * 32KB is comfortably above any real answer (a dense reconstruction prompt
 * is 2–4KB) and well under the point where any of the three hops notices.
 */
const MAX_RESULT_BYTES = 32 * 1024;

/**
 * Keeps an oversized result from being stored and broadcast.
 *
 * Nothing is lost that isn't recoverable: every one of these tools writes
 * its real output to Mongo first — a generation's `response.text`, a kit
 * document — so the client can fetch the whole thing by the ids that
 * remain. What is dropped is the convenience copy.
 */
/**
 * Charges a finished run.
 *
 * `deliveredCount` comes from the batch runner and is the number of images
 * that actually came back; a tool that produces one thing doesn't report it,
 * and settles at the units it was quoted for.
 *
 * A failure here is logged and swallowed. The alternative — rethrowing — would
 * turn a successful generation into a failed job, so the user loses images
 * they made because the billing write had a bad moment. The hold is left
 * open instead, which the reaper closes.
 */
async function settleCredits(job, credits, result) {
  if (!credits?.held) return;

  try {
    await credit.settleRun({
      credits,
      jobId: job._id,
      generationId: result?.generationId || null,
      deliveredUnits: result?.deliveredCount,
    });
    job.credits.settled = true;
  } catch (err) {
    console.error(`[worker] could not settle credits for ${job._id}:`, err.message);
  }
}

/** Releases a hold on a run that is over for good. Same swallow-and-log reasoning. */
async function refundCredits(job, credits, reason) {
  if (!credits?.held) return;

  try {
    await credit.refundRun({ credits, jobId: job._id, reason });
    job.credits.settled = true;
  } catch (err) {
    console.error(`[worker] could not refund credits for ${job._id}:`, err.message);
  }
}

function withinResultBudget(result, jobId) {
  if (!result) return result;

  const size = Buffer.byteLength(JSON.stringify(result), "utf8");
  if (size <= MAX_RESULT_BYTES) return result;

  console.warn(`[worker] job ${jobId} returned ${size} bytes — dropping the inline copy, ids kept`);
  const { text, result: inner, kit, ...rest } = result;
  return { ...rest, truncated: true };
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
  const publish = async (percent, phase, { persist = false, partials, completed, total } = {}) => {
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
      // Only ever sent on the tick where something actually finished. Every
      // other tick leaves them out, so a per-second push stays a few bytes
      // instead of re-shipping every preview; the client accumulates them.
      ...(partials?.length ? { partials } : {}),
      ...(typeof completed === "number" ? { completed, total } : {}),
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
   * Two things drive the bar, and they answer different halves of the problem.
   *
   * The clock answers "is it alive": the provider call is nearly all of a
   * job's wall time and reports nothing while it runs, so without a ticker
   * there is simply nothing to send between the two milestones either side of
   * it, and the percentage sits still.
   *
   * `steps` answers "how far along, exactly". A run producing four images is
   * four provider calls, and each one that lands is a fact — not an estimate.
   * The band is divided into that many equal slices, and a finished call snaps
   * the bar to its slice boundary. Between boundaries the clock creeps within
   * the current slice only, so it can never claim more than has actually been
   * delivered, and every reported percentage is one the work has earned.
   *
   * `fn` receives `{ stepDone }` to report each completion, along with the
   * preview to push out with it.
   *
   * The ticker is cleared in a `finally`, so a throw can't leave an interval
   * running against a settled job.
   */
  const withProgress = async ({ from, to, phase, steps = 1 }, fn) => {
    const slice = (to - from) / Math.max(1, steps);

    let done = 0;
    let sliceStartedAt = Date.now();
    await publish(from, phase, { persist: true, completed: 0, total: steps });

    const ticker = setInterval(() => {
      // Never past the next real milestone. The steps run concurrently, so one
      // of them is expected to cost roughly the whole estimate rather than a
      // share of it — measuring against `estimatedMs` undivided is what keeps
      // the clock from saturating its slice in the first few seconds and then
      // sitting there. Between milestones the bar creeps; only a delivered
      // image moves it to a boundary.
      const base = from + slice * done;
      publish(rampedPercent(base, base + slice, Date.now() - sliceStartedAt, job.estimatedMs), phase).catch((err) =>
        console.error(`[worker] progress tick failed for ${jobId}:`, err.message)
      );
    }, TICK_MS);
    // Nothing should be kept alive purely by a progress bar.
    ticker.unref?.();

    /** One unit of the band is genuinely finished. Snaps the bar to its boundary. */
    const stepDone = async (preview) => {
      done = Math.min(steps, done + 1);
      sliceStartedAt = Date.now();
      await publish(from + slice * done, phase, {
        persist: true,
        completed: done,
        total: steps,
        partials: preview ? [preview] : undefined,
      }).catch((err) => console.error(`[worker] step report failed for ${jobId}:`, err.message));
    };

    try {
      return await fn({ stepDone });
    } finally {
      clearInterval(ticker);
    }
  };

  try {
    const handler = getJobHandler(job.type);
    const result = await handler({ job, data: bullJob.data, setProgress, withProgress });

    /*
     * Charged for what it delivered, not what it quoted.
     *
     * `deliveredCount` is the batch runner's count of images that actually
     * came back — four asked for and two returned charges for two, and the
     * rest of the hold goes back. A run with no count of its own settles at
     * the units it was quoted for.
     *
     * Before the document is marked completed, deliberately: if settling
     * throws, the job stays in a state the reaper will revisit rather than
     * looking finished with its credits still frozen.
     */
    await settleCredits(job, bullJob.data?.credits, result);

    job.status = "completed";
    job.result = withinResultBudget(result, jobId);
    job.progress = 100;
    job.phase = "done";
    job.finishedAt = new Date();
    // The sample every future estimate for this model is drawn from.
    job.durationMs = job.startedAt ? job.finishedAt - job.startedAt : null;
    await job.save();

    return result;
  } catch (err) {
    const attemptsAllowed = bullJob.opts.attempts || 1;
    // `noRetry` is set by failures that are settled rather than transient — a
    // content filter refusing an image answers the same way every time, so a
    // retry only makes the user wait twice as long for the same sentence.
    const willRetry =
      !(err instanceof UnrecoverableError) && !err?.noRetry && bullJob.attemptsMade + 1 < attemptsAllowed;
    const { message, code } = classifyProviderError(err, job.request?.provider);

    // Back to `queued` between attempts so the queue panel keeps showing it as
    // pending work rather than flashing "failed" and then un-failing.
    job.status = willRetry ? "queued" : "failed";
    job.error = { message, code };
    if (!willRetry) job.finishedAt = new Date();

    /*
     * Refunded only when the run is over for good.
     *
     * A job between attempts keeps its hold: releasing it now and taking it
     * again on the next attempt would mean a user at their limit is locked
     * out of a retry by their own failed run — and the retry would be
     * refused for a job they already paid for.
     */
    if (!willRetry) {
      await refundCredits(job, bullJob.data?.credits, message);
    }

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
    // swallow the failure or the job would be recorded as successful. A
    // settled failure is rethrown as Unrecoverable so BullMQ's own attempt
    // counter agrees with the document we just wrote.
    if (err?.noRetry && !(err instanceof UnrecoverableError)) throw new UnrecoverableError(message);
    throw err;
  }
}

/**
 * Starts consuming. Called by this file when run directly (the production
 * worker service) and by server.js in development, where one process is
 * friendlier than making `npm run dev` mean two terminals.
 */
function startWorker() {
  // One consumer per lane (see jobs/lanes.js). They share this process and
  // this handler — the lanes exist to keep slow work from occupying the
  // slots fast work needs, not to run different code.
  const workers = LANE_IDS.map(startLaneWorker);

  // Runs here rather than in the API process: a crashed worker is what
  // leaves credits frozen, and this is the process that comes back up.
  const reaper = startCreditReaper();

  return {
    /** Closes every lane, so callers can keep treating this as one worker. */
    close: () => {
      reaper.stop();
      return Promise.all(workers.map((worker) => worker.close()));
    },
    workers,
  };
}

function startLaneWorker(laneId) {
  const lane = laneConfig(laneId);

  const worker = new Worker(lane.name, processJob, {
    connection: createRedisConnection(`worker:${laneId}`),
    concurrency: lane.concurrency,
    // Must outlast the slowest honest run. Too low and BullMQ concludes a
    // worker died mid-generation and hands the same job to another one, so a
    // slow provider turns into duplicate images and double billing.
    lockDuration: lane.lockDuration,
  });

  worker.on("failed", (bullJob, err) => {
    console.error(`[worker:${laneId}] ${bullJob?.id ?? "unknown"} failed:`, err.message);
  });
  // Throttled: a worker whose Redis is unreachable re-emits this on every
  // reconnect attempt, which is a flood rather than information.
  const logWorkerError = throttledLogger(`worker:${laneId}`);
  worker.on("error", (err) => logWorkerError(err.message));
  worker.on("ready", () => console.log(`[worker] consuming "${lane.name}" (concurrency ${lane.concurrency})`));

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

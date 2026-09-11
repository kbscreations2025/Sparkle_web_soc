const { Queue, QueueEvents } = require("bullmq");
const config = require("./config");
const { createRedisConnection, throttledLogger } = require("./redis");
const { emitToUser } = require("./socket");
const Job = require("./models/job");

let queue;
let queueEvents;

/**
 * How long a request is willing to wait to hand work to Redis.
 *
 * BullMQ waits for its connection to be ready before it will accept a job, and
 * ioredis retries a dead Redis forever — so without a deadline here an
 * unreachable queue doesn't fail, it just never answers, and the user watches
 * a spinner instead of being told what's wrong.
 */
const ENQUEUE_TIMEOUT_MS = 5000;

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

/** The producer handle. Lazily built so requiring this file never opens a socket. */
function getQueue() {
  if (!queue) {
    // failFast: this connection is used from inside HTTP handlers, which must
    // answer "the queue is down" rather than hang waiting for it to come back.
    queue = new Queue(config.queue.name, { connection: createRedisConnection("queue", { failFast: true }) });

    // Not optional: BullMQ re-emits connection failures on the Queue itself,
    // and an unhandled 'error' on an EventEmitter takes the process down —
    // so an unreachable Redis would crash the API rather than degrade it.
    const logQueueError = throttledLogger("queue");
    queue.on("error", (err) => logQueueError(err.message));
  }
  return queue;
}

/**
 * The shape the client sees. Never includes `request` payload internals beyond
 * what's already display-safe, and never the images — those only ever live in
 * the BullMQ payload.
 */
function toPublicJob(job) {
  return {
    id: String(job._id),
    type: job.type,
    tool: job.tool,
    status: job.status,
    progress: job.progress,
    phase: job.phase,
    // What the client needs to draw a clock of its own between updates: the
    // prediction this run is being measured against, and what it actually
    // cost once it is over.
    estimatedMs: job.estimatedMs,
    durationMs: job.durationMs,
    request: job.request,
    preview: job.preview,
    result: job.result,
    error: job.error?.message ? { message: job.error.message, code: job.error.code } : null,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

/**
 * Records the work in Mongo, then hands it to Redis to be run.
 *
 * The Mongo document is written first and on purpose: if the Redis handoff
 * fails, a job exists in a `queued` state that never runs, which is visible
 * and fixable. The other order would run work that nothing has a record of.
 *
 * `request` is the display/audit description of the run (model, instruction,
 * counts). `payload` is what the handler actually needs — including image
 * bytes, which is why it goes to Redis and not into the document.
 */
async function enqueueJob({ tenantId, userId, userName, type, tool, request = {}, payload = {}, preview = null }) {
  const job = await Job.create({
    tenantId,
    userId,
    userName,
    type,
    tool,
    status: "queued",
    request,
    preview,
    maxAttempts: config.queue.attempts,
  });

  try {
    await withTimeout(
      getQueue().add(
      type,
      { jobId: String(job._id), ...payload },
      {
        // Same id on both sides, so one id identifies the work everywhere:
        // in Mongo, in Redis, in Bull Board and in the client's URL.
        jobId: String(job._id),
        attempts: config.queue.attempts,
        backoff: { type: "exponential", delay: 5000 },
        // The Mongo document is the lasting record, so a finished job's Redis
        // copy is dead weight — and it still holds the image payload, which
        // makes keeping it expensive. Failures are kept briefly and in small
        // numbers so they can be inspected (and retried) from Bull Board.
        removeOnComplete: true,
        removeOnFail: { age: 24 * 3600, count: 50 },
      }
      ),
      ENQUEUE_TIMEOUT_MS,
      `the job queue did not accept the job within ${ENQUEUE_TIMEOUT_MS}ms`
    );
  } catch (err) {
    // Leave a trail rather than a document stuck at "queued" with no
    // explanation of why nothing ever picked it up.
    job.status = "failed";
    job.error = { message: `could not reach the job queue: ${err.message}`, code: "enqueue_failed" };
    job.finishedAt = new Date();
    await job.save();
    throw err;
  }

  emitToUser(userId, "job:updated", toPublicJob(job));
  return job;
}

/**
 * Pushes job state to the browser as it changes.
 *
 * Runs in the API process, not the worker: BullMQ's event stream is itself in
 * Redis, so the process holding the websockets can watch work happening in a
 * process that has no websockets of its own. That is what lets the worker be
 * deployed separately without teaching it anything about Socket.IO.
 *
 * Every event re-reads the document rather than trusting the event payload —
 * the worker has already written the authoritative state there, and one shape
 * for the client (`toPublicJob`) beats three near-identical ones.
 */
function startQueueEventsBridge() {
  if (queueEvents) return queueEvents;

  queueEvents = new QueueEvents(config.queue.name, { connection: createRedisConnection("events") });

  /**
   * `live` is the payload the worker attached to its progress tick, when
   * there is one. It is overlaid on the stored document because the two
   * move at different rates on purpose: the worker ticks the socket every
   * second but only writes Mongo every few, so between writes the event is
   * the fresher of the two and the document would drag the bar backwards.
   */
  const push = async (jobId, live) => {
    try {
      const job = await Job.findById(jobId);
      if (!job) return;

      const payload = toPublicJob(job);
      if (live && typeof live === "object" && job.status === "running") {
        if (typeof live.percent === "number") payload.progress = live.percent;
        if (live.phase) payload.phase = live.phase;
        if (typeof live.estimatedMs === "number") payload.estimatedMs = live.estimatedMs;
      }

      emitToUser(job.userId, "job:updated", payload);
    } catch (err) {
      // A missed push costs the client a live update, nothing more: it still
      // reconciles from GET /api/jobs on its next load.
      console.error(`[queue] could not push job ${jobId}:`, err.message);
    }
  };

  queueEvents.on("progress", ({ jobId, data }) => push(jobId, data));
  queueEvents.on("completed", ({ jobId }) => push(jobId));
  queueEvents.on("failed", ({ jobId }) => push(jobId));
  const logEventsError = throttledLogger("queue");
  queueEvents.on("error", (err) => logEventsError(`events stream error: ${err.message}`));

  return queueEvents;
}

async function closeQueue() {
  await Promise.all([queue?.close(), queueEvents?.close()].filter(Boolean));
  queue = undefined;
  queueEvents = undefined;
}

module.exports = { getQueue, enqueueJob, toPublicJob, startQueueEventsBridge, closeQueue };

const { enqueueJob, toPublicJob } = require("../queue");
const { parseDataUri } = require("../generationService");
const { logAudit, requestMeta, actorFrom } = require("../auditLog");
const credit = require("../services/credits");

/**
 * The half of an image-generating route that never varies: hand the work to
 * the queue, record that it was asked for, and answer with the job.
 *
 * What each tool does for itself is validation and shaping its payload —
 * everything after that is the same for all of them, so it lives here rather
 * than once per route.
 */

/**
 * Ceiling for the queue thumbnail stored on the job. A 96px JPEG lands around
 * 3–6KB; 32KB leaves room for an odd encoder without letting a client store a
 * real image in a field returned with every job listing. Oversized previews
 * are dropped, not rejected — a missing thumbnail is a cosmetic loss and no
 * reason to refuse the generation itself.
 */
const MAX_PREVIEW_BYTES = 32 * 1024;

function safePreview(preview) {
  if (typeof preview !== "string" || !preview.startsWith("data:image/")) return null;
  return Buffer.byteLength(preview, "utf8") <= MAX_PREVIEW_BYTES ? preview : null;
}

/** Parses a list of data URIs, dropping any that aren't one. */
function parseImages(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.map(parseDataUri).filter(Boolean);
}

/**
 * @param request A display/audit description of the run. No image bytes.
 * @param payload What the handler actually needs, images included — this goes
 *                to Redis rather than into the job document.
 */
async function queueGeneration(req, res, { type, tool, request, payload, preview, message }) {
  const { dbUser } = req;

  /*
   * Paid for before it is queued, never after. A job that reaches the queue
   * unpaid can be picked up by a worker within milliseconds, and by then
   * refusing it means killing a run already in flight.
   *
   * `request.modelId ?? request.model` because Image to Video's `model` is a
   * composite key built for the duration estimator — it matches no pricing
   * rule, and reading it here would bill every video at the catch-all rate.
   */
  let credits;
  try {
    const priced = await credit.quote({
      tenantId: dbUser.tenantId,
      tool,
      modelId: request.modelId ?? request.model ?? null,
      quality: request.quality ?? null,
      count: request.count ?? request.imageCount ?? 1,
      durationSeconds: request.durationSeconds,
    });

    if (priced) {
      const jobHint = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const held = await credit.holdForRun({
        tenantId: dbUser.tenantId,
        userId: dbUser._id,
        userName: dbUser.name || dbUser.email,
        tool,
        priced,
        jobHint,
      });
      credits = { ...held, jobHint, tenantId: dbUser.tenantId, userId: dbUser._id, tool };
    }
  } catch (err) {
    if (err.code === "insufficient_credits") {
      // 402, not 403: this is not a permission problem, and the client
      // renders it as "top up" rather than "you can't do this".
      return res.status(402).json({
        status: "error",
        message: `This run costs ${err.required} credits and you have ${err.available}.`,
        code: "insufficient_credits",
        required: err.required,
        available: err.available,
      });
    }
    console.error(`${tool}: could not price the run:`, err.message);
    return res.status(503).json({
      status: "error",
      message: "Credits are unavailable right now. Please try again shortly.",
      code: "credits_unavailable",
    });
  }

  try {
    const job = await enqueueJob({
      tenantId: dbUser.tenantId,
      userId: dbUser._id,
      userName: dbUser.name || dbUser.email,
      type,
      tool,
      preview: safePreview(preview),
      request,
      // The frozen quote rides with the job so the worker can settle it
      // without re-resolving a price that may have changed since.
      payload: credits ? { ...payload, credits } : payload,
      credits,
    });

    // Now that the job exists, tie the hold to it — this is what the
    // settlement and the reaper look it up by.
    if (credits?.held) await credit.attachJob(credits.jobHint, credits.accountId, job._id);

    logAudit({
      ...actorFrom(req),
      ...requestMeta(req),
      tenantId: dbUser.tenantId,
      action: "job.queued",
      status: "success",
      targetType: "job",
      targetId: String(job._id),
      message,
      metadata: {
        tool,
        jobType: type,
        provider: request.provider,
        model: request.model,
        creditsHeld: credits?.held ?? 0,
      },
    });

    // 202: taken, not done. The body carries the job rather than a result.
    res.status(202).json({ status: "queued", job: toPublicJob(job), creditsHeld: credits?.held ?? 0 });
  } catch (err) {
    console.error(`${tool}: could not queue the job:`, err.message);

    /*
     * The queue refused the work after the credits were frozen. Without this
     * the user is charged for a run that does not exist, and nothing else
     * will ever release it: the reaper finds holds by job id, and this hold
     * never got one.
     */
    if (credits?.held) {
      await credit
        .refundRun({ credits, jobId: null, reason: "queue unavailable" })
        .catch((releaseErr) => console.error(`${tool}: could not release the hold:`, releaseErr.message));
    }

    res.status(503).json({
      status: "error",
      message: "The job queue is unavailable right now. Please try again shortly.",
      code: "queue_unavailable",
    });
  }
}

module.exports = { queueGeneration, parseImages };

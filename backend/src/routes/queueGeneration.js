const { enqueueJob, toPublicJob } = require("../queue");
const { parseDataUri } = require("../generationService");
const { logAudit, requestMeta, actorFrom } = require("../auditLog");

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

  try {
    const job = await enqueueJob({
      tenantId: dbUser.tenantId,
      userId: dbUser._id,
      userName: dbUser.name || dbUser.email,
      type,
      tool,
      preview: safePreview(preview),
      request,
      payload,
    });

    logAudit({
      ...actorFrom(req),
      ...requestMeta(req),
      tenantId: dbUser.tenantId,
      action: "job.queued",
      status: "success",
      targetType: "job",
      targetId: String(job._id),
      message,
      metadata: { tool, jobType: type, provider: request.provider, model: request.model },
    });

    // 202: taken, not done. The body carries the job rather than a result.
    res.status(202).json({ status: "queued", job: toPublicJob(job) });
  } catch (err) {
    console.error(`${tool}: could not queue the job:`, err.message);
    res.status(503).json({
      status: "error",
      message: "The job queue is unavailable right now. Please try again shortly.",
      code: "queue_unavailable",
    });
  }
}

module.exports = { queueGeneration, parseImages };

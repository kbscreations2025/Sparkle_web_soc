const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { resolveProviderModel } = require("../aiRouting");
const { parseDataUri } = require("../generationService");
const { enqueueJob, toPublicJob } = require("../queue");
const { TEXT_TO_IMAGE_JOB, MAX_IMAGE_COUNT, DEFAULT_IMAGE_COUNT } = require("../jobs/textToImage");
const { logAudit, requestMeta, actorFrom } = require("../auditLog");

const router = express.Router();

router.use(requireAuth, requirePermission("tool.text_to_image.run"));

/**
 * Accepts a Text to Image run — an initial generation (built from the
 * jewelry builder + free text, 1–8 variations) or a refinement of one
 * existing result — and hands it to the queue. Mirrors routes/cleaning.js:
 * cheap validation happens here, everything that talks to the model happens
 * in the worker (see jobs/textToImage.js), and the queue rail follows the
 * same job over the same `job:updated` socket events either way.
 */
router.post("/", async (req, res) => {
  const { dbUser } = req;
  const {
    prompt,
    style,
    aspect,
    count,
    model: requestedModel,
    refineImage,
    referenceImages,
    instruction,
    displayPrompt,
    conversationId,
    parentGenerationId,
  } = req.body || {};

  const isRefinement = Boolean(refineImage && instruction);
  const { provider, model, modelLabel, quality } = resolveProviderModel(requestedModel);

  if (isRefinement) {
    const parsedImage = parseDataUri(refineImage);
    if (!parsedImage) {
      return res.status(400).json({ status: "error", message: "refine image must be a data URI", code: "invalid" });
    }
    const parsedReferences = Array.isArray(referenceImages) ? referenceImages.map(parseDataUri).filter(Boolean) : [];

    try {
      const job = await enqueueJob({
        tenantId: dbUser.tenantId,
        userId: dbUser._id,
        userName: dbUser.name || dbUser.email,
        type: TEXT_TO_IMAGE_JOB,
        tool: "text_to_image",
        request: {
          provider,
          model,
          modelLabel,
          quality,
          isRefinement: true,
          instruction,
          referenceCount: parsedReferences.length,
          conversationId: conversationId || null,
        },
        payload: {
          isRefinement: true,
          refineImage: parsedImage,
          references: parsedReferences,
          instruction,
          displayPrompt,
          requestedModel,
          conversationId,
          parentGenerationId,
        },
      });

      logAudit({
        ...actorFrom(req),
        ...requestMeta(req),
        tenantId: dbUser.tenantId,
        action: "job.queued",
        status: "success",
        targetType: "job",
        targetId: String(job._id),
        message: `queued a text-to-image refinement on ${modelLabel}`,
        metadata: { tool: "text_to_image", jobType: TEXT_TO_IMAGE_JOB, provider, model, isRefinement: true },
      });

      return res.status(202).json({ status: "queued", job: toPublicJob(job) });
    } catch (err) {
      console.error("text-to-image: could not queue the refinement job:", err.message);
      return res.status(503).json({
        status: "error",
        message: "The job queue is unavailable right now. Please try again shortly.",
        code: "queue_unavailable",
      });
    }
  }

  if (!prompt || !String(prompt).trim()) {
    return res.status(400).json({ status: "error", message: "a prompt is required", code: "invalid" });
  }

  const numImages = Math.max(1, Math.min(MAX_IMAGE_COUNT, Math.round(Number(count)) || DEFAULT_IMAGE_COUNT));

  try {
    const job = await enqueueJob({
      tenantId: dbUser.tenantId,
      userId: dbUser._id,
      userName: dbUser.name || dbUser.email,
      type: TEXT_TO_IMAGE_JOB,
      tool: "text_to_image",
      request: {
        provider,
        model,
        modelLabel,
        quality,
        isRefinement: false,
        prompt: String(prompt).trim(),
        style: style || null,
        aspect: aspect || null,
        count: numImages,
      },
      payload: {
        isRefinement: false,
        prompt: String(prompt).trim(),
        // What History shows as the user's own words, distinct from the full
        // prompt the model is actually sent.
        userPrompt: String(prompt).trim(),
        style,
        aspect,
        count: numImages,
        requestedModel,
        conversationId: conversationId || null,
      },
    });

    logAudit({
      ...actorFrom(req),
      ...requestMeta(req),
      tenantId: dbUser.tenantId,
      action: "job.queued",
      status: "success",
      targetType: "job",
      targetId: String(job._id),
      message: `queued a text-to-image run (${numImages} image${numImages > 1 ? "s" : ""}) on ${modelLabel}`,
      metadata: { tool: "text_to_image", jobType: TEXT_TO_IMAGE_JOB, provider, model, count: numImages },
    });

    res.status(202).json({ status: "queued", job: toPublicJob(job) });
  } catch (err) {
    console.error("text-to-image: could not queue the job:", err.message);
    res.status(503).json({
      status: "error",
      message: "The job queue is unavailable right now. Please try again shortly.",
      code: "queue_unavailable",
    });
  }
});

module.exports = router;

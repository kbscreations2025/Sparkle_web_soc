const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { resolveProviderModel } = require("../aiRouting");
const { parseDataUri } = require("../generationService");
const { queueGeneration, parseImages } = require("./queueGeneration");
const { CLEANING_JOB } = require("../jobs/cleaning");

const router = express.Router();

router.use(requireAuth, requirePermission("tool.cleaning.run"));

/**
 * Accepts a cleaning run and hands it to the queue.
 *
 * Everything cheap and certain still happens here — a malformed request is
 * refused immediately with a 400 rather than becoming a job that exists only
 * to fail. What used to happen next (call the model, wait 30–150s, save the
 * result) now happens in a worker, so this answers in milliseconds with an id
 * the client can follow.
 *
 * That id is the whole point: the browser can reload, navigate away or lose
 * its connection, and the work carries on. The page finds it again by asking
 * GET /api/jobs, not by remembering anything.
 *
 * The image bytes go to Redis with the job rather than into the job document —
 * see models/job.js for why.
 */
router.post("/", async (req, res) => {
  const { dbUser } = req;
  const {
    image,
    model: requestedModel,
    customPrompt,
    refineImage,
    instruction,
    referenceImages,
    conversationId,
    parentGenerationId,
    preview,
  } = req.body || {};

  const isRefinement = Boolean(refineImage && instruction);
  const sourceImage = isRefinement ? refineImage : image;

  if (!sourceImage) {
    return res.status(400).json({ status: "error", message: "no image provided", code: "invalid" });
  }

  const parsed = parseDataUri(sourceImage);
  if (!parsed) {
    return res.status(400).json({ status: "error", message: "image must be a data URI", code: "invalid" });
  }

  // Invalid entries are dropped rather than rejecting the whole request —
  // references are inspiration, not required inputs, so one bad one
  // shouldn't sink an otherwise-good refinement.
  const parsedReferences = parseImages(referenceImages);

  // Resolved here as well as in the handler: the handler needs it to run, and
  // this copy is what the queue panel shows while the job is still waiting.
  const { provider, model, modelLabel, quality } = resolveProviderModel(requestedModel);

  return queueGeneration(req, res, {
    type: CLEANING_JOB,
    tool: "cleaning",
    preview,
    // Display/audit description of the run. No image bytes.
    request: {
      provider,
      model,
      modelLabel,
      quality,
      isRefinement,
      instruction: isRefinement ? instruction : null,
      customPrompt: customPrompt?.trim() || null,
      referenceCount: parsedReferences.length,
      conversationId: conversationId || null,
    },
    // What the handler actually needs, images included.
    payload: {
      image: parsed,
      references: parsedReferences,
      requestedModel,
      isRefinement,
      instruction,
      customPrompt,
      conversationId,
      parentGenerationId,
    },
    message: `queued a cleaning ${isRefinement ? "refinement" : "run"} on ${modelLabel}`,
  });
});

module.exports = router;

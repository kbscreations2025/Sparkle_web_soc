const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { resolveProviderModel } = require("../aiRouting");
const { parseDataUri } = require("../generationService");
const { queueGeneration, parseImages, refinementPayload, MAX_REFERENCE_PHOTOS } = require("./queueGeneration");
const { TEXT_TO_IMAGE_JOB } = require("../jobs/textToImage");
const { clampCount } = require("../jobs/generationRunner");
const { readTrendCues } = require("../services/trends");

const router = express.Router();

router.use(requireAuth, requirePermission("tool.text_to_image.run"));

/**
 * Accepts a Text to Image run — an initial generation (built from the jewelry
 * builder + free text, 1–8 variations) or a refinement of one existing
 * result — and hands it to the queue.
 *
 * Mirrors routes/cleaning.js: cheap validation happens here, everything that
 * talks to the model happens in the worker (see jobs/textToImage.js), and the
 * queue rail follows the same job over the same `job:updated` socket events
 * either way.
 */
router.post("/", async (req, res) => {
  const {
    prompt,
    style,
    aspect,
    count,
    model: requestedModel,
    quality: requestedQuality,
    refineImage,
    referenceImage,
    instruction,
    preview,
    conversationId,
    trends,
    designVariations,
  } = req.body || {};

  const { provider, model, modelLabel, quality } = resolveProviderModel(requestedModel, requestedQuality);

  if (refineImage && instruction) {
    const parsedImage = parseDataUri(refineImage);
    if (!parsedImage) {
      return res.status(400).json({ status: "error", message: "refine image must be a data URI", code: "invalid" });
    }
    const refinement = refinementPayload(req.body, parsedImage);

    return queueGeneration(req, res, {
      type: TEXT_TO_IMAGE_JOB,
      tool: "text_to_image",
      preview,
      request: {
        provider,
        model,
        modelLabel,
        quality,
        isRefinement: true,
        instruction,
        referenceCount: refinement.references.length,
        conversationId: conversationId || null,
      },
      payload: refinement,
      message: `queued a text-to-image refinement on ${modelLabel}`,
    });
  }

  // A reference photo alone is enough to start from, as in Text to Sketch.
  const reference = parseImages(referenceImage).slice(0, MAX_REFERENCE_PHOTOS);
  if ((!prompt || !String(prompt).trim()) && !reference.length) {
    return res.status(400).json({ status: "error", message: "a prompt or a reference photo is required", code: "invalid" });
  }

  const description = String(prompt || "").trim();
  const numImages = clampCount(count);

  return queueGeneration(req, res, {
    type: TEXT_TO_IMAGE_JOB,
    tool: "text_to_image",
    preview,
    request: {
      provider,
      model,
      modelLabel,
      quality,
      isRefinement: false,
      prompt: description,
      style: style || null,
      aspect: aspect || null,
      count: numImages,
      hasReference: reference.length > 0,
    },
    payload: {
      isRefinement: false,
      prompt: description,
      // What History shows as the user's own words, distinct from the full
      // prompt the model is actually sent.
      userPrompt: description,
      style,
      aspect,
      count: numImages,
      requestedModel,
      requestedQuality,
      conversationId: conversationId || null,
      sourceImages: reference,
      // The current trends the builder asked each image to follow, in turn.
      trendCues: readTrendCues(trends),
      // New design options from the reference photo, rather than a recreation of it.
      designVariations: designVariations === true && reference.length > 0,
    },
    message: `queued a text-to-image run (${numImages} image${numImages > 1 ? "s" : ""}) on ${modelLabel}`,
  });
});

module.exports = router;

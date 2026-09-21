const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { resolveProviderModel } = require("../aiRouting");
const { parseDataUri } = require("../generationService");
const { queueGeneration, parseImages } = require("./queueGeneration");
const { TEXT_TO_IMAGE_JOB, MAX_IMAGE_COUNT, DEFAULT_IMAGE_COUNT } = require("../jobs/textToImage");

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
    referenceImages,
    instruction,
    displayPrompt,
    preview,
    conversationId,
    parentGenerationId,
  } = req.body || {};

  const { provider, model, modelLabel, quality } = resolveProviderModel(requestedModel, requestedQuality);

  if (refineImage && instruction) {
    const parsedImage = parseDataUri(refineImage);
    if (!parsedImage) {
      return res.status(400).json({ status: "error", message: "refine image must be a data URI", code: "invalid" });
    }
    const parsedReferences = parseImages(referenceImages);

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
        requestedQuality,
        conversationId,
        parentGenerationId,
      },
      message: `queued a text-to-image refinement on ${modelLabel}`,
    });
  }

  if (!prompt || !String(prompt).trim()) {
    return res.status(400).json({ status: "error", message: "a prompt is required", code: "invalid" });
  }

  const description = String(prompt).trim();
  const numImages = Math.max(1, Math.min(MAX_IMAGE_COUNT, Math.round(Number(count)) || DEFAULT_IMAGE_COUNT));

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
    },
    message: `queued a text-to-image run (${numImages} image${numImages > 1 ? "s" : ""}) on ${modelLabel}`,
  });
});

module.exports = router;

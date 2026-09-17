const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { resolveProviderModel } = require("../aiRouting");
const { clampCount } = require("../jobs/generationRunner");
const { TEXT_TO_SKETCH_JOB, SKETCH_TO_IMAGE_JOB, IMAGE_TO_SKETCH_JOB } = require("../jobs/sketchTools");
const { queueGeneration, parseImages } = require("./queueGeneration");

/**
 * The three sketch tools' entry points. Each validates what only it knows —
 * a brief, a set of sketches, a photograph — and hands the rest to
 * `queueGeneration`.
 *
 * Mounted as one router because they are three variations on one request, and
 * three near-identical files would drift apart.
 */

/** Photo-driven tools default to a single result; text-driven ones to four. */
const PHOTO_DEFAULT_COUNT = 1;
const TEXT_DEFAULT_COUNT = 2;

/** Pulls the refinement half out of a body, since all three share its shape. */
function readRefinement(body) {
  const { refineImage, referenceImages, instruction, displayPrompt, conversationId, parentGenerationId } = body;
  if (!refineImage || !instruction) return null;

  const [parsed] = parseImages(refineImage);
  if (!parsed) return null;

  return {
    isRefinement: true,
    refineImage: parsed,
    references: parseImages(referenceImages),
    instruction,
    displayPrompt,
    conversationId,
    parentGenerationId,
  };
}

const router = express.Router();
router.use(requireAuth);

// ── Text to Sketch ──────────────────────────────────────────────────────────
router.post("/text-to-sketch", requirePermission("tool.text_to_sketch.run"), async (req, res) => {
  const body = req.body || {};
  const { provider, model, modelLabel, quality } = resolveProviderModel(body.model);
  const refinement = readRefinement(body);

  if (!refinement && !body.prompt?.trim() && !body.referenceImage) {
    return res.status(400).json({ status: "error", message: "a description or a reference image is required", code: "invalid" });
  }

  const count = refinement ? 1 : clampCount(body.count, TEXT_DEFAULT_COUNT);
  const shared = { provider, model, modelLabel, quality };

  return queueGeneration(req, res, {
    type: TEXT_TO_SKETCH_JOB,
    tool: "text_to_sketch",
    preview: body.referenceImage,
    request: refinement
      ? { ...shared, isRefinement: true, instruction: body.instruction, referenceCount: refinement.references.length }
      : { ...shared, isRefinement: false, prompt: body.prompt?.trim() || null, style: body.style ?? null, aspect: body.aspect ?? null, count },
    payload: refinement
      ? { ...refinement, requestedModel: body.model }
      : {
          isRefinement: false,
          requestedModel: body.model,
          prompt: body.prompt?.trim() || "",
          userPrompt: body.prompt?.trim() || null,
          style: body.style,
          aspect: body.aspect,
          count,
          // The optional reference photo the brief is drawn from.
          sourceImages: parseImages(body.referenceImage),
          conversationId: body.conversationId || null,
        },
    message: refinement
      ? `queued a text-to-sketch refinement on ${modelLabel}`
      : `queued a text-to-sketch run (${count} image${count > 1 ? "s" : ""}) on ${modelLabel}`,
  });
});

// ── Sketch to Image ─────────────────────────────────────────────────────────
router.post("/sketch-to-image", requirePermission("tool.sketch_to_image.run"), async (req, res) => {
  const body = req.body || {};
  const { provider, model, modelLabel, quality } = resolveProviderModel(body.model);
  const refinement = readRefinement(body);

  // Every uploaded view of the piece goes into one request, so the model sees
  // the whole design rather than one angle of it.
  const sketches = refinement ? [] : parseImages(body.images);
  if (!refinement && sketches.length === 0) {
    return res.status(400).json({ status: "error", message: "at least one sketch is required", code: "invalid" });
  }

  const count = refinement ? 1 : clampCount(body.count, PHOTO_DEFAULT_COUNT);
  const shared = { provider, model, modelLabel, quality };

  return queueGeneration(req, res, {
    type: SKETCH_TO_IMAGE_JOB,
    tool: "sketch_to_image",
    preview: body.preview,
    request: refinement
      ? { ...shared, isRefinement: true, instruction: body.instruction, referenceCount: refinement.references.length }
      : { ...shared, isRefinement: false, description: body.description?.trim() || null, sketchCount: sketches.length, count },
    payload: refinement
      ? { ...refinement, requestedModel: body.model }
      : {
          isRefinement: false,
          requestedModel: body.model,
          description: body.description?.trim() || "",
          userPrompt: body.description?.trim() || null,
          count,
          sourceImages: sketches,
          conversationId: body.conversationId || null,
        },
    message: refinement
      ? `queued a sketch-to-image refinement on ${modelLabel}`
      : `queued a sketch-to-image run (${count} image${count > 1 ? "s" : ""}) on ${modelLabel}`,
  });
});

// ── Image to Sketch ─────────────────────────────────────────────────────────
router.post("/image-to-sketch", requirePermission("tool.image_to_sketch.run"), async (req, res) => {
  const body = req.body || {};
  const { provider, model, modelLabel, quality } = resolveProviderModel(body.model);
  const refinement = readRefinement(body);

  const photo = refinement ? [] : parseImages(body.image);
  if (!refinement && photo.length === 0) {
    return res.status(400).json({ status: "error", message: "an image is required", code: "invalid" });
  }

  const count = refinement ? 1 : clampCount(body.count, PHOTO_DEFAULT_COUNT);
  const shared = { provider, model, modelLabel, quality };

  return queueGeneration(req, res, {
    type: IMAGE_TO_SKETCH_JOB,
    tool: "image_to_sketch",
    preview: body.preview,
    request: refinement
      ? { ...shared, isRefinement: true, instruction: body.instruction, referenceCount: refinement.references.length }
      : { ...shared, isRefinement: false, style: body.style ?? null, count },
    payload: refinement
      ? { ...refinement, requestedModel: body.model }
      : {
          isRefinement: false,
          requestedModel: body.model,
          style: body.style,
          count,
          sourceImages: photo,
          conversationId: body.conversationId || null,
        },
    message: refinement
      ? `queued an image-to-sketch refinement on ${modelLabel}`
      : `queued an image-to-sketch run (${count} image${count > 1 ? "s" : ""}) on ${modelLabel}`,
  });
});

module.exports = router;

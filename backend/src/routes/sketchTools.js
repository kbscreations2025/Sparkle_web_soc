const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { resolveProviderModel, loadTenantOrThrow } = require("../aiRouting");
const { clampCount } = require("../jobs/generationRunner");
const { TEXT_TO_SKETCH_JOB, SKETCH_TO_IMAGE_JOB, IMAGE_TO_SKETCH_JOB } = require("../jobs/sketchTools");
const { resolveSketchMode, variationCountFor, describeSketchMode } = require("../prompts/intent");
const { queueGeneration, parseImages, readRefinement, MAX_REFERENCE_PHOTOS } = require("./queueGeneration");
const { readTrendCues } = require("../services/trends");

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

const router = express.Router();
router.use(requireAuth);

// ── Text to Sketch ──────────────────────────────────────────────────────────
router.post("/text-to-sketch", requirePermission("tool.text_to_sketch.run"), async (req, res) => {
  const body = req.body || {};
  const { provider, model, modelLabel, quality } = resolveProviderModel(body.model, body.quality);
  const refinement = readRefinement(body);

  if (!refinement && !body.prompt?.trim() && !body.referenceImage) {
    return res.status(400).json({ status: "error", message: "a description or a reference image is required", code: "invalid" });
  }

  const count = refinement ? 1 : clampCount(body.count, TEXT_DEFAULT_COUNT);
  const shared = { provider, model, modelLabel, quality };

  return queueGeneration(req, res, {
    type: TEXT_TO_SKETCH_JOB,
    tool: "text_to_sketch",
    // The first reference photo, when several are sent.
    preview: [].concat(body.referenceImage ?? [])[0],
    request: refinement
      ? { ...shared, isRefinement: true, instruction: body.instruction, referenceCount: refinement.references.length }
      : { ...shared, isRefinement: false, prompt: body.prompt?.trim() || null, style: body.style ?? null, aspect: body.aspect ?? null, count },
    payload: refinement
      ? refinement
      : {
          isRefinement: false,
          requestedModel: body.model,
          requestedQuality: body.quality,
          prompt: body.prompt?.trim() || "",
          userPrompt: body.prompt?.trim() || null,
          style: body.style,
          aspect: body.aspect,
          count,
          // The optional reference photo the brief is drawn from.
          sourceImages: parseImages(body.referenceImage).slice(0, MAX_REFERENCE_PHOTOS),
          conversationId: body.conversationId || null,
          // The current trends the builder asked each sketch to follow, in turn.
          trendCues: readTrendCues(body.trends),
          // New design options from the reference photo, rather than a redraw of it.
          designVariations: body.designVariations === true && Boolean(body.referenceImage),
        },
    message: refinement
      ? `queued a text-to-sketch refinement on ${modelLabel}`
      : `queued a text-to-sketch run (${count} image${count > 1 ? "s" : ""}) on ${modelLabel}`,
  });
});

// ── Sketch to Image ─────────────────────────────────────────────────────────
router.post("/sketch-to-image", requirePermission("tool.sketch_to_image.run"), async (req, res) => {
  const body = req.body || {};
  const { provider, model, modelLabel, quality } = resolveProviderModel(body.model, body.quality);
  const shared = { provider, model, modelLabel, quality };

  /*
   * A follow-up typed on the sketch itself — picked from the opening turn —
   * asks for that sketch to be rendered, with the message as its notes. Run as
   * an edit it would reach the model as "this jewelry photograph … keep the
   * background", and come back as the sketch still on its paper. Anything
   * attached alongside counts as another view, as on the upload form.
   */
  const onSketch = body.refineSource === "input" && Boolean(body.refineImage && body.instruction);
  const refinement = onSketch ? null : readRefinement(body);

  if (refinement) {
    return queueGeneration(req, res, {
      type: SKETCH_TO_IMAGE_JOB,
      tool: "sketch_to_image",
      preview: body.preview,
      request: { ...shared, isRefinement: true, instruction: body.instruction, referenceCount: refinement.references.length },
      payload: refinement,
      message: `queued a sketch-to-image refinement on ${modelLabel}`,
    });
  }

  // Every uploaded view of the piece goes into one request, so the model sees
  // the whole design rather than one angle of it.
  const sketches = parseImages(onSketch ? [body.refineImage, ...(body.referenceImages ?? [])] : body.images);
  if (sketches.length === 0) {
    return res.status(400).json({ status: "error", message: "at least one sketch is required", code: "invalid" });
  }

  const description = String((onSketch ? body.instruction : body.description) ?? "").trim();
  const userPrompt = String((onSketch ? body.displayPrompt || body.instruction : body.description) ?? "").trim() || null;

  // The sketch as drawn, or new designs grown from it — read before pricing,
  // since variations can make more images than the picker shows.
  const tenant = await loadTenantOrThrow(req.dbUser).catch(() => null);
  const { mode, count: asked } = await resolveSketchMode(description, { tenant });
  const selected = clampCount(body.count, PHOTO_DEFAULT_COUNT);
  const count = mode === "variations" ? variationCountFor({ asked, selected, tool: "sketch_to_image" }) : selected;
  const intentLabel = describeSketchMode(mode, count);

  return queueGeneration(req, res, {
    type: SKETCH_TO_IMAGE_JOB,
    tool: "sketch_to_image",
    preview: body.preview,
    request: {
      ...shared,
      isRefinement: false,
      description: description || null,
      sketchCount: sketches.length,
      count,
      mode,
      ...(intentLabel ? { intentLabel } : {}),
    },
    payload: {
      isRefinement: false,
      requestedModel: body.model,
      requestedQuality: body.quality,
      description,
      userPrompt,
      mode,
      count,
      intentLabel,
      sourceImages: sketches,
      conversationId: body.conversationId || null,
      parentGenerationId: onSketch ? body.parentGenerationId || null : null,
    },
    message: `queued a sketch-to-image run (${count} image${count > 1 ? "s" : ""}) on ${modelLabel}`,
  });
});

// ── Image to Sketch ─────────────────────────────────────────────────────────
router.post("/image-to-sketch", requirePermission("tool.image_to_sketch.run"), async (req, res) => {
  const body = req.body || {};
  const { provider, model, modelLabel, quality } = resolveProviderModel(body.model, body.quality);
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
      ? refinement
      : {
          isRefinement: false,
          requestedModel: body.model,
          requestedQuality: body.quality,
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

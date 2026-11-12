const express = require("express");
const { requireAuth, requirePermission, requireAnyPermission } = require("../middleware/auth");
const { resolveProviderModel } = require("../aiRouting");
const { parseDataUri } = require("../generationService");
const { queueGeneration, parseImages, refinementPayload } = require("./queueGeneration");
const { resolveBaseModel, modelPayload } = require("./baseModel");
const { LIFESTYLE_JOB, LIFESTYLE_MODEL_JOB } = require("../jobs/lifestyle");
const models = require("../services/lifestyleModels");

const router = express.Router();

router.use(requireAuth);

/** The model library is shared with Marketing Kit, which picks from it too. */
const MODEL_LIBRARY_PERMISSIONS = ["tool.life_style.run", "tool.marketing_kit.run"];

/**
 * Who may share a model with the organization, or remove one from it.
 *
 * The organization's own admin, or the platform super admin above them — the
 * two tiers this app has. The browser mirrors this to decide which buttons
 * to draw; this is the copy that decides anything.
 */
const isAdmin = (req) => Boolean(req.isSuperAdmin || req.dbUser?.role === "admin");

/*
 * ── The model library ───────────────────────────────────────────────────────
 * Not queued: saving a photo is an upload and renaming one is a field write.
 * Only *generating* a model is slow enough to be a job, and that one is
 * below with the generations.
 */

router.get("/models", requireAnyPermission(MODEL_LIBRARY_PERMISSIONS), async (req, res) => {
  res.json({ status: "success", models: await models.listModels(req.dbUser) });
});

/** Saves a directly uploaded photo — no generation, just whatever was picked. */
router.post("/models", requireAnyPermission(MODEL_LIBRARY_PERMISSIONS), async (req, res, next) => {
  try {
    const { name, imageDataUri } = req.body || {};
    const model = await models.createModel({ dbUser: req.dbUser, name, imageDataUri });
    res.status(201).json({ status: "success", model });
  } catch (err) {
    if (err.code === "invalid") {
      return res.status(400).json({ status: "error", message: err.message, code: "invalid" });
    }
    next(err);
  }
});

router.patch("/models/:id", requireAnyPermission(MODEL_LIBRARY_PERMISSIONS), async (req, res, next) => {
  try {
    const { name, isPublic } = req.body || {};
    let model = null;

    if (typeof name === "string") {
      model = await models.renameModel({ dbUser: req.dbUser, id: req.params.id, name });
    }
    if (typeof isPublic === "boolean") {
      // Sharing a photograph of a person with a whole organization is a
      // decision rather than a convenience — an organization's own admin
      // makes it, or the platform super admin above them.
      if (!isAdmin(req)) {
        return res.status(403).json({
          status: "error",
          message: "only an admin can share a model with the organization",
          code: "forbidden",
        });
      }
      model = await models.setModelPublic({ dbUser: req.dbUser, id: req.params.id, isPublic });
    }

    if (!model) {
      return res.status(name === undefined && isPublic === undefined ? 400 : 404).json({
        status: "error",
        message: model === null ? "model not found" : "nothing to update",
        code: "not_found",
      });
    }
    res.json({ status: "success", model });
  } catch (err) {
    if (err.code === "forbidden") {
      return res.status(403).json({ status: "error", message: err.message, code: "forbidden" });
    }
    next(err);
  }
});

router.delete("/models/:id", requireAnyPermission(MODEL_LIBRARY_PERMISSIONS), async (req, res, next) => {
  try {
    // Always a soft delete — the record and photo stay for past runs.
    const model = await models.deleteModel({
      dbUser: req.dbUser,
      id: req.params.id,
      isAdmin: isAdmin(req),
    });
    if (!model) return res.status(404).json({ status: "error", message: "model not found", code: "not_found" });
    res.json({ status: "success", model });
  } catch (err) {
    if (err.code === "forbidden") {
      return res.status(403).json({ status: "error", message: err.message, code: "forbidden" });
    }
    next(err);
  }
});

/** Generating a new model — slow, so queued like any other model call. */
router.post("/model", requireAnyPermission(MODEL_LIBRARY_PERMISSIONS), async (req, res) => {
  const { attrs, notes, name, model: requestedModel, quality: requestedQuality } = req.body || {};
  const { provider, model, modelLabel, quality } = resolveProviderModel(requestedModel, requestedQuality);

  return queueGeneration(req, res, {
    type: LIFESTYLE_MODEL_JOB,
    tool: "life_style",
    request: { provider, model, modelLabel, quality, kind: "model", name: name || null },
    payload: { attrs: attrs || {}, notes: notes || null, name, requestedModel, requestedQuality },
    message: `queued a Lifestyle model generation on ${modelLabel}`,
  });
});

/*
 * ── Generations ─────────────────────────────────────────────────────────────
 */

router.post("/", requirePermission("tool.life_style.run"), async (req, res) => {
  const {
    modelImage,
    modelId,
    jewelryImage,
    jewelryImages,
    placement,
    poseInstruction,
    shotType,
    sceneInstruction,
    aspectRatio,
    description,
    model: requestedModel,
    quality: requestedQuality,
    refineImage,
    instruction,
    conversationId,
  } = req.body || {};

  const { provider, model, modelLabel, quality } = resolveProviderModel(requestedModel, requestedQuality);

  /*
   * A refinement re-attaches the original jewellery photos on every turn, in
   * front of any style reference. Without them the model only ever checks
   * its work against the previous generated image, so a stone lost on turn
   * two stays lost for the rest of the thread.
   */
  if (refineImage && instruction) {
    const parsedImage = parseDataUri(refineImage);
    if (!parsedImage) {
      return res.status(400).json({ status: "error", message: "refine image must be a data URI", code: "invalid" });
    }

    const jewelryRefs = parseImages(jewelryImages);
    // Its `references` are the style references alone.
    const refinement = refinementPayload(req.body, parsedImage);

    return queueGeneration(req, res, {
      type: LIFESTYLE_JOB,
      tool: "life_style",
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
      payload: {
        ...refinement,
        // Order matters and is described by the prompt: the jewellery
        // originals first, then anything attached as inspiration.
        references: [...jewelryRefs, ...refinement.references],
        jewelryCount: jewelryRefs.length,
      },
      preview: null,
      message: `queued a Lifestyle refinement on ${modelLabel}`,
    });
  }

  // Either a `jewelryImages` array (a set) or a single `jewelryImage`.
  const jewelryList = parseImages(Array.isArray(jewelryImages) && jewelryImages.length ? jewelryImages : jewelryImage);
  if (jewelryList.length === 0) {
    return res.status(400).json({ status: "error", message: "at least one jewellery photo is required", code: "invalid" });
  }

  // A library model (recorded by reference, read when the job runs) or a
  // photo sent with the request (still saving to the library) — see baseModel.js.
  let baseModel;
  try {
    baseModel = await resolveBaseModel({ dbUser: req.dbUser, modelId, modelImage });
  } catch (err) {
    return res.status(400).json({ status: "error", message: err.message, code: "invalid" });
  }
  if (!baseModel) {
    return res.status(400).json({ status: "error", message: "choose a model to place the jewellery on", code: "invalid" });
  }

  const options = {
    placement: placement || "around neck",
    poseInstruction: poseInstruction || "",
    description: description || "",
    shotType: shotType || "",
    sceneInstruction: sceneInstruction || "",
    aspectRatio: aspectRatio || "",
  };

  return queueGeneration(req, res, {
    type: LIFESTYLE_JOB,
    tool: "life_style",
    request: {
      provider,
      model,
      modelLabel,
      quality,
      isRefinement: false,
      jewelryCount: jewelryList.length,
      placement: options.placement,
      conversationId: conversationId || null,
    },
    payload: {
      isRefinement: false,
      // The pieces, plus the model by reference (or, for an upload, its photo
      // first). The job puts the model first — the order both prompts describe.
      ...modelPayload(baseModel, jewelryList),
      sourceRoles: baseModel.ref ? undefined : ["model"],
      jewelryCount: jewelryList.length,
      // The frame shape the user actually picked — sent to the provider
      // directly (see `generationRunner`), not left to the prompt text alone.
      aspectRatio: options.aspectRatio || null,
      options,
      userPrompt: description || null,
      // One composite per run, however many references went in.
      count: 1,
      requestedModel,
      requestedQuality,
      conversationId: conversationId || null,
    },
    message: `queued a Lifestyle run (${jewelryList.length} piece${jewelryList.length > 1 ? "s" : ""}) on ${modelLabel}`,
  });
});

module.exports = router;

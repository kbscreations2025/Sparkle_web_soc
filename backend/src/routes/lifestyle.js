const express = require("express");
const { requireAuth, requirePermission, requireAnyPermission } = require("../middleware/auth");
const { resolveProviderModel } = require("../aiRouting");
const { parseDataUri, resolveInlineImage } = require("../generationService");
const { queueGeneration, parseImages } = require("./queueGeneration");
const { LIFESTYLE_JOB, LIFESTYLE_MODEL_JOB } = require("../jobs/lifestyle");
const { loadPreset, PRESET_IDS } = require("../services/lifestylePresets");
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
    modelNumber,
    modelImage,
    modelId,
    jewelryImage,
    jewelryImages,
    placement,
    poseInstruction,
    shotType,
    sceneInstruction,
    description,
    model: requestedModel,
    quality: requestedQuality,
    refineImage,
    referenceImages,
    instruction,
    displayPrompt,
    conversationId,
    parentGenerationId,
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
    const styleRefs = parseImages(referenceImages);

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
        referenceCount: styleRefs.length,
        conversationId: conversationId || null,
      },
      payload: {
        isRefinement: true,
        refineImage: parsedImage,
        // Order matters and is described by the prompt: the jewellery
        // originals first, then anything attached as inspiration.
        references: [...jewelryRefs, ...styleRefs],
        jewelryCount: jewelryRefs.length,
        instruction,
        displayPrompt,
        requestedModel,
        requestedQuality,
        conversationId,
        parentGenerationId,
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

  // Three ways to name a model, resolved to bytes here so the worker only
  // ever deals in images: one of the built-in presets, a saved model from
  // the library, or a photo uploaded with the request.
  let baseModel;
  try {
    baseModel = await resolveBaseModel({ dbUser: req.dbUser, modelNumber, modelId, modelImage });
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
      // The model first, the pieces after — the order both prompts describe.
      sourceImages: [baseModel, ...jewelryList],
      jewelryCount: jewelryList.length,
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

/**
 * The chosen model as `{ mimeType, base64 }`.
 *
 * A saved model is stored as a url, so it is fetched back rather than
 * trusted from the client: the browser sending the bytes of "model 7" is the
 * browser deciding what model 7 is.
 */
async function resolveBaseModel({ dbUser, modelNumber, modelId, modelImage }) {
  if (modelId) {
    const saved = await models.findUsableModel({ dbUser, id: modelId });
    if (!saved) throw new Error("that saved model is not available");
    return resolveInlineImage(saved.imageUrl);
  }

  if (modelImage) {
    const uploaded = await resolveInlineImage(modelImage);
    if (!uploaded) throw new Error("the model photo must be an image");
    return uploaded;
  }

  if (modelNumber !== undefined && modelNumber !== null && modelNumber !== "") {
    if (!PRESET_IDS.includes(Number(modelNumber))) throw new Error(`there is no preset model ${modelNumber}`);
    return loadPreset(modelNumber);
  }

  return null;
}

module.exports = router;

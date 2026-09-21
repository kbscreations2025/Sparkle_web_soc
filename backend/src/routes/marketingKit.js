const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { resolveProviderModel } = require("../aiRouting");
const { parseDataUri, resolveInlineImage } = require("../generationService");
const { queueGeneration, parseImages } = require("./queueGeneration");
const { BRAND_STORY_JOB, AFFINITY_JOB, CAMPAIGN_KIT_JOB } = require("../jobs/marketingKit");
const { MARKETING_KIT_TYPES } = require("../models/marketingKit");
const kits = require("../services/marketingKits");
const lifestyleModels = require("../services/lifestyleModels");
const { loadPreset, PRESET_IDS } = require("../services/lifestylePresets");

const router = express.Router();

router.use(requireAuth, requirePermission("tool.marketing_kit.run"));

/** Eight pieces is where the model's attention — and its token budget — runs out. */
const MAX_AFFINITY_ITEMS = 8;

/*
 * ── Brand Story ─────────────────────────────────────────────────────────────
 */

router.post("/brand-story", async (req, res) => {
  const { images, sheetImages, preview, conversationId } = req.body || {};

  const parsedImages = parseImages(images);
  if (parsedImages.length === 0) {
    return res.status(400).json({ status: "error", message: "at least one photo is required", code: "invalid" });
  }

  return queueGeneration(req, res, {
    type: BRAND_STORY_JOB,
    tool: "marketing_kit",
    request: {
      provider: "gemini",
      model: "gemini-2.5-pro",
      modelLabel: "Sparkle 2.5 Pro",
      kind: "brand_story",
      imageCount: parsedImages.length,
    },
    payload: {
      images: parsedImages,
      sheetImages: parseImages(sheetImages),
      conversationId: conversationId || null,
    },
    preview,
    message: "queued a Brand Story narrative",
  });
});

/*
 * ── Affinity ────────────────────────────────────────────────────────────────
 */

router.post("/affinity", async (req, res) => {
  const { items, preview, conversationId } = req.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ status: "error", message: "no pieces provided", code: "invalid" });
  }
  if (items.length > MAX_AFFINITY_ITEMS) {
    return res.status(400).json({
      status: "error",
      message: `upload at most ${MAX_AFFINITY_ITEMS} pieces at a time`,
      code: "too_many_items",
    });
  }

  // Parsed here so the worker never re-parses a data URI, and so a piece
  // whose photo isn't really an image is rejected before anything is queued.
  const parsedItems = items.map((item) => ({
    image: parseDataUri(item?.image) || null,
    sheetImages: parseImages(item?.sheetImages),
    sheetExcelText: Array.isArray(item?.sheetExcelText) ? item.sheetExcelText.filter((text) => typeof text === "string") : [],
  }));

  if (parsedItems.every((item) => !item.image)) {
    return res.status(400).json({ status: "error", message: "each piece needs a photo", code: "invalid" });
  }

  return queueGeneration(req, res, {
    type: AFFINITY_JOB,
    tool: "marketing_kit",
    request: {
      provider: "gemini",
      model: "gemini-2.5-pro",
      modelLabel: "Sparkle 2.5 Pro",
      kind: "affinity",
      itemCount: parsedItems.length,
      withSheets: parsedItems.filter((item) => item.sheetImages.length || item.sheetExcelText.length).length,
    },
    payload: { items: parsedItems, conversationId: conversationId || null },
    preview,
    message: `queued an Affinity deck (${parsedItems.length} piece${parsedItems.length > 1 ? "s" : ""})`,
  });
});

/*
 * ── Campaign Kit ────────────────────────────────────────────────────────────
 */

router.post("/campaign", async (req, res) => {
  const {
    modelImage,
    modelId,
    modelNumber,
    jewelryImages,
    description,
    boxStyles,
    poses,
    studioProps,
    aspect,
    model: requestedModel,
    quality: requestedQuality,
    refineImage,
    referenceImages,
    instruction,
    displayPrompt,
    shotLabel,
    conversationId,
    parentGenerationId,
  } = req.body || {};

  const { provider, model, modelLabel, quality } = resolveProviderModel(requestedModel, requestedQuality);

  // Retouching one shot costs one image, not another whole kit.
  if (refineImage && instruction) {
    const parsed = parseDataUri(refineImage);
    if (!parsed) {
      return res.status(400).json({ status: "error", message: "refine image must be a data URI", code: "invalid" });
    }
    const references = parseImages(referenceImages);

    return queueGeneration(req, res, {
      type: CAMPAIGN_KIT_JOB,
      tool: "marketing_kit",
      request: {
        provider,
        model,
        modelLabel,
        quality,
        kind: "campaign",
        isRefinement: true,
        shotLabel: shotLabel || null,
        conversationId: conversationId || null,
      },
      payload: {
        isRefinement: true,
        refineImage: parsed,
        references,
        instruction,
        displayPrompt,
        shotLabel: shotLabel || null,
        requestedModel,
        requestedQuality,
        conversationId,
        parentGenerationId,
      },
      message: `queued a Campaign Kit retouch on ${modelLabel}`,
    });
  }

  const jewelryList = parseImages(jewelryImages);
  if (jewelryList.length === 0) {
    return res.status(400).json({ status: "error", message: "at least one jewellery photo is required", code: "invalid" });
  }

  let baseModel;
  try {
    baseModel = await resolveBaseModel({ dbUser: req.dbUser, modelNumber, modelId, modelImage });
  } catch (err) {
    return res.status(400).json({ status: "error", message: err.message, code: "invalid" });
  }
  if (!baseModel) {
    return res.status(400).json({ status: "error", message: "choose a model for the lifestyle shots", code: "invalid" });
  }

  const options = {
    description: description || "",
    aspect: aspect || "square",
    boxStyles: asIdList(boxStyles),
    poses: asIdList(poses),
    studioProps: asIdList(studioProps),
  };

  return queueGeneration(req, res, {
    type: CAMPAIGN_KIT_JOB,
    tool: "marketing_kit",
    request: {
      provider,
      model,
      modelLabel,
      quality,
      kind: "campaign",
      isRefinement: false,
      jewelryCount: jewelryList.length,
      aspect: options.aspect,
      conversationId: conversationId || null,
    },
    payload: {
      isRefinement: false,
      // The model first, the pieces after — the shot builder splits on that.
      sourceImages: [baseModel, ...jewelryList],
      sourceRoles: ["uploaded", ...jewelryList.map(() => "reference")],
      options,
      userPrompt: description || null,
      requestedModel,
      requestedQuality,
      conversationId: conversationId || null,
    },
    message: `queued a Campaign Kit (4 shots) on ${modelLabel}`,
  });
});

/** At most two picks per option — one per shot in its pair. */
function asIdList(value) {
  return (Array.isArray(value) ? value : []).filter((id) => typeof id === "string").slice(0, 2);
}

/** Same three ways of naming a model as Lifestyle, and the same rule: never trust the bytes for a saved one. */
async function resolveBaseModel({ dbUser, modelNumber, modelId, modelImage }) {
  if (modelId) {
    const saved = await lifestyleModels.findUsableModel({ dbUser, id: modelId });
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

/*
 * ── Saved kits ──────────────────────────────────────────────────────────────
 * A kit is an editable document, not a queued run — plain REST.
 */

router.get("/kits", async (req, res) => {
  // Anything not on the list is ignored rather than refused — a stale
  // bookmark narrowing to a kind that no longer exists should show
  // everything, not an error.
  const kind = MARKETING_KIT_TYPES.includes(req.query.kind) ? req.query.kind : undefined;
  const result = await kits.listKits({
    dbUser: req.dbUser,
    kind,
    cursor: req.query.cursor,
    limit: req.query.limit,
    // `scope=team` is honoured only for someone who holds
    // `result.read.others`, so it is always safe to ask.
    scope: req.query.scope,
  });
  res.json({ status: "success", ...result });
});

router.get("/kits/:id", async (req, res) => {
  const kit = await kits.getKit({ dbUser: req.dbUser, id: req.params.id });
  if (!kit) return res.status(404).json({ status: "error", message: "kit not found", code: "not_found" });
  res.json({ status: "success", kit });
});

router.patch("/kits/:id", async (req, res) => {
  const kit = await kits.updateKit({ dbUser: req.dbUser, id: req.params.id, changes: req.body || {} });
  if (!kit) return res.status(404).json({ status: "error", message: "kit not found", code: "not_found" });
  res.json({ status: "success", kit });
});

router.delete("/kits/:id", async (req, res) => {
  const result = await kits.deleteKit({ dbUser: req.dbUser, id: req.params.id });
  if (!result) return res.status(404).json({ status: "error", message: "kit not found", code: "not_found" });
  res.json({ status: "success", ...result });
});

module.exports = router;

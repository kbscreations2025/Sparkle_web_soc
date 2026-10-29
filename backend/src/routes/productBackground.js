const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { resolveProviderModel } = require("../aiRouting");
const { clampCount } = require("../jobs/generationRunner");
const { PRODUCT_BACKGROUND_JOB } = require("../jobs/productBackground");
const { THEMES, THEME_BY_ID } = require("../prompts/productBackground");
const { analyse, nearestAspectRatio } = require("../services/cutout");
const { queueGeneration, parseImages, readRefinement } = require("./queueGeneration");

const TOOL = "product_background";

/** At most this many versions of one scene per run — each is a full image generation, and charged as one. */
const MAX_SCENE_COUNT = 4;

/**
 * What a cutout is priced as. The cutout itself is local work; the one model
 * call in it is the segmentation (a Gemini 2.5 Flash request), so it is
 * priced as that. A photo too busy to cut directly is first moved onto white
 * by an image model, and priced as that edit.
 */
const CUTOUT_PRICE = { provider: "gemini", model: "gemini-2.5-flash", modelLabel: "Sparkle Cutout", quality: null };
const BUSY_CUTOUT_PRICE = { provider: "gemini", model: "gemini-3-pro-image", modelLabel: "Sparkle Cutout + 3 Pro Image", quality: "2K" };

const SHADOWS = ["none", "natural", "soft"];
const FRAMINGS = ["original", "square"];

const router = express.Router();
router.use(requireAuth, requirePermission(`tool.${TOOL}.run`));

/** The scene presets, for the picker — the prompt wording stays on the server. */
router.get("/themes", (req, res) => {
  res.json({ status: "success", themes: THEMES.map(({ id, label, hint }) => ({ id, label, hint })) });
});

/** The background asked for, normalised — or null when it isn't one this tool offers. */
function readBackground(value) {
  const kind = value?.kind;
  if (kind === "transparent") return { kind };
  if (kind === "white") return { kind, hex: "#FFFFFF" };
  if (kind === "color") {
    const hex = typeof value.hex === "string" && /^#[0-9a-f]{6}$/i.test(value.hex.trim()) ? value.hex.trim().toUpperCase() : null;
    return hex ? { kind, hex } : null;
  }
  if (kind === "theme") {
    const prompt = typeof value.prompt === "string" ? value.prompt.trim().slice(0, 600) : "";
    const theme = THEME_BY_ID.has(value.theme) ? value.theme : "custom";
    return { kind, theme, prompt };
  }
  return null;
}

router.post("/", async (req, res) => {
  const body = req.body || {};

  const refinement = readRefinement(body);
  if (refinement) {
    const { provider, model, modelLabel, quality } = resolveProviderModel(body.model, body.quality);
    return queueGeneration(req, res, {
      type: PRODUCT_BACKGROUND_JOB,
      tool: TOOL,
      preview: body.preview,
      request: { provider, model, modelLabel, quality, isRefinement: true, instruction: body.instruction, referenceCount: refinement.references.length },
      payload: refinement,
      message: `queued a product-background refinement on ${modelLabel}`,
    });
  }

  const [photo] = parseImages(body.image);
  if (!photo) {
    return res.status(400).json({ status: "error", message: "a photo of the piece is required", code: "invalid" });
  }
  const background = readBackground(body.background);
  if (!background) {
    return res.status(400).json({ status: "error", message: "choose a background: transparent, white, a colour or a scene", code: "invalid" });
  }
  const [backdrop] = background.kind === "theme" ? parseImages(body.backdropImage) : [];
  if (background.kind === "theme" && background.theme === "custom" && !background.prompt && !backdrop) {
    return res.status(400).json({ status: "error", message: "describe the scene, or add a background photo", code: "invalid" });
  }

  // The photo's proportions (so a generated scene keeps its framing) and
  // whether it sits on a plain backdrop (whether a cutout needs a model
  // first, and so what it costs). A small decode — cheap enough to answer here.
  let analysis;
  try {
    analysis = await analyse(Buffer.from(photo.base64, "base64"));
  } catch (err) {
    console.warn(`${TOOL}: could not read the uploaded photo:`, err.message);
    return res.status(400).json({ status: "error", message: "That photo could not be read. Try a JPG or PNG.", code: "invalid" });
  }
  const aspectRatio = nearestAspectRatio(analysis.width, analysis.height);
  const conversationId = body.conversationId || null;

  if (background.kind === "theme") {
    const { provider, model, modelLabel, quality } = resolveProviderModel(body.model, body.quality);
    const count = Math.min(MAX_SCENE_COUNT, clampCount(body.count, 1));
    const sceneName = backdrop
      ? "Placed into my background photo"
      : background.theme === "custom"
        ? background.prompt
        : `${THEME_BY_ID.get(background.theme).label} scene`;
    const userPrompt = background.theme !== "custom" && background.prompt ? `${sceneName} — ${background.prompt}` : sceneName;

    return queueGeneration(req, res, {
      type: PRODUCT_BACKGROUND_JOB,
      tool: TOOL,
      preview: body.preview,
      request: { provider, model, modelLabel, quality, isRefinement: false, background, count, aspectRatio },
      payload: {
        isRefinement: false,
        requestedModel: body.model,
        requestedQuality: body.quality,
        background,
        count,
        aspectRatio,
        userPrompt,
        sourceImages: backdrop ? [photo, backdrop] : [photo],
        // The second image is the setting, not a second piece.
        sourceRoles: backdrop ? ["uploaded", "reference"] : ["uploaded"],
        conversationId,
      },
      message: `queued a product-background scene (${count} image${count > 1 ? "s" : ""}) on ${modelLabel}`,
    });
  }

  const needsPlainBackdrop = !analysis.plain;
  const price = needsPlainBackdrop ? BUSY_CUTOUT_PRICE : CUTOUT_PRICE;
  const shadow = SHADOWS.includes(body.shadow) ? body.shadow : "none";
  const framing = FRAMINGS.includes(body.framing) ? body.framing : "original";

  return queueGeneration(req, res, {
    type: PRODUCT_BACKGROUND_JOB,
    tool: TOOL,
    preview: body.preview,
    request: { ...price, isRefinement: false, background, shadow, framing, needsPlainBackdrop },
    payload: {
      isRefinement: false,
      background,
      shadow,
      framing,
      aspectRatio,
      needsPlainBackdrop,
      sourceImages: [photo],
      conversationId,
    },
    message: `queued a product-background cutout (${background.kind}${needsPlainBackdrop ? ", busy photo" : ""})`,
  });
});

module.exports = router;

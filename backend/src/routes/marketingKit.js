const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { resolveProviderModel } = require("../aiRouting");
const { parseDataUri } = require("../generationService");
const { queueGeneration, parseImages, refinementPayload } = require("./queueGeneration");
const { resolveBaseModel } = require("./baseModel");
const {
  BRAND_STORY_JOB,
  AFFINITY_JOB,
  COLLECTION_STORY_JOB,
  CAMPAIGN_KIT_JOB,
  FESTIVE_POSTER_JOB,
} = require("../jobs/marketingKit");
const { BRAND_STORY_TONES, BRAND_STORY_LENGTHS } = require("../prompts/marketingKit");
const { FESTIVE_EVENT_IDS, FESTIVE_ASPECT_RATIOS, POSTER_FONT_IDS, eventLabel } = require("../prompts/festivePoster");
const { clampCount } = require("../jobs/generationRunner");
const { MARKETING_KIT_TYPES } = require("../models/marketingKit");
const kits = require("../services/marketingKits");

const router = express.Router();

router.use(requireAuth, requirePermission("tool.marketing_kit.run"));

/** Eight pieces is where the model's attention — and its token budget — runs out. */
const MAX_AFFINITY_ITEMS = 8;
/**
 * Collection Story splits its pieces into categories, each read as its own
 * small set, so it carries more in one run — and the body limit, not the
 * model, is what bounds it (sheet pages travel as compressed JPEGs) — so
 * there is no count cap here.
 */
const MAX_COLLECTION_ITEMS = Infinity;

/*
 * ── Brand Story ─────────────────────────────────────────────────────────────
 */

router.post("/brand-story", async (req, res) => {
  const { images, sheetImages, preview, conversationId } = req.body || {};
  // Unknown or absent choices fall back to the original voice and length
  // rather than refusing — they only ever shape the wording.
  const tone = Object.hasOwn(BRAND_STORY_TONES, req.body?.tone) ? req.body.tone : "classic";
  const length = Object.hasOwn(BRAND_STORY_LENGTHS, req.body?.length) ? req.body.length : "medium";

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
      tone,
      length,
    },
    payload: {
      images: parsedImages,
      sheetImages: parseImages(sheetImages),
      conversationId: conversationId || null,
      tone,
      length,
    },
    preview,
    message: "queued a Brand Story narrative",
  });
});

/*
 * ── Affinity ────────────────────────────────────────────────────────────────
 */

/*
 * Collection Story is Affinity under its own name: the same request, its own
 * job type and kit kind (see jobs/marketingKit.js).
 */
router.post("/affinity", (req, res) => queueAffinityRun(req, res, { type: AFFINITY_JOB, kind: "affinity", name: "Affinity deck" }));
router.post("/collection-story", (req, res) =>
  queueAffinityRun(req, res, { type: COLLECTION_STORY_JOB, kind: "collection_story", name: "Collection Story" })
);

async function queueAffinityRun(req, res, { type, kind, name }) {
  const { items, preview, conversationId } = req.body || {};
  const max = kind === "collection_story" ? MAX_COLLECTION_ITEMS : MAX_AFFINITY_ITEMS;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ status: "error", message: "no pieces provided", code: "invalid" });
  }
  if (items.length > max) {
    return res.status(400).json({
      status: "error",
      message: `upload at most ${max} pieces at a time`,
      code: "too_many_items",
    });
  }

  const categories = kind === "collection_story" ? readCategories(req.body?.categories, items.length) : [];
  if (categories === null) {
    return res.status(400).json({ status: "error", message: "every piece must be in at least one category", code: "invalid" });
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
    type,
    tool: "marketing_kit",
    request: {
      provider: "gemini",
      model: "gemini-2.5-pro",
      modelLabel: "Sparkle 2.5 Pro",
      kind,
      itemCount: parsedItems.length,
      withSheets: parsedItems.filter((item) => item.sheetImages.length || item.sheetExcelText.length).length,
      ...(categories.length ? { categoryCount: categories.length } : {}),
    },
    payload: { items: parsedItems, categories, conversationId: conversationId || null },
    preview,
    message: `queued a ${name} (${parsedItems.length} piece${parsedItems.length > 1 ? "s" : ""})`,
  });
}

/**
 * Collection Story's groups, checked: each `{ label, pieceIndexes, coverIndex }`
 * names pieces by their position in `items`, every piece is in at least one
 * group (and may be in several), and a group's cover is one of its own pieces. Empty or absent means
 * "one group". Null when the groups don't add up.
 */
function readCategories(value, itemCount) {
  if (!Array.isArray(value) || value.length === 0) return [];
  const seen = new Set();
  const categories = [];

  for (const entry of value.slice(0, itemCount)) {
    const pieceIndexes = (Array.isArray(entry?.pieceIndexes) ? entry.pieceIndexes : [])
      .map(Number)
      .filter((index) => Number.isInteger(index) && index >= 0 && index < itemCount);
    if (pieceIndexes.length === 0) continue;
    // A piece may sit in more than one group; it just has to be in at least one.
    for (const index of pieceIndexes) seen.add(index);
    const cover = Number(entry.coverIndex);
    categories.push({
      // The person's grouping name — a hint for the model, which writes the real one.
      label: typeof entry.label === "string" ? entry.label.trim().slice(0, 100) : "",
      pieceIndexes,
      coverIndex: pieceIndexes.includes(cover) ? cover : pieceIndexes[0],
    });
  }

  if (seen.size !== itemCount) return null;
  // One group is just the plain deck — no category covers needed.
  return categories.length > 1 ? categories : [];
}

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
    instruction,
    shotLabel,
    conversationId,
  } = req.body || {};

  const { provider, model, modelLabel, quality } = resolveProviderModel(requestedModel, requestedQuality);

  // Retouching one shot costs one image, not another whole kit.
  if (refineImage && instruction) {
    const parsed = parseDataUri(refineImage);
    if (!parsed) {
      return res.status(400).json({ status: "error", message: "refine image must be a data URI", code: "invalid" });
    }

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
      payload: { ...refinementPayload(req.body, parsed), shotLabel: shotLabel || null },
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

/*
 * ── Festive Poster ──────────────────────────────────────────────────────────
 */

/** Six is where every piece can still be seen clearly in one frame. */
const MAX_FESTIVE_PIECES = 6;
/** Each variation is a separately charged image. */
const MAX_FESTIVE_VARIATIONS = 4;

/** The poster's words and title font, cleaned — or null for a poster with no text. */
function readPosterText(value) {
  const line = (entry, max) => (typeof entry === "string" ? entry.replace(/\s+/g, " ").trim().slice(0, max) : "");
  // Asked for with every line left empty is still a poster with text: the
  // model writes the words itself (see textBlock in prompts/festivePoster.js).
  if (!value || value.enabled === false) return null;
  const headline = line(value.headline, 60);
  return {
    headline,
    subtitle: line(value.subtitle, 60),
    tagline: line(value.tagline, 90),
    font: POSTER_FONT_IDS.includes(value.font) ? value.font : "surprise",
    placement: ["left", "center", "right"].includes(value.placement) ? value.placement : "center",
  };
}

router.post("/festive", async (req, res) => {
  const {
    jewelryImages,
    event,
    customEvent,
    description,
    aspect,
    count,
    model: requestedModel,
    quality: requestedQuality,
    refineImage,
    instruction,
    conversationId,
    preview,
  } = req.body || {};

  const { provider, model, modelLabel, quality } = resolveProviderModel(requestedModel, requestedQuality);

  // Retouching one poster costs one image and edits it — no new kit.
  if (refineImage && instruction) {
    const parsed = parseDataUri(refineImage);
    if (!parsed) {
      return res.status(400).json({ status: "error", message: "refine image must be a data URI", code: "invalid" });
    }

    return queueGeneration(req, res, {
      type: FESTIVE_POSTER_JOB,
      tool: "marketing_kit",
      request: { provider, model, modelLabel, quality, kind: "festive", isRefinement: true, conversationId: conversationId || null },
      payload: refinementPayload(req.body, parsed),
      message: `queued a Poster retouch on ${modelLabel}`,
    });
  }

  const pieces = parseImages(jewelryImages);
  if (pieces.length === 0) {
    return res.status(400).json({ status: "error", message: "add at least one jewellery photo", code: "invalid" });
  }
  if (pieces.length > MAX_FESTIVE_PIECES) {
    return res.status(400).json({
      status: "error",
      message: `use at most ${MAX_FESTIVE_PIECES} pieces in one poster`,
      code: "too_many_items",
    });
  }

  const custom = typeof customEvent === "string" ? customEvent.trim().slice(0, 200) : "";
  if (!custom && !FESTIVE_EVENT_IDS.includes(event)) {
    return res.status(400).json({ status: "error", message: "choose an event, or type your own", code: "invalid" });
  }

  const options = {
    eventId: custom ? null : event,
    customEvent: custom || null,
    description: typeof description === "string" ? description.slice(0, 1000) : "",
    aspect: Object.hasOwn(FESTIVE_ASPECT_RATIOS, aspect) ? aspect : "square",
    text: readPosterText(req.body?.text),
  };
  const variations = Math.min(MAX_FESTIVE_VARIATIONS, clampCount(count, 1));

  return queueGeneration(req, res, {
    type: FESTIVE_POSTER_JOB,
    tool: "marketing_kit",
    preview,
    request: {
      provider,
      model,
      modelLabel,
      quality,
      kind: "festive",
      isRefinement: false,
      event: eventLabel(options),
      jewelryCount: pieces.length,
      aspect: options.aspect,
      count: variations,
      conversationId: conversationId || null,
    },
    payload: {
      isRefinement: false,
      sourceImages: pieces,
      options,
      count: variations,
      defaultCount: 1,
      // The frame shape itself, not only the words — see gemini generateImage.
      aspectRatio: FESTIVE_ASPECT_RATIOS[options.aspect],
      userPrompt: `${eventLabel(options)} poster${options.description ? ` — ${options.description}` : ""}`,
      requestedModel,
      requestedQuality,
      conversationId: conversationId || null,
    },
    message: `queued a ${eventLabel(options)} poster (${variations} image${variations > 1 ? "s" : ""}) on ${modelLabel}`,
  });
});

/** At most two picks per option — one per shot in its pair. */
function asIdList(value) {
  return (Array.isArray(value) ? value : []).filter((id) => typeof id === "string").slice(0, 2);
}

/*
 * ── Setting codes ───────────────────────────────────────────────────────────
 * The table the catalog copy decodes sheet setting codes with, so the upload
 * preview can show a sheet's settings in the same words the deck will use.
 */
const SETTING_CODE_NAMES = Object.fromEntries(require("../prompts/settingCodes.json").map((entry) => [entry.code, entry.brief]));

router.get("/setting-codes", (req, res) => {
  // Static for the life of the process; let the browser keep it a day.
  res.set("Cache-Control", "private, max-age=86400");
  res.json({ status: "success", codes: SETTING_CODE_NAMES });
});

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
  let kit;
  try {
    kit = await kits.updateKit({ dbUser: req.dbUser, id: req.params.id, changes: req.body || {} });
  } catch (err) {
    if (err.code === "design_too_large") return res.status(413).json({ status: "error", message: err.message, code: err.code });
    // Express 4 does not catch a rejected handler, so answer here rather than leave the request hanging.
    console.error("[marketing-kit] update failed:", err);
    return res.status(500).json({ status: "error", message: "Could not save that edit", code: "server_error" });
  }
  if (!kit) return res.status(404).json({ status: "error", message: "kit not found", code: "not_found" });
  res.json({ status: "success", kit });
});

router.delete("/kits/:id", async (req, res) => {
  const result = await kits.deleteKit({ dbUser: req.dbUser, id: req.params.id });
  if (!result) return res.status(404).json({ status: "error", message: "kit not found", code: "not_found" });
  res.json({ status: "success", ...result });
});

module.exports = router;

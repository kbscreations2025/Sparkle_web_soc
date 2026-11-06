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
  CHARM_STORY_JOB,
  ON_MODEL_JOB,
} = require("../jobs/marketingKit");
const { CHARM_METAL_IDS, CHARM_ASPECT_RATIOS } = require("../prompts/charmStory");
const {
  ON_MODEL_PIECE_TYPES,
  ON_MODEL_ARRANGEMENTS,
  ON_MODEL_TONES,
  ON_MODEL_ASPECT_RATIOS,
} = require("../prompts/onModel");
const { BRAND_STORY_TONES, BRAND_STORY_LENGTHS } = require("../prompts/marketingKit");
const { FESTIVE_EVENT_IDS, FESTIVE_ASPECT_RATIOS, POSTER_FONT_IDS, eventLabel } = require("../prompts/festivePoster");
const { clampCount } = require("../jobs/generationRunner");
const { MARKETING_KIT_TYPES } = require("../models/marketingKit");
const MarketingKit = require("../models/marketingKit");
const Generation = require("../models/generation");
const mongoose = require("mongoose");
const { PRESENTATION_JOB, PRESENTATION_EDIT_JOB } = require("../jobs/presentation");
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

/*
 * ── Charm Shots ─────────────────────────────────────────────────────────────
 * Separate charm photos → all the charms on one chain, photographed in a
 * different aesthetic scene per image; as many images as the person asks for,
 * and a written brief, when given, sets the scene.
 */

/** Each image is a separately charged generation — the runner's own ceiling. */
const MAX_CHARM_IMAGES = 8;

/**
 * The number of charms varies run to run, so there is no real cap — this only
 * guards the request size (each charm travels as a data URI).
 */
const MAX_CHARMS = 30;

router.post("/charms", async (req, res) => {
  const {
    charmImages,
    metal,
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

  if (refineImage && instruction) {
    const parsed = parseDataUri(refineImage);
    if (!parsed) {
      return res.status(400).json({ status: "error", message: "refine image must be a data URI", code: "invalid" });
    }
    return queueGeneration(req, res, {
      type: CHARM_STORY_JOB,
      tool: "marketing_kit",
      request: { provider, model, modelLabel, quality, kind: "charms", mode: "charms", isRefinement: true, conversationId: conversationId || null },
      payload: refinementPayload(req.body, parsed),
      message: `queued a Charm Shots retouch on ${modelLabel}`,
    });
  }

  const pieces = parseImages(charmImages);
  if (pieces.length === 0) {
    return res.status(400).json({ status: "error", message: "add at least one charm photo", code: "invalid" });
  }
  if (pieces.length > MAX_CHARMS) {
    return res.status(400).json({ status: "error", message: `use at most ${MAX_CHARMS} charms`, code: "too_many_items" });
  }

  const options = {
    metal: CHARM_METAL_IDS.includes(metal) ? metal : "match",
    // The brief, when written, sets the scene (see sceneBlock in prompts/charmStory.js).
    description: typeof description === "string" ? description.replace(/\s+/g, " ").trim().slice(0, 1000) : "",
    aspect: Object.hasOwn(CHARM_ASPECT_RATIOS, aspect) ? aspect : "portrait",
  };
  const images = Math.min(MAX_CHARM_IMAGES, clampCount(count, 1));

  return queueGeneration(req, res, {
    type: CHARM_STORY_JOB,
    tool: "marketing_kit",
    preview,
    request: {
      provider,
      model,
      modelLabel,
      quality,
      kind: "charms",
      // What the queue rail and toasts reopen the run by (frontend lib/nav.ts workspacePathFor).
      mode: "charms",
      isRefinement: false,
      jewelryCount: pieces.length,
      aspect: options.aspect,
      count: images,
      conversationId: conversationId || null,
    },
    payload: {
      isRefinement: false,
      sourceImages: pieces,
      options,
      count: images,
      defaultCount: 1,
      // The frame shape itself, not only the words — see gemini generateImage.
      aspectRatio: CHARM_ASPECT_RATIOS[options.aspect],
      userPrompt: `Charm Shots — ${pieces.length} charm${pieces.length > 1 ? "s" : ""} on one chain${options.description ? ` — ${options.description}` : ""}`,
      requestedModel,
      requestedQuality,
      conversationId: conversationId || null,
    },
    message: `queued Charm Shots (${images} image${images > 1 ? "s" : ""}) on ${modelLabel}`,
  });
});

/*
 * ── Styled on Model ─────────────────────────────────────────────────────────
 * Any mix of pieces — a set, pendants to layer, rings and bracelets to stack,
 * a charm collection, or one piece — worn together by one model in cinematic
 * editorial shots, as many as the person asks for.
 */

/** Past twelve, one frame can no longer show every piece at its real size. */
const MAX_ON_MODEL_PIECES = 12;
/** Each image is a separately charged generation — the runner's own ceiling. */
const MAX_ON_MODEL_IMAGES = 8;

router.post("/on-model", async (req, res) => {
  const {
    jewelryImages,
    types,
    arrangement,
    tone,
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

  if (refineImage && instruction) {
    const parsed = parseDataUri(refineImage);
    if (!parsed) {
      return res.status(400).json({ status: "error", message: "refine image must be a data URI", code: "invalid" });
    }
    return queueGeneration(req, res, {
      type: ON_MODEL_JOB,
      tool: "marketing_kit",
      request: { provider, model, modelLabel, quality, kind: "on_model", mode: "on_model", isRefinement: true, conversationId: conversationId || null },
      payload: refinementPayload(req.body, parsed),
      message: `queued a Styled on Model retouch on ${modelLabel}`,
    });
  }

  const pieces = parseImages(jewelryImages);
  if (pieces.length === 0) {
    return res.status(400).json({ status: "error", message: "add at least one jewellery photo", code: "invalid" });
  }
  if (pieces.length > MAX_ON_MODEL_PIECES) {
    return res.status(400).json({
      status: "error",
      message: `use at most ${MAX_ON_MODEL_PIECES} pieces in one look`,
      code: "too_many_items",
    });
  }

  const options = {
    // Index-aligned with the photos; an unknown type is left to the photo.
    types: pieces.map((_, i) => (ON_MODEL_PIECE_TYPES.includes(types?.[i]) ? types[i] : "auto")),
    arrangement: ON_MODEL_ARRANGEMENTS.includes(arrangement) ? arrangement : "auto",
    tone: ON_MODEL_TONES.includes(tone) ? tone : "warm_cinematic",
    // The brief, when written, leads (see sceneBlock in prompts/onModel.js).
    description: typeof description === "string" ? description.replace(/\s+/g, " ").trim().slice(0, 1000) : "",
    aspect: Object.hasOwn(ON_MODEL_ASPECT_RATIOS, aspect) ? aspect : "portrait",
  };
  const images = Math.min(MAX_ON_MODEL_IMAGES, clampCount(count, 1));

  return queueGeneration(req, res, {
    type: ON_MODEL_JOB,
    tool: "marketing_kit",
    preview,
    request: {
      provider,
      model,
      modelLabel,
      quality,
      kind: "on_model",
      mode: "on_model",
      isRefinement: false,
      jewelryCount: pieces.length,
      aspect: options.aspect,
      count: images,
      conversationId: conversationId || null,
    },
    payload: {
      isRefinement: false,
      sourceImages: pieces,
      options,
      count: images,
      defaultCount: 1,
      // The frame shape itself, not only the words — see gemini generateImage.
      aspectRatio: ON_MODEL_ASPECT_RATIOS[options.aspect],
      userPrompt: `Styled on Model — ${pieces.length} piece${pieces.length > 1 ? "s" : ""}${options.description ? ` — ${options.description}` : ""}`,
      requestedModel,
      requestedQuality,
      conversationId: conversationId || null,
    },
    message: `queued Styled on Model (${images} image${images > 1 ? "s" : ""}) on ${modelLabel}`,
  });
});

/*
 * ── Presentation ────────────────────────────────────────────────────────────
 * Anything in — the browser has already read every file to text and pictures
 * (frontend lib/presentationFiles.ts) — a deck out, then edited by chat.
 */

const MAX_PRESENTATION_IMAGES = 30;
const MAX_PRESENTATION_SOURCES = 20;
const PRESENTATION_STYLES = ["auto", "luxury", "minimal", "corporate", "bold", "editorial"];
const PRESENTATION_LENGTHS = ["auto", "short", "medium", "long"];

const clean = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

router.post("/presentation", async (req, res) => {
  const { sources, images, preview, conversationId } = req.body || {};
  const brief = clean(req.body?.brief, 4000);
  const style = PRESENTATION_STYLES.includes(req.body?.style) ? req.body.style : "auto";
  const length = PRESENTATION_LENGTHS.includes(req.body?.length) ? req.body.length : "auto";

  const readSources = (Array.isArray(sources) ? sources : [])
    .slice(0, MAX_PRESENTATION_SOURCES)
    .map((source) => ({ name: clean(source?.name, 300) || "file", kind: clean(source?.kind, 40) || "File", text: clean(source?.text, 40_000) }))
    .filter((source) => source.text);
  // Each picture keeps the label it was read with ("price-list.xlsx · STYLE NO R-104") —
  // that label is how the model ties a photo to the row it sat on.
  const readImages = (Array.isArray(images) ? images : [])
    .slice(0, MAX_PRESENTATION_IMAGES)
    .map((image) => {
      const parsed = parseDataUri(image?.src);
      return parsed ? { ...parsed, label: clean(image?.label, 300) } : null;
    })
    .filter(Boolean);

  if (!readSources.length && !readImages.length && brief.length < 10) {
    return res.status(400).json({
      status: "error",
      message: "Add some files or pictures, or describe the presentation you want",
      code: "invalid",
    });
  }

  return queueGeneration(req, res, {
    type: PRESENTATION_JOB,
    tool: "marketing_kit",
    preview,
    request: {
      provider: "gemini",
      model: "gemini-2.5-pro",
      modelLabel: "Sparkle 2.5 Pro",
      kind: "presentation",
      sourceCount: readSources.length,
      // Not `imageCount`: the quote reads that as how many images a run
      // produces, and a deck is one writing run however many pictures it has.
      pictureCount: readImages.length,
      count: 1,
      style,
      length,
    },
    payload: { sources: readSources, images: readImages, brief, style, length, conversationId: conversationId || null },
    message: `queued a Presentation (${readSources.length} file${readSources.length === 1 ? "" : "s"}, ${readImages.length} picture${readImages.length === 1 ? "" : "s"})`,
  });
});

/** The thread an edit sees — enough to resolve "that slide" or "undo it", not the whole history. */
const EDIT_HISTORY_MESSAGES = 8;

router.post("/presentation/edit", async (req, res) => {
  const instruction = clean(req.body?.instruction, 2000);
  if (!instruction) return res.status(400).json({ status: "error", message: "Say what to change", code: "invalid" });

  // The stored outline, not one the client sends: it is what the last edit
  // wrote, and only the owner's own deck can be edited.
  const kitId = String(req.body?.kitId || "");
  const kit = mongoose.Types.ObjectId.isValid(kitId)
    ? await MarketingKit.findOne({ _id: kitId, tenantId: req.dbUser.tenantId, userId: req.dbUser._id, deletedAt: null }).lean()
    : null;
  if (!kit?.presentation?.outline) {
    return res.status(404).json({ status: "error", message: "That presentation could not be found", code: "not_found" });
  }

  const imageCount = kit.presentation.images?.length ?? 0;
  const imageNotes = Array.from({ length: imageCount }, (_, n) => kit.presentation.imageNotes?.[n] || kit.presentation.images[n]?.fileName || "");

  // Every edit joins the thread the deck was built in, so History shows one
  // conversation per deck rather than a new one per message.
  const conversationId =
    req.body?.conversationId ||
    (kit.generationId ? (await Generation.findById(kit.generationId).select("conversationId").lean())?.conversationId : null) ||
    null;

  return queueGeneration(req, res, {
    type: PRESENTATION_EDIT_JOB,
    tool: "marketing_kit",
    request: {
      provider: "gemini",
      model: "gemini-2.5-pro",
      modelLabel: "Sparkle 2.5 Pro",
      kind: "presentation",
      isRefinement: true,
      kitId,
      conversationId: conversationId ? String(conversationId) : null,
    },
    payload: {
      kitId,
      instruction,
      outline: kit.presentation.outline,
      imageNotes,
      history: (kit.presentation.messages ?? []).slice(-EDIT_HISTORY_MESSAGES).map((message) => ({ role: message.role, text: message.text })),
      conversationId: conversationId ? String(conversationId) : null,
    },
    message: "queued a Presentation edit",
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

const mongoose = require("mongoose");
const { registerJobHandler } = require("./registry");
const { runTextJob, ModelRefusedError } = require("./textRunner");
const { runGenerationJob } = require("./generationRunner");
const kits = require("../services/marketingKits");
const gemini = require("../providers/gemini");
const {
  SETTING_CODE_REFERENCE,
  BRAND_STORY_SYSTEM_INSTRUCTION,
  AFFINITY_SYSTEM_INSTRUCTION,
  buildBrandStoryPrompt,
  AFFINITY_PROMPT,
} = require("../prompts/marketingKit");
const { buildCampaignKitShots, buildCampaignKitRefinePrompt } = require("../prompts/campaignKit");
const { buildFestivePosterPrompt, buildFestivePosterRefinePrompt, eventLabel } = require("../prompts/festivePoster");

const BRAND_STORY_JOB = "marketingKit.brandStory";
const AFFINITY_JOB = "marketingKit.affinity";
const COLLECTION_STORY_JOB = "marketingKit.collectionStory";
const CAMPAIGN_KIT_JOB = "marketingKit.campaign";
const FESTIVE_POSTER_JOB = "marketingKit.festive";

/** The writing halves both run on the reasoning model, never a picker's choice. */
const WRITING_MODEL = "gemini-2.5-pro";

/** What a kit records about the model that wrote it. */
const KIT_MODEL = { provider: "google", modelId: WRITING_MODEL, modelLabel: gemini.labelFor(WRITING_MODEL) };

const inlineData = ({ mimeType, base64 }) => ({ inlineData: { mimeType, data: base64 } });

/**
 * A kit's id, minted before either record is written.
 *
 * Both the kit and the generation need to name each other, and neither can
 * name an id that does not exist yet. Deciding it up front turns what would
 * be "write, then go back and update" into one write each.
 */
function newKitId() {
  return new mongoose.Types.ObjectId();
}

/**
 * Saves a kit and shapes what the job result says about it.
 *
 * The id is returned even when the save failed, because a `failed` marker
 * row is written under that same id — so the client still has something to
 * open, and it says why rather than showing nothing at all.
 */
async function saveKit({ kind, kitId, dbUser, generationId, save }) {
  const kit = await kits.saveKitSafely(save, { kind, kitId, dbUser, model: KIT_MODEL, generationId });
  return { kitId: String(kitId), kit, kitSaved: Boolean(kit) };
}

/**
 * Brand Story: several photos of one piece, read as a design narrative.
 *
 * The sheet pages go first and clearly labelled, then the product photos —
 * the prompt tells the model how each set may be used, and that ordering is
 * what the wording refers to. The 600-row setting-code table only travels
 * when a sheet is attached, since a printed code is the only thing it could
 * be matched against.
 */
registerJobHandler(BRAND_STORY_JOB, (context) => {
  const kitId = newKitId();
  // In the voice and length picked on the page — see buildBrandStoryPrompt.
  const prompt = buildBrandStoryPrompt({ tone: context.data.tone, length: context.data.length });

  return runTextJob({
    ...context,
    tool: "marketing_kit",
    modelId: WRITING_MODEL,
    systemInstruction: BRAND_STORY_SYSTEM_INSTRUCTION,
    // The narrative is at most 450 words (~650 tokens); the rest is headroom,
    // with thinking bounded so it can never crowd the answer out. On Gemini
    // 2.5 reasoning tokens are billed against maxOutputTokens, so an
    // unbounded budget means a run that thinks and then emits nothing.
    thinkingBudget: 512,
    maxOutputTokens: 4096,
    buildParts: ({ data }) => [
      ...(data.sheetImages.length
        ? [
            { text: "PRODUCTION DEVELOPMENT SHEET (design philosophy reference):" },
            ...data.sheetImages.map(inlineData),
            { text: `SETTING CODE REFERENCE TABLE (code: brief description):\n${SETTING_CODE_REFERENCE}` },
          ]
        : []),
      { text: "JEWELLERY IMAGES (primary product photos):" },
      ...data.images.map(inlineData),
      { text: prompt },
    ],
    promptForHistory: prompt,
    userPrompt: "Write a brand story for this piece",
    /*
     * Only the first photo, not all of them.
     *
     * Every picture this run was given is already stored on the kit, which
     * is where they are looked at again. Recording them as assets too would
     * upload the same bytes to R2 a second time — for an eight-piece
     * Affinity run, twenty-odd duplicates. One is kept so History has a
     * tile to show rather than a blank square.
     */
    inputImages: context.data.images.slice(0, 1).map((image) => ({ image, role: "uploaded" })),
    // The other half of the link: the generation names the document it
    // wrote, so History can open the deck this run produced.
    historyParams: { kitId: String(kitId) },
    persist: ({ text, data, dbUser, generationId }) =>
      saveKit({
        kind: "brand_story",
        kitId,
        dbUser,
        generationId,
        save: () =>
          kits.saveBrandStoryKit({
            dbUser,
            kitId,
            generationId,
            model: KIT_MODEL,
            images: data.images,
            sheetImages: data.sheetImages,
            analysis: text,
          }),
      }),
  });
});

/**
 * Affinity: several pieces, each with its own photo and optionally its own
 * production sheet, turned into catalog copy for the set.
 *
 * Collection Story is the same run under its own name — its own job type (so
 * the queue rail reopens it on its own page) and its own kit kind (so its
 * decks are listed apart), with everything else shared.
 */
registerJobHandler(AFFINITY_JOB, (context) => runAffinityJob(context, "affinity"));
registerJobHandler(COLLECTION_STORY_JOB, (context) => runAffinityJob(context, "collection_story"));

function runAffinityJob(context, kind) {
  const kitId = newKitId();

  return runTextJob({
    ...context,
    tool: "marketing_kit",
    modelId: WRITING_MODEL,
    systemInstruction: AFFINITY_SYSTEM_INSTRUCTION,
    responseSchema: AFFINITY_RESPONSE_SCHEMA({ withCategories: hasCategories(context.data) }),
    // Eight items of catalog copy is ~1,200 tokens, twenty-four ~3,600; the rest is headroom.
    thinkingBudget: 1024,
    maxOutputTokens: hasCategories(context.data) ? 12288 : 8192,
    buildParts: ({ data }) => buildAffinityParts(data),
    promptForHistory: AFFINITY_PROMPT,
    userPrompt: "Write catalog copy for these pieces",
    // One tile for History; the pieces themselves live on the kit. Same
    // reasoning as Brand Story above.
    inputImages: context.data.items
      .filter((item) => item.image)
      .slice(0, 1)
      .map((item) => ({ image: item.image, role: "uploaded" })),
    // `kitKind` so History opens a Collection Story on its own page, not Affinity's.
    historyParams: { kitId: String(kitId), kitKind: kind },
    // Reading the answer is its own step, before anything is recorded: a
    // deck the model didn't actually produce must not leave a history row.
    parse: ({ text, data }) => parseAffinityResult(text, data),
    persist: async ({ parsed, data, dbUser, generationId }) => {
      const kit = await saveKit({
        kind,
        kitId,
        dbUser,
        generationId,
        save: () =>
          kits.saveAffinityKit({
            kind,
            dbUser,
            kitId,
            generationId,
            model: KIT_MODEL,
            collectionName: parsed.collectionName,
            tagline: parsed.tagline,
            items: parsed.items,
            categories: parsed.categories,
            pieces: data.items.map((item, index) => ({
              index,
              image: item.image,
              sheetImages: item.sheetImages,
              // The client parses workbooks to text before sending; the
              // filename does not survive that trip, so it is reconstructed.
              sheetExcel: (item.sheetExcelText || []).map((excelText, n) => ({
                fileName: `sheet-${index + 1}-${n + 1}.xlsx`,
                text: excelText,
              })),
              designerInitial: "",
            })),
          }),
      });

      return { result: parsed, ...kit };
    },
  });
}

/**
 * The response shape, as a contract with the API rather than a request in
 * the prompt.
 *
 * `responseMimeType` alone only promises *valid* JSON, not the *right*
 * JSON — the view does `result.items.map(...)`, and a well-formed object
 * with no `items` array crashed it mid-render.
 *
 * `size`, `width`, `height` and `notes` are deliberately absent: they are UI
 * layout state, filled in below and by the user, never the model's to decide.
 *
 * Built lazily so requiring this file doesn't pull the Gemini SDK into the
 * API process, which registers no handlers and never runs one.
 */
function AFFINITY_RESPONSE_SCHEMA({ withCategories = false } = {}) {
  const { Type } = require("@google/genai");
  return {
    type: Type.OBJECT,
    properties: {
      collectionName: { type: Type.STRING },
      tagline: { type: Type.STRING },
      ...(withCategories
        ? {
            categories: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  index: { type: Type.INTEGER },
                  name: { type: Type.STRING },
                  tagline: { type: Type.STRING },
                },
                required: ["index", "name", "tagline"],
              },
            },
          }
        : {}),
      items: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            index: { type: Type.INTEGER },
            category: { type: Type.STRING },
            title: { type: Type.STRING },
            caption: { type: Type.STRING },
            sourceCode: { type: Type.STRING, nullable: true },
          },
          required: ["index", "category", "title", "caption"],
        },
      },
    },
    required: ["collectionName", "tagline", "items", ...(withCategories ? ["categories"] : [])],
  };
}

/** Collection Story with more than one group — the only run that asks for category names. */
function hasCategories(data) {
  return Array.isArray(data.categories) && data.categories.length > 1;
}

/**
 * Appended to the Affinity brief when the pieces come in groups. The brief
 * itself is left as tuned; this only adds the one extra thing asked for.
 */
function categoriesBrief(categories) {
  const lines = categories.map((category, n) => {
    const items = category.pieceIndexes.map((index) => `ITEM ${index + 1}`).join(", ");
    const hint = category.label ? ` — the jeweller grouped these as "${category.label}"` : "";
    return `- CATEGORY ${n + 1}: ${items}${hint}`;
  });
  return `CATEGORIES — these pieces are grouped into ${categories.length} categories, each presented as its own section of the deck:
${lines.join("\n")}

In addition to the overall collectionName and tagline, return "categories": one entry per category, in this order, with "index" (zero-based: CATEGORY 1 → 0), "name" (an elegant two-word title-case name for that category, read across only its own items — use the jeweller's grouping name as a hint where it is meaningful, never a bare number) and "tagline" (4–8 words). Every item's "category", "title", "caption" and "sourceCode" rules above are unchanged.`;
}

/**
 * Every piece, labelled and interleaved with its own sheet.
 *
 * The per-item "HAS NO PRODUCTION SHEET" reminder is stated inline next to
 * the item as well as once in the prompt: with up to eight items
 * interleaved, the local reminder is what actually holds.
 */
function buildAffinityParts(data) {
  const parts = [];
  let anySheet = false;

  data.items.forEach((item, index) => {
    const sheetPages = item.sheetImages || [];
    const sheetExcel = item.sheetExcelText || [];

    parts.push({ text: `ITEM ${index + 1} JEWELLERY IMAGE:` });
    if (item.image) parts.push(inlineData(item.image));

    if (sheetPages.length) {
      anySheet = true;
      parts.push({ text: `ITEM ${index + 1} PRODUCTION DEVELOPMENT SHEET:` });
      parts.push(...sheetPages.map(inlineData));
    }
    if (sheetExcel.length) {
      anySheet = true;
      parts.push({ text: `ITEM ${index + 1} PRODUCTION DEVELOPMENT SHEET (Excel data):\n${sheetExcel.join("\n\n")}` });
    }
    if (!sheetPages.length && !sheetExcel.length) {
      parts.push({
        text: `ITEM ${index + 1} HAS NO PRODUCTION SHEET — it is NEW IDEATION. Return "title" and "caption" as empty strings for it.`,
      });
    }
  });

  if (anySheet) {
    parts.push({ text: `SETTING CODE REFERENCE TABLE (code: brief description):\n${SETTING_CODE_REFERENCE}` });
  }
  parts.push({ text: AFFINITY_PROMPT });
  if (hasCategories(data)) parts.push({ text: categoriesBrief(data.categories) });

  return parts;
}

/**
 * The model's answer, rebuilt field by field.
 *
 * Not spread through: the response is only schema-checked by the API, so
 * every value here is still `unknown`, and both the client and the stored
 * document expect a known shape.
 */
function parseAffinityResult(text, data) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ModelRefusedError("The model returned an unexpected format. Please try again.", "bad_json");
  }

  if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
    throw new ModelRefusedError("The model did not return catalog entries for these pieces. Please try again.", "no_items");
  }

  const hasSheet = data.items.map((item) => Boolean(item.sheetImages?.length || item.sheetExcelText?.length));

  const items = parsed.items.map((item, position) => {
    const index = typeof item.index === "number" ? item.index : position;
    /*
     * A New Ideation piece has no sheet to verify anything against, so a
     * title or caption for it could only ever be guessed off the photo.
     * Blanked here rather than trusted to the prompt — the model is asked
     * twice not to write them, and this is the guarantee. The view renders
     * an empty value as a hover-only "+ Add title", so a person fills these
     * in deliberately instead of editing over an invented description.
     */
    const describable = hasSheet[index] ?? false;

    return {
      index,
      category: typeof item.category === "string" ? item.category : "",
      title: describable && typeof item.title === "string" ? item.title : "",
      caption: describable && typeof item.caption === "string" ? item.caption : "",
      sourceCode: typeof item.sourceCode === "string" ? item.sourceCode : null,
      // Layout is a user-adjustable UI concern, never the model's to decide.
      size: "md",
    };
  });

  // Groups and covers are what the person chose; only the words are the model's.
  const named = Array.isArray(parsed.categories) ? parsed.categories : [];
  const categories = hasCategories(data)
    ? data.categories.map((category, n) => {
        const answer = named.find((entry) => entry?.index === n) ?? named[n] ?? {};
        return {
          name: (typeof answer.name === "string" && answer.name.trim()) || category.label || `Category ${n + 1}`,
          tagline: typeof answer.tagline === "string" ? answer.tagline : "",
          coverIndex: category.coverIndex,
          pieceIndexes: category.pieceIndexes,
        };
      })
    : [];

  return {
    collectionName: typeof parsed.collectionName === "string" ? parsed.collectionName : "Untitled Collection",
    tagline: typeof parsed.tagline === "string" ? parsed.tagline : "",
    items,
    categories,
  };
}

/**
 * Campaign Kit: four shots in one run — two of the piece worn, two of the
 * piece alone.
 *
 * This is the shared runner's `buildShots` doing exactly what it exists
 * for. The studio shots deliberately receive only the jewellery: handed the
 * model photo as well, they tend to put a hand in a frame the brief says is
 * jewellery only.
 *
 * A shot that fails is left out rather than failing the kit — three good
 * shots are worth having, and the runner already reports each one the
 * moment it lands.
 */
registerJobHandler(CAMPAIGN_KIT_JOB, (context) => {
  const kitId = newKitId();

  return runGenerationJob({
    ...context,
    tool: "marketing_kit",
    buildShots: ({ data }) => {
      const [modelImage, ...jewelry] = data.sourceImages;
      return buildCampaignKitShots(data.options).map((shot) => ({
        // Carried through so the deck can label each picture with the shot
        // it came from — see `delivered` in the runner.
        id: shot.id,
        label: shot.label,
        prompt: shot.prompt,
        images: shot.needsModel ? [modelImage, ...jewelry] : jewelry,
      }));
    },
    buildRefinePrompt: buildCampaignKitRefinePrompt,
    params: { ...context.data.options, kitId: String(kitId) },
    /*
     * A retouch of one shot is not a new deck — it edits a picture inside
     * an existing one — so only a first run writes a kit.
     */
    persist: context.data.isRefinement
      ? undefined
      : ({ saved, delivered, data, dbUser, provider, model, modelLabel }) => {
          const [modelImage, ...jewelry] = data.sourceImages;

          return saveKit({
            kind: "campaign",
            kitId,
            dbUser,
            generationId: saved.generationId,
            save: () =>
              kits.saveCampaignKit({
                dbUser,
                kitId,
                generationId: saved.generationId,
                model: { provider, modelId: model, modelLabel },
                modelImage,
                sourceImages: jewelry,
                // Index-aligned with `delivered`: a shot that failed is
                // absent from both, so a three-of-four kit is still correct.
                shots: delivered.map((shot, index) => ({
                  id: shot.id,
                  label: shot.label,
                  assetId: saved.outputs[index]?.assetId ?? null,
                  url: saved.outputs[index]?.url,
                  caption: "",
                })),
                options: data.options,
              }),
          });
        },
  });
});

/**
 * Festive Poster: the user's pieces together in one event-themed campaign
 * image — or several variations of it, each composed differently.
 *
 * Saved as a kit in the Campaign Kit shape (inputs + produced shots, no model
 * photo), so it reopens from the rail and History like every other kit.
 */
registerJobHandler(FESTIVE_POSTER_JOB, (context) => {
  const kitId = newKitId();
  const options = context.data.options || {};

  return runGenerationJob({
    ...context,
    tool: "marketing_kit",
    buildShots: ({ data, count }) =>
      Array.from({ length: count }, (_, index) => ({
        id: `poster${index + 1}`,
        label: count > 1 ? `Poster ${index + 1}` : "Poster",
        prompt: buildFestivePosterPrompt({ ...data.options, pieceCount: data.sourceImages.length, index, total: count }),
        images: data.sourceImages,
      })),
    buildRefinePrompt: buildFestivePosterRefinePrompt,
    params: { ...options, kitId: String(kitId) },
    // A retouch edits one poster inside an existing kit — only a first run writes one.
    persist: context.data.isRefinement
      ? undefined
      : ({ saved, delivered, data, dbUser, provider, model, modelLabel }) =>
          saveKit({
            kind: "festive",
            kitId,
            dbUser,
            generationId: saved.generationId,
            save: () =>
              kits.saveCampaignKit({
                kind: "festive",
                title: `${eventLabel(data.options || {})} poster`,
                dbUser,
                kitId,
                generationId: saved.generationId,
                model: { provider, modelId: model, modelLabel },
                modelImage: null,
                sourceImages: data.sourceImages,
                shots: delivered.map((shot, index) => ({
                  id: shot.id,
                  label: shot.label,
                  assetId: saved.outputs[index]?.assetId ?? null,
                  url: saved.outputs[index]?.url,
                  caption: "",
                })),
                options: data.options,
              }),
          }),
  });
});

module.exports = { BRAND_STORY_JOB, AFFINITY_JOB, COLLECTION_STORY_JOB, CAMPAIGN_KIT_JOB, FESTIVE_POSTER_JOB };

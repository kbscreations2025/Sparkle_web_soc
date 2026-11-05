const mongoose = require("mongoose");
const { registerJobHandler } = require("./registry");
const { runTextJob, ModelRefusedError, inlineData } = require("./textRunner");
const kits = require("../services/marketingKits");
const gemini = require("../providers/gemini");
const {
  LAYOUTS,
  PALETTES,
  HEADING_FONTS,
  BODY_FONTS,
  PRESENTATION_SYSTEM_INSTRUCTION,
  buildPresentationPrompt,
  buildPresentationEditPrompt,
  PRESENTATION_RESPONSE_SCHEMA,
} = require("../prompts/presentation");

/**
 * Presentation: anything in, a designed deck out — then edited by chat.
 *
 * Two jobs. The first reads every document and picture and writes the deck's
 * outline; the second takes the current outline and one instruction and
 * returns the outline changed. Both on the reasoning model: deciding what a
 * deck should say, and changing exactly one thing in a twenty-slide JSON
 * document without disturbing the rest, are both judgement, not drawing.
 */

const PRESENTATION_JOB = "marketingKit.presentation";
const PRESENTATION_EDIT_JOB = "marketingKit.presentationEdit";

const WRITING_MODEL = "gemini-2.5-pro";
const KIT_MODEL = { provider: "google", modelId: WRITING_MODEL, modelLabel: gemini.labelFor(WRITING_MODEL) };

/** Hard caps on what the model's answer may make the deck — far past any sensible deck. */
const MAX_SLIDES = 40;
const MAX_ITEMS = 12;

const text = (value, max = 2000) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const list = (value, max, read) => (Array.isArray(value) ? value.slice(0, max).map(read).filter(Boolean) : []);

/**
 * The model's outline, rebuilt field by field into exactly the shape the
 * frontend lays out — the API's schema check is advisory over OpenRouter, so
 * nothing in the answer is trusted to be there or to be the right type.
 */
function readOutline(raw, imageCount) {
  const slides = list(raw?.slides, MAX_SLIDES, (slide, index) => {
    if (!slide || typeof slide !== "object") return null;
    const layout = LAYOUTS.includes(slide.layout) ? slide.layout : "bullets";
    const out = { id: text(slide.id, 40) || `s${index + 1}`, layout, title: text(slide.title, 300) };
    const subtitle = text(slide.subtitle, 500);
    const body = text(slide.body, 1500);
    if (subtitle) out.subtitle = subtitle;
    if (body) out.body = body;
    const bullets = list(slide.bullets, MAX_ITEMS, (b) => text(b, 400));
    if (bullets.length) out.bullets = bullets;
    // Picture numbers are 1-based and must name a picture that exists.
    const images = list(slide.images, 6, (n) => (Number.isInteger(n) && n >= 1 && n <= imageCount ? n : null));
    if (images.length) out.images = images;
    const stats = list(slide.stats, 4, (s) => (s && (text(s.value) || text(s.label)) ? { value: text(s.value, 40), label: text(s.label, 200) } : null));
    if (stats.length) out.stats = stats;
    if (slide.table && Array.isArray(slide.table.headers)) {
      const headers = list(slide.table.headers, 8, (h) => text(h, 80) || " ");
      const rows = list(slide.table.rows, 20, (row) => (Array.isArray(row) ? headers.map((_, i) => text(String(row[i] ?? ""), 300)) : null));
      if (headers.length && rows.length) out.table = { headers, rows };
    }
    const quote = text(slide.quote, 600);
    if (quote) out.quote = quote;
    const attribution = text(slide.attribution, 200);
    if (attribution) out.attribution = attribution;
    const columns = list(slide.columns, 3, (c) =>
      c && (text(c.heading) || c.bullets?.length) ? { heading: text(c.heading, 120), bullets: list(c.bullets, 6, (b) => text(b, 300)) } : null
    );
    if (columns.length) out.columns = columns;
    const steps = list(slide.steps, 6, (s) => (s && (text(s.heading) || text(s.text)) ? { heading: text(s.heading, 120), text: text(s.text, 400) } : null));
    if (steps.length) out.steps = steps;
    const notes = text(slide.notes, 3000);
    if (notes) out.notes = notes;
    return out;
  });

  if (slides.length === 0) {
    throw new ModelRefusedError("The model did not return any slides. Please try again.", "no_slides");
  }

  // Ids must be unique, or a later edit would mistake one page for another.
  const seen = new Set();
  for (const slide of slides) {
    while (seen.has(slide.id)) slide.id = `${slide.id}x`;
    seen.add(slide.id);
  }

  const theme = raw?.theme || {};
  return {
    title: text(raw?.title, 300) || slides[0].title || "Presentation",
    theme: {
      palette: PALETTES.includes(theme.palette) ? theme.palette : "ivory",
      headingFont: HEADING_FONTS.includes(theme.headingFont) ? theme.headingFont : "Georgia",
      bodyFont: BODY_FONTS.includes(theme.bodyFont) ? theme.bodyFont : "Helvetica",
    },
    slides,
  };
}

function parseJson(output) {
  try {
    return JSON.parse(output);
  } catch {
    throw new ModelRefusedError("The model returned an unexpected format. Please try again.", "bad_json");
  }
}

/*
 * ── Build ───────────────────────────────────────────────────────────────────
 */
registerJobHandler(PRESENTATION_JOB, (context) => {
  const kitId = new mongoose.Types.ObjectId();
  const { data } = context;
  const prompt = buildPresentationPrompt({
    brief: data.brief,
    style: data.style,
    length: data.length,
    imageCount: data.images.length,
    sourceCount: data.sources.length,
  });

  return runTextJob({
    ...context,
    tool: "marketing_kit",
    modelId: WRITING_MODEL,
    systemInstruction: PRESENTATION_SYSTEM_INSTRUCTION,
    responseSchema: PRESENTATION_RESPONSE_SCHEMA(),
    // A twenty-slide outline with tables runs to ~8k tokens; thinking bounded
    // so it can never eat the answer (see Brand Story on Gemini 2.5 budgets).
    thinkingBudget: 2048,
    maxOutputTokens: 24576,
    buildParts: ({ data }) => [
      ...data.sources.flatMap((source, n) => [{ text: `SOURCE ${n + 1} — ${source.kind}: ${source.name}\n${source.text}` }]),
      ...(data.images.length
        ? [
            { text: `IMAGES (${data.images.length}) — numbered in order; refer to them by number:` },
            ...data.images.flatMap((image, n) => [{ text: `IMAGE ${n + 1} — ${image.label || "uploaded picture"}:` }, inlineData(image)]),
          ]
        : []),
      { text: prompt },
    ],
    promptForHistory: prompt,
    userPrompt: data.brief || "Build a presentation from these files",
    // One tile for History; the pictures themselves are stored on the kit.
    inputImages: data.images.slice(0, 1).map((image) => ({ image, role: "uploaded" })),
    historyParams: { kitId: String(kitId), kitKind: "presentation" },
    parse: ({ text: output, data }) => {
      const raw = parseJson(output);
      return {
        outline: readOutline(raw, data.images.length),
        imageNotes: list(raw.imageNotes, data.images.length, (note) => text(note, 300) || " "),
      };
    },
    persist: async ({ parsed, data, dbUser, generationId }) => {
      const kit = await kits.saveKitSafely(
        () =>
          kits.savePresentationKit({
            dbUser,
            kitId,
            model: KIT_MODEL,
            generationId,
            images: data.images,
            imageNotes: parsed.imageNotes,
            sources: data.sources,
            brief: data.brief,
            style: data.style,
            length: data.length,
            outline: parsed.outline,
          }),
        { kind: "presentation", kitId, dbUser, model: KIT_MODEL, generationId }
      );
      return {
        result: { outline: parsed.outline, images: kit?.presentation?.images ?? [] },
        kitId: String(kitId),
        kit,
        kitSaved: Boolean(kit),
      };
    },
  });
});

/*
 * ── Chat edit ───────────────────────────────────────────────────────────────
 */
registerJobHandler(PRESENTATION_EDIT_JOB, (context) => {
  const { data } = context;
  const prompt = buildPresentationEditPrompt({
    outline: data.outline,
    imageNotes: data.imageNotes,
    history: data.history,
    instruction: data.instruction,
  });

  return runTextJob({
    ...context,
    tool: "marketing_kit",
    modelId: WRITING_MODEL,
    systemInstruction: PRESENTATION_SYSTEM_INSTRUCTION,
    responseSchema: PRESENTATION_RESPONSE_SCHEMA({ forEdit: true }),
    thinkingBudget: 2048,
    maxOutputTokens: 24576,
    // A lower temperature: an edit should change what was asked and copy the rest.
    temperature: 0.4,
    buildParts: () => [{ text: prompt }],
    promptForHistory: prompt,
    userPrompt: data.instruction,
    historyParams: { kitId: data.kitId, kitKind: "presentation", isEdit: true },
    parse: ({ text: output, data }) => {
      const raw = parseJson(output);
      return { outline: readOutline(raw, data.imageNotes.length), reply: text(raw.reply, 1000) || "Done — the deck is updated." };
    },
    persist: async ({ parsed, data, dbUser }) => {
      const kit = await kits.savePresentationEdit({
        dbUser,
        kitId: data.kitId,
        outline: parsed.outline,
        instruction: data.instruction,
        reply: parsed.reply,
      });
      return { result: { outline: parsed.outline, reply: parsed.reply }, kitId: data.kitId, kitSaved: Boolean(kit) };
    },
  });
});

module.exports = { PRESENTATION_JOB, PRESENTATION_EDIT_JOB };

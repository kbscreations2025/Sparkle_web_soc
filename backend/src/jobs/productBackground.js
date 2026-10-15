const { registerJobHandler } = require("./registry");
const { runGenerationJob } = require("./generationRunner");
const { routeProviderCall, loadTenantOrThrow } = require("../aiRouting");
const { recordGeneration } = require("../generationService");
const { createLivePreview } = require("../storage/thumbnail");
const { cutOut, composite } = require("../services/cutout");
const { segmentPiece } = require("../services/segmentation");
const { buildScenePrompt, buildRefinePrompt, PLAIN_WHITE_PROMPT } = require("../prompts/productBackground");
const User = require("../models/user");

const PRODUCT_BACKGROUND_JOB = "productBackground.generate";
const TOOL = "product_background";

/** The model that moves a busy photo onto plain white before it is cut out — the same one Image Cleaning trusts with a customer's piece. */
const PLAIN_MODEL = "gemini-3-pro-image";
const PLAIN_QUALITY = "2K";

/**
 * Product Background: one piece of jewellery, a new background.
 *
 * Three ways through, by what was asked for:
 *
 *  - **Transparent, white or a colour** — the piece is cut out of the photo's
 *    own pixels (services/cutout.js), guided by a vision model's outline of it
 *    (services/segmentation.js), and laid on the background exactly: real
 *    transparency, true #FFFFFF, the brand colour to the hex. No image model
 *    redraws the piece, so the piece in the result is the piece in the photo.
 *    A photo too busy to cut from (a hand, a table, a scene) is moved onto
 *    plain white by an image model first — the route decides, and prices it.
 *  - **A scene** — a preset, the person's own words, or their own backdrop
 *    photo — is an image model placing the piece into it, through the shared
 *    runner like every other generate tool.
 *  - **A follow-up** typed in the chat edits the latest result, also through
 *    the shared runner.
 */
registerJobHandler(PRODUCT_BACKGROUND_JOB, async (context) => {
  const { data } = context;

  if (data.isRefinement) {
    return runGenerationJob({ ...context, tool: TOOL, buildRefinePrompt });
  }

  if (data.background?.kind === "theme") {
    return runGenerationJob({
      ...context,
      tool: TOOL,
      params: { background: data.background },
      buildShots: ({ count }) =>
        Array.from({ length: count }, (_, index) =>
          buildScenePrompt({
            themeId: data.background.theme,
            customScene: data.background.prompt,
            hasBackdrop: (data.sourceImages?.length ?? 0) > 1,
            index,
            total: count,
          })
        ),
    });
  }

  return runCutoutJob(context);
});

/** Transparent, white or a colour — see above. */
async function runCutoutJob({ job, data, setProgress, withProgress }) {
  const dbUser = await User.findById(job.userId);
  if (!dbUser) throw new Error("the user who queued this job no longer exists");
  const tenant = await loadTenantOrThrow(dbUser);

  const photo = data.sourceImages?.[0];
  if (!photo) throw new Error("no photo to cut out");

  let source = photo;
  let providerId = null;
  let provider = "sparkle";
  let modelId = "sparkle-cutout";
  let modelLabel = "Sparkle Cutout";

  // A busy photo: onto plain white first, so there is a backdrop to lift off.
  if (data.needsPlainBackdrop) {
    const result = await withProgress({ from: 10, to: 50, phase: "generating" }, async ({ stepDone }) => {
      const answer = await routeProviderCall({
        tenant,
        provider: "gemini",
        modelId: PLAIN_MODEL,
        prompt: PLAIN_WHITE_PROMPT,
        quality: PLAIN_QUALITY,
        aspectRatio: data.aspectRatio || null,
        images: [{ mimeType: photo.mimeType, base64: photo.base64 }],
      });
      await stepDone(null);
      return answer;
    });
    source = result.output;
    providerId = result.providerId;
    provider = "gemini";
    modelId = PLAIN_MODEL;
    modelLabel = "Sparkle Cutout + 3 Pro Image";
  }

  const buffer = Buffer.from(source.base64, "base64");

  // Where the piece is, as a vision model sees it — what lets a white band on
  // a white backdrop survive the cutout. Best-effort: null cuts by colour.
  const semantic = await withProgress(
    { from: data.needsPlainBackdrop ? 50 : 10, to: data.needsPlainBackdrop ? 74 : 62, phase: "analysing" },
    async ({ stepDone }) => {
      const mask = await segmentPiece({ tenant, buffer });
      await stepDone(null);
      return mask;
    }
  );

  const finished = await withProgress({ from: data.needsPlainBackdrop ? 76 : 66, to: 86, phase: "cutting" }, async ({ stepDone }) => {
    const cut = await cutOut(buffer, { semantic });
    const out = await composite(cut, {
      background: data.background.kind === "transparent" ? { kind: "transparent" } : { kind: "color", hex: data.background.hex },
      shadow: data.shadow,
      framing: data.framing,
    });
    const preview = await createLivePreview(out.buffer);
    await stepDone(preview?.dataUrl ?? null);
    return out;
  });

  await setProgress(88, "saving");

  const description =
    data.background.kind === "transparent"
      ? "Cut out on a transparent background"
      : `Placed on ${data.background.kind === "white" ? "white" : data.background.hex}`;

  const saved = await recordGeneration({
    tenant,
    user: dbUser,
    tool: TOOL,
    conversationId: data.conversationId,
    model: modelId,
    modelLabel,
    quality: null,
    // No model was told anything about the piece itself, so the recorded
    // prompt is what was done — plus, for a busy photo, what it was told.
    prompt: data.needsPlainBackdrop ? `${description}.\n\n${PLAIN_WHITE_PROMPT}` : `${description}.`,
    userPrompt: description,
    inputImages: [{ image: photo, role: "uploaded" }],
    outputImages: [{ image: { mimeType: finished.mimeType, base64: finished.buffer.toString("base64") }, role: "generated" }],
    params: {
      background: data.background,
      shadow: data.shadow,
      framing: data.framing,
      guided: Boolean(semantic),
      plainBackdrop: data.needsPlainBackdrop ? "generated" : "original",
    },
    providerId,
    provider,
  });

  return {
    generationId: saved.generationId,
    conversationId: saved.conversationId,
    outputUrl: saved.outputs[0]?.url || null,
    outputUrls: saved.outputs.map((entry) => entry.url),
    model: modelId,
    modelLabel,
    provider,
    requestedCount: 1,
    deliveredCount: 1,
  };
}

module.exports = { PRODUCT_BACKGROUND_JOB };

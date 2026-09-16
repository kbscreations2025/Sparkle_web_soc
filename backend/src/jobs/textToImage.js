const { buildTextToImagePrompt, buildTextToImageRefinePrompt } = require("../prompts");
const { resolveProviderModel, routeProviderCall, loadTenantOrThrow } = require("../aiRouting");
const { recordGeneration } = require("../generationService");
const { registerJobHandler } = require("./registry");
const User = require("../models/user");

const TEXT_TO_IMAGE_JOB = "textToImage.generate";

const MAX_IMAGE_COUNT = 8;
const DEFAULT_IMAGE_COUNT = 4;

/**
 * One Text to Image run — either an initial generation (1–8 variations fired
 * at the provider in parallel) or a refinement of a single existing result.
 *
 * Variations run concurrently via `Promise.allSettled` rather than as
 * separate queued jobs: one Job/generation record ends up covering the whole
 * batch, which keeps the queue rail showing one row per "Generate" click
 * (with the images each landing on the stage as soon as this job settles)
 * instead of N rows racing to create the same conversation. A variation that
 * fails to come back is simply left out of the result — only the ones that
 * actually returned are billed for or recorded.
 */
async function runTextToImageJob({ job, data, setProgress, withProgress }) {
  const dbUser = await User.findById(job.userId);
  if (!dbUser) throw new Error("the user who queued this job no longer exists");

  const { provider, model, quality, modelLabel } = resolveProviderModel(data.requestedModel);
  const tenant = await loadTenantOrThrow(dbUser);

  if (data.isRefinement) {
    const { refineImage, references = [], instruction, displayPrompt } = data;
    const prompt = buildTextToImageRefinePrompt({ instruction, referenceCount: references.length });

    const { output, providerId } = await withProgress({ from: 20, to: 85, phase: "generating" }, () =>
      routeProviderCall({
        tenant,
        provider,
        modelId: model,
        prompt,
        images: [
          { mimeType: refineImage.mimeType, base64: refineImage.base64 },
          ...references.map((ref) => ({ mimeType: ref.mimeType, base64: ref.base64 })),
        ],
      })
    );

    await setProgress(88, "saving");

    const saved = await recordGeneration({
      tenant,
      user: dbUser,
      tool: "text_to_image",
      conversationId: data.conversationId,
      parentGenerationId: data.parentGenerationId,
      model,
      modelLabel,
      quality,
      prompt,
      userPrompt: displayPrompt || instruction,
      inputImages: [
        { image: refineImage, role: "edited" },
        ...references.map((ref) => ({ image: ref, role: "reference" })),
      ],
      outputImages: [{ image: output, role: "generated" }],
      providerId,
      provider,
    });

    const url = saved.outputs[0]?.url || null;
    return {
      generationId: saved.generationId,
      conversationId: saved.conversationId,
      outputUrl: url,
      outputUrls: url ? [url] : [],
      model,
      modelLabel,
      provider,
    };
  }

  // ── Initial generation — 1..N variations in parallel ──
  const numImages = Math.max(1, Math.min(MAX_IMAGE_COUNT, Math.round(Number(data.count)) || DEFAULT_IMAGE_COUNT));
  const prompt = buildTextToImagePrompt({ description: data.prompt, style: data.style, aspect: data.aspect, count: numImages });

  const settled = await withProgress({ from: 20, to: 85, phase: "generating" }, () =>
    Promise.allSettled(
      Array.from({ length: numImages }, () => routeProviderCall({ tenant, provider, modelId: model, prompt, images: [] }))
    )
  );

  const successes = settled.filter((entry) => entry.status === "fulfilled").map((entry) => entry.value);
  if (successes.length === 0) {
    const firstFailure = settled.find((entry) => entry.status === "rejected");
    throw firstFailure ? firstFailure.reason : new Error("Every image variation failed to generate");
  }

  await setProgress(88, "saving");

  const saved = await recordGeneration({
    tenant,
    user: dbUser,
    tool: "text_to_image",
    conversationId: data.conversationId,
    parentGenerationId: null,
    model,
    modelLabel,
    quality,
    prompt,
    userPrompt: data.prompt || null,
    inputImages: [],
    outputImages: successes.map((entry) => ({ image: entry.output, role: "generated" })),
    // One provider serves a whole run; the first success stands in for all of them.
    providerId: successes[0].providerId,
    provider,
  });

  return {
    generationId: saved.generationId,
    conversationId: saved.conversationId,
    outputUrl: saved.outputs[0]?.url || null,
    outputUrls: saved.outputs.map((entry) => entry.url),
    requestedCount: numImages,
    deliveredCount: successes.length,
    model,
    modelLabel,
    provider,
  };
}

registerJobHandler(TEXT_TO_IMAGE_JOB, runTextToImageJob);

module.exports = { TEXT_TO_IMAGE_JOB, MAX_IMAGE_COUNT, DEFAULT_IMAGE_COUNT };

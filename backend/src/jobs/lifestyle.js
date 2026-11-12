const { registerJobHandler } = require("./registry");
const { runGenerationJob } = require("./generationRunner");
const { loadJobActor } = require("./actor");
const { resolveProviderModel, routeProviderCall } = require("../aiRouting");
const { createLivePreview } = require("../storage/thumbnail");
const { createModel, loadModelImage } = require("../services/lifestyleModels");
const { logAudit } = require("../auditLog");
const { matchColour, wantsColourChange } = require("../services/colorMatch");
const {
  buildLifestylePrompt,
  buildLifestyleSetPrompt,
  buildLifestyleRefinePrompt,
  buildLifestyleModelPrompt,
} = require("../prompts/lifestyle");

const LIFESTYLE_JOB = "lifestyle.generate";
const LIFESTYLE_MODEL_JOB = "lifestyle.model";

/**
 * Lifestyle: a piece of jewellery photographed on a model.
 *
 * One output per run however many jewellery photos went in — this is a
 * composite, not a set of variations — so the runner's fan-out is left at
 * one and the whole band belongs to the single call.
 *
 * The model is sent to the AI first, the jewellery after — the order both
 * prompts describe. A library model arrives as a reference (`modelRef`) and
 * its photo is read from R2 here, so neither Redis nor the run's stored
 * inputs carry a copy; the run records a pointer instead (`inputPointers`).
 * An uploaded photo still saving to the library arrives as the first source
 * image, as every run used to — and so does a run queued before references.
 */
registerJobHandler(LIFESTYLE_JOB, async (context) => {
  const { data } = context;
  const modelImage = !data.isRefinement && data.modelRef ? await loadModelImage(data.modelRef) : null;
  const prompt = (options) =>
    data.jewelryCount > 1 ? buildLifestyleSetPrompt({ count: data.jewelryCount, ...options }) : buildLifestylePrompt(options);

  return runGenerationJob({
    ...context,
    tool: "life_style",
    // One composite: the model (read here, or already first in the source
    // images) followed by the pieces.
    buildShots: ({ data: payload }) => [
      { prompt: prompt(payload.options), images: modelImage ? [modelImage, ...payload.sourceImages] : payload.sourceImages },
    ],
    buildRefinePrompt: buildLifestyleRefinePrompt,
    // Each edit drifted pinker and redder than the shot it edited; its colour
    // is pulled back to that shot unless the edit asks for a colour change.
    finishRefine: ({ output, refineImage, instruction }) =>
      wantsColourChange(instruction) ? output : matchColour(output, refineImage),
    // Which library model this run used.
    params: { ...data.options, ...(data.modelRef ? { modelId: data.modelRef.id } : {}) },
  });
});

/**
 * Generating a new model to place jewellery onto — no input images at all,
 * just the attributes someone picked in the builder.
 *
 * Its own handler rather than the shared runner because what it produces is
 * not a result: it is a reusable input, and the run ends by saving it to the
 * model library. Recording it in History too would put a person's photograph
 * in the results feed as though it were work someone asked for.
 */
registerJobHandler(LIFESTYLE_MODEL_JOB, async ({ job, data, setProgress, withProgress }) => {
  const { dbUser, tenant } = await loadJobActor(job);
  const { provider, model, modelLabel, quality } = resolveProviderModel(
    data.requestedModel,
    data.requestedQuality
  );

  // Chosen here rather than at the route: the outfit may be picked at random
  // from the ones selected, and the saved model should record the one it is
  // actually wearing.
  const { prompt, outfit } = buildLifestyleModelPrompt(data.attrs, data.notes);

  const { output } = await withProgress({ from: 20, to: 85, phase: "generating" }, async ({ stepDone }) => {
    const result = await routeProviderCall({ tenant, provider, modelId: model, prompt, quality, images: [] });
    const preview = await createLivePreview(Buffer.from(result.output.base64, "base64"));
    await stepDone(preview?.dataUrl ?? null);
    return result;
  });

  await setProgress(88, "saving");

  const saved = await createModel({
    dbUser,
    name: data.name,
    attrs: { ...data.attrs, outfit },
    notes: data.notes,
    imageDataUri: `data:${output.mimeType};base64,${output.base64}`,
  });

  /*
   * This run writes no Generation — a model is a reusable input, not a
   * result, and putting a person's photograph in the results feed would be
   * wrong. But it is still a paid model call, and without this it would
   * appear in no history and no audit trail at all. `recordGeneration`
   * writes its own audit row for every other tool; this is the equivalent.
   */
  logAudit({
    tenantId: dbUser.tenantId,
    actorUserId: dbUser._id,
    actorAuthUserId: dbUser.authUserId || null,
    actorEmail: dbUser.email,
    actorName: dbUser.name || dbUser.email,
    action: "generation.completed",
    status: "success",
    targetType: "lifestyleModel",
    targetId: saved.id,
    message: `lifestyle model generated via ${modelLabel}`,
    metadata: { tool: "life_style", kind: "model", model, modelLabel, provider, outfit },
  });

  // Urls, not bytes — this travels through Redis and down a socket.
  return {
    lifestyleModel: saved,
    outputUrl: saved.imageUrl,
    outputUrls: [saved.imageUrl],
    outfit,
    model,
    modelLabel,
    provider,
  };
});

module.exports = { LIFESTYLE_JOB, LIFESTYLE_MODEL_JOB };

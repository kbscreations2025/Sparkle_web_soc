const { registerJobHandler } = require("./registry");
const { runGenerationJob } = require("./generationRunner");
const { resolveProviderModel, routeProviderCall, loadTenantOrThrow } = require("../aiRouting");
const { createLivePreview } = require("../storage/thumbnail");
const { loadPreset } = require("../services/lifestylePresets");
const { createModel } = require("../services/lifestyleModels");
const { logAudit } = require("../auditLog");
const {
  buildLifestylePrompt,
  buildLifestyleSetPrompt,
  buildLifestyleRefinePrompt,
  buildLifestyleModelPrompt,
} = require("../prompts/lifestyle");
const User = require("../models/user");

const LIFESTYLE_JOB = "lifestyle.generate";
const LIFESTYLE_MODEL_JOB = "lifestyle.model";

/**
 * Lifestyle: a piece of jewellery photographed on a model.
 *
 * One output per run however many jewellery photos went in — this is a
 * composite, not a set of variations — so the runner's fan-out is left at
 * one and the whole band belongs to the single call.
 *
 * The model photo is resolved at the route (a preset, an upload, or a saved
 * one fetched back from R2) and arrives here as the first source image, with
 * the jewellery after it. That order is what both prompts describe.
 */
registerJobHandler(LIFESTYLE_JOB, (context) =>
  runGenerationJob({
    ...context,
    tool: "life_style",
    buildPrompt: ({ data }) =>
      data.jewelryCount > 1
        ? buildLifestyleSetPrompt({ count: data.jewelryCount, ...data.options })
        : buildLifestylePrompt(data.options),
    buildRefinePrompt: buildLifestyleRefinePrompt,
    params: context.data.options,
  })
);

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
  const dbUser = await User.findById(job.userId);
  if (!dbUser) throw new Error("the user who queued this job no longer exists");

  const tenant = await loadTenantOrThrow(dbUser);
  const { provider, model, modelLabel } = resolveProviderModel(data.requestedModel);

  // Chosen here rather than at the route: the outfit may be picked at random
  // from the ones selected, and the saved model should record the one it is
  // actually wearing.
  const { prompt, outfit } = buildLifestyleModelPrompt(data.attrs, data.notes);

  const { output } = await withProgress({ from: 20, to: 85, phase: "generating" }, async ({ stepDone }) => {
    const result = await routeProviderCall({ tenant, provider, modelId: model, prompt, images: [] });
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

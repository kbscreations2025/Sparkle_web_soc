const { IMAGE_CLEANING_PROMPT, buildReferenceNote } = require("../prompts");
const { resolveProviderModel, routeProviderCall, loadTenantOrThrow } = require("../aiRouting");
const { recordGeneration } = require("../generationService");
const { createLivePreview } = require("../storage/thumbnail");
const { registerJobHandler } = require("./registry");
const User = require("../models/user");

const CLEANING_JOB = "cleaning.generate";

/**
 * A first-pass run sends the built-in prompt unless the user wrote their own,
 * which replaces it entirely rather than being appended to it — the wording
 * that preserves the jewellery's exact design lives only in the built-in
 * prompt, so "replace" (not "add to") is deliberate: mixing the two would let
 * a custom prompt silently fight the preservation instructions.
 *
 * A refinement is never the raw instruction either — it's wrapped so the
 * model is told which image it's editing and what to leave alone. Any
 * reference images ride along as visual inspiration only, same as Chat to
 * Edit — never something to copy into the result wholesale.
 */
function buildPrompt({ isRefinement, instruction, customPrompt, referenceCount = 0 }) {
  if (isRefinement) {
    return (
      `Modify this jewelry photograph (the first image) as follows: ${instruction}. ` +
      "Preserve the pure white studio background, professional lighting, and all other " +
      "photographic qualities. Only apply the specifically requested changes." +
      buildReferenceNote(referenceCount)
    );
  }
  return customPrompt?.trim() || IMAGE_CLEANING_PROMPT;
}

/**
 * One Image Cleaning run, executed off the request that asked for it.
 *
 * This is the body the route used to run inline. Nothing about *how* a
 * generation is produced changed in the move — the provider routing, per-key
 * retry/failover and history writing are the same shared functions as before.
 * What changed is only that the caller is a worker, so the user's browser can
 * disappear mid-run without taking the work with it.
 *
 * Images arrive in `data` (the BullMQ payload), already parsed into
 * `{ mimeType, base64 }` by the route, so the worker never re-parses a data URI.
 */
async function runCleaningJob({ job, data, setProgress, withProgress }) {
  const { image, references = [], requestedModel, isRefinement, instruction, customPrompt } = data;

  // The worker has no request context, so the actor is re-loaded from the job.
  // `.lean()` is deliberately NOT used: recordGeneration reads `user.name`/
  // `user.email` and passes `user._id` straight into other documents.
  const dbUser = await User.findById(job.userId);
  if (!dbUser) throw new Error("the user who queued this job no longer exists");

  // Deliberately no requested quality: cleaning is the one tool with no size
  // picker. A retouched photograph is the deliverable here, not a preview, so
  // it always runs at the model's best — 4K on the models that offer it —
  // whatever a client might try to send.
  const { provider, model, quality, modelLabel } = resolveProviderModel(requestedModel);
  const tenant = await loadTenantOrThrow(dbUser);

  const prompt = buildPrompt({
    isRefinement,
    instruction,
    customPrompt,
    referenceCount: references.length,
  });

  // Nearly all of a run's wall time is spent inside this one call, and the
  // providers report nothing while it is open — so the bar is walked from 20
  // to 85 against the predicted duration rather than jumping between the two
  // ends of it. `withProgress` stops the ticker however this exits.
  const { output, providerId } = await withProgress(
    { from: 20, to: 85, phase: "generating" },
    async ({ stepDone }) => {
      const result = await routeProviderCall({
        tenant,
        provider,
        modelId: model,
        prompt,
        quality,
        images: [
          { mimeType: image.mimeType, base64: image.base64 },
          ...references.map((ref) => ({ mimeType: ref.mimeType, base64: ref.base64 })),
        ],
      });

      // Pushed the moment the model answers, so the wait ends there rather
      // than after the upload below. Same treatment every other tool gets.
      const preview = await createLivePreview(Buffer.from(result.output.base64, "base64"));
      await stepDone(preview?.dataUrl ?? null);
      return result;
    }
  );

  // The model has answered; what's left is storage, which is quick but not
  // instant — worth its own step so a stalled upload is visibly distinct from
  // a stalled generation.
  await setProgress(88, "saving");

  const saved = await recordGeneration({
    tenant,
    user: dbUser,
    tool: "cleaning",
    conversationId: data.conversationId,
    parentGenerationId: data.parentGenerationId,
    model,
    modelLabel,
    quality,
    prompt,
    userPrompt: isRefinement ? instruction : customPrompt?.trim() || null,
    inputImages: [
      { image, role: isRefinement ? "edited" : "uploaded" },
      ...references.map((ref) => ({ image: ref, role: "reference" })),
    ],
    outputImages: [{ image: output, role: "generated" }],
    providerId,
    provider,
  });

  // Deliberately small, and deliberately a url rather than the image itself:
  // this value is written to Mongo, carried through Redis and pushed down a
  // socket, none of which should be moving megabytes of base64 around. The
  // client renders the url and, when it needs bytes to edit further, fetches
  // them the same way resuming a conversation from History already does.
  return {
    generationId: saved.generationId,
    conversationId: saved.conversationId,
    outputUrl: saved.outputs[0]?.url || null,
    model,
    modelLabel,
    provider,
  };
}

registerJobHandler(CLEANING_JOB, runCleaningJob);

module.exports = { CLEANING_JOB, buildPrompt };

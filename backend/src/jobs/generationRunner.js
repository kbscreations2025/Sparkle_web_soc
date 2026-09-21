const { resolveProviderModel, routeProviderCall, loadTenantOrThrow } = require("../aiRouting");
const { recordGeneration } = require("../generationService");
const { createLivePreview } = require("../storage/thumbnail");
const User = require("../models/user");

/**
 * The body every image-generating job shares.
 *
 * Each tool differs only in the words it sends and which images go with them —
 * loading the actor, resolving the model, fanning variations out in parallel,
 * writing history and shaping the result are identical across all of them. A
 * tool supplies its prompts through `buildPrompt`/`buildRefinePrompt`; this
 * runs them.
 *
 * Variations run concurrently rather than as separate queued jobs, so one
 * "Generate" stays one row in the queue rail and one generation in History.
 * A variation that fails is left out rather than failing the batch — only what
 * actually came back is recorded.
 */

const MAX_IMAGE_COUNT = 8;
/**
 * What a text-driven run produces when the client names no count.
 *
 * The photo-driven tools pass their own fallback of 1 at the route, so this is
 * only ever the text default — it must stay in step with the picker's default
 * in the frontend's `DEFAULT_IMAGE_COUNT`.
 */
const DEFAULT_IMAGE_COUNT = 2;

/** Clamps whatever the client asked for into what a run is allowed to produce. */
function clampCount(count, fallback = DEFAULT_IMAGE_COUNT) {
  return Math.max(1, Math.min(MAX_IMAGE_COUNT, Math.round(Number(count)) || fallback));
}

/**
 * @param tool              A key from GENERATION_TOOLS, for history and audit.
 * @param buildPrompt       `({ data, count }) => string` for an initial run.
 *                          Every variation is sent the same words.
 * @param buildShots        `({ data, count }) => string[]` instead, when the
 *                          variations are not the same request repeated —
 *                          Campaign Kit's four shots are four different
 *                          prompts, and a count of N identical ones is just
 *                          the common case of this. Wins over `buildPrompt`.
 * @param buildRefinePrompt `({ instruction, referenceCount, data }) => string`
 *                          for a follow-up. `data` is there for a tool whose
 *                          references aren't all alike: Lifestyle re-attaches
 *                          the original jewellery photos as ground truth
 *                          alongside any style reference, and the prompt has
 *                          to say which is which.
 *
 * `data` is the BullMQ payload. Images arrive already parsed as
 * `{ mimeType, base64 }` — the route does that, so the worker never re-parses
 * a data URI:
 *   · `sourceImages`  what an initial run sends to the model (may be empty)
 *   · `refineImage`   the image a follow-up edits
 *   · `references`    extra images attached to a follow-up, inspiration only
 */
async function runGenerationJob({
  job,
  data,
  setProgress,
  withProgress,
  tool,
  buildPrompt,
  buildShots,
  buildRefinePrompt,
  /** Extra per-tool knobs to record on the generation, beside `quality`. */
  params,
  /**
   * `({ saved, delivered, data, dbUser }) => object` — for a tool that keeps
   * a document of its own beside the generation (Campaign Kit's deck).
   * Runs after the images are stored, so it can point at them rather than
   * holding a second copy. Returns fields merged into the job result.
   */
  persist,
}) {
  const dbUser = await User.findById(job.userId);
  if (!dbUser) throw new Error("the user who queued this job no longer exists");

  const { provider, model, quality, modelLabel } = resolveProviderModel(
    data.requestedModel,
    data.requestedQuality
  );
  const tenant = await loadTenantOrThrow(dbUser);

  const common = { tenant, user: dbUser, tool, model, modelLabel, quality, provider, params };

  if (data.isRefinement) {
    const { refineImage, references = [], instruction, displayPrompt } = data;
    const prompt = buildRefinePrompt({ instruction, referenceCount: references.length, data });

    const { output, providerId } = await withProgress({ from: 20, to: 85, phase: "generating" }, async ({ stepDone }) => {
      const result = await routeProviderCall({
        tenant,
        provider,
        modelId: model,
        prompt,
        quality,
        images: [refineImage, ...references].map(({ mimeType, base64 }) => ({ mimeType, base64 })),
      });

      // Shown while the result is still being uploaded and recorded, so the
      // wait ends when the model answers rather than when storage does.
      const preview = await createLivePreview(Buffer.from(result.output.base64, "base64"));
      await stepDone(preview?.dataUrl ?? null);
      return result;
    });

    await setProgress(88, "saving");

    const saved = await recordGeneration({
      ...common,
      conversationId: data.conversationId,
      parentGenerationId: data.parentGenerationId,
      prompt,
      userPrompt: displayPrompt || instruction,
      inputImages: [
        { image: refineImage, role: "edited" },
        ...references.map((ref) => ({ image: ref, role: "reference" })),
      ],
      outputImages: [{ image: output, role: "generated" }],
      providerId,
    });

    return toResult(saved, { model, modelLabel, provider });
  }

  const requestedCount = clampCount(data.count, data.defaultCount);
  const sourceImages = data.sourceImages ?? [];

  /*
   * A tool that varies its prompt per shot decides how many there are; for
   * everything else it is the count the user asked for, repeated.
   *
   * A shot may be a bare prompt string, or `{ prompt, images }` when it
   * needs a different set of pictures from the others — Campaign Kit's
   * studio shots must not receive the model photo, or a hand appears in a
   * "jewelry only" frame.
   */
  const shots = (
    buildShots
      ? buildShots({ data, count: requestedCount })
      : Array.from({ length: requestedCount }, () => buildPrompt({ data, count: requestedCount }))
  ).map((shot) => (typeof shot === "string" ? { prompt: shot, images: sourceImages } : { images: sourceImages, ...shot }));
  const count = shots.length;

  // The prompt recorded in History. With one set of words it is simply them;
  // with several it is all of them, since no single one explains the run.
  const prompt = count === 1 ? shots[0].prompt : shots.map((shot) => shot.prompt).join("\n\n─────\n\n");

  // One slice of the bar per variation, and each one reports the moment it
  // lands: the user sees the first image while the rest are still running,
  // and the percentage moves on facts rather than on a clock alone.
  const settled = await withProgress({ from: 20, to: 85, phase: "generating", steps: count }, ({ stepDone }) =>
    Promise.allSettled(
      shots.map(async (shot) => {
        const result = await routeProviderCall({
          tenant,
          provider,
          modelId: model,
          prompt: shot.prompt,
          quality,
          images: shot.images.map(({ mimeType, base64 }) => ({ mimeType, base64 })),
        });

        // Best-effort, and awaited only so the bar and the preview move
        // together: a preview that fails still leaves a counted variation.
        const preview = await createLivePreview(Buffer.from(result.output.base64, "base64"));
        await stepDone(preview?.dataUrl ?? null);
        return result;
      })
    )
  );

  /*
   * Which shot each delivered image came from, in order.
   *
   * `settled` is index-aligned with `shots` — `Promise.allSettled` keeps
   * order — but filtering the failures out loses that alignment, and a tool
   * whose shots differ from one another (Campaign Kit) needs to know which
   * label belongs to which picture. Zipped here before the filter, so both
   * this and `successes` stay in the same order as the outputs recorded
   * below.
   */
  const delivered = shots
    .map((shot, index) => (settled[index].status === "fulfilled" ? shot : null))
    .filter(Boolean);

  const successes = settled.filter((entry) => entry.status === "fulfilled").map((entry) => entry.value);
  if (successes.length === 0) {
    const firstFailure = settled.find((entry) => entry.status === "rejected");
    throw firstFailure ? firstFailure.reason : new Error("Every variation failed to generate");
  }

  // A variation that failed never reported a step, so the bar would stop short
  // of the band. Close the gap rather than leaving it stuck below 85%.
  await setProgress(88, "saving");

  const saved = await recordGeneration({
    ...common,
    conversationId: data.conversationId,
    parentGenerationId: null,
    prompt,
    userPrompt: data.userPrompt ?? null,
    // What the run was given, if anything — the sketch, the photo, the
    // reference. `sourceRoles` lets a tool that sends a mixed set say which
    // is which: Lifestyle's first image is the model and the rest are the
    // pieces, and recording all of them as "uploaded" would lose that.
    inputImages: sourceImages.map((image, index) => ({ image, role: data.sourceRoles?.[index] || "uploaded" })),
    outputImages: successes.map((entry) => ({ image: entry.output, role: "generated" })),
    // One provider serves a whole run; the first success stands in for all of them.
    providerId: successes[0].providerId,
  });

  /*
   * A tool that keeps a document of its own writes it here, once the
   * generation exists and its outputs are stored — so the document can
   * point at both. `saved.outputs` is in the same order as `delivered`.
   */
  const extra = (await persist?.({ saved, delivered, data, dbUser, tenant })) ?? {};

  return {
    ...toResult(saved, { model, modelLabel, provider }),
    requestedCount: count,
    deliveredCount: successes.length,
    ...extra,
  };
}

/**
 * Deliberately small, and deliberately urls rather than the images themselves:
 * this is written to Mongo, carried through Redis and pushed down a socket,
 * none of which should be moving megabytes of base64 around.
 */
function toResult(saved, { model, modelLabel, provider }) {
  return {
    generationId: saved.generationId,
    conversationId: saved.conversationId,
    outputUrl: saved.outputs[0]?.url || null,
    outputUrls: saved.outputs.map((entry) => entry.url),
    model,
    modelLabel,
    provider,
  };
}

module.exports = { runGenerationJob, clampCount, MAX_IMAGE_COUNT, DEFAULT_IMAGE_COUNT };

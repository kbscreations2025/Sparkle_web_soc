const { registerJobHandler } = require("./registry");
const { routeVideoCall, routeTextCall, loadTenantOrThrow } = require("../aiRouting");
const { recordGeneration } = require("../generationService");
const {
  buildImageAnimationPrompt,
  buildDesignSpecPrompt,
  DEFAULT_NEGATIVE_PROMPT,
  MAX_REFERENCE_IMAGES,
  REFERENCE_MODE,
} = require("../prompts/video");
const gemini = require("../gemini");
const User = require("../models/user");

const IMAGE_TO_VIDEO_JOB = "imageToVideo.generate";

/**
 * Image to Video: one still, animated.
 *
 * Its own handler rather than the shared runner, and on its own queue lane
 * (see jobs/lanes.js), because almost nothing about it matches an image
 * job: there is one output and never a batch, the call takes minutes rather
 * than tens of seconds, and what comes back can't be previewed as it
 * arrives — Veo answers once, at the end.
 *
 * So the bar here is honest about having only two facts: the run started,
 * and the provider answered. Between them it creeps on the clock alone —
 * there is no third fact to report, and inventing one from the poll count
 * would be a progress bar measuring how often we asked, not how far along
 * the work is.
 */
registerJobHandler(IMAGE_TO_VIDEO_JOB, async ({ job, data, setProgress, withProgress }) => {
  const dbUser = await User.findById(job.userId);
  if (!dbUser) throw new Error("the user who queued this job no longer exists");

  const tenant = await loadTenantOrThrow(dbUser);
  const modelId = gemini.resolveVideoModel(data.requestedModel);
  const modelLabel = gemini.videoLabelFor(modelId);

  // Older queued jobs predate `images` and carry only `image`.
  const views = (Array.isArray(data.images) && data.images.length ? data.images : [data.image]).filter(Boolean);
  const multiView = views.length > 1;

  /*
   * Read the piece before filming it.
   *
   * Best-effort on purpose. This is a paid, minutes-long run, and a clip
   * made without the spec is still a clip — losing the whole job because a
   * text model was briefly unavailable would be a far worse trade than
   * filming with the standard guardrails alone. Failure is logged and the
   * run continues.
   */
  const designSpec = await withProgress({ from: 5, to: 15, phase: "analysing" }, async ({ stepDone }) => {
    try {
      const { output } = await routeTextCall({
        tenant,
        modelId: gemini.DEFAULT_TEXT_MODEL,
        prompt: buildDesignSpecPrompt(views.length),
        images: views.map((view) => ({ mimeType: view.mimeType, base64: view.base64 })),
      });
      await stepDone(null);
      return output?.text?.trim() || null;
    } catch (err) {
      console.error("[imageToVideo] design analysis failed, filming without it:", err.message);
      await stepDone(null);
      return null;
    }
  });

  const prompt = buildImageAnimationPrompt({
    camera: data.camera,
    mood: data.mood,
    description: data.description,
    /*
     * What Veo is actually handed, not what was uploaded. Telling it "the 6
     * reference images" when three arrived would have it looking for
     * pictures that are not there; the other views reached it already, as
     * the design spec.
     */
    viewCount: Math.min(views.length, MAX_REFERENCE_IMAGES),
    designSpec,
  });

  /*
   * Two different Veo modes, not one with an extra argument. A single still
   * is a first frame: the clip literally opens on the user's photo. Several
   * views go in as ASSET references instead — the SDK rejects `image`
   * alongside them — so Veo rebuilds the piece from every angle and composes
   * its own opening frame. That is the trade: the back of the ring is real
   * on an orbit, and the first frame is no longer pinned.
   */
  const viewInput = multiView
    ? {
        image: undefined,
        // Only the first three: Veo refuses a fourth. The others have
        // already done their work in the design spec above.
        referenceImages: views
          .slice(0, MAX_REFERENCE_IMAGES)
          .map((view) => gemini.assetVideoReference(view, REFERENCE_MODE.referenceType)),
      }
    : { image: { imageBytes: views[0].base64, mimeType: views[0].mimeType }, referenceImages: undefined };

  const { output, providerId } = await withProgress(
    { from: 15, to: 80, phase: "generating" },
    async ({ stepDone }) => {
      const result = await routeVideoCall({
        tenant,
        modelId,
        prompt,
        image: viewInput.image,
        config: {
          numberOfVideos: 1,
          aspectRatio: data.aspectRatio,
          resolution: data.resolution,
          durationSeconds: data.durationSeconds,
          /*
           * Reference mode rejects a negative prompt outright, so in that
           * mode the "don't redesign the piece" guardrails live only in the
           * prompt — which is why buildImageAnimationPrompt opens with them
           * rather than relying on this list.
           */
          ...(multiView ? {} : { negativePrompt: DEFAULT_NEGATIVE_PROMPT }),
          ...(viewInput.referenceImages ? { referenceImages: viewInput.referenceImages } : {}),
        },
      });
      await stepDone(null);
      return result;
    }
  );

  // Deliberately its own phase with a long tail: a 1080p clip is tens of
  // megabytes, and the upload after the model answers is a real part of the
  // wait rather than a rounding error the way it is for an image.
  await setProgress(85, "saving");

  const saved = await recordGeneration({
    tenant,
    user: dbUser,
    tool: "image_to_video",
    conversationId: data.conversationId,
    parentGenerationId: data.parentGenerationId || null,
    model: modelId,
    modelLabel,
    provider: "gemini",
    quality: data.resolution,
    prompt,
    userPrompt: data.description || null,
    params: {
      camera: data.camera ?? null,
      mood: data.mood ?? null,
      aspectRatio: data.aspectRatio,
      resolution: data.resolution,
      durationSeconds: data.durationSeconds,
      viewCount: views.length,
      /** What the vision pass read off the photos — so a bad clip can be traced to a bad reading. */
      designSpec: designSpec || null,
    },
    // The stills the clip was made from. The first is also what the video's
    // poster frame is rendered from — see recordGeneration — so the order
    // the user uploaded in is kept rather than sorted.
    inputImages: views.map((view) => ({ image: view, role: "uploaded" })),
    outputImages: [{ image: output, role: "generated" }],
    durationMs: data.durationSeconds * 1000,
    providerId,
  });

  return {
    generationId: saved.generationId,
    conversationId: saved.conversationId,
    outputUrl: saved.outputs[0]?.url || null,
    outputUrls: saved.outputs.map((entry) => entry.url),
    /** So the client renders a player rather than an `<img>` that can't load. */
    outputType: "video",
    durationSeconds: data.durationSeconds,
    model: modelId,
    modelLabel,
    provider: "gemini",
  };
});

module.exports = { IMAGE_TO_VIDEO_JOB };

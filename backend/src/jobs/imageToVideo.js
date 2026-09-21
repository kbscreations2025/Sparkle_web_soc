const { registerJobHandler } = require("./registry");
const { routeVideoCall, loadTenantOrThrow } = require("../aiRouting");
const { recordGeneration } = require("../generationService");
const { buildImageAnimationPrompt, DEFAULT_NEGATIVE_PROMPT } = require("../prompts/video");
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

  const prompt = buildImageAnimationPrompt({
    camera: data.camera,
    mood: data.mood,
    description: data.description,
  });

  const { output, providerId } = await withProgress(
    { from: 15, to: 80, phase: "generating" },
    async ({ stepDone }) => {
      const result = await routeVideoCall({
        tenant,
        modelId,
        prompt,
        image: { imageBytes: data.image.base64, mimeType: data.image.mimeType },
        config: {
          numberOfVideos: 1,
          aspectRatio: data.aspectRatio,
          resolution: data.resolution,
          durationSeconds: data.durationSeconds,
          negativePrompt: DEFAULT_NEGATIVE_PROMPT,
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
    },
    // The still the clip was made from. It is also what the video's poster
    // frame is rendered from — see recordGeneration.
    inputImages: [{ image: data.image, role: "uploaded" }],
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

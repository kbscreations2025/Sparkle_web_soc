const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { parseDataUri } = require("../generationService");
const { queueGeneration } = require("./queueGeneration");
const { IMAGE_TO_VIDEO_JOB } = require("../jobs/imageToVideo");
const {
  CAMERA_STYLES,
  MOOD_STYLES,
  ASPECT_RATIOS,
  DEFAULT_ASPECT_RATIO,
  RESOLUTIONS,
  DEFAULT_RESOLUTION,
  DEFAULT_DURATION,
  MIN_DURATION,
  MAX_DURATION,
} = require("../prompts/video");
const gemini = require("../gemini");

const router = express.Router();

router.use(requireAuth, requirePermission("tool.image_to_video.run"));

/** Clamps a requested clip length into what the API will actually accept. */
function clampDuration(value) {
  const seconds = Math.round(Number(value)) || DEFAULT_DURATION;
  return Math.max(MIN_DURATION, Math.min(MAX_DURATION, seconds));
}

/** Falls back to the default for anything not on the list, never passing it through. */
function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

router.post("/", async (req, res) => {
  const { image, description, model: requestedModel, camera, mood, aspectRatio, resolution, durationSeconds, preview, conversationId } =
    req.body || {};

  const parsed = parseDataUri(image);
  if (!parsed) {
    return res.status(400).json({ status: "error", message: "upload a jewellery photo first", code: "invalid" });
  }

  const modelId = gemini.resolveVideoModel(requestedModel);
  const seconds = clampDuration(durationSeconds);
  const pickedResolution = oneOf(resolution, RESOLUTIONS, DEFAULT_RESOLUTION);

  return queueGeneration(req, res, {
    type: IMAGE_TO_VIDEO_JOB,
    tool: "image_to_video",
    request: {
      provider: "gemini",
      /*
       * Composite on purpose. The duration estimator samples past runs by
       * `(type, request.model)`, and a 4-second clip and a 15-second one are
       * not the same job — averaging them would make short clips look stuck
       * and long ones look finished long before they are.
       */
      model: `${modelId}:${pickedResolution}:${seconds}s`,
      modelId,
      modelLabel: gemini.videoLabelFor(modelId),
      quality: pickedResolution,
      durationSeconds: seconds,
      aspectRatio: oneOf(aspectRatio, ASPECT_RATIOS, DEFAULT_ASPECT_RATIO),
    },
    payload: {
      image: parsed,
      description: description || null,
      camera: oneOf(camera, CAMERA_STYLES.map((style) => style.id), CAMERA_STYLES[0].id),
      mood: oneOf(mood, MOOD_STYLES.map((style) => style.id), MOOD_STYLES[0].id),
      aspectRatio: oneOf(aspectRatio, ASPECT_RATIOS, DEFAULT_ASPECT_RATIO),
      resolution: pickedResolution,
      durationSeconds: seconds,
      requestedModel: modelId,
      conversationId: conversationId || null,
    },
    preview,
    message: `queued a ${seconds}s ${pickedResolution} video on ${gemini.videoLabelFor(modelId)}`,
  });
});

module.exports = router;

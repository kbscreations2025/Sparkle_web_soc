const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { queueGeneration, parseImages } = require("./queueGeneration");
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
  MAX_VIEWS,
  REFERENCE_MODE,
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
  const { image, images, description, model: requestedModel, camera, mood, aspectRatio, resolution, durationSeconds, preview, conversationId } =
    req.body || {};

  /*
   * One piece, several views of it. `image` is still accepted so older
   * clients keep working, and anything past the cap is dropped rather than
   * refused — losing the seventh angle is a better outcome than losing the
   * run. Only the first three reach Veo as references (see MAX_VIEWS); the
   * rest are read by the design-spec pass in the handler.
   */
  const parsedViews = parseImages(Array.isArray(images) && images.length ? images : image).slice(0, MAX_VIEWS);
  if (!parsedViews.length) {
    return res.status(400).json({ status: "error", message: "upload a jewellery photo first", code: "invalid" });
  }

  /*
   * Reference mode accepts exactly one combination of settings (see
   * REFERENCE_MODE) and answers anything else with an opaque 400 several
   * minutes into the queue. Pinning the settings here rather than passing
   * the user's picks through is what turns that into a clip; the frontend
   * locks the same pickers so the values shown match the values sent.
   */
  const multiView = parsedViews.length > 1;

  const modelId = multiView ? REFERENCE_MODE.model : gemini.resolveVideoModel(requestedModel);
  const seconds = multiView ? REFERENCE_MODE.durationSeconds : clampDuration(durationSeconds);
  const pickedResolution = multiView ? REFERENCE_MODE.resolution : oneOf(resolution, RESOLUTIONS, DEFAULT_RESOLUTION);
  const pickedAspect = multiView ? REFERENCE_MODE.aspectRatio : oneOf(aspectRatio, ASPECT_RATIOS, DEFAULT_ASPECT_RATIO);

  return queueGeneration(req, res, {
    type: IMAGE_TO_VIDEO_JOB,
    tool: "image_to_video",
    request: {
      provider: "gemini",
      /*
       * Composite on purpose. The duration estimator samples past runs by
       * `(type, request.model)`, and a 4-second clip and a 15-second one are
       * not the same job — averaging them would make short clips look stuck
       * and long ones look finished long before they are. A multi-view run
       * goes through Veo's reference path rather than first-frame, so it is
       * sampled separately for the same reason.
       */
      model: `${modelId}:${pickedResolution}:${seconds}s${multiView ? `:${parsedViews.length}views` : ""}`,
      modelId,
      modelLabel: gemini.videoLabelFor(modelId),
      quality: pickedResolution,
      durationSeconds: seconds,
      aspectRatio: pickedAspect,
    },
    payload: {
      /** First view stays under `image` so anything reading one still keeps working. */
      image: parsedViews[0],
      images: parsedViews,
      description: description || null,
      camera: oneOf(camera, CAMERA_STYLES.map((style) => style.id), CAMERA_STYLES[0].id),
      mood: oneOf(mood, MOOD_STYLES.map((style) => style.id), MOOD_STYLES[0].id),
      aspectRatio: pickedAspect,
      resolution: pickedResolution,
      durationSeconds: seconds,
      requestedModel: modelId,
      conversationId: conversationId || null,
    },
    preview,
    message: `queued a ${seconds}s ${pickedResolution} video on ${gemini.videoLabelFor(modelId)}${
      multiView ? ` from ${parsedViews.length} views` : ""
    }`,
  });
});

module.exports = router;

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
  TURNTABLE,
} = require("../prompts/video");
const { planTurntable } = require("../video/turntable");
const gemini = require("../providers/gemini");
const openrouter = require("../providers/openrouter");

const router = express.Router();

/**
 * Which provider a requested video model belongs to. Veo ids stay on Gemini
 * (with OpenRouter as a priority-ordered fallback, see routeVideoCall);
 * Kling, Wan and Seedance exist only on OpenRouter. Anything unknown —
 * including Sora 2 Pro, which OpenRouter no longer offers — falls back to
 * the default Veo model.
 */
function resolveVideoModel(requested) {
  if (openrouter.isKnownVideoModel(requested)) {
    const spec = openrouter.OPENROUTER_VIDEO_MODELS[requested];
    return { provider: "openrouter", modelId: requested, label: spec.label, durations: spec.durations, resolutions: spec.resolutions };
  }
  const modelId = gemini.resolveVideoModel(requested);
  return { provider: "gemini", modelId, label: gemini.videoLabelFor(modelId), durations: null, resolutions: RESOLUTIONS };
}

/** The allowed length closest to what was asked for. */
function nearest(value, allowed) {
  const wanted = Number(value) || DEFAULT_DURATION;
  return allowed.reduce((best, option) => (Math.abs(option - wanted) < Math.abs(best - wanted) ? option : best), allowed[0]);
}

router.use(requireAuth, requirePermission("tool.image_to_video.run"));

/** Clamps a requested clip length into what the API will actually accept. */
function clampDuration(value) {
  const seconds = Math.round(Number(value)) || DEFAULT_DURATION;
  return Math.max(MIN_DURATION, Math.min(MAX_DURATION, seconds));
}

/** The client's angle names for the first `count` views, bounded; null when it sent none. */
function readViewLabels(viewLabels, count) {
  return Array.isArray(viewLabels) ? viewLabels.slice(0, count).map((label) => String(label).slice(0, 24)) : null;
}

/** Falls back to the default for anything not on the list, never passing it through. */
function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

/**
 * The pinned turntable (see jobs/imageToVideo.js filmTurntable): the photos
 * the client labelled Front, Side, Back and Other side are the angles the
 * piece turns through, one segment between each and the next.
 *
 * What the photos show decides the plan, not the slots they sit in. The same
 * photo in Front and Back says the piece looks the same from behind — then the
 * second half of a turn is the first half again, so only Front → Side → Back
 * is filmed and the loop plays it twice. Filming the full turn between those
 * repeated photos is what made it swing back: between two identical frames a
 * model has no way to tell which way to keep turning.
 *
 * Priced by what is filmed — every filmed segment, each a little longer than
 * its share of the loop — rather than by the length of the finished loop.
 */
function queueTurntable(req, res, { parsedViews, viewLabels, description, aspectRatio, resolution, durationSeconds, preview, conversationId }) {
  const labels = readViewLabels(viewLabels, parsedViews.length) ?? [];
  const pinned = TURNTABLE.angles
    .map((angle) => ({ label: angle.label, degrees: angle.degrees, index: labels.indexOf(angle.label) }))
    .filter((angle) => angle.index >= 0);

  if (pinned[0]?.label !== "Front" || pinned.length < 2) {
    return res.status(400).json({
      status: "error",
      message: "A pinned 360° needs the Front photo and at least one of Side, Back or Other side.",
      code: "invalid",
    });
  }

  const clipSeconds = nearest(durationSeconds || TURNTABLE.defaultLength, TURNTABLE.lengths);
  const plan = planTurntable({ pinned, images: parsedViews, loopSeconds: clipSeconds });
  if (plan.error) return res.status(400).json({ status: "error", message: plan.error, code: "invalid" });
  const { segments, loop, halfTurn, distinct } = plan;
  const filmedSeconds = segments.reduce((sum, segment) => sum + segment.seconds, 0);
  const pickedResolution = oneOf(resolution, RESOLUTIONS, DEFAULT_RESOLUTION);
  const pickedAspect = oneOf(aspectRatio, ASPECT_RATIOS, DEFAULT_ASPECT_RATIO);
  const label = openrouter.videoLabelFor(TURNTABLE.model);

  return queueGeneration(req, res, {
    type: IMAGE_TO_VIDEO_JOB,
    tool: "image_to_video",
    request: {
      provider: "openrouter",
      // Sampled apart from ordinary clips by the duration estimator: several
      // segments filmed at once, then joined, is its own kind of wait.
      model: `${TURNTABLE.model}:${pickedResolution}:${clipSeconds}s:turntable${segments.length}`,
      modelId: TURNTABLE.model,
      modelLabel: label,
      quality: pickedResolution,
      durationSeconds: filmedSeconds,
      aspectRatio: pickedAspect,
      mode: "turntable",
    },
    payload: {
      turntable: true,
      image: parsedViews[0],
      images: parsedViews,
      viewLabels: labels,
      pinned,
      segments,
      loop,
      halfTurn,
      clipSeconds,
      description: description || null,
      camera: "orbit",
      aspectRatio: pickedAspect,
      resolution: pickedResolution,
      durationSeconds: clipSeconds,
      requestedModel: TURNTABLE.model,
      provider: "openrouter",
      conversationId: conversationId || null,
    },
    preview,
    message: `queued a pinned ${clipSeconds}s 360° from ${distinct} photos on ${label}${halfTurn ? " (half turn, played twice)" : ""}`,
  });
}

router.post("/", async (req, res) => {
  const {
    image,
    images,
    viewLabels,
    description,
    model: requestedModel,
    camera,
    mood,
    aspectRatio,
    resolution,
    durationSeconds,
    preview,
    conversationId,
    turntable,
  } = req.body || {};

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

  if (turntable) {
    return queueTurntable(req, res, { parsedViews, viewLabels, description, aspectRatio, resolution, durationSeconds, preview, conversationId });
  }

  /*
   * Reference mode accepts exactly one combination of settings (see
   * REFERENCE_MODE) and answers anything else with an opaque 400 several
   * minutes into the queue. Pinning the settings here rather than passing
   * the user's picks through is what turns that into a clip; the frontend
   * locks the same pickers so the values shown match the values sent.
   */
  const multiView = parsedViews.length > 1;

  const video = resolveVideoModel(multiView ? REFERENCE_MODE.model : requestedModel);
  const { modelId, provider } = video;
  const seconds = multiView
    ? REFERENCE_MODE.durationSeconds
    : video.durations
      ? nearest(durationSeconds, video.durations)
      : clampDuration(durationSeconds);
  const pickedResolution = multiView
    ? REFERENCE_MODE.resolution
    : oneOf(resolution, video.resolutions, video.resolutions.includes(DEFAULT_RESOLUTION) ? DEFAULT_RESOLUTION : video.resolutions[0]);
  const pickedAspect = multiView ? REFERENCE_MODE.aspectRatio : oneOf(aspectRatio, ASPECT_RATIOS, DEFAULT_ASPECT_RATIO);

  return queueGeneration(req, res, {
    type: IMAGE_TO_VIDEO_JOB,
    tool: "image_to_video",
    request: {
      provider,
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
      modelLabel: video.label,
      quality: pickedResolution,
      durationSeconds: seconds,
      aspectRatio: pickedAspect,
    },
    payload: {
      /** First view stays under `image` so anything reading one still keeps working. */
      image: parsedViews[0],
      images: parsedViews,
      /*
       * Which angle each view is, when the client said — sliced alongside the
       * views so a dropped seventh angle cannot shift the labels out of step
       * with the photographs they name.
       */
      viewLabels: readViewLabels(viewLabels, parsedViews.length),
      description: description || null,
      camera: oneOf(camera, CAMERA_STYLES.map((style) => style.id), CAMERA_STYLES[0].id),
      mood: oneOf(mood, MOOD_STYLES.map((style) => style.id), MOOD_STYLES[0].id),
      aspectRatio: pickedAspect,
      resolution: pickedResolution,
      durationSeconds: seconds,
      requestedModel: modelId,
      provider,
      conversationId: conversationId || null,
    },
    preview,
    message: `queued a ${seconds}s ${pickedResolution} video on ${video.label}${
      multiView ? ` from ${parsedViews.length} views` : ""
    }`,
  });
});

module.exports = router;

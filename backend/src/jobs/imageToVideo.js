const { registerJobHandler } = require("./registry");
const { loadJobActor } = require("./actor");
const { toResult, historyPrompt } = require("./generationRunner");
const { routeVideoCall, routeTextCall } = require("../aiRouting");
const { recordGeneration } = require("../generationService");
const {
  buildImageAnimationPrompt,
  buildDesignSpecPrompt,
  buildTurntableSegmentPrompt,
  DEFAULT_NEGATIVE_PROMPT,
  MAX_REFERENCE_IMAGES,
  REFERENCE_MODE,
  TURNTABLE,
} = require("../prompts/video");
const { frameSize, framePhotos, turnJump, snapped, retraceScore, retraced, assembleLoop } = require("../video/turntable");
const gemini = require("../providers/gemini");
const openrouter = require("../providers/openrouter");

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
  const { dbUser, tenant } = await loadJobActor(job);
  // Older queued jobs predate `provider` and are all Veo on Gemini.
  const requestedProvider = data.provider === "openrouter" && openrouter.isKnownVideoModel(data.requestedModel) ? "openrouter" : "gemini";
  const modelId = requestedProvider === "openrouter" ? data.requestedModel : gemini.resolveVideoModel(data.requestedModel);
  const modelLabel = requestedProvider === "openrouter" ? openrouter.videoLabelFor(modelId) : gemini.videoLabelFor(modelId);

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
        prompt: buildDesignSpecPrompt(views.length, data.viewLabels || []),
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

  if (data.turntable) {
    return filmTurntable({ job, data, setProgress, withProgress, dbUser, tenant, views, designSpec });
  }

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
    // Kling refuses a prompt over 2,500 characters — compacted to fit.
    maxLength: requestedProvider === "openrouter" ? openrouter.videoPromptLimit(modelId) : null,
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

  const { output, providerId, provider } = await withProgress(
    { from: 15, to: 80, phase: "generating" },
    async ({ stepDone }) => {
      const result = await routeVideoCall({
        tenant,
        provider: requestedProvider,
        modelId,
        prompt,
        // The raw views, for an OpenRouter key — same first-frame vs
        // references split, capped the same way.
        views: views.slice(0, MAX_REFERENCE_IMAGES).map((view) => ({ mimeType: view.mimeType, base64: view.base64 })),
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
    provider,
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

  return toResult(saved, {
    /** So the client renders a player rather than an `<img>` that can't load. */
    outputType: "video",
    durationSeconds: data.durationSeconds,
    model: modelId,
    modelLabel,
    provider,
  });
});

/**
 * The pinned turntable: a full turn filmed as segments between the person's
 * own photos — front → side → back → other side → front, or as many of those
 * as were given — each segment pinned to a photo at both ends. Every
 * photographed angle is therefore the photograph itself; the model only
 * animates the turn between two known views. The segments are then evened
 * out and joined into one seamless loop (video/turntable.js).
 *
 * The route plans which segments to film from what the photos show (see
 * queueTurntable): normally one per pair of neighbouring angles; for a piece
 * whose Back is the same photo as its Front, just Front → Side → Back, played
 * twice.
 *
 * All segments are filmed at once. One that fails fails the run: a turn with
 * a missing quarter is not a turntable. Then each is checked, and refilmed —
 * up to twice, keeping the best take — when it:
 *  - snapped: held still, then jumped to its last frame (turnJump);
 *  - turned back: played the segment before it in reverse, which is how the
 *    turn "goes backwards and forwards again" (retraceScore).
 * Extra takes are on us: the run is priced by its segments, not its takes.
 */
const MAX_RETAKES = 2;

async function filmTurntable({ job, data, setProgress, withProgress, dbUser, tenant, views, designSpec }) {
  const pinned = data.pinned.map((entry) => ({ ...entry, image: views[entry.index] }));
  const size = frameSize(data.resolution, data.aspectRatio);
  const frames = await framePhotos(
    pinned.map((entry) => entry.image),
    size
  );

  // Jobs queued before plans existed: every neighbouring pair, played once.
  const plan =
    data.segments ??
    pinned.map((entry, index) => {
      const next = (index + 1) % pinned.length;
      return {
        fromPin: index,
        toPin: next,
        from: entry.label,
        to: pinned[next].label,
        degrees: (pinned[next].degrees - entry.degrees + 360) % 360 || 360,
        seconds: data.segmentSeconds[index],
      };
    });
  const loop = data.loop ?? plan.map((_, index) => index);
  const segments = plan.map((segment) => ({ ...segment, first: frames[segment.fromPin], last: frames[segment.toPin] }));

  const film = async (segment) => {
    const result = await routeVideoCall({
      tenant,
      provider: "openrouter",
      modelId: TURNTABLE.model,
      prompt: buildTurntableSegmentPrompt({ ...segment, designSpec, description: data.description }),
      frames: { first: segment.first, last: segment.last },
      // A turntable has nothing to say; silence is also cheaper.
      generateAudio: false,
      config: { aspectRatio: data.aspectRatio, resolution: data.resolution, durationSeconds: segment.seconds },
    });
    const buffer = Buffer.from(result.output.base64, "base64");
    return { ...result, buffer, jump: await turnJump(buffer, data.aspectRatio) };
  };

  const filmed = await withProgress({ from: 15, to: 72, phase: "generating", steps: segments.length }, ({ stepDone }) =>
    Promise.all(
      segments.map(async (segment) => {
        let take = await film(segment);
        if (snapped(take.jump)) {
          console.warn(`[imageToVideo] turntable job ${job._id}: ${segment.from} → ${segment.to} snapped (${take.jump.toFixed(1)}×), filming it again`);
          const retake = await film(segment);
          if (retake.jump < take.jump) take = retake;
        }
        await stepDone(null);
        return take;
      })
    )
  );

  // Each segment against the one before it: refilm any that turned back. The
  // scores are taken afresh every round, since a retake changes what the
  // segment after it is measured against.
  await setProgress(74, "generating");
  const scoreAll = () =>
    Promise.all(filmed.map((take, k) => (k === 0 ? 1 : retraceScore(take.buffer, filmed[k - 1].buffer, data.aspectRatio))));
  let scores = await scoreAll();
  for (let round = 0; round < MAX_RETAKES; round++) {
    const turnedBack = scores.map((score, k) => (k > 0 && retraced(score) ? k : -1)).filter((k) => k > 0);
    if (!turnedBack.length) break;
    console.warn(
      `[imageToVideo] turntable job ${job._id}: ${turnedBack.map((k) => `${segments[k].from} → ${segments[k].to} (${scores[k].toFixed(2)})`).join(", ")} turned back, filming again`
    );
    await Promise.all(
      turnedBack.map(async (k) => {
        const retake = await film(segments[k]);
        const score = await retraceScore(retake.buffer, filmed[k - 1].buffer, data.aspectRatio);
        if (score > scores[k] && !snapped(retake.jump)) filmed[k] = retake;
      })
    );
    scores = await scoreAll();
  }

  await setProgress(82, "joining");
  const clip = await assembleLoop(
    loop.map((k) => filmed[k].buffer),
    {
      degrees: loop.map((k) => segments[k].degrees),
      loopSeconds: data.clipSeconds,
      fps: TURNTABLE.fps,
      aspectRatio: data.aspectRatio,
      ...size,
    }
  );

  await setProgress(90, "saving");
  const modelLabel = openrouter.videoLabelFor(TURNTABLE.model);
  const prompt = historyPrompt(segments.map((segment) => buildTurntableSegmentPrompt({ ...segment, designSpec, description: data.description })));

  const saved = await recordGeneration({
    tenant,
    user: dbUser,
    tool: "image_to_video",
    conversationId: data.conversationId,
    parentGenerationId: data.parentGenerationId || null,
    model: TURNTABLE.model,
    modelLabel,
    provider: "openrouter",
    quality: data.resolution,
    prompt,
    userPrompt: data.description || null,
    params: {
      mode: "turntable",
      camera: "orbit",
      aspectRatio: data.aspectRatio,
      resolution: data.resolution,
      durationSeconds: data.clipSeconds,
      angles: pinned.map((entry) => entry.label),
      segmentSeconds: segments.map((segment) => segment.seconds),
      halfTurn: Boolean(data.halfTurn),
      // How well each segment carried on from the one before (1 = fully; below 0.6 it turned back).
      turnScores: scores.map((score) => Number(score.toFixed(2))),
      viewCount: views.length,
      designSpec: designSpec || null,
    },
    // The pinned photos, in the order the piece turns through them — the
    // first is the opening frame, and what the poster is drawn from.
    inputImages: pinned.map((entry) => ({ image: entry.image, role: "uploaded" })),
    outputImages: [{ image: { mimeType: "video/mp4", base64: clip.toString("base64") }, role: "generated" }],
    durationMs: data.clipSeconds * 1000,
    providerId: filmed[0].providerId,
  });

  return toResult(saved, {
    outputType: "video",
    durationSeconds: data.clipSeconds,
    turntable: true,
    // Charged for the seconds filmed on the first takes — retakes are on us.
    deliveredCount: segments.reduce((sum, segment) => sum + segment.seconds, 0),
    model: TURNTABLE.model,
    modelLabel,
    provider: "openrouter",
  });
}

module.exports = { IMAGE_TO_VIDEO_JOB };

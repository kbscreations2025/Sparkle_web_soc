const { registerJobHandler } = require("./registry");
const { runGenerationJob } = require("./generationRunner");
const {
  buildTextToSketchPrompt,
  buildTextToSketchRefinePrompt,
  buildImageToSketchPrompt,
  buildImageToSketchRefinePrompt,
  buildSketchToImagePrompt,
  buildSketchToImageRefinePrompt,
  SKETCH_ANALYSIS_PROMPT,
} = require("../prompts/sketch");
const { routeTextCall, loadTenantOrThrow } = require("../aiRouting");
const User = require("../models/user");
/** Same family Image to Text uses for reading jewellery; flash is plenty for counting and fast. */
const SKETCH_ANALYSIS_MODEL = "gemini-2.5-flash";

/**
 * The three sketch tools. Each is only its prompts and its tool key — the
 * shared runner does the loading, model routing, parallel fan-out, history
 * writing and result shaping (see generationRunner.js).
 */

const TEXT_TO_SKETCH_JOB = "textToSketch.generate";
const SKETCH_TO_IMAGE_JOB = "sketchToImage.generate";
const IMAGE_TO_SKETCH_JOB = "imageToSketch.generate";

/** A written brief (plus an optional reference photo) drawn as a sketch. */
registerJobHandler(TEXT_TO_SKETCH_JOB, (context) =>
  runGenerationJob({
    ...context,
    tool: "text_to_sketch",
    buildPrompt: ({ data, count }) =>
      buildTextToSketchPrompt({
        description:
          data.prompt?.trim() ||
          (data.sourceImages?.length
            ? "Recreate the attached reference piece faithfully as a design sketch."
            : "an elegant, beautifully designed piece of fine jewelry — the artist's own tasteful choice of type, metal, stones and setting"),
        style: data.style,
        aspect: data.aspect,
        count,
        hasReference: Boolean(data.sourceImages?.length),
      }),
    buildRefinePrompt: buildTextToSketchRefinePrompt,
  })
);

/** One or more hand-drawn sketches rendered as a photorealistic product shot. */
registerJobHandler(SKETCH_TO_IMAGE_JOB, async (context) => {
  // Image models render "the gist" and lose counts — a 12-sided halo of
  // twenty stones comes back as a plain octagon. So a vision model reads the
  // sketch first and writes the exact numbers down; the render prompt then
  // carries them as hard facts. Best-effort: no spec, render as before.
  const spec = context.data.isRefinement ? null : await analyseSketch(context);

  return runGenerationJob({
    ...context,
    tool: "sketch_to_image",
    buildPrompt: ({ data, count }) => buildSketchToImagePrompt({ description: data.description, count, spec }),
    buildRefinePrompt: buildSketchToImageRefinePrompt,
  });
});

async function analyseSketch({ job, data, setProgress }) {
  const images = data.sourceImages ?? [];
  if (images.length === 0) return null;

  try {
    await setProgress?.(10, "analysing");
    const dbUser = await User.findById(job.userId);
    const tenant = await loadTenantOrThrow(dbUser);
    const { output } = await routeTextCall({
      tenant,
      modelId: SKETCH_ANALYSIS_MODEL,
      parts: [
        ...images.map(({ mimeType, base64 }) => ({ inlineData: { mimeType, data: base64 } })),
        { text: SKETCH_ANALYSIS_PROMPT },
      ],
      // Transcription, not creativity: the same sketch should give the same count.
      temperature: 0.1,
      thinkingBudget: 4000,
      maxOutputTokens: 6000,
    });
    if (output.blocked || !output.text) return null;
    return output.text.trim();
  } catch (err) {
    console.warn("[sketchToImage] sketch analysis failed — rendering without a spec:", err.message);
    return null;
  }
}

/** A photograph redrawn by hand as a sketch. */
registerJobHandler(IMAGE_TO_SKETCH_JOB, (context) =>
  runGenerationJob({
    ...context,
    tool: "image_to_sketch",
    buildPrompt: ({ data, count }) => buildImageToSketchPrompt({ style: data.style, count }),
    buildRefinePrompt: buildImageToSketchRefinePrompt,
  })
);

module.exports = { TEXT_TO_SKETCH_JOB, SKETCH_TO_IMAGE_JOB, IMAGE_TO_SKETCH_JOB };

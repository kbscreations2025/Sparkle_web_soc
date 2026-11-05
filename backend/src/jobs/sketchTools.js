const { registerJobHandler } = require("./registry");
const { runGenerationJob, designVariationShots } = require("./generationRunner");
const {
  buildTextToSketchPrompt,
  buildTextToSketchVariationPrompt,
  buildTextToSketchRefinePrompt,
  buildImageToSketchPrompt,
  buildImageToSketchRefinePrompt,
  buildSketchToImagePrompt,
  buildSketchVariationPrompt,
  buildSketchToImageRefinePrompt,
} = require("../prompts/sketch");

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
        hasReference: data.sourceImages?.length ?? 0,
      }),
    // "Make variations" on a reference photo: each sketch a different design
    // option grown out of it, rather than the same piece drawn again.
    ...designVariationShots(context.data, buildTextToSketchVariationPrompt),
    buildRefinePrompt: buildTextToSketchRefinePrompt,
  })
);

/**
 * One or more hand-drawn sketches rendered as a photorealistic product shot —
 * or, when the notes ask for it (`data.mode`, decided in the route), new
 * designs grown out of the sketch.
 */
registerJobHandler(SKETCH_TO_IMAGE_JOB, async (context) => {
  // Variations are new designs, so there is nothing to measure: the sketch is
  // the starting point, and each shot gets a direction of its own.
  if (!context.data.isRefinement && context.data.mode === "variations") {
    return runGenerationJob({
      ...context,
      tool: "sketch_to_image",
      buildShots: ({ data, count }) =>
        Array.from({ length: count }, (_, index) =>
          buildSketchVariationPrompt({ description: data.description, index, total: count })
        ),
      buildRefinePrompt: buildSketchToImageRefinePrompt,
    });
  }

  // Rendered from the drawing alone. A vision model used to read the sketch
  // first and hand the renderer its counts; on two-view band sheets it
  // miscounted, and the renderer followed the numbers over the drawing — see
  // buildSketchToImagePrompt.
  return runGenerationJob({
    ...context,
    tool: "sketch_to_image",
    buildPrompt: ({ data, count }) => buildSketchToImagePrompt({ description: data.description, count }),
    buildRefinePrompt: buildSketchToImageRefinePrompt,
  });
});

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

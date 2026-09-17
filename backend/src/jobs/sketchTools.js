const { registerJobHandler } = require("./registry");
const { runGenerationJob } = require("./generationRunner");
const {
  buildTextToSketchPrompt,
  buildTextToSketchRefinePrompt,
  buildImageToSketchPrompt,
  buildImageToSketchRefinePrompt,
  buildSketchToImagePrompt,
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
        hasReference: Boolean(data.sourceImages?.length),
      }),
    buildRefinePrompt: buildTextToSketchRefinePrompt,
  })
);

/** One or more hand-drawn sketches rendered as a photorealistic product shot. */
registerJobHandler(SKETCH_TO_IMAGE_JOB, (context) =>
  runGenerationJob({
    ...context,
    tool: "sketch_to_image",
    buildPrompt: ({ data, count }) => buildSketchToImagePrompt({ description: data.description, count }),
    buildRefinePrompt: buildSketchToImageRefinePrompt,
  })
);

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

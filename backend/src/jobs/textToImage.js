const { registerJobHandler } = require("./registry");
const { runGenerationJob, MAX_IMAGE_COUNT, DEFAULT_IMAGE_COUNT } = require("./generationRunner");
const { buildTextToImagePrompt, buildTextToImageRefinePrompt } = require("../prompts");

const TEXT_TO_IMAGE_JOB = "textToImage.generate";

/**
 * Text to Image: a written brief rendered as a photograph, optionally from a
 * reference photo. With one, it travels in `sourceImages` and the shared
 * runner sends it alongside the prompt; without, the prompt goes alone.
 */
registerJobHandler(TEXT_TO_IMAGE_JOB, (context) =>
  runGenerationJob({
    ...context,
    tool: "text_to_image",
    buildPrompt: ({ data, count }) =>
      buildTextToImagePrompt({
        description: data.prompt,
        style: data.style,
        aspect: data.aspect,
        count,
        hasReference: Boolean(data.sourceImages?.length),
      }),
    buildRefinePrompt: buildTextToImageRefinePrompt,
  })
);

module.exports = { TEXT_TO_IMAGE_JOB, MAX_IMAGE_COUNT, DEFAULT_IMAGE_COUNT };

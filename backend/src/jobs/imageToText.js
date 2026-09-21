const { registerJobHandler } = require("./registry");
const { runTextJob } = require("./textRunner");
const { ANALYSIS_PROMPT } = require("../prompts/imageToText");

const IMAGE_TO_TEXT_JOB = "imageToText.generate";

/**
 * Image to Text: one photograph in, the prompt that would recreate it out.
 *
 * The only tool here with no refine step — the answer is a description, and
 * a follow-up would be a new reading of the same photo rather than an edit
 * of the last one. It still opens a conversation, so the run appears in
 * History beside everything else and can be reopened to re-read.
 *
 * `temperature: 0.1` because this is a transcription task dressed as a
 * creative one: the same photo should give the same stone count twice.
 */
registerJobHandler(IMAGE_TO_TEXT_JOB, (context) =>
  runTextJob({
    ...context,
    tool: "image_to_text",
    modelId: "gemini-2.5-pro",
    temperature: 0.1,
    thinkingBudget: 8000,
    maxOutputTokens: 12288,
    buildParts: ({ data }) => [
      { inlineData: { mimeType: data.image.mimeType, data: data.image.base64 } },
      { text: ANALYSIS_PROMPT },
    ],
    inputImages: [{ image: context.data.image, role: "uploaded" }],
    promptForHistory: ANALYSIS_PROMPT,
    // What History shows as the user's own words. There are none — they
    // uploaded a photo — so the tool speaks for them.
    userPrompt: "Describe this piece as a generation prompt",
  })
);

module.exports = { IMAGE_TO_TEXT_JOB };

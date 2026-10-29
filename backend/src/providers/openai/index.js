const OpenAI = require("openai");
const { toFile } = require("openai/uploads");
const { withRetry, classifyApiError } = require("../shared");

/**
 * OpenAI's current image-generation/editing model. There is no "gpt-img-2" —
 * `gpt-image-1` is the latest OpenAI offers as of this writing, so it's what
 * this app calls whenever the frontend's GPT model option is picked. Kept as
 * a list (not a single constant) so a future successor model is a one-line
 * addition here, matching how gemini.js lists its models.
 */
const OPENAI_MODELS = ["gpt-image-1"];

/** The "Sparkle" label the frontend shows — see frontend/lib/api.ts's GPT_CLEANING_MODELS. */
const OPENAI_MODEL_LABELS = {
  "gpt-image-1": "Sparkle GPT Image",
};

function labelFor(modelId) {
  return OPENAI_MODEL_LABELS[modelId] || modelId;
}

/**
 * gpt-image-1's quality axis is a compute tier, not a resolution — it renders
 * up to 4096x4096 at any of these, so the Gemini vocabulary ("4K"/"2K"/"1K")
 * does not apply and is deliberately not borrowed. Best first, matching
 * `gemini.qualitiesFor`, so a picker can read either provider's list the same
 * way.
 */
const OPENAI_QUALITIES = ["high", "medium", "low"];

function qualitiesFor() {
  return OPENAI_QUALITIES;
}

function qualityFor(modelId, requested) {
  return OPENAI_QUALITIES.includes(requested) ? requested : OPENAI_QUALITIES[0];
}

function isKnownModel(modelId) {
  return OPENAI_MODELS.includes(modelId);
}

/** A raw OpenAI SDK error as `{ message, code, retryable }` — see `classifyApiError`. */
function classifyError(err) {
  return classifyApiError(err, "OpenAI");
}

/** `mimeType` → a filename extension the Images API's multipart upload will accept. */
function extensionFor(mimeType) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

/**
 * One call to OpenAI's image *editing* endpoint — the cleaning flow always
 * starts from an existing photo, never a blank canvas, so `edit` (not
 * `generate`) is the right call.
 *
 * `images` is `[{ mimeType, base64 }]`; the first is the photo being edited
 * and any further entries ride along as additional input images (gpt-image-1
 * accepts more than one), mirroring gemini.js's `generateImage` contract so
 * `aiRouting.js` can call either provider identically.
 */
async function generateImage({ apiKey, modelId, prompt, images, quality }) {
  const client = new OpenAI({ apiKey, timeout: 150_000 });

  const files = await Promise.all(
    images.map((image, i) =>
      toFile(Buffer.from(image.base64, "base64"), `image-${i}.${extensionFor(image.mimeType)}`, { type: image.mimeType })
    )
  );

  const response = await withRetry(
    () =>
      client.images.edit({
        model: modelId,
        image: files.length === 1 ? files[0] : files,
        prompt,
        quality: qualityFor(modelId, quality),
      }),
    classifyError
  );

  const imageData = response.data?.[0];
  if (!imageData?.b64_json) {
    const err = new Error("OpenAI returned no image in its response");
    err.openaiText = response.data?.[0]?.revised_prompt;
    throw err;
  }

  return { base64: imageData.b64_json, mimeType: "image/png", text: null };
}

module.exports = {
  OPENAI_MODELS,
  qualityFor,
  qualitiesFor,
  isKnownModel,
  labelFor,
  classifyError,
  generateImage,
};

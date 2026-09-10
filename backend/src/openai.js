const OpenAI = require("openai");
const { toFile } = require("openai/uploads");

/**
 * OpenAI's current image-generation/editing model. There is no "gpt-img-2" —
 * `gpt-image-1` is the latest OpenAI offers as of this writing, so it's what
 * this app calls whenever the frontend's GPT model option is picked. Kept as
 * a list (not a single constant) so a future successor model is a one-line
 * addition here, matching how gemini.js lists its models.
 */
const OPENAI_MODELS = ["gpt-image-1"];
const DEFAULT_OPENAI_MODEL = OPENAI_MODELS[0];

/** The "Sparkle" label the frontend shows — see frontend/lib/api.ts's GPT_CLEANING_MODELS. */
const OPENAI_MODEL_LABELS = {
  "gpt-image-1": "Sparkle GPT Image",
};

function labelFor(modelId) {
  return OPENAI_MODEL_LABELS[modelId] || modelId;
}

/** gpt-image-1 has no separate "4K" tier like the Gemini models — one quality level, rendered up to 4096x4096. */
function qualityFor() {
  return "HD";
}

function isKnownModel(modelId) {
  return OPENAI_MODELS.includes(modelId);
}

/** Falls back to the default model whenever the requested one isn't offered. */
function resolveModel(requestedModel) {
  return OPENAI_MODELS.includes(requestedModel) ? requestedModel : DEFAULT_OPENAI_MODEL;
}

/**
 * Turns a raw OpenAI SDK error into `{ message, code, retryable }` — the same
 * shape gemini.js's `classifyError` produces, so `aiRouting.js` can treat
 * either provider's failure identically. See that function's own comment for
 * what `retryable` controls.
 */
function classifyError(err) {
  const code = typeof err?.status === "number" ? err.status : undefined;
  const raw = err?.error?.message || err?.message || String(err);
  const text = `${raw} ${code ?? ""}`.toLowerCase();

  if (code === 429 || code === 500 || code === 503 || text.includes("overloaded") || text.includes("rate limit") || text.includes("quota")) {
    return { message: "This model is under heavy load right now. Please try again shortly.", code, retryable: true };
  }

  if (text.includes("timeout") || text.includes("timed out") || text.includes("econnreset") || text.includes("aborted") || text.includes("network")) {
    return { message: "The request timed out. Please try again.", code, retryable: true };
  }

  if (text.includes("safety") || text.includes("content_policy") || text.includes("content policy") || text.includes("blocked") || text.includes("moderation")) {
    return {
      message: "That request was blocked by the content safety filter. Try adjusting the image or instructions.",
      code,
      retryable: false,
    };
  }

  if (code === 401 || code === 403 || text.includes("api key") || text.includes("incorrect api key") || text.includes("permission")) {
    return { message: "One of this organization's OpenAI keys was rejected.", code, retryable: false };
  }

  if (code === 400 || text.includes("invalid")) {
    return { message: "The request could not be processed. Please adjust the input and try again.", code, retryable: false };
  }

  return { message: "Something went wrong talking to the model.", code, retryable: false };
}

function isWorthTryingNextKey(err) {
  const { code, retryable } = classifyError(err);
  return retryable || code === 401 || code === 403;
}

async function withRetry(fn, { retries = 1, delayMs = 2000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !classifyError(err).retryable) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
  throw lastErr;
}

/** Same shape/contract as gemini.js's `withKeyFailover` — see there for the full rationale. */
async function withKeyFailover(entries, attempt) {
  let lastErr;
  for (let i = 0; i < entries.length; i++) {
    try {
      return await attempt(entries[i], i);
    } catch (err) {
      lastErr = err;
      const isLastKey = i === entries.length - 1;
      if (isLastKey || !isWorthTryingNextKey(err)) throw err;
      console.warn(`[openai] key ${i + 1}/${entries.length} failed (${classifyError(err).message}) — trying the next one`);
    }
  }
  throw lastErr;
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
async function generateImage({ apiKey, modelId, prompt, images }) {
  const client = new OpenAI({ apiKey, timeout: 150_000 });

  const files = await Promise.all(
    images.map((image, i) =>
      toFile(Buffer.from(image.base64, "base64"), `image-${i}.${extensionFor(image.mimeType)}`, { type: image.mimeType })
    )
  );

  const response = await withRetry(() =>
    client.images.edit({
      model: modelId,
      image: files.length === 1 ? files[0] : files,
      prompt,
      quality: "high",
    })
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
  DEFAULT_OPENAI_MODEL,
  qualityFor,
  resolveModel,
  isKnownModel,
  labelFor,
  classifyError,
  withKeyFailover,
  generateImage,
};

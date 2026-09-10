const { GoogleGenAI } = require("@google/genai");

/**
 * The models this app offers. Every id here is both what the frontend shows
 * (under a "Sparkle" label — see frontend/lib/api.ts) and the real Gemini API
 * model id — no alias table, unlike a provider that also has to carry legacy
 * names forward.
 */
const GEMINI_MODELS = ["gemini-3-pro-image", "gemini-3.1-flash-image", "gemini-2.5-flash-image"];
const DEFAULT_GEMINI_MODEL = GEMINI_MODELS[0];

/** The "Sparkle" label the frontend shows for each model id — see frontend/lib/api.ts's CLEANING_MODELS. Kept in step by hand since one lives in each language. */
const GEMINI_MODEL_LABELS = {
  "gemini-3-pro-image": "Sparkle 3 Pro Image",
  "gemini-3.1-flash-image": "Sparkle 3.1 Flash Image",
  "gemini-2.5-flash-image": "Sparkle 2.5 Flash Image",
};

function labelFor(modelId) {
  return GEMINI_MODEL_LABELS[modelId] || modelId;
}

// Only the newer two accept an explicit output size; 2.5-flash-image predates
// imageConfig and is fixed at 1024x1024 regardless of what's asked for.
function supports4K(modelId) {
  return modelId === "gemini-3-pro-image" || modelId === "gemini-3.1-flash-image";
}

function qualityFor(modelId) {
  return supports4K(modelId) ? "4K" : "1K";
}

/** Falls back to the default model whenever the requested one isn't offered. */
function resolveModel(requestedModel) {
  return GEMINI_MODELS.includes(requestedModel) ? requestedModel : DEFAULT_GEMINI_MODEL;
}

/**
 * Turns a raw Gemini/network error into `{ message, code, retryable }`.
 *
 * `retryable` drives two decisions: whether `withRetry` tries the same key
 * again, and — one level up — whether `withKeyFailover` moves on to the
 * tenant's next configured key. Content-safety blocks and bad requests are
 * deliberately excluded from both: every key would fail a blocked prompt the
 * same way, so retrying only delays the real error reaching the user.
 */
function classifyError(err) {
  const raw = err instanceof Error ? err.message : String(err);

  let inner = raw;
  let code;
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed?.error?.message) inner = String(parsed.error.message);
      if (typeof parsed?.error?.code === "number") code = parsed.error.code;
    } catch {
      // Not JSON — inner stays as the raw message.
    }
  }
  if (code === undefined && err && typeof err === "object" && typeof err.status === "number") {
    code = err.status;
  }

  const text = `${inner} ${code ?? ""}`.toLowerCase();

  if (
    code === 500 ||
    code === 503 ||
    code === 429 ||
    text.includes("overloaded") ||
    text.includes("unavailable") ||
    text.includes("internal error") ||
    text.includes("resource has been exhausted") ||
    text.includes("rate limit") ||
    text.includes("quota")
  ) {
    return { message: "This model is under heavy load right now. Please try again shortly.", code, retryable: true };
  }

  if (
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("fetch failed") ||
    text.includes("econnreset") ||
    text.includes("aborted") ||
    text.includes("network")
  ) {
    return { message: "The request timed out. Please try again.", code, retryable: true };
  }

  if (text.includes("safety") || text.includes("blocked") || text.includes("prohibited") || text.includes("content policy")) {
    return {
      message: "That request was blocked by the content safety filter. Try adjusting the image or instructions.",
      code,
      retryable: false,
    };
  }

  if (code === 401 || code === 403 || text.includes("api key") || text.includes("permission denied") || text.includes("unauthenticated")) {
    return { message: "One of this organization's Gemini keys was rejected.", code, retryable: false };
  }

  if (code === 400 || text.includes("invalid argument") || text.includes("invalid request")) {
    return { message: "The request could not be processed. Please adjust the input and try again.", code, retryable: false };
  }

  return { message: "Something went wrong talking to the model.", code, retryable: false };
}

/**
 * Worth trying the tenant's next key over this error? Adds 401/403 on top of
 * `retryable`: those aren't worth retrying on the *same* key (the key itself
 * is bad), but a different key on the same tenant may not be revoked or
 * rate-limited at all.
 */
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

/**
 * Tries `attempt` once per key, in priority order, stopping at the first
 * success. Each key already gets its own transient-error retry inside
 * `attempt` (see `withRetry`) — this is the layer above that: once a key's
 * own retries are exhausted, move on to the tenant's next one rather than
 * failing the whole request over one bad or rate-limited key.
 *
 * `attempt(entry)` is called with the routable `aiProviders` subdocument, not
 * a raw string, so the caller can record success/failure against it.
 *
 * @throws The last key's error, once every key has been tried and none worked.
 */
async function withKeyFailover(entries, attempt) {
  let lastErr;
  for (let i = 0; i < entries.length; i++) {
    try {
      return await attempt(entries[i], i);
    } catch (err) {
      lastErr = err;
      const isLastKey = i === entries.length - 1;
      if (isLastKey || !isWorthTryingNextKey(err)) throw err;
      console.warn(`[gemini] key ${i + 1}/${entries.length} failed (${classifyError(err).message}) — trying the next one`);
    }
  }
  throw lastErr; // unreachable when entries is non-empty; keeps the type honest for an empty array
}

/**
 * One call to Gemini's image generation. `images` is an array of
 * `{ mimeType, base64 }`, sent first, in order, with the prompt last — the
 * order Gemini documents as most reliable for image-conditioned generation.
 *
 * Resolves with the first image part in the response; throws if none came
 * back (a text-only response, most often a declined or unsupported request).
 */
async function generateImage({ apiKey, modelId, prompt, images }) {
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 150_000 } });

  const parts = [
    ...images.map(({ mimeType, base64 }) => ({ inlineData: { mimeType, data: base64 } })),
    { text: prompt },
  ];

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: modelId,
      contents: [{ role: "user", parts }],
      config: {
        responseModalities: ["IMAGE", "TEXT"],
        ...(supports4K(modelId) ? { imageConfig: { imageSize: "4K" } } : {}),
      },
    })
  );

  const responseParts = response.candidates?.[0]?.content?.parts ?? [];
  const imagePart = responseParts.find((part) => part.inlineData?.data);

  if (!imagePart) {
    const textPart = responseParts.find((part) => part.text);
    const err = new Error("Gemini returned no image in its response");
    err.geminiText = textPart?.text;
    throw err;
  }

  return {
    base64: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType || "image/png",
    text: responseParts.find((part) => part.text)?.text ?? null,
  };
}

module.exports = {
  GEMINI_MODELS,
  DEFAULT_GEMINI_MODEL,
  qualityFor,
  resolveModel,
  labelFor,
  classifyError,
  withKeyFailover,
  generateImage,
};

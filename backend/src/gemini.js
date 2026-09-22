const { GoogleGenAI } = require("@google/genai");

/**
 * The models this app offers. Every id here is both what the frontend shows
 * (under a "Sparkle" label — see frontend/lib/api.ts) and the real Gemini API
 * model id — no alias table, unlike a provider that also has to carry legacy
 * names forward.
 */
const GEMINI_MODELS = ["gemini-3-pro-image", "gemini-3.1-flash-image", "gemini-2.5-flash-image"];
const DEFAULT_GEMINI_MODEL = GEMINI_MODELS[0];

/**
 * The text-out models. Separate from the image list because they are picked
 * by the tool rather than by the user — Image to Text and the writing halves
 * of Marketing Kit each name the one they need, and no picker offers a
 * choice — so there is nothing here to resolve a user's request against.
 */
const GEMINI_TEXT_MODELS = ["gemini-2.5-pro", "gemini-2.5-flash"];
const DEFAULT_TEXT_MODEL = GEMINI_TEXT_MODELS[0];

/**
 * Veo, for Image to Video. Verified live against the account this app runs
 * on: `gemini-omni-flash-preview` 404s on `predictLongRunning` through the
 * Gemini Developer API, so it is deliberately absent rather than offered and
 * always failing.
 */
const GEMINI_VIDEO_MODELS = [
  "veo-3.1-generate-preview",
  "veo-3.1-fast-generate-preview",
  "veo-3.1-lite-generate-preview",
];
const DEFAULT_VIDEO_MODEL = "veo-3.1-fast-generate-preview";

const GEMINI_VIDEO_MODEL_LABELS = {
  "veo-3.1-generate-preview": "Veo 3.1 Standard",
  "veo-3.1-fast-generate-preview": "Veo 3.1 Fast",
  "veo-3.1-lite-generate-preview": "Veo 3.1 Lite",
};

/**
 * An ASSET reference for a video run: "this object appears in the clip",
 * as opposed to a STYLE reference, which would only lend its look.
 *
 * Deliberately NOT the SDK's `VideoGenerationReferenceType.ASSET`. That enum
 * is `"ASSET"`, the converter passes the string through verbatim, and the
 * Gemini Developer API rejects it — the wire value is lowercase `"asset"`,
 * as in Google's own samples. See REFERENCE_MODE in prompts/video.js for the
 * rest of what this mode will and won't accept.
 */
function assetVideoReference(image, referenceType) {
  return {
    image: { imageBytes: image.base64, mimeType: image.mimeType },
    referenceType,
  };
}

function resolveVideoModel(requestedModel) {
  return GEMINI_VIDEO_MODELS.includes(requestedModel) ? requestedModel : DEFAULT_VIDEO_MODEL;
}

function videoLabelFor(modelId) {
  return GEMINI_VIDEO_MODEL_LABELS[modelId] || modelId;
}

/**
 * `finishReason` values that mean the model was stopped by a safety or policy
 * filter rather than finishing its answer. Checked on text responses, where —
 * unlike an image response — a stopped run still returns a well-formed
 * candidate with no usable content, and would otherwise read as "the model
 * returned nothing" with no explanation.
 */
const BLOCKED_FINISH_REASONS = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"]);

/** The "Sparkle" label the frontend shows for each model id — see frontend/lib/api.ts's CLEANING_MODELS. Kept in step by hand since one lives in each language. */
const GEMINI_MODEL_LABELS = {
  "gemini-3-pro-image": "Sparkle 3 Pro Image",
  "gemini-3.1-flash-image": "Sparkle 3.1 Flash Image",
  "gemini-2.5-flash-image": "Sparkle 2.5 Flash Image",
};

function labelFor(modelId) {
  return GEMINI_MODEL_LABELS[modelId] || modelId;
}

/**
 * The output sizes each image model accepts, best first — the first entry is
 * what a run gets when the caller names nothing.
 *
 * Only the newer two accept an explicit size; 2.5-flash-image predates
 * `imageConfig` and is fixed at 1024x1024 regardless of what's asked for, so
 * it is listed with its one real option rather than being offered a choice it
 * would silently ignore. That distinction is what `supportsImageSize` below
 * guards: sending `imageConfig` to a model that predates it is not a no-op to
 * rely on, and the API's own default is 1K, so the field has to be sent
 * explicitly for 4K or 2K to happen at all.
 */
const GEMINI_IMAGE_QUALITIES = {
  "gemini-3-pro-image": ["4K", "2K", "1K"],
  "gemini-3.1-flash-image": ["4K", "2K", "1K"],
  "gemini-2.5-flash-image": ["1K"],
};

/** The sizes a picker should offer for this model. Never empty. */
function qualitiesFor(modelId) {
  return GEMINI_IMAGE_QUALITIES[modelId] || ["1K"];
}

function supportsImageSize(modelId) {
  return qualitiesFor(modelId).length > 1;
}

/**
 * The size this run will actually be generated at.
 *
 * Falls back to the model's best rather than rejecting: the picker resets
 * when the model changes, but an in-flight request (or a queued job written
 * before the model was switched) can still carry a size the new model has
 * never supported, and failing that outright would turn a cosmetic mismatch
 * into a dead generation.
 */
function qualityFor(modelId, requested) {
  const allowed = qualitiesFor(modelId);
  return allowed.includes(requested) ? requested : allowed[0];
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
async function generateImage({ apiKey, modelId, prompt, images, quality }) {
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
        ...(supportsImageSize(modelId) ? { imageConfig: { imageSize: qualityFor(modelId, quality) } } : {}),
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

/**
 * One call to a text-out Gemini model. Same argument shape as
 * `generateImage` — images first, prompt last — so the two are
 * interchangeable from the router's point of view.
 *
 * `responseSchema` turns on Gemini's structured-output mode. Without it the
 * API only promises *valid* JSON, not the *right* JSON: Affinity's view maps
 * over `result.items`, and a well-formed object with no `items` array would
 * crash it mid-render. With it the shape is a contract with the API rather
 * than a request in the prompt.
 *
 * `thinkingBudget` is not optional tuning. On Gemini 2.5 the model's internal
 * reasoning tokens are billed against `maxOutputTokens`, unlike OpenAI's
 * `max_tokens` — so an unbounded budget lets a model spend the whole
 * allowance thinking and emit no answer at all. Every caller bounds it.
 *
 * @returns {{ text: string, finishReason: string|null, blocked: boolean, truncated: boolean }}
 */
async function generateText({
  apiKey,
  modelId,
  prompt,
  images = [],
  parts: extraParts,
  systemInstruction,
  responseSchema,
  thinkingBudget = 1024,
  maxOutputTokens = 4096,
  temperature,
}) {
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 150_000 } });

  // `parts` lets a caller interleave its own labelled text and images —
  // Affinity sends "ITEM 1 PHOTO:", the photo, "ITEM 1 SHEET:", the sheet,
  // and the labelling is what keeps eight pieces from blurring together.
  const parts = extraParts ?? [
    ...images.map(({ mimeType, base64 }) => ({ inlineData: { mimeType, data: base64 } })),
    { text: prompt },
  ];

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: modelId,
      contents: [{ role: "user", parts }],
      config: {
        ...(systemInstruction ? { systemInstruction } : {}),
        ...(responseSchema ? { responseMimeType: "application/json", responseSchema } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        thinkingConfig: { thinkingBudget },
        maxOutputTokens,
      },
    })
  );

  const candidate = response.candidates?.[0];
  const finishReason = candidate?.finishReason ?? null;
  const blocked = Boolean(response.promptFeedback?.blockReason) || BLOCKED_FINISH_REASONS.has(finishReason ?? "");

  // Joined, not `[0]`: Gemini can split a long answer across several text
  // parts, and taking the first would silently truncate the narrative.
  const text = (candidate?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  return { text, finishReason, blocked, truncated: finishReason === "MAX_TOKENS" };
}

/** How often a video operation is polled, and for how long before giving up. */
const VIDEO_POLL_INTERVAL_MS = 5000;
/**
 * ~10 minutes. The Next route this replaces capped out at ~290s because a
 * serverless function had to answer within 300s; a queue worker has no such
 * ceiling, so the limit here is "when is it fair to call this hung" rather
 * than "when does the platform kill us".
 */
const VIDEO_MAX_POLLS = 120;

class VideoTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.code = "video_timeout";
    // Written for the user, and not worth retrying: another attempt is
    // another ten minutes of waiting for the same verdict, on the most
    // expensive call this app makes.
    this.expose = true;
    this.noRetry = true;
  }
}

/**
 * Kicks off a Veo generation and polls the long-running operation to
 * completion.
 *
 * Returns the same `{ base64, mimeType }` shape as `generateImage`, so
 * everything downstream — the router, the asset writer, the job result —
 * handles a video exactly as it handles an image.
 *
 * `onPoll` reports each completed poll, which is the only signal this call
 * produces: a Veo run is several minutes of silence otherwise, and the
 * progress bar would have nothing but the clock to go on.
 */
async function generateVideo({ apiKey, modelId, prompt, image, config, onPoll }) {
  // No client timeout: the submit call returns an operation handle in
  // seconds, and every long wait after it is our own polling loop, which
  // has its own deadline below.
  const ai = new GoogleGenAI({ apiKey });

  let operation = await withRetry(() =>
    ai.models.generateVideos({ model: modelId, prompt, ...(image ? { image } : {}), config })
  );

  for (let poll = 0; !operation.done && poll < VIDEO_MAX_POLLS; poll++) {
    await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_INTERVAL_MS));
    operation = await ai.operations.getVideosOperation({ operation });
    // Best-effort: a progress push that throws must not lose the video.
    try {
      await onPoll?.(poll + 1, VIDEO_MAX_POLLS);
    } catch (err) {
      console.error("[gemini] video poll progress failed:", err.message);
    }
  }

  if (!operation.done) {
    throw new VideoTimeoutError("The video is taking longer than expected. Try a shorter duration or a faster model.");
  }
  if (operation.error) {
    throw new Error(operation.error.message || "Video generation failed");
  }

  const video = operation.response?.generatedVideos?.[0]?.video;
  if (!video) throw new Error("No video was returned by the model");

  const mimeType = video.mimeType || "video/mp4";

  // Sometimes the bytes come back inline.
  if (video.videoBytes) return { base64: video.videoBytes, mimeType, text: null };

  /*
   * More often they don't: the response carries a Files API URI that has to
   * be fetched separately, with the same key that made the video.
   *
   * Fetched by hand rather than through `ai.files.download()`. That helper
   * returns `Promise<void>` and writes to a `downloadPath` on disk — it
   * hands back no bytes at all. Reading its return value produced an empty
   * buffer, which uploaded cleanly as a 0-byte mp4: a job that reported
   * success, a poster frame that rendered, and a player with nothing to
   * play. Hence the explicit emptiness check below — a video that arrives
   * with no bytes must fail the job rather than be stored.
   */
  if (video.uri) {
    const url = video.uri.includes("alt=media")
      ? video.uri
      : `${video.uri}${video.uri.includes("?") ? "&" : "?"}alt=media`;

    const response = await withRetry(() => fetch(url, { headers: { "x-goog-api-key": apiKey } }));
    if (!response.ok) {
      throw new Error(`Could not download the generated video (${response.status} ${response.statusText})`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error("The generated video downloaded as an empty file");

    return { base64: buffer.toString("base64"), mimeType, text: null };
  }

  throw new Error("No video data in the model's response");
}

module.exports = {
  GEMINI_MODELS,
  DEFAULT_GEMINI_MODEL,
  GEMINI_TEXT_MODELS,
  DEFAULT_TEXT_MODEL,
  GEMINI_VIDEO_MODELS,
  DEFAULT_VIDEO_MODEL,
  qualityFor,
  qualitiesFor,
  resolveModel,
  resolveVideoModel,
  assetVideoReference,
  labelFor,
  videoLabelFor,
  classifyError,
  withKeyFailover,
  generateImage,
  generateText,
  generateVideo,
  VideoTimeoutError,
};

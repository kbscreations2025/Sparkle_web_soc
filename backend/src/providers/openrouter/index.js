/**
 * OpenRouter fronts many providers behind one OpenAI-compatible API and one
 * key. This app draws on it two ways: as its own selectable models (GPT's
 * newest image models, picked directly on New Cleaning) and as a fallback
 * that can serve a Gemini/OpenAI model when that provider's own keys are
 * missing or exhausted (see aiRouting.js's `imageCandidatesFor` and
 * `providers/modelEquivalents.js`) — so the Gemini-equivalent ids below are
 * reachable even though nothing lets a user pick them directly yet.
 *
 * Ids are OpenRouter's own `<provider>/<model>` naming.
 */
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** OpenRouter's own image endpoint has two distinct shapes depending on which underlying model is asked for it — see `generateImage`. */
const GPT_STYLE_MODELS = ["openai/gpt-image-2", "openai/gpt-image-1"];
const GEMINI_STYLE_MODELS = ["google/gemini-3-pro-image", "google/gemini-3.1-flash-image"];

const OPENROUTER_MODELS = [...GPT_STYLE_MODELS, ...GEMINI_STYLE_MODELS];
const DEFAULT_OPENROUTER_MODEL = OPENROUTER_MODELS[0];

/** The "Sparkle" label the frontend shows — see frontend/lib/api.ts's NEW_CLEANING_MODELS. */
const OPENROUTER_MODEL_LABELS = {
  "openai/gpt-image-2": "Sparkle GPT Image 2",
  "openai/gpt-image-1": "Sparkle GPT Image",
  "google/gemini-3-pro-image": "Sparkle 3 Pro Image",
  "google/gemini-3.1-flash-image": "Sparkle 3.1 Flash Image",
  // The text models' OpenRouter equivalents — same names as on Gemini, since
  // it is the same model whichever key answered.
  "google/gemini-2.5-pro": "Sparkle 2.5 Pro",
  "google/gemini-2.5-flash": "Sparkle 2.5 Flash",
};

function labelFor(modelId) {
  return OPENROUTER_MODEL_LABELS[modelId] || modelId;
}

/** gpt-image-2/1's quality axis over OpenRouter's images endpoint — same vocabulary as OpenAI's own (see openai.js). Best first. */
const GPT_QUALITIES = ["high", "medium", "low"];
/** The Gemini-style models' axis is a resolution, same vocabulary the Gemini provider module itself uses — confirmed from OpenRouter's own Playground export, not assumed. */
const GEMINI_QUALITIES = ["4K", "2K", "1K"];

function qualitiesFor(modelId) {
  return GEMINI_STYLE_MODELS.includes(modelId) ? GEMINI_QUALITIES : GPT_QUALITIES;
}

function qualityFor(modelId, requested) {
  const allowed = qualitiesFor(modelId);
  return allowed.includes(requested) ? requested : allowed[0];
}

function isKnownModel(modelId) {
  return OPENROUTER_MODELS.includes(modelId);
}

/** Falls back to the default model whenever the requested one isn't offered. */
function resolveModel(requestedModel) {
  return OPENROUTER_MODELS.includes(requestedModel) ? requestedModel : DEFAULT_OPENROUTER_MODEL;
}

/** Same shape as gemini.js/openai.js's `classifyError` so aiRouting.js can treat every provider identically. */
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
    return { message: "One of this organization's OpenRouter keys was rejected.", code, retryable: false };
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
      console.warn(`[openrouter] key ${i + 1}/${entries.length} failed (${classifyError(err).message}) — trying the next one`);
    }
  }
  throw lastErr;
}

/**
 * One call to any of OpenRouter's image models through its `images/generations`
 * endpoint. Editing an existing photo goes through `input_references` — an
 * array of `{ type: "image_url", image_url: { url } }`, confirmed against
 * OpenRouter's own Playground export — not a bare `image` field (that's
 * silently ignored: an earlier version of this file sent that and got back
 * an unrelated redesign) and not OpenAI's own `images.edit` multipart
 * contract (OpenRouter doesn't expose that route for these models). A data
 * URI works as the reference's `url` same as a hosted one. Shared by both
 * model families below — only the rest of the body differs.
 */
async function generateImage({ apiKey, modelId, prompt, images, quality, aspectRatio }) {
  const inputReferences = images?.length
    ? {
        input_references: images.map(({ mimeType, base64 }) => ({
          type: "image_url",
          image_url: { url: `data:${mimeType};base64,${base64}` },
        })),
      }
    : {};

  // The two families take genuinely different parameters — confirmed from
  // OpenRouter's own Playground export for each, not assumed from one
  // shape carrying over to the other. GPT's has a compute-tier `quality`
  // plus `background`; Gemini's has a `resolution` and neither of those.
  const body = GEMINI_STYLE_MODELS.includes(modelId)
    ? {
        model: modelId,
        prompt,
        resolution: qualityFor(modelId, quality),
        aspect_ratio: aspectRatio || "1:1",
        ...inputReferences,
      }
    : {
        model: modelId,
        prompt,
        aspect_ratio: aspectRatio || "1:1",
        quality: qualityFor(modelId, quality),
        background: "auto",
        ...inputReferences,
      };

  const response = await withRetry(async () => {
    const res = await fetch(`${OPENROUTER_BASE_URL}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(150_000),
    });

    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      const err = new Error(`OpenRouter image request failed (${res.status})`);
      err.status = res.status;
      err.error = { message: raw || res.statusText };
      throw err;
    }
    return res.json();
  });

  const item = response.data?.[0];
  if (!item?.b64_json) {
    const err = new Error("OpenRouter returned no image in its response");
    err.openaiText = response?.error?.message;
    throw err;
  }

  return { base64: item.b64_json, mimeType: item.media_type || "image/png", text: null };
}

/**
 * Gemini's structured-output schema (`Type.OBJECT`, `nullable: true`) as the
 * standard JSON Schema OpenRouter's `response_format` takes. Lower-cases the
 * type names and turns `nullable` into a `["type", "null"]` union; everything
 * else (properties, items, required, enum, description) already matches.
 */
function toJsonSchema(schema) {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(toJsonSchema);

  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "nullable") continue;
    if (key === "type" && typeof value === "string") out.type = value.toLowerCase();
    else if (key === "properties") out.properties = Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, toJsonSchema(sub)]));
    else if (key === "items") out.items = toJsonSchema(value);
    else out[key] = value;
  }
  if (schema.nullable && out.type) out.type = [out.type, "null"];
  return out;
}

/**
 * Gemini's content parts — `{ text }` and `{ inlineData: { mimeType, data } }`,
 * in the order the caller interleaved them — as OpenAI-style message content.
 * Order is kept exactly: Affinity's "ITEM 1 PHOTO:", photo, "ITEM 1 SHEET:",
 * sheet labelling only works if each label stays next to its picture.
 */
function toMessageContent(parts) {
  return parts
    .map((part) => {
      if (typeof part.text === "string") return { type: "text", text: part.text };
      if (part.inlineData) {
        return { type: "image_url", image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` } };
      }
      return null;
    })
    .filter(Boolean);
}

/** Finish reasons that mean the answer was withheld, not merely short — same set gemini.js treats as blocked. */
const BLOCKED_NATIVE_REASONS = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"]);

/**
 * A text-out call through OpenRouter's chat-completions endpoint — the stand-in
 * for gemini.js's `generateText` when the tenant's Gemini keys are missing or
 * failing (see aiRouting.js's `routeTextCall`). Same arguments, same return
 * shape — `{ text, finishReason, blocked, truncated }` — so the text runner
 * and every other caller can't tell which provider answered.
 *
 * `thinkingBudget` maps to OpenRouter's `reasoning.max_tokens` (0 turns
 * reasoning off), and the reasoning itself is excluded from the reply: only
 * the answer is wanted, the same as on Gemini.
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
  const parts = extraParts ?? [
    ...images.map(({ mimeType, base64 }) => ({ inlineData: { mimeType, data: base64 } })),
    { text: prompt },
  ];

  const messages = [
    ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
    { role: "user", content: toMessageContent(parts) },
  ];

  const body = {
    model: modelId,
    messages,
    max_tokens: maxOutputTokens,
    ...(temperature !== undefined ? { temperature } : {}),
    reasoning: thinkingBudget > 0 ? { max_tokens: thinkingBudget, exclude: true } : { enabled: false, exclude: true },
    ...(responseSchema
      ? // Not `strict`: strict mode demands every property be required and
        // `additionalProperties: false`, which Affinity's optional
        // `sourceCode` breaks. The callers validate the parsed answer anyway.
        { response_format: { type: "json_schema", json_schema: { name: "response", strict: false, schema: toJsonSchema(responseSchema) } } }
      : {}),
  };

  const response = await withRetry(async () => {
    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(150_000),
    });

    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      const err = new Error(`OpenRouter text request failed (${res.status})`);
      err.status = res.status;
      err.error = { message: raw || res.statusText };
      throw err;
    }

    const json = await res.json();
    // OpenRouter can answer 200 with an upstream error in the body.
    if (json?.error) {
      const err = new Error(`OpenRouter text request failed: ${json.error.message || "upstream error"}`);
      err.status = typeof json.error.code === "number" ? json.error.code : undefined;
      err.error = { message: json.error.message || "" };
      throw err;
    }
    return json;
  });

  const choice = response.choices?.[0];
  const finishReason = choice?.native_finish_reason || choice?.finish_reason || null;
  const content = choice?.message?.content;
  const text = (Array.isArray(content) ? content.map((piece) => piece?.text ?? "").join("") : content ?? "").trim();
  const blocked = choice?.finish_reason === "content_filter" || BLOCKED_NATIVE_REASONS.has(String(choice?.native_finish_reason || "").toUpperCase());

  return {
    text,
    finishReason,
    blocked,
    truncated: choice?.finish_reason === "length" || String(choice?.native_finish_reason || "").toUpperCase() === "MAX_TOKENS",
  };
}

/**
 * Video models served through OpenRouter's `/videos` endpoint. Ids are from
 * OpenRouter's own Playground exports. The Veo ids here double as the
 * fallback for the native Gemini Veo models (see modelEquivalents.js); the
 * rest are only reachable through an OpenRouter key.
 *
 * `durations` and `resolutions` are what this app offers per model — the
 * route clamps to them, so a pick the model can't run never reaches it.
 */
const OPENROUTER_VIDEO_MODELS = {
  "google/veo-3.1": { label: "Veo 3.1 Standard", durations: [4, 6, 8], resolutions: ["720p", "1080p"] },
  "google/veo-3.1-fast": { label: "Veo 3.1 Fast", durations: [4, 6, 8], resolutions: ["720p", "1080p"] },
  "google/veo-3.1-lite": { label: "Veo 3.1 Lite", durations: [4, 6, 8], resolutions: ["720p", "1080p"] },
  "kwaivgi/kling-v3.0-pro": { label: "Kling 3.0 Pro", durations: [5, 10], resolutions: ["720p", "1080p"] },
  "kwaivgi/kling-v3.0-std": { label: "Kling 3.0 Standard", durations: [5, 10], resolutions: ["720p"] },
  "openai/sora-2-pro": { label: "Sora 2 Pro", durations: [4, 8, 12], resolutions: ["720p", "1080p"] },
  "alibaba/wan-3.0": { label: "Wan 3.0", durations: [5], resolutions: ["720p", "1080p"] },
  "alibaba/wan-2.7": { label: "Wan 2.7", durations: [5], resolutions: ["720p", "1080p"] },
  "bytedance/seedance-2.5": { label: "Seedance 2.5", durations: [4, 5, 10], resolutions: ["720p", "1080p"] },
  "bytedance/seedance-2.0": { label: "Seedance 2.0", durations: [4, 5, 10], resolutions: ["720p", "1080p"] },
  "bytedance/seedance-2.0-fast": { label: "Seedance 2.0 Fast", durations: [4, 5, 10], resolutions: ["720p"] },
};

function isKnownVideoModel(modelId) {
  return Object.hasOwn(OPENROUTER_VIDEO_MODELS, modelId);
}

function videoLabelFor(modelId) {
  return OPENROUTER_VIDEO_MODELS[modelId]?.label || modelId;
}

/** Same cadence and ceiling as gemini.js's Veo polling — see there. */
const VIDEO_POLL_INTERVAL_MS = 5000;
const VIDEO_MAX_POLLS = 120;

async function openrouterFetch(apiKey, path, init = {}) {
  const res = await fetch(path.startsWith("http") ? path : `${OPENROUTER_BASE_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    signal: AbortSignal.timeout(init.timeoutMs || 60_000),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    const err = new Error(`OpenRouter video request failed (${res.status})`);
    err.status = res.status;
    err.error = { message: raw || res.statusText };
    throw err;
  }
  return res;
}

/**
 * Submit, poll, download — OpenRouter's video API is asynchronous: the POST
 * answers 202 with a job id, the job is polled until `completed`/`failed`,
 * and the bytes come from `/videos/{id}/content` with the same key.
 *
 * `views` are `[{ mimeType, base64 }]`. One view is pinned as the first
 * frame; several go in as `input_references` instead, mirroring the
 * first-frame vs reference split the Gemini path makes.
 *
 * Returns `{ base64, mimeType, text }` like every other generator here.
 */
async function generateVideo({ apiKey, modelId, prompt, views, aspectRatio, resolution, durationSeconds, onPoll }) {
  const asUrl = ({ mimeType, base64 }) => ({ type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } });
  const imageInput = !views?.length
    ? {}
    : views.length === 1
      ? { frame_images: [{ ...asUrl(views[0]), frame_type: "first_frame" }] }
      : { input_references: views.map(asUrl) };

  const submitted = await withRetry(async () =>
    (
      await openrouterFetch(apiKey, "/videos", {
        method: "POST",
        body: JSON.stringify({
          model: modelId,
          prompt,
          duration: durationSeconds,
          resolution,
          aspect_ratio: aspectRatio,
          ...imageInput,
        }),
      })
    ).json()
  );

  if (!submitted?.id) throw new Error("OpenRouter did not return a video job id");
  const pollUrl = submitted.polling_url || `/videos/${submitted.id}`;

  let job = submitted;
  for (let poll = 0; job.status !== "completed" && job.status !== "failed" && poll < VIDEO_MAX_POLLS; poll++) {
    await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_INTERVAL_MS));
    job = await withRetry(async () => (await openrouterFetch(apiKey, pollUrl)).json());
    try {
      await onPoll?.(poll + 1, VIDEO_MAX_POLLS);
    } catch (err) {
      console.error("[openrouter] video poll progress failed:", err.message);
    }
  }

  if (job.status === "failed") {
    const err = new Error(job.error?.message || job.error || "Video generation failed");
    err.error = { message: String(job.error?.message || job.error || "") };
    throw err;
  }
  if (job.status !== "completed") {
    const err = new Error("The video is taking longer than expected. Try a shorter duration or a faster model.");
    err.code = "video_timeout";
    err.expose = true;
    err.noRetry = true;
    throw err;
  }

  const contentUrl = job.unsigned_urls?.[0] || `/videos/${submitted.id}/content?index=0`;
  const res = await withRetry(() => openrouterFetch(apiKey, contentUrl, { timeoutMs: 300_000 }));
  const buffer = Buffer.from(await res.arrayBuffer());
  // Same guard as gemini.js: a 0-byte video must fail the job, not be stored.
  if (!buffer.length) throw new Error("The generated video downloaded as an empty file");

  const mimeType = (res.headers.get("content-type") || "video/mp4").split(";")[0];
  return { base64: buffer.toString("base64"), mimeType: mimeType.startsWith("video/") ? mimeType : "video/mp4", text: null };
}

module.exports = {
  OPENROUTER_VIDEO_MODELS,
  isKnownVideoModel,
  videoLabelFor,
  generateVideo,
  OPENROUTER_MODELS,
  DEFAULT_OPENROUTER_MODEL,
  qualityFor,
  qualitiesFor,
  resolveModel,
  isKnownModel,
  labelFor,
  classifyError,
  withKeyFailover,
  generateImage,
  generateText,
  toJsonSchema,
};

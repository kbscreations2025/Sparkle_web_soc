/**
 * OpenRouter fronts many providers behind one OpenAI-compatible API and one
 * key. This app draws on it two ways: as its own selectable models (GPT's
 * newest image models, picked directly on New Cleaning) and as a fallback
 * that can serve a Gemini/OpenAI model when that provider's own keys are
 * missing or exhausted (see aiRouting.js's `candidatesFor` and
 * `providers/modelEquivalents.js`) — so the Gemini-equivalent ids below are
 * reachable even though nothing lets a user pick them directly yet.
 *
 * Ids are OpenRouter's own `<provider>/<model>` naming.
 */
const sharp = require("sharp");
const { withRetry, classifyApiError, promptParts, BLOCKED_FINISH_REASONS, pollVideo } = require("../shared");

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** OpenRouter's own image endpoint takes a different shape depending on which underlying model is asked for it — see `generateImage`. */
const GPT_25_MODELS = ["openai/gpt-image-2.5-sunburst", "openai/gpt-image-2.5-flare"];
const GPT_STYLE_MODELS = ["openai/gpt-image-2", "openai/gpt-image-1", ...GPT_25_MODELS];
const GEMINI_STYLE_MODELS = ["google/gemini-3-pro-image", "google/gemini-3.1-flash-image"];
/**
 * The models on trial in Image Cleaning's "Cleaning in Testing" card — photo
 * editors from other makers, taking OpenRouter's normalized image fields: a
 * resolution tier and an aspect ratio the model clamps to what it supports.
 */
const EDIT_STYLE_MODELS = [
  "google/gemini-nano-banana-2.1",
  "black-forest-labs/flux-3-image",
  "black-forest-labs/flux.2-max",
  "bytedance-seed/seedream-5-0-pro",
  "qwen/qwen-image-3-pro",
  "krea/k3-edit",
  "microsoft/mai-image-2.6",
  "x-ai/grok-imagine-image-2.0",
  "sourceful/riverflow-v2.5-pro",
  "tencent/hy-image-v3.5-preview",
  "meta/muse-image",
];

const OPENROUTER_MODELS = [...GPT_STYLE_MODELS, ...GEMINI_STYLE_MODELS, ...EDIT_STYLE_MODELS];

/** Everything on the "Cleaning in Testing" card — what scripts/benchCleaning.js runs. */
const TRIAL_MODELS = [...GPT_25_MODELS, ...EDIT_STYLE_MODELS];

/**
 * The label the frontend shows — see frontend/lib/api.ts's NEW_CLEANING_MODELS
 * and TESTING_CLEANING_MODELS. The trial models keep their makers' names, so
 * a result in History says plainly which model made it.
 */
const OPENROUTER_MODEL_LABELS = {
  "openai/gpt-image-2": "Sparkle GPT Image 2",
  "openai/gpt-image-1": "Sparkle GPT Image",
  "google/gemini-3-pro-image": "Sparkle 3 Pro Image",
  "google/gemini-3.1-flash-image": "Sparkle 3.1 Flash Image",
  // The text models' OpenRouter equivalents — same names as on Gemini, since
  // it is the same model whichever key answered.
  "google/gemini-2.5-pro": "Sparkle 2.5 Pro",
  "google/gemini-2.5-flash": "Sparkle 2.5 Flash",
  // On trial — Cleaning in Testing.
  "openai/gpt-image-2.5-sunburst": "GPT Image 2.5 Sunburst",
  "openai/gpt-image-2.5-flare": "GPT Image 2.5 Flare",
  "google/gemini-nano-banana-2.1": "Nano Banana 2.1",
  "black-forest-labs/flux-3-image": "FLUX 3 Image",
  "black-forest-labs/flux.2-max": "FLUX.2 Max",
  "bytedance-seed/seedream-5-0-pro": "Seedream 5.0 Pro",
  "qwen/qwen-image-3-pro": "Qwen Image 3 Pro",
  "krea/k3-edit": "Krea K3 Edit",
  "microsoft/mai-image-2.6": "MAI-Image-2.6",
  "x-ai/grok-imagine-image-2.0": "Grok Imagine Image 2.0",
  "sourceful/riverflow-v2.5-pro": "Riverflow V2.5 Pro",
  "tencent/hy-image-v3.5-preview": "Hy Image 3.5",
  "meta/muse-image": "Muse Image",
};

function labelFor(modelId) {
  return OPENROUTER_MODEL_LABELS[modelId] || modelId;
}

/** gpt-image-2/1's quality axis over OpenRouter's images endpoint — same vocabulary as OpenAI's own (see openai.js). Best first. */
const GPT_QUALITIES = ["high", "medium", "low"];
/** The Gemini-style models' axis is a resolution, same vocabulary the Gemini provider module itself uses — confirmed from OpenRouter's own Playground export, not assumed. */
const GEMINI_QUALITIES = ["4K", "2K", "1K"];
/** OpenRouter's normalized tiers for the trial models. 2K first: not every one of them renders 4K. */
const EDIT_QUALITIES = ["2K", "1K"];
/**
 * The trial models that do render 4K — each confirmed by a probe that got a
 * 4096×4096 image back, not assumed. The rest reject "4K" outright (Seedream
 * and Grok list 1K/2K only), so it can't simply be added for all of them.
 */
const EDIT_4K_MODELS = ["google/gemini-nano-banana-2.1"];
const EDIT_4K_QUALITIES = ["4K", "2K", "1K"];

function qualitiesFor(modelId) {
  if (GEMINI_STYLE_MODELS.includes(modelId)) return GEMINI_QUALITIES;
  if (EDIT_4K_MODELS.includes(modelId)) return EDIT_4K_QUALITIES;
  if (EDIT_STYLE_MODELS.includes(modelId)) return EDIT_QUALITIES;
  return GPT_QUALITIES;
}

function qualityFor(modelId, requested) {
  const allowed = qualitiesFor(modelId);
  return allowed.includes(requested) ? requested : allowed[0];
}

function isKnownModel(modelId) {
  return OPENROUTER_MODELS.includes(modelId);
}

/** An OpenRouter error as `{ message, code, retryable }` — see `classifyApiError`. */
function classifyError(err) {
  return classifyApiError(err, "OpenRouter", (raw, code) => {
    // Any other refusal: say what the model said, briefly — "something went
    // wrong" gives the person nothing to change.
    const reason = String(raw).replace(/\s+/g, " ").trim().slice(0, 160);
    return code >= 400 && code < 500 && reason ? { message: `The model refused this request: ${reason}`, code, retryable: false } : null;
  });
}

/**
 * One request to OpenRouter with this key — JSON when there's a body. A non-2xx
 * answer throws an error carrying its status and body text, which is what
 * `classifyError` reads; `kind` only names the request in that error.
 */
async function openrouterFetch(apiKey, kind, path, { timeoutMs = 60_000, ...init } = {}) {
  const res = await fetch(path.startsWith("http") ? path : `${OPENROUTER_BASE_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    const err = new Error(`OpenRouter ${kind} request failed (${res.status})`);
    err.status = res.status;
    err.error = { message: raw || res.statusText };
    throw err;
  }
  return res;
}

/** An image as the `url` an OpenRouter image reference or message part takes. */
function dataUrl(mimeType, base64) {
  return `data:${mimeType};base64,${base64}`;
}

/**
 * The shapes every trial editor accepts — the narrowest list among them
 * (Krea's, from its own rejection message); Nano Banana takes all of these.
 */
const EDIT_ASPECTS = [
  ["1:1", 1],
  ["4:5", 4 / 5],
  ["4:3", 4 / 3],
  ["3:2", 3 / 2],
  ["2:3", 2 / 3],
  ["16:9", 16 / 9],
  ["9:16", 9 / 16],
];

/**
 * The supported shape nearest the photo being edited. Left unset, a trial
 * editor usually keeps the photo's shape but not always — a square product
 * shot came back 16:9 and re-cropped — so an edit asks for it outright.
 */
async function photoAspect(image) {
  if (!image?.base64) return null;
  try {
    const { width, height } = await sharp(Buffer.from(image.base64, "base64")).metadata();
    if (!width || !height) return null;
    const ratio = width / height;
    const distance = (value) => Math.abs(Math.log(ratio / value));
    return EDIT_ASPECTS.reduce((best, entry) => (distance(entry[1]) < distance(best[1]) ? entry : best))[0];
  } catch {
    return null;
  }
}

/**
 * One call to any of OpenRouter's image models through its `images/generations`
 * endpoint. Editing an existing photo goes through `input_references` — an
 * array of `{ type: "image_url", image_url: { url } }`, confirmed against
 * OpenRouter's own Playground export — not a bare `image` field (that's
 * silently ignored: an earlier version of this file sent that and got back
 * an unrelated redesign) and not OpenAI's own `images.edit` multipart
 * contract (OpenRouter doesn't expose that route for these models). A data
 * URI works as the reference's `url` same as a hosted one. Shared by every
 * model family below — only the rest of the body differs.
 */
async function generateImage({ apiKey, modelId, prompt, images, quality, aspectRatio }) {
  const editAspect = EDIT_STYLE_MODELS.includes(modelId) && !aspectRatio ? await photoAspect(images?.[0]) : null;
  const inputReferences = images?.length
    ? {
        input_references: images.map(({ mimeType, base64 }) => ({ type: "image_url", image_url: { url: dataUrl(mimeType, base64) } })),
      }
    : {};

  // The two families take genuinely different parameters — confirmed from
  // OpenRouter's own Playground export for each, not assumed from one
  // shape carrying over to the other. GPT's has a compute-tier `quality`
  // plus `background`; Gemini's has a `resolution` and neither of those.
  const body = EDIT_STYLE_MODELS.includes(modelId)
    ? {
        // The trial models: OpenRouter's normalized fields only. Their
        // providers reject "auto" outright, so the shape is the one asked
        // for, or else the edited photo's own (see `photoAspect`).
        model: modelId,
        prompt,
        resolution: qualityFor(modelId, quality),
        ...(aspectRatio || editAspect ? { aspect_ratio: aspectRatio || editAspect } : {}),
        ...inputReferences,
      }
    : GEMINI_STYLE_MODELS.includes(modelId)
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
        // Without a resolution GPT Image 2.5 answers at 1024px; asked for
        // "2K" it returns ~1254px, its ceiling (a probe asking "4K" got the
        // same). gpt-image-2/1 keep their existing request untouched.
        ...(GPT_25_MODELS.includes(modelId) ? { resolution: "2K" } : {}),
        ...inputReferences,
      };

  const response = await withRetry(
    async () =>
      (
        await openrouterFetch(apiKey, "image", "/images/generations", {
          method: "POST",
          body: JSON.stringify(body),
          timeoutMs: 150_000,
        })
      ).json(),
    classifyError
  );

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
      if (part.inlineData) return { type: "image_url", image_url: { url: dataUrl(part.inlineData.mimeType, part.inlineData.data) } };
      return null;
    })
    .filter(Boolean);
}

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
  /** Live web results for the model to answer from — OpenRouter's web plugin. See gemini.js. */
  webSearch = false,
}) {
  const messages = [
    ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
    { role: "user", content: toMessageContent(extraParts ?? promptParts(images, prompt)) },
  ];

  const body = {
    model: modelId,
    messages,
    max_tokens: maxOutputTokens,
    ...(temperature !== undefined ? { temperature } : {}),
    reasoning: thinkingBudget > 0 ? { max_tokens: thinkingBudget, exclude: true } : { enabled: false, exclude: true },
    ...(webSearch ? { plugins: [{ id: "web", max_results: 8 }] } : {}),
    ...(responseSchema
      ? // Not `strict`: strict mode demands every property be required and
        // `additionalProperties: false`, which Affinity's optional
        // `sourceCode` breaks. The callers validate the parsed answer anyway.
        { response_format: { type: "json_schema", json_schema: { name: "response", strict: false, schema: toJsonSchema(responseSchema) } } }
      : {}),
  };

  const response = await withRetry(async () => {
    const json = await (
      await openrouterFetch(apiKey, "text", "/chat/completions", { method: "POST", body: JSON.stringify(body), timeoutMs: 150_000 })
    ).json();
    // OpenRouter can answer 200 with an upstream error in the body.
    if (json?.error) {
      const err = new Error(`OpenRouter text request failed: ${json.error.message || "upstream error"}`);
      err.status = typeof json.error.code === "number" ? json.error.code : undefined;
      err.error = { message: json.error.message || "" };
      throw err;
    }
    return json;
  }, classifyError);

  const choice = response.choices?.[0];
  const finishReason = choice?.native_finish_reason || choice?.finish_reason || null;
  const nativeReason = String(choice?.native_finish_reason || "").toUpperCase();
  const content = choice?.message?.content;
  const text = (Array.isArray(content) ? content.map((piece) => piece?.text ?? "").join("") : content ?? "").trim();

  return {
    text,
    finishReason,
    // Withheld, not merely short — the same reasons gemini.js treats as blocked.
    blocked: choice?.finish_reason === "content_filter" || BLOCKED_FINISH_REASONS.has(nativeReason),
    truncated: choice?.finish_reason === "length" || nativeReason === "MAX_TOKENS",
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
 *
 * One model per maker, the strongest: the budget and draft tiers (Veo Fast
 * and Lite, Kling Standard, Wan 2.7, Seedance 2.0 Fast) and Seedance 2.5 —
 * which OpenRouter caps at 720p — are gone, and so is Sora 2 Pro, which
 * OpenRouter no longer lists. Kling 3.0 Pro is 720p only, as OpenRouter
 * lists it (its clips still arrive at 1080p).
 *
 * `maxPrompt` is the longest prompt a model accepts. Kling's is 2,500
 * characters; the full Image to Video prompt with a design spec runs past
 * 3,000, which is why its runs failed — prompts/video.js compacts to fit.
 */
const OPENROUTER_VIDEO_MODELS = {
  "google/veo-3.1": { label: "Veo 3.1 Standard", durations: [4, 6, 8], resolutions: ["720p", "1080p"] },
  "kwaivgi/kling-v3.0-pro": { label: "Kling 3.0 Pro", durations: [5, 10], resolutions: ["720p"], maxPrompt: 2500 },
  // OpenRouter takes 2–30s; these are the lengths the picker offers, 8s its default.
  "alibaba/wan-3.0": { label: "Wan 3.0", durations: [5, 8, 10], resolutions: ["720p", "1080p"] },
  "bytedance/seedance-2.0": { label: "Seedance 2.0", durations: [4, 5, 10], resolutions: ["720p", "1080p"] },
};

function isKnownVideoModel(modelId) {
  return Object.hasOwn(OPENROUTER_VIDEO_MODELS, modelId);
}

function videoLabelFor(modelId) {
  return OPENROUTER_VIDEO_MODELS[modelId]?.label || modelId;
}

/** The longest prompt `modelId` accepts, or null when it has no known limit. */
function videoPromptLimit(modelId) {
  return OPENROUTER_VIDEO_MODELS[modelId]?.maxPrompt ?? null;
}

/**
 * Submit, poll, download — OpenRouter's video API is asynchronous: the POST
 * answers 202 with a job id, the job is polled until `completed`/`failed`
 * (same cadence and ceiling as Veo's, see `pollVideo`), and the bytes come
 * from `/videos/{id}/content` with the same key.
 *
 * `views` are `[{ mimeType, base64 }]`. One view is pinned as the first
 * frame; several go in as `input_references` instead, mirroring the
 * first-frame vs reference split the Gemini path makes.
 *
 * `frames: { first, last }` pins both ends instead — the clip has to open on
 * one image and land on the other (the turntable's quarter-turns). It wins
 * over `views`. `generateAudio: false` asks for a silent clip, which some
 * models price lower.
 *
 * Returns `{ base64, mimeType, text }` like every other generator here.
 */
async function generateVideo({ apiKey, modelId, prompt, views, frames, generateAudio, aspectRatio, resolution, durationSeconds, onPoll }) {
  const asUrl = ({ mimeType, base64 }) => ({ type: "image_url", image_url: { url: dataUrl(mimeType, base64) } });
  const imageInput =
    frames?.first && frames?.last
      ? {
          frame_images: [
            { ...asUrl(frames.first), frame_type: "first_frame" },
            { ...asUrl(frames.last), frame_type: "last_frame" },
          ],
        }
      : !views?.length
        ? {}
        : views.length === 1
          ? { frame_images: [{ ...asUrl(views[0]), frame_type: "first_frame" }] }
          : { input_references: views.map(asUrl) };

  const submitted = await withRetry(
    async () =>
      (
        await openrouterFetch(apiKey, "video", "/videos", {
          method: "POST",
          body: JSON.stringify({
            model: modelId,
            prompt,
            duration: durationSeconds,
            resolution,
            aspect_ratio: aspectRatio,
            ...(generateAudio === false ? { generate_audio: false } : {}),
            ...imageInput,
          }),
        })
      ).json(),
    classifyError
  );

  if (!submitted?.id) throw new Error("OpenRouter did not return a video job id");
  const pollUrl = submitted.polling_url || `/videos/${submitted.id}`;

  const job = await pollVideo(submitted, {
    poll: () => withRetry(async () => (await openrouterFetch(apiKey, "video", pollUrl)).json(), classifyError),
    isDone: (current) => current.status === "completed" || current.status === "failed",
    onPoll,
    provider: "openrouter",
  });

  if (job.status === "failed") {
    // The provider's own reason, shown as it is: a run it accepted and then
    // failed carries no status code for classifyError to read, and its
    // generic fallback told the person nothing.
    const reason = String(job.error?.message || job.error || "").replace(/\s+/g, " ").trim().slice(0, 160);
    const err = new Error(reason ? `The video model couldn't make this clip: ${reason}` : "Video generation failed");
    err.error = { message: reason };
    if (reason) err.expose = true;
    throw err;
  }

  const contentUrl = job.unsigned_urls?.[0] || `/videos/${submitted.id}/content?index=0`;
  const res = await withRetry(() => openrouterFetch(apiKey, "video", contentUrl, { timeoutMs: 300_000 }), classifyError);
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
  videoPromptLimit,
  generateVideo,
  OPENROUTER_MODELS,
  TRIAL_MODELS,
  qualityFor,
  qualitiesFor,
  isKnownModel,
  labelFor,
  classifyError,
  generateImage,
  generateText,
};

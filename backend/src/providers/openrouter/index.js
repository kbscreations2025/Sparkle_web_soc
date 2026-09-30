/**
 * OpenRouter fronts many providers behind one OpenAI-compatible API and one
 * key. This app only draws on it for GPT's newest image-generation models —
 * everything else still goes through gemini.js/openai.js directly — so the
 * list here is deliberately narrow rather than OpenRouter's full catalogue.
 * Ids are OpenRouter's own `<provider>/<model>` naming.
 */
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const OPENROUTER_MODELS = ["openai/gpt-image-2", "openai/gpt-image-1"];
const DEFAULT_OPENROUTER_MODEL = OPENROUTER_MODELS[0];

/** The "Sparkle" label the frontend shows — see frontend/lib/api.ts's NEW_CLEANING_MODELS. */
const OPENROUTER_MODEL_LABELS = {
  "openai/gpt-image-2": "Sparkle GPT Image 2",
  "openai/gpt-image-1": "Sparkle GPT Image",
};

function labelFor(modelId) {
  return OPENROUTER_MODEL_LABELS[modelId] || modelId;
}

/** gpt-image-2/1's quality axis over OpenRouter's images endpoint — same vocabulary as OpenAI's own (see openai.js). Best first. */
const OPENROUTER_QUALITIES = ["high", "medium", "low"];

function qualitiesFor() {
  return OPENROUTER_QUALITIES;
}

function qualityFor(modelId, requested) {
  return OPENROUTER_QUALITIES.includes(requested) ? requested : OPENROUTER_QUALITIES[0];
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
 * One call to gpt-image-2/1 through OpenRouter's `images/generations`
 * endpoint. Editing an existing photo goes through `input_references` — an
 * array of `{ type: "image_url", image_url: { url } }`, confirmed against
 * OpenRouter's own Playground export for this exact model — not a bare
 * `image` field (that's silently ignored: an earlier version of this file
 * sent that and got back an unrelated redesign) and not OpenAI's own
 * `images.edit` multipart contract (OpenRouter doesn't expose that route for
 * this model). A data URI works as the reference's `url` same as a hosted one.
 */
async function generateImage({ apiKey, modelId, prompt, images, quality, aspectRatio }) {
  const body = {
    model: modelId,
    prompt,
    aspect_ratio: aspectRatio || "1:1",
    quality: qualityFor(modelId, quality),
    background: "auto",
    ...(images?.length
      ? {
          input_references: images.map(({ mimeType, base64 }) => ({
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${base64}` },
          })),
        }
      : {}),
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

module.exports = {
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
};

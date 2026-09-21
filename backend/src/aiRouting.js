const Tenant = require("./models/tenant");
const { decryptSecret } = require("./secrets");
const gemini = require("./gemini");
const openai = require("./openai");

/** One entry per provider this router knows how to call — see `routeProviderCall`. */
const PROVIDER_MODULES = { gemini, openai };
const PROVIDER_LABELS = { gemini: "Gemini", openai: "OpenAI" };

/** Thrown when a tenant has no usable key for the requested provider. */
class NoProviderError extends Error {
  constructor(message) {
    super(message);
    this.code = "no_provider_configured";
  }
}

/**
 * Every image-generating route needs the tenant behind the request before it
 * can route a model call. Centralized so each route doesn't repeat the same
 * lookup and the same "no tenant" error.
 */
async function loadTenantOrThrow(dbUser) {
  const tenant = await Tenant.findOne({ _id: dbUser.tenantId, deletedAt: null });
  if (!tenant) throw new NoProviderError("This organization could not be found.");
  return tenant;
}

/**
 * Resolves a requested model id to the provider that serves it, its
 * canonical model id, quality tier and display label. OpenAI's model list is
 * checked first: Gemini's `resolveModel` silently falls back to its own
 * default for anything it doesn't recognise, which would otherwise swallow an
 * OpenAI id and run it on Gemini instead of reporting it as OpenAI.
 *
 * `requestedQuality` is what the user picked, and is resolved against the
 * *resolved* model rather than the requested one — the two differ whenever a
 * bad model id falls back, and validating against the id that will not be
 * used would let a size the real model cannot produce through. Omitting it
 * yields that model's best, which is what every caller got before the picker
 * existed.
 */
function resolveProviderModel(requestedModel, requestedQuality) {
  if (openai.isKnownModel(requestedModel)) {
    return {
      provider: "openai",
      model: requestedModel,
      quality: openai.qualityFor(requestedModel, requestedQuality),
      modelLabel: openai.labelFor(requestedModel),
    };
  }
  const model = gemini.resolveModel(requestedModel);
  return {
    provider: "gemini",
    model,
    quality: gemini.qualityFor(model, requestedQuality),
    modelLabel: gemini.labelFor(model),
  };
}

/**
 * The user-facing reading of a failed generation, independent of how it will
 * be delivered. Routes turn this into an HTTP response; the queue worker
 * stores it on the job instead, and both want the same wording for the same
 * failure.
 */
function classifyProviderError(err, provider = "gemini") {
  if (err instanceof NoProviderError) {
    return { message: err.message, code: err.code, noProvider: true };
  }
  // Already in the user's language, and about this application rather than
  // the provider — a content-filter refusal or a video that ran long. Reading
  // it through the provider's classifier would replace a specific,
  // actionable sentence with "something went wrong talking to the model".
  if (err?.expose && err.message) {
    return { message: err.message, code: err.code ? String(err.code) : null, noProvider: false };
  }
  const { message, code } = (PROVIDER_MODULES[provider] || PROVIDER_MODULES.gemini).classifyError(err);
  return { message, code: code === undefined ? null : String(code), noProvider: false };
}

/**
 * Shared failure response for the image-generating routes: a `NoProviderError`
 * is a 503 the tenant needs to act on, anything else is classified (by
 * whichever provider actually ran) and reported as a 502 (the model didn't
 * deliver) or 500 (a bug here).
 */
function sendGenerationError(res, err, routeName, provider = "gemini") {
  if (err instanceof NoProviderError) {
    return res.status(503).json({ status: "error", message: err.message, code: err.code });
  }
  const { message, code } = PROVIDER_MODULES[provider].classifyError(err);
  console.error(`${routeName} route failed:`, err.geminiText || err.openaiText || err.message || err);
  const status = err.geminiText !== undefined || err.openaiText !== undefined || code !== undefined ? 502 : 500;
  res.status(status).json({ status: "error", message, code: "generation_failed" });
}

/**
 * The part every image-generating route needs, regardless of which tool or
 * provider: pick the tenant's keys for that provider in priority order, fail
 * over between them on a transient error, and record which one actually
 * worked. Built once here so `cleaning` and `chatToEdit` (and every tool
 * after them) share one failover policy instead of each reimplementing it
 * slightly differently — and so a second provider is a new `provider` value,
 * not a second copy of this function.
 *
 * `images` is `[{ mimeType, base64 }]`, sent in that order with the prompt
 * last — see `generateImage` in gemini.js/openai.js.
 *
 * @throws {NoProviderError} if the tenant has no enabled key for `provider`.
 * @returns {{ output: { base64, mimeType, text }, providerId: ObjectId }}
 */
async function routeProviderOperation({ tenant, provider, call }) {
  const mod = PROVIDER_MODULES[provider];
  const candidates = tenant.routableProviders(provider);
  if (candidates.length === 0) {
    throw new NoProviderError(`This organization has no ${PROVIDER_LABELS[provider]} key configured. Ask a super admin to add one.`);
  }

  let usedEntry;
  let output;
  try {
    output = await mod.withKeyFailover(candidates, async (entry) => {
      // Loaded fresh per attempt: `candidates` came off a query without
      // `+aiProviders.credential`, so the secret has to be fetched by id.
      const withCredential = await Tenant.loadProvider(tenant._id, entry._id);
      const apiKey = decryptSecret(withCredential.credential, { provider });

      try {
        const result = await call({ apiKey, mod });
        tenant.recordProviderSuccess(entry._id);
        usedEntry = entry;
        return result;
      } catch (err) {
        tenant.recordProviderFailure(entry._id, mod.classifyError(err).code);
        throw err;
      }
    });
  } finally {
    // Health bookkeeping is best-effort: a write error here is logged and
    // swallowed rather than turned into a failure the user sees, since it
    // changes nothing about whether their image was produced.
    try {
      await tenant.save();
    } catch (err) {
      console.error("could not record provider health:", err.message);
    }
  }

  return { output, providerId: usedEntry._id };
}

/**
 * An image out. The original shape of this function, now one of three
 * operations over the same failover policy.
 */
async function routeProviderCall({ tenant, provider, modelId, prompt, images, quality }) {
  return routeProviderOperation({
    tenant,
    provider,
    call: ({ apiKey, mod }) => mod.generateImage({ apiKey, modelId, prompt, images, quality }),
  });
}

/**
 * Text out — Image to Text, and the writing halves of Marketing Kit.
 *
 * Gemini-only: nothing else this app talks to is wired for text yet, and
 * silently running a text job on a provider that can't do it would fail
 * deep inside the worker rather than here.
 *
 * `output` is `{ text, finishReason, blocked, truncated }` rather than image
 * bytes — see `gemini.generateText`.
 */
async function routeTextCall({ tenant, modelId, prompt, images, parts, ...options }) {
  return routeProviderOperation({
    tenant,
    provider: "gemini",
    call: ({ apiKey, mod }) => mod.generateText({ apiKey, modelId, prompt, images, parts, ...options }),
  });
}

/**
 * A video out. Shares the tenant's Gemini keys and their failover with every
 * other call, which matters more here than elsewhere: a Veo run is minutes
 * long, so a key that turns out to be rate-limited should cost a retry on
 * the next key rather than the whole job.
 */
async function routeVideoCall({ tenant, modelId, prompt, image, config, onPoll }) {
  return routeProviderOperation({
    tenant,
    provider: "gemini",
    call: ({ apiKey, mod }) => mod.generateVideo({ apiKey, modelId, prompt, image, config, onPoll }),
  });
}

/** Back-compat shorthand for the pre-multi-provider call sites. */
async function routeGeminiCall({ tenant, modelId, prompt, images, quality }) {
  return routeProviderCall({ tenant, provider: "gemini", modelId, prompt, images, quality });
}

module.exports = {
  routeGeminiCall,
  routeProviderCall,
  routeProviderOperation,
  routeTextCall,
  routeVideoCall,
  resolveProviderModel,
  loadTenantOrThrow,
  sendGenerationError,
  classifyProviderError,
  NoProviderError,
};

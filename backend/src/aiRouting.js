const Tenant = require("./models/tenant");
const { decryptSecret } = require("./secrets");
const gemini = require("./providers/gemini");
const openai = require("./providers/openai");
const openrouter = require("./providers/openrouter");
const { openrouterEquivalentFor } = require("./providers/modelEquivalents");

/** One entry per provider this router knows how to call — see `routeProviderCall`. */
const PROVIDER_MODULES = { gemini, openai, openrouter };
const PROVIDER_LABELS = { gemini: "Gemini", openai: "OpenAI", openrouter: "OpenRouter" };

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
  if (openrouter.isKnownModel(requestedModel)) {
    return {
      provider: "openrouter",
      model: requestedModel,
      quality: openrouter.qualityFor(requestedModel, requestedQuality),
      modelLabel: openrouter.labelFor(requestedModel),
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
 * The candidates for one image call: the requested provider's own enabled
 * keys, plus — when the requested model has an OpenRouter equivalent (see
 * `providers/modelEquivalents.js`) — this tenant's enabled OpenRouter keys,
 * merged into one list and sorted by the same `priority` number a super
 * admin already sets. That's what lets an OpenRouter key sit at priority 4
 * behind two Gemini keys and an OpenAI key and actually be tried in that
 * order, rather than only ever competing with other OpenRouter rows.
 *
 * A row belonging to neither the requested provider nor OpenRouter is left
 * out; an OpenRouter row is left out too when the requested model has no
 * known OpenRouter id — trying it would only ever fail, so it's dropped
 * instead of attempted.
 */
function imageCandidatesFor(tenant, provider, modelId) {
  const equivalent = provider === "openrouter" ? modelId : openrouterEquivalentFor(provider, modelId);

  return tenant
    .routableProviders() // every enabled key, already sorted by priority
    .filter((entry) => entry.provider === provider || entry.provider === "openrouter")
    .map((entry) => {
      if (entry.provider === provider) return { entry, mod: PROVIDER_MODULES[provider], modelId };
      if (!equivalent) return null; // an OpenRouter row, but this model has no OpenRouter id
      return { entry, mod: openrouter, modelId: equivalent };
    })
    .filter(Boolean);
}

/**
 * Tries each image candidate in order, moving to the next on a transient or
 * key-specific error — same policy every provider module's own
 * `withKeyFailover` already applies, generalized here because candidates can
 * now span more than one module (a Gemini row and an OpenRouter row are not
 * the same module's problem to classify).
 */
async function tryImageCandidates(candidates, attempt) {
  let lastErr;
  for (let i = 0; i < candidates.length; i++) {
    try {
      return await attempt(candidates[i]);
    } catch (err) {
      lastErr = err;
      const isLastCandidate = i === candidates.length - 1;
      const { code, retryable } = candidates[i].mod.classifyError(err);
      if (isLastCandidate || !(retryable || code === 401 || code === 403)) throw err;
      console.warn(
        `[aiRouting] candidate ${i + 1}/${candidates.length} (${candidates[i].entry.provider}) failed — trying the next one`
      );
    }
  }
  throw lastErr; // unreachable when candidates is non-empty; keeps the type honest for an empty array
}

/**
 * An image out. Unlike `routeProviderOperation` (still used by text/video,
 * neither of which OpenRouter serves), this builds its own candidate list so
 * it can mix providers — see `imageCandidatesFor`.
 */
async function routeProviderCall({ tenant, provider, modelId, prompt, images, quality, aspectRatio }) {
  const candidates = imageCandidatesFor(tenant, provider, modelId);
  if (candidates.length === 0) {
    throw new NoProviderError(`This organization has no ${PROVIDER_LABELS[provider]} key configured. Ask a super admin to add one.`);
  }

  let usedEntry;
  let output;
  try {
    output = await tryImageCandidates(candidates, async ({ entry, mod, modelId: resolvedModelId }) => {
      const withCredential = await Tenant.loadProvider(tenant._id, entry._id);
      const apiKey = decryptSecret(withCredential.credential, { provider: entry.provider });

      try {
        const result = await mod.generateImage({
          apiKey,
          modelId: resolvedModelId,
          prompt,
          images,
          quality: mod.qualityFor(resolvedModelId, quality),
          aspectRatio,
        });
        tenant.recordProviderSuccess(entry._id);
        usedEntry = entry;
        return result;
      } catch (err) {
        tenant.recordProviderFailure(entry._id, mod.classifyError(err).code);
        throw err;
      }
    });
  } finally {
    try {
      await tenant.save();
    } catch (err) {
      console.error("could not record provider health:", err.message);
    }
  }

  return { output, providerId: usedEntry._id };
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

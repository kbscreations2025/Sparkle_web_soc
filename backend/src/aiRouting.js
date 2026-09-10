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
 */
function resolveProviderModel(requestedModel) {
  if (openai.isKnownModel(requestedModel)) {
    return {
      provider: "openai",
      model: requestedModel,
      quality: openai.qualityFor(requestedModel),
      modelLabel: openai.labelFor(requestedModel),
    };
  }
  const model = gemini.resolveModel(requestedModel);
  return { provider: "gemini", model, quality: gemini.qualityFor(model), modelLabel: gemini.labelFor(model) };
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
async function routeProviderCall({ tenant, provider, modelId, prompt, images }) {
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
        const result = await mod.generateImage({ apiKey, modelId, prompt, images });
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

/** Back-compat shorthand for the pre-multi-provider call sites. */
async function routeGeminiCall({ tenant, modelId, prompt, images }) {
  return routeProviderCall({ tenant, provider: "gemini", modelId, prompt, images });
}

module.exports = {
  routeGeminiCall,
  routeProviderCall,
  resolveProviderModel,
  loadTenantOrThrow,
  sendGenerationError,
  NoProviderError,
};

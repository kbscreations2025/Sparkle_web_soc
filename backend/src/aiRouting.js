const Tenant = require("./models/tenant");
const { decryptSecret } = require("./secrets");
const { classifyError, withKeyFailover, generateImage } = require("./gemini");

/** Thrown when a tenant has no usable key for the requested provider. */
class NoProviderError extends Error {
  constructor(message) {
    super(message);
    this.code = "no_provider_configured";
  }
}

/**
 * Every image-generating route needs the tenant behind the request before it
 * can route a Gemini call. Centralized so each route doesn't repeat the same
 * lookup and the same "no tenant" error.
 */
async function loadTenantOrThrow(dbUser) {
  const tenant = await Tenant.findOne({ _id: dbUser.tenantId, deletedAt: null });
  if (!tenant) throw new NoProviderError("This organization has no Gemini key configured. Ask a super admin to add one.");
  return tenant;
}

/**
 * Shared failure response for the image-generating routes: a `NoProviderError`
 * is a 503 the tenant needs to act on, anything else is classified and
 * reported as a 502 (the model didn't deliver) or 500 (a bug here).
 */
function sendGenerationError(res, err, routeName) {
  if (err instanceof NoProviderError) {
    return res.status(503).json({ status: "error", message: err.message, code: err.code });
  }
  const { message, code } = classifyError(err);
  console.error(`${routeName} route failed:`, err.geminiText || err.message || err);
  const status = err.geminiText !== undefined || code !== undefined ? 502 : 500;
  res.status(status).json({ status: "error", message, code: "generation_failed" });
}

/**
 * The part every image-generating route needs, regardless of which tool it
 * is: pick the tenant's Gemini keys in priority order, fail over between them
 * on a transient error, and record which one actually worked. Built once here
 * so `cleaning` and `chatToEdit` (and every tool after them) share one
 * failover policy instead of each reimplementing it slightly differently.
 *
 * `images` is `[{ mimeType, base64 }]`, sent in that order with the prompt
 * last — see `generateImage` in gemini.js.
 *
 * @throws {NoProviderError} if the tenant has no enabled Gemini key at all.
 * @returns {{ output: { base64, mimeType, text }, providerId: ObjectId }}
 */
async function routeGeminiCall({ tenant, modelId, prompt, images }) {
  const candidates = tenant.routableProviders("gemini");
  if (candidates.length === 0) {
    throw new NoProviderError("This organization has no Gemini key configured. Ask a super admin to add one.");
  }

  let usedEntry;
  let output;
  try {
    output = await withKeyFailover(candidates, async (entry) => {
      // Loaded fresh per attempt: `candidates` came off a query without
      // `+aiProviders.credential`, so the secret has to be fetched by id.
      const withCredential = await Tenant.loadProvider(tenant._id, entry._id);
      const apiKey = decryptSecret(withCredential.credential, { provider: "gemini" });

      try {
        const result = await generateImage({ apiKey, modelId, prompt, images });
        tenant.recordProviderSuccess(entry._id);
        usedEntry = entry;
        return result;
      } catch (err) {
        tenant.recordProviderFailure(entry._id, classifyError(err).code);
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

module.exports = { routeGeminiCall, loadTenantOrThrow, sendGenerationError, NoProviderError };

const mongoose = require("mongoose");
const { encryptSecret, fingerprintSecret, fingerprintMatches, hintSecret } = require("../secrets");

const PROVIDERS = ["openai", "gemini", "replicate", "fal", "stability", "bfl", "custom"];
const TENANT_STATUSES = ["active", "trial", "suspended", "archived"];

const credentialSchema = new mongoose.Schema(
  {
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true }, // 12 bytes, fresh per encryption, never reused
    authTag: { type: String, required: true },
    keyVersion: { type: Number, required: true }, // which KEK encrypted this; enables rotation
  },
  { _id: false }
);

const healthSchema = new mongoose.Schema(
  {
    lastUsedAt: Date,
    lastSuccessAt: Date,
    lastErrorAt: Date,
    lastErrorCode: String,
    consecutiveFailures: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const aiProviderSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true, enum: PROVIDERS },
    label: { type: String, required: true, trim: true },

    // NEVER plaintext, and never selected by default. Read it only through
    // Tenant.loadProvider() so the one place that needs the raw key is greppable.
    credential: { type: credentialSchema, required: true, select: false },

    keyHint: { type: String, required: true }, // "sk-…cdef" — safe to return to the UI
    keyFingerprint: { type: String, required: true }, // HMAC with a server pepper, not bare sha256

    // Some providers need an org/project id alongside the key (OpenAI's
    // org-scoped keys, for one). Not a secret, so it is stored in the clear.
    orgId: { type: String, default: null },

    // ── routing + failover ──
    enabled: { type: Boolean, default: true },
    priority: { type: Number, default: 10 }, // lower tried first
    health: { type: healthSchema, default: () => ({}) },

    // Optional: a super admin acting here may have no local User row of their own.
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

const tenantSchema = new mongoose.Schema(
  {
    // ── identity ──
    name: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      immutable: true, // baked into URLs; renaming would break every existing link
      lowercase: true,
      trim: true,
      match: [/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "slug must be lowercase, URL-safe"],
    },
    status: { type: String, enum: TENANT_STATUSES, default: "active" },

    // ── gen-AI credentials ──
    aiProviders: { type: [aiProviderSchema], default: [] },

    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

tenantSchema.index({ status: 1, deletedAt: 1 });

// Belt and braces over `select: false`: even a query that explicitly asks for
// the credential can't leak it through a JSON response.
tenantSchema.set("toJSON", {
  transform(doc, ret) {
    (ret.aiProviders || []).forEach((provider) => {
      delete provider.credential;
    });
    return ret;
  },
});

// The only place a raw API key enters the system. Both writers go through this
// one derivation so the ciphertext, the hint and the fingerprint can never
// drift apart — they always describe the same plaintext.
function credentialFrom(apiKey, provider) {
  return {
    credential: encryptSecret(apiKey, { provider }),
    keyHint: hintSecret(apiKey),
    keyFingerprint: fingerprintSecret(apiKey),
  };
}

/**
 * True when this tenant already holds this exact key. Compared by fingerprint,
 * so it works without ever decrypting anything.
 *
 * Deliberately keyed on the secret, not the provider: several keys for one
 * provider is a normal setup (separate quotas, separate billing), but the same
 * key twice is always a mistake — it would double an entry's weight in the
 * failover order while sharing one upstream rate limit.
 *
 * `exceptId` skips one entry, so rotating a key doesn't collide with itself.
 */
tenantSchema.methods.hasProviderKey = function hasProviderKey(apiKey, { exceptId } = {}) {
  return this.aiProviders.some(
    (entry) => String(entry._id) !== String(exceptId) && fingerprintMatches(apiKey, entry.keyFingerprint)
  );
};

tenantSchema.methods.addProvider = function addProvider({
  provider,
  label,
  apiKey,
  createdByUserId,
  priority,
  enabled,
}) {
  this.aiProviders.push({
    provider,
    label,
    ...credentialFrom(apiKey, provider),
    createdByUserId,
    ...(priority !== undefined && { priority }),
    ...(enabled !== undefined && { enabled }),
  });

  return this.aiProviders[this.aiProviders.length - 1];
};

// Replaces the key in place, keeping the subdocument _id so routing history and
// health stats survive a key rotation.
tenantSchema.methods.replaceProviderKey = function replaceProviderKey(providerId, apiKey) {
  const entry = this.aiProviders.id(providerId);
  if (!entry) throw new Error("provider not found on this tenant");

  entry.set(credentialFrom(apiKey, entry.provider));
  entry.health = {}; // a new key clears the old key's failure streak
  return entry;
};

// Loads one provider entry *with* its credential attached. Separate from the
// normal read path on purpose — callers have to ask for the secret by name.
tenantSchema.statics.loadProvider = async function loadProvider(tenantId, providerId) {
  const tenant = await this.findOne({ _id: tenantId, deletedAt: null })
    .select("+aiProviders.credential")
    .exec();

  return tenant?.aiProviders.id(providerId) || null;
};

// Failover order: enabled entries only, lowest priority first, and among equal
// priorities the one that has failed least recently.
tenantSchema.methods.routableProviders = function routableProviders(provider) {
  return this.aiProviders
    .filter((entry) => entry.enabled && (!provider || entry.provider === provider))
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        a.health.consecutiveFailures - b.health.consecutiveFailures ||
        (a.health.lastErrorAt?.getTime() || 0) - (b.health.lastErrorAt?.getTime() || 0)
    );
};

module.exports = mongoose.model("Tenant", tenantSchema);
module.exports.PROVIDERS = PROVIDERS;
module.exports.TENANT_STATUSES = TENANT_STATUSES;

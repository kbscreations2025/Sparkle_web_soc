const mongoose = require("mongoose");
const { GENERATION_TOOLS } = require("../generations");

/**
 * What `creditsPerUnit` and `providerRate` are each multiplied by.
 *
 * - `per_image`   — × the number of output images. Text to Image can ask for
 *                   five and Campaign Kit always renders four, so a flat
 *                   per-request price would sell five images for the price of
 *                   one.
 * - `per_request` — × 1, for the text-out routes, which return no images and
 *                   would otherwise be permanently free.
 * - `per_second`  — × clip length. Veo bills on duration, so an 8s clip costs
 *                   twice a 4s one and a flat price misprices both ends.
 */
const PRICING_UNITS = ["per_image", "per_request", "per_second"];

/** Currencies a provider's published rate can be quoted in. */
const PRICING_CURRENCIES = ["USD", "INR", "EUR", "GBP"];

/**
 * How narrowly a rule targets one call, scored so the most specific match
 * wins. Ordering is deliberate: a rule naming an exact model and size
 * ("3 Pro at 4K") targets a request far more precisely than a blanket
 * "anything in Text to Image", so model outranks tool. Organization sits
 * above everything — it is a negotiated exception and must not be shadowed by
 * a global rule, however specific that rule is.
 */
const SPECIFICITY_WEIGHTS = { tenantId: 16, modelId: 8, quality: 4, tool: 2 };

/**
 * What one unit of AI work costs — both what the provider charges us and what
 * we charge the customer — resolved per organization / tool / model / quality.
 *
 * Both numbers live on the same row on purpose. They are two views of one
 * commercial decision, and keeping the provider's published rate beside our
 * credit rate is what makes the margin inspectable: a super admin can see, in
 * one line, that 4K on 3 Pro costs us $0.24 and sells for 12 credits. Split
 * across two collections, the pair would drift the first time a provider
 * changed its price list.
 *
 * A null match field is a wildcard, so a handful of rules covers every route —
 * including ones that don't exist yet, which fall through to the catch-all.
 */
const creditPricingRuleSchema = new mongoose.Schema(
  {
    /**
     * The super admin's own name for this rule, shown in the console and on
     * the charge it produces. Free text and required: an unlabelled price
     * table is unreadable six months later, when the question is "why was
     * this run billed 12 credits?".
     */
    label: { type: String, required: true, trim: true, maxlength: 200 },

    // ── what this rule matches ────────────────────────────────────────────
    /**
     * Null means the rule applies to every organization — the normal case. A
     * value is a negotiated exception for one customer and outranks the
     * global rule.
     */
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", default: null },

    /** Null matches every tool. */
    tool: { type: String, enum: [...GENERATION_TOOLS, null], default: null },

    /**
     * The resolved API model id — `gemini-3-pro-image`, `veo-3.1-fast-generate-preview`,
     * `gpt-image-1`. Null matches every model.
     *
     * Free text rather than an enum: a model released after this was written
     * must be priceable by typing its id, without a deploy.
     */
    modelId: { type: String, default: null, trim: true, maxlength: 120 },

    /**
     * Null matches every quality. `4K`/`2K`/`1K` for Gemini images,
     * `high`/`medium`/`low` for gpt-image-1, `720p`/`1080p` for video — one
     * column serves all three, since a rule only ever matches one provider's
     * vocabulary at a time.
     */
    quality: { type: String, default: null, trim: true, maxlength: 20 },

    unit: { type: String, enum: PRICING_UNITS, default: "per_image", required: true },

    // ── the two rates ─────────────────────────────────────────────────────
    /**
     * What the provider actually charges us per unit, in `providerCurrency` —
     * their published list price, recorded by hand. Reference only: nothing
     * bills against it, and it is what makes the margin column meaningful.
     *
     * Nullable because a provider that has not published a rate for a model
     * is a real state, and guessing a number would be worse than showing none.
     */
    providerRate: { type: Number, default: null, min: 0 },
    providerCurrency: { type: String, enum: PRICING_CURRENCIES, default: "USD" },

    /** What we charge the customer per unit. This is the number that bills. */
    creditsPerUnit: { type: Number, required: true, min: 0 },

    /** Anything the label can't carry — why a rate was set where it was. */
    notes: { type: String, default: null, trim: true, maxlength: 1000 },

    // ── lifecycle ─────────────────────────────────────────────────────────
    effectiveFrom: { type: Date, required: true, default: () => new Date() },
    /**
     * Null while the rule is live; a timestamp once retired. Deleting from the
     * console stamps this rather than removing the row, so a charge made under
     * a rule that no longer applies can still be explained.
     */
    effectiveTo: { type: Date, default: null },

    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, collection: "credit_pricing_rules" }
);

// The resolver's query: live rules for this org, plus the global ones.
creditPricingRuleSchema.index({ tenantId: 1, effectiveTo: 1 });
// Narrowing by what the caller actually asked for.
creditPricingRuleSchema.index({ modelId: 1, tool: 1, quality: 1 });

/** True while the rule is live. */
creditPricingRuleSchema.virtual("active").get(function isActive() {
  return this.effectiveTo === null;
});

/** How narrowly this rule targets a call — see `SPECIFICITY_WEIGHTS`. */
creditPricingRuleSchema.methods.specificity = function specificity() {
  return (
    (this.tenantId ? SPECIFICITY_WEIGHTS.tenantId : 0) +
    (this.modelId ? SPECIFICITY_WEIGHTS.modelId : 0) +
    (this.quality ? SPECIFICITY_WEIGHTS.quality : 0) +
    (this.tool ? SPECIFICITY_WEIGHTS.tool : 0)
  );
};

/**
 * Every live rule that could price this call, most specific first.
 *
 * A rule matches when each of its named fields equals the request's, and a
 * null field matches anything. Ties on specificity go to the rule created
 * most recently, so re-adding a rule with a new rate takes effect without
 * having to retire the old one first.
 */
creditPricingRuleSchema.statics.findApplicable = async function findApplicable({
  tenantId = null,
  tool = null,
  modelId = null,
  quality = null,
} = {}) {
  const rules = await this.find({
    effectiveTo: null,
    effectiveFrom: { $lte: new Date() },
    tenantId: { $in: [tenantId, null] },
    tool: { $in: [tool, null] },
    modelId: { $in: [modelId, null] },
    quality: { $in: [quality, null] },
  }).exec();

  return rules.sort((a, b) => b.specificity() - a.specificity() || b.createdAt - a.createdAt);
};

module.exports = mongoose.model("CreditPricingRule", creditPricingRuleSchema);
module.exports.PRICING_UNITS = PRICING_UNITS;
module.exports.PRICING_CURRENCIES = PRICING_CURRENCIES;
module.exports.SPECIFICITY_WEIGHTS = SPECIFICITY_WEIGHTS;
